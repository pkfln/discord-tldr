export type TldrMode =
  | "since_last_message"
  | "since_timestamp"
  | "last_messages";

export type TldrStyle = "brief" | "detailed";

export interface FormattedMessage {
  id: string;
  authorId: string;
  createdTimestamp: number;
  formatted: string;
}

export interface MessageCollectionResult {
  messages: FormattedMessage[];
  note?: string;
  latestMessageId?: string;
  latestMessageTimestamp?: number;
  scopeStartTimestamp?: number;
}

export interface SummaryJson {
  summary: string;
}

export interface SummaryCacheEntry {
  key: string;
  renderedSummary: string;
  latestMessageId?: string;
  latestMessageTimestamp?: number;
  createdAt: number;
}
