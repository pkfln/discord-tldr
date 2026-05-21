import type { Config } from "../config";
import type {
  FormattedMessage,
  MessageCollectionResult,
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
  const formatted = messages
    .filter((message) => shouldIncludeMessage(message, options.botUserId))
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .slice(-options.config.maxPromptMessages)
    .map(formatMessage);

  const latest = formatted.at(-1);
  const cappedNote =
    formatted.length >= options.config.maxPromptMessages
      ? `I capped the summary input at the latest ${options.config.maxPromptMessages} useful messages for cost control.`
      : undefined;

  return {
    messages: formatted,
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

const formatMessage = (message: Message): FormattedMessage => {
  const displayName =
    message.member?.displayName ??
    message.author.globalName ??
    message.author.username;
  return {
    id: message.id,
    authorId: message.author.id,
    createdTimestamp: message.createdTimestamp,
    formatted: `${displayName}: ${truncate(formatMessageBody(message), 1000)}`,
  };
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

const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
};
