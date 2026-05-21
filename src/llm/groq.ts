import type { BotConfig } from "../config";
import type { SummaryJson, TldrStyle } from "../types";

interface GroqResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const SYSTEM_PROMPT =
  "You summarize a casual Discord channel for someone catching up. Be concise, factual, and natural. Use only the provided messages. Do not invent details. Capture what people were actually talking about, including jokes, plans, links, arguments, memes, and context when they matter. Do not make it sound like meeting notes. Return valid JSON only.";

export class GroqClient {
  constructor(private readonly config: BotConfig) {}

  async summarize(messages: string, style: TldrStyle): Promise<SummaryJson> {
    const userPrompt = buildUserPrompt(messages, style);
    const requestMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];

    if (Bun.env.NODE_ENV === "development") {
      console.log("Groq prompt", JSON.stringify(requestMessages, null, 2));
    }

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.groqApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.groqModel,
          temperature: this.config.groqTemperature,
          response_format: { type: "json_object" },
          messages: requestMessages,
        }),
      }
    );

    if (!response.ok) {
      console.error("Groq request failed", {
        status: response.status,
        requestId: response.headers.get("x-request-id"),
      });
      throw new Error("Groq request failed");
    }

    const payload = (await response.json()) as GroqResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      console.error("Groq response did not include message content");
      throw new Error("Groq response was empty");
    }

    return normalizeSummary(parseSummaryJson(content));
  }
}

const buildUserPrompt = (
  messages: string,
  style: TldrStyle
): string => `Summarize these Discord messages for a user who missed them.

Style: ${style}
Output JSON shape:
{
  "summary": string
}

Rules:
- For brief mode, write one short paragraph.
- For detailed mode, write two or three short paragraphs.
- Make it read like a friend catching someone up, not a corporate recap.
- Mention the overall vibe if the chat was mostly joking, arguing, planning, or random banter.
- Include concrete topics, links, shared media placeholders, and notable context when useful.
- Do not mention that you are an AI.
- Do not quote long text.
- Do not include message IDs.
- Do not include sensitive personal details unless essential to the discussion.

Messages:
${messages}`;

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
      throw new Error("Groq response was not valid JSON");
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
