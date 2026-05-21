const DISCORD_TIMESTAMP_RE = /^<t:(\d{1,13})(?::[tTdDfFR])?>$/;

export const parseTimestamp = (input: string): number | null => {
  const value = input.trim();
  if (!value) return null;

  const discordMatch = DISCORD_TIMESTAMP_RE.exec(value);
  if (discordMatch?.[1]) {
    return Number.parseInt(discordMatch[1], 10) * 1000;
  }

  if (/^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    if (value.length <= 10) return parsed * 1000;
    if (value.length <= 13) return parsed;
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;

  return parsed;
};

export const formatRelativeRetry = (retryAt: number): string => {
  const seconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;

  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
};
