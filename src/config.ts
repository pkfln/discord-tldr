export interface Config {
  discordToken: string;
  discordClientId: string;
  discordGuildId: string;
  llmApiUrl: string;
  llmModel: string;
  llmTemperature: number;
  adminUserId?: string;
  userWindowLimit: number;
  userWindowMs: number;
  userDailyLimit: number;
  channelCooldownMs: number;
  maxScanMessages: number;
  maxPromptMessages: number;
  minMessagesToSummarize: number;
  summaryCacheTtlMs: number;
}

export interface BotConfig extends Config {
  llmApiKey: string;
}

export interface RegisterConfig extends Config {
  discordClientId: string;
}

const required = (name: string): string => {
  const value = Bun.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const optional = (name: string): string | undefined => {
  const value = Bun.env[name]?.trim();
  return value ? value : undefined;
};

const intEnv = (name: string, defaultValue: number, min = 1): number => {
  const raw = optional(name);
  if (!raw) return defaultValue;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(
      `${name} must be an integer greater than or equal to ${min}`
    );
  }
  return parsed;
};

const floatEnv = (name: string, defaultValue: number): number => {
  const raw = optional(name);
  if (!raw) return defaultValue;

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  return parsed;
};

const loadSharedConfig = (): Config => {
  const maxPromptMessages = intEnv("MAX_PROMPT_MESSAGES", 300, 10);

  return {
    discordToken: required("DISCORD_TOKEN"),
    discordClientId: optional("DISCORD_CLIENT_ID") ?? "",
    discordGuildId: optional("DISCORD_GUILD_ID") ?? "",
    llmApiUrl: optional("LLM_API_URL") ?? "https://api.openai.com/v1",
    llmModel: optional("LLM_MODEL") ?? "gpt-4o-mini",
    llmTemperature: floatEnv("LLM_TEMPERATURE", 0.2),
    adminUserId: optional("ADMIN_USER_ID"),
    userWindowLimit: intEnv("USER_RATE_LIMIT", 3),
    userWindowMs: intEnv("USER_RATE_WINDOW_MINUTES", 15) * 60 * 1000,
    userDailyLimit: intEnv("USER_DAILY_LIMIT", 25),
    channelCooldownMs: intEnv("CHANNEL_COOLDOWN_SECONDS", 30) * 1000,
    maxScanMessages: intEnv("MAX_SCAN_MESSAGES", 500, 100),
    maxPromptMessages: Math.min(maxPromptMessages, 300),
    minMessagesToSummarize: intEnv("MIN_MESSAGES_TO_SUMMARIZE", 3),
    summaryCacheTtlMs: intEnv("SUMMARY_CACHE_TTL_MINUTES", 15) * 60 * 1000,
  };
};

export const loadBotConfig = (): BotConfig => {
  return {
    ...loadSharedConfig(),
    llmApiKey: required("LLM_API_KEY"),
  };
};

export const loadRegisterConfig = (): RegisterConfig => {
  return {
    ...loadSharedConfig(),
    discordClientId: required("DISCORD_CLIENT_ID"),
  };
};
