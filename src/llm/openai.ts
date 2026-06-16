import type { BotConfig } from "../config";
import type { SummaryJson } from "../types";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

const SYSTEM_PROMPT = `You summarize a casual Discord channel for someone catching up.

Write a TL;DR that lets someone understand the actual conversation, not just the broad categories of what happened. Be specific enough that the reader learns what people said, reacted to, decided, planned, joked about, argued over, or linked.

Return valid JSON only:
{
  "summary": string
}

Rules:
- Use only the provided messages. Do not invent details or infer facts that are not supported.
- Name the specific topics, claims, decisions, jokes, links, or media when they matter.
- Preserve useful context: who raised a topic, what people agreed or disagreed about, why a joke landed, and how the conversation moved from one topic to another.
- Avoid vague filler like "the group was joking around", "the conversation took a humorous turn", or "people reacted in a funny way" unless you also explain the concrete subject of the joke or reaction.
- Do not write meeting notes or a transcript. Write like a friend catching someone up.
- Keep it compact, usually one to three short paragraphs. Use more detail for dense conversations and less for simple ones.
- If the messages are mostly banter, summarize the actual bit instead of flattening it into "banter".
- Mention shared links, images, GIFs, videos, or media placeholders by describing their apparent role in the conversation.
- Do not mention that you are an AI.
- Do not quote long text.
- Do not include message IDs.
- Do not include sensitive personal details unless essential to understanding the discussion.`;

export class LlmClient {
  constructor(
    private readonly config: BotConfig,
    private readonly fetcher: Fetcher = fetch
  ) {}

  async summarize(messages: string): Promise<SummaryJson> {
    const userPrompt = buildUserPrompt(messages);
    const requestMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];

    if (Bun.env.NODE_ENV === "development") {
      console.log("LLM prompt", JSON.stringify(requestMessages, null, 2));
    }

    const response = await this.fetcher(
      `${this.config.llmApiUrl.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.llmApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.llmModel,
          temperature: this.config.llmTemperature,
          response_format: { type: "json_object" },
          messages: requestMessages,
        }),
      }
    );

    if (!response.ok) {
      console.error("LLM request failed", {
        status: response.status,
        requestId: response.headers.get("x-request-id"),
      });
      throw new Error("LLM request failed");
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      console.error("LLM response did not include message content");
      throw new Error("LLM response was empty");
    }

    return normalizeSummary(parseSummaryJson(content));
  }
}

const buildUserPrompt = (messages: string): string =>
  `Messages:\n${messages}`;

const parseSummaryJson = (content: string): unknown => {
  const trimmed = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("LLM response was not valid JSON");
    }
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }
};

const normalizeSummary = (value: unknown): SummaryJson => {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  return {
    summary: summaryText(record.summary),
  };
};

const summaryText = (value: unknown): string => {
  if (typeof value === "string") return cleanSummary(value);

  if (Array.isArray(value)) {
    return cleanSummary(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .join("\n\n")
    );
  }

  return "";
};

const cleanSummary = (value: string): string => {
  return value
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};
