import type { Config } from "../config";
import type {
  FormattedMessage,
  MessageCollectionResult,
  PromptParticipant,
  TldrMode,
} from "../types";
import {
  ChannelType,
  PermissionFlagsBits,
  type Message,
  type NewsChannel,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";

export type HistoryChannel = TextChannel | NewsChannel | ThreadChannel;

interface ParticipantDraft {
  authorId: string;
  handle: string;
  mention: string;
  aliases: string[];
}

interface CollectMessagesOptions {
  mode: TldrMode;
  invokingUserId: string;
  botUserId: string;
  timestampMs?: number;
  count?: number;
  config: Config;
}

export const isHistoryChannel = (
  channel: unknown
): channel is HistoryChannel => {
  if (!channel || typeof channel !== "object") return false;

  const candidate = channel as { type?: ChannelType; messages?: unknown };
  return (
    (candidate.type === ChannelType.GuildText ||
      candidate.type === ChannelType.GuildAnnouncement ||
      candidate.type === ChannelType.PublicThread ||
      candidate.type === ChannelType.PrivateThread ||
      candidate.type === ChannelType.AnnouncementThread) &&
    Boolean(candidate.messages)
  );
};

export const missingPermissions = (
  channel: HistoryChannel,
  botUserId: string
): string[] => {
  const permissions = channel.permissionsFor(botUserId);
  const missing: string[] = [];

  if (!permissions?.has(PermissionFlagsBits.ViewChannel))
    missing.push("View Channel");
  if (!permissions?.has(PermissionFlagsBits.ReadMessageHistory))
    missing.push("Read Message History");
  if (!permissions?.has(PermissionFlagsBits.SendMessages))
    missing.push("Send Messages");

  return missing;
};

export const collectMessages = async (
  channel: HistoryChannel,
  options: CollectMessagesOptions
): Promise<MessageCollectionResult> => {
  switch (options.mode) {
    case "since_last_message":
      return collectSinceLastMessage(channel, options);
    case "since_timestamp":
      return collectSinceTimestamp(channel, options);
    case "last_messages":
      return collectLastMessages(channel, options);
  }
};

const collectSinceLastMessage = async (
  channel: HistoryChannel,
  options: CollectMessagesOptions
): Promise<MessageCollectionResult> => {
  const scanned = await fetchBackward(channel, options.config.maxScanMessages);
  const marker = scanned.find(
    (message) => message.author.id === options.invokingUserId && !message.system
  );

  if (!marker) {
    const fallback = scanned.slice(0, 100);
    return buildResult(
      fallback,
      options,
      "I could not find your previous message in the scan window, so I summarized the latest 100 messages instead."
    );
  }

  const newer = scanned.filter(
    (message) => message.createdTimestamp > marker.createdTimestamp
  );
  return buildResult(newer, options, undefined, marker.createdTimestamp);
};

const collectSinceTimestamp = async (
  channel: HistoryChannel,
  options: CollectMessagesOptions
): Promise<MessageCollectionResult> => {
  if (options.timestampMs == null) {
    throw new Error("timestampMs is required for since_timestamp mode");
  }

  const messages: Message[] = [];
  let before: string | undefined;
  let scanned = 0;
  let stoppedByTimestamp = false;

  while (scanned < options.config.maxScanMessages) {
    const limit = Math.min(100, options.config.maxScanMessages - scanned);
    const page = await channel.messages.fetch({ limit, before });
    const pageMessages = Array.from(page.values());
    if (pageMessages.length === 0) break;

    scanned += pageMessages.length;
    for (const message of pageMessages) {
      if (message.createdTimestamp > options.timestampMs) {
        messages.push(message);
      } else {
        stoppedByTimestamp = true;
      }
    }

    if (stoppedByTimestamp) break;
    before = pageMessages.at(-1)?.id;
    if (!before) break;
  }

  const note = stoppedByTimestamp
    ? undefined
    : `I scanned the latest ${options.config.maxScanMessages} messages and capped the history there for cost control.`;

  return buildResult(messages, options, note, options.timestampMs);
};

const collectLastMessages = async (
  channel: HistoryChannel,
  options: CollectMessagesOptions
): Promise<MessageCollectionResult> => {
  const count = Math.min(
    options.count ?? 100,
    options.config.maxPromptMessages
  );
  const messages = await fetchBackward(channel, count);
  return buildResult(messages, options);
};

const fetchBackward = async (
  channel: HistoryChannel,
  maxMessages: number
): Promise<Message[]> => {
  const messages: Message[] = [];
  let before: string | undefined;

  while (messages.length < maxMessages) {
    const limit = Math.min(100, maxMessages - messages.length);
    const page = await channel.messages.fetch({ limit, before });
    const pageMessages = Array.from(page.values());
    if (pageMessages.length === 0) break;

    messages.push(...pageMessages);
    before = pageMessages.at(-1)?.id;
    if (!before) break;
  }

  return messages;
};

const buildResult = (
  messages: Message[],
  options: CollectMessagesOptions,
  note?: string,
  scopeStartTimestamp?: number
): MessageCollectionResult => {
  const included = messages
    .filter((message) => shouldIncludeMessage(message, options.botUserId))
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .slice(-options.config.maxPromptMessages);

  const participants = buildParticipants(included);
  const formatted = included.map((message) => {
    const participant = participants.byAuthorId.get(message.author.id);
    if (!participant)
      throw new Error(`Missing prompt participant for ${message.author.id}`);

    return formatMessage(message, participant.handle);
  });

  const latest = formatted.at(-1);
  const cappedNote =
    formatted.length >= options.config.maxPromptMessages
      ? `I capped the summary input at the latest ${options.config.maxPromptMessages} useful messages for cost control.`
      : undefined;

  return {
    messages: formatted,
    participants: participants.list,
    note: [note, cappedNote].filter(Boolean).join(" "),
    latestMessageId: latest?.id,
    latestMessageTimestamp: latest?.createdTimestamp,
    scopeStartTimestamp,
  };
};

const shouldIncludeMessage = (message: Message, botUserId: string): boolean => {
  if (message.system) return false;
  if (message.author.bot) return false;
  if (message.author.id === botUserId) return false;

  return formatMessageBody(message).length > 0;
};

const formatMessage = (
  message: Message,
  authorHandle: string
): FormattedMessage => {
  return {
    id: message.id,
    authorId: message.author.id,
    createdTimestamp: message.createdTimestamp,
    formatted: `${authorHandle}: ${truncate(
      sanitizeTranscriptText(formatMessageBody(message)),
      1000
    )}`,
  };
};

const buildParticipants = (
  messages: Message[]
): {
  list: PromptParticipant[];
  byAuthorId: Map<string, PromptParticipant>;
} => {
  const draftsByAuthorId = new Map<string, ParticipantDraft>();

  for (const message of messages) {
    const existing = draftsByAuthorId.get(message.author.id);
    if (existing) {
      existing.aliases = mergeAliases(existing.aliases, aliasesFor(message));
      continue;
    }

    const handle = sanitizeHandle(message.author.username);
    if (!handle)
      throw new Error(
        `Discord username sanitized to empty: ${message.author.id}`
      );

    const participant: ParticipantDraft = {
      authorId: message.author.id,
      handle,
      mention: `<@${message.author.id}>`,
      aliases: aliasesFor(message),
    };
    draftsByAuthorId.set(message.author.id, participant);
  }

  const drafts = Array.from(draftsByAuthorId.values());
  const entries = drafts.map((participant) => {
    const promptParticipant: PromptParticipant = {
      handle: participant.handle,
      mention: participant.mention,
      aliases: participant.aliases.filter(
        (alias) => alias.toLocaleLowerCase() !== participant.handle
      ),
    };

    return [participant.authorId, promptParticipant] as const;
  });
  const byAuthorId = new Map(entries);
  const list = entries.map(([, participant]) => participant);

  return { list, byAuthorId };
};

const aliasesFor = (message: Message): string[] => {
  const candidates = [message.member?.displayName, message.author.globalName];

  return mergeAliases(
    [],
    candidates
      .filter((value): value is string => Boolean(value))
      .map(sanitizeAlias)
      .filter(isUsefulAlias)
      .slice(0, 3)
  );
};

const mergeAliases = (existing: string[], incoming: string[]): string[] => {
  const seen = new Set(existing.map((alias) => alias.toLocaleLowerCase()));
  const merged = [...existing];

  for (const alias of incoming) {
    const key = alias.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(alias);
  }

  return merged.slice(0, 3);
};

const formatMessageBody = (message: Message): string => {
  const parts: string[] = [];
  const content = message.content.trim();
  if (content) parts.push(content);

  for (const attachment of message.attachments.values()) {
    parts.push(`[attachment: ${attachment.name ?? "file"}]`);
  }

  for (const embed of message.embeds) {
    const label = embed.title ?? embed.url ?? "embed";
    parts.push(`[embed: ${truncate(label, 80)}]`);
  }

  return parts.join(" ").trim();
};

const sanitizeTranscriptText = (value: string): string =>
  value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

const sanitizeAlias = (value: string): string =>
  value
    .normalize("NFKC")
    .replace(/<@!?\d+>/g, " ")
    .replace(/[`*_~|\\[\]{}()<>"#:;=/]+/g, " ")
    .replace(/[^\p{L}\p{N} ._'’-]+/gu, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 32)
    .trim();

const sanitizeHandle = (value: string): string =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_.]+/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 32);

const INSTRUCTION_ALIAS_RE =
  /\b(ignore|disregard|forget|previous|above|system|developer|assistant|prompt|instruction|instructions|rules|role|output|respond|reply|json|markdown|tool|function)\b/i;

const isUsefulAlias = (value: string): boolean => {
  if (value.length < 2) return false;
  if (INSTRUCTION_ALIAS_RE.test(value)) return false;

  return /[\p{L}\p{N}]/u.test(value);
};

const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
};
