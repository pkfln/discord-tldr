import type { Config } from "../config";
import {
  collectMessages,
  isHistoryChannel,
  missingPermissions,
} from "../discord/messages";
import type { LlmClient } from "../llm/openai";
import type { RateLimiter } from "../rateLimit";
import { formatRelativeRetry, parseTimestamp } from "../time";
import type {
  SummaryCacheEntry,
  SummaryJson,
  TldrMode,
} from "../types";
import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";

export const tldrCommand = new SlashCommandBuilder()
  .setName("tldr")
  .setDescription("Summarize recent activity in this channel.")
  .addStringOption((option) =>
    option
      .setName("mode")
      .setDescription("Which messages to summarize.")
      .addChoices(
        { name: "Since my last message", value: "since_last_message" },
        { name: "Since timestamp", value: "since_timestamp" },
        { name: "Last messages", value: "last_messages" }
      )
  )
  .addStringOption((option) =>
    option
      .setName("timestamp")
      .setDescription("ISO timestamp, Unix time, or Discord timestamp markup.")
  )
  .addIntegerOption((option) =>
    option
      .setName("count")
      .setDescription("Number of recent messages for last_messages mode.")
      .setMinValue(10)
      .setMaxValue(300)
  );

const summaryCache = new Map<string, SummaryCacheEntry>();

interface TldrDependencies {
  config: Config;
  llm: LlmClient;
  rateLimiter: RateLimiter;
}

export const handleTldrCommand = async (
  interaction: ChatInputCommandInteraction,
  deps: TldrDependencies
): Promise<void> => {
  const mode =
    (interaction.options.getString("mode") as TldrMode | null) ??
    "since_last_message";
  const count =
    mode === "last_messages"
      ? interaction.options.getInteger("count") ?? 100
      : undefined;
  const timestampInput = interaction.options.getString("timestamp");
  const parsedTimestampMs =
    mode === "since_timestamp"
      ? parseTimestamp(timestampInput ?? "")
      : undefined;
  const timestampMs = parsedTimestampMs ?? undefined;

  if (mode === "since_timestamp" && parsedTimestampMs === null) {
    await interaction.reply({
      content:
        "I could not parse that timestamp. Use ISO like `2026-05-21T10:00:00Z`, Unix seconds, Unix milliseconds, or Discord markup like `<t:1716230400:R>`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    !interaction.inGuild() ||
    !interaction.channel ||
    !isHistoryChannel(interaction.channel)
  ) {
    await interaction.reply({
      content:
        "I can only summarize guild text channels and threads where message history is available.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const botUserId = interaction.client.user?.id;
  if (!botUserId) {
    await interaction.reply({
      content: "The bot is not ready yet. Please try again in a moment.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const missing = missingPermissions(interaction.channel, botUserId);
  if (missing.length > 0) {
    await interaction.reply({
      content: `I need these channel permissions before I can summarize here: ${missing.join(
        ", "
      )}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const rateLimit = deps.rateLimiter.check(
    interaction.user.id,
    interaction.channel.id
  );
  if (!rateLimit.allowed) {
    await interaction.reply({
      content: `${
        rateLimit.reason ?? "You are being rate limited"
      } Try again in ${formatRelativeRetry(
        rateLimit.retryAt ?? Date.now() + 60_000
      )}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const collection = await collectMessages(interaction.channel, {
    mode,
    invokingUserId: interaction.user.id,
    botUserId,
    timestampMs,
    count,
    config: deps.config,
  });

  const cacheKey = buildCacheKey({
    channelId: interaction.channel.id,
    mode,
    userId: interaction.user.id,
    timestampMs,
    scopeStartTimestamp: collection.scopeStartTimestamp,
    count,
  });
  const cached = getFreshCache(cacheKey, deps.config.summaryCacheTtlMs);
  const cachedLatestTimestamp = cached?.latestMessageTimestamp;
  const newMessages = cachedLatestTimestamp
    ? collection.messages.filter(
        (message) => message.createdTimestamp > cachedLatestTimestamp
      )
    : collection.messages;

  deps.rateLimiter.commit(interaction.user.id, interaction.channel.id);

  if (
    collection.messages.length < deps.config.minMessagesToSummarize &&
    !cached
  ) {
    await interaction.editReply(
      `I found only ${collection.messages.length} useful message${
        collection.messages.length === 1 ? "" : "s"
      } to summarize. Try a wider range.`
    );
    return;
  }

  if (cached && newMessages.length === 0) {
    await interaction.editReply(
      withNote(cached.renderedSummary, collection.note)
    );
    return;
  }

  const promptMessages = buildPromptMessages(
    collection.messages,
    cached,
    newMessages
  );

  try {
    const summary = await deps.llm.summarize(promptMessages);
    const rendered = renderSummary(summary, collection.note);
    summaryCache.set(cacheKey, {
      key: cacheKey,
      renderedSummary: rendered,
      latestMessageId: collection.latestMessageId,
      latestMessageTimestamp: collection.latestMessageTimestamp,
      createdAt: Date.now(),
    });

    await interaction.editReply(rendered);
  } catch (error) {
    console.error("Failed to complete TLDR command", {
      error: error instanceof Error ? error.message : "unknown error",
      channelId: interaction.channel.id,
      guildId: interaction.guildId,
    });
    await interaction.editReply(
      "I could not summarize these messages right now. Please try again later."
    );
  }
};

const buildPromptMessages = (
  allMessages: Array<{ formatted: string }>,
  cached: SummaryCacheEntry | undefined,
  newMessages: Array<{ formatted: string }>
): string => {
  if (!cached)
    return allMessages.map((message) => message.formatted).join("\n");

  return [
    "Previous TLDR context:",
    cached.renderedSummary,
    "",
    "New messages since that TLDR:",
    ...newMessages.map((message) => message.formatted),
  ].join("\n");
};

const buildCacheKey = (input: {
  channelId: string;
  mode: TldrMode;
  userId: string;
  timestampMs?: number;
  scopeStartTimestamp?: number;
  count?: number;
}): string => {
  const userPart = input.mode === "since_last_message" ? input.userId : "any";
  const startPart = input.scopeStartTimestamp ?? input.timestampMs ?? "none";
  return [
    input.channelId,
    input.mode,
    userPart,
    startPart,
    input.count ?? "none",
  ].join(":");
};

const getFreshCache = (
  key: string,
  ttlMs: number
): SummaryCacheEntry | undefined => {
  const cached = summaryCache.get(key);
  if (!cached) return undefined;

  if (Date.now() - cached.createdAt > ttlMs) {
    summaryCache.delete(key);
    return undefined;
  }

  return cached;
};

const renderSummary = (summary: SummaryJson, note?: string): string => {
  const body =
    summary.summary.length > 0
      ? `**TL;DR**\n${summary.summary}`
      : "I could not find enough meaningful discussion to summarize.";
  return trimDiscordMessage(withNote(body, note));
};

const withNote = (message: string, note?: string): string => {
  if (!note) return trimDiscordMessage(message);
  return trimDiscordMessage(`_${note}_\n\n${message}`);
};

const trimDiscordMessage = (message: string): string => {
  if (message.length <= 1900) return message;

  const lines = message.split("\n");
  while (lines.length > 1 && `${lines.join("\n")}\n...`.length > 1900) {
    lines.pop();
  }
  return `${lines.join("\n")}\n...`;
};
