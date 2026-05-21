import type { Config } from "./config";

interface WindowState {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  retryAt?: number;
}

export class RateLimiter {
  private readonly userWindows = new Map<string, WindowState>();
  private readonly userDailyWindows = new Map<string, WindowState>();
  private readonly channelCooldowns = new Map<string, number>();

  constructor(private readonly config: Config) {}

  check(userId: string, channelId: string): RateLimitResult {
    const now = Date.now();

    const channelRetryAt = this.channelCooldowns.get(channelId);
    if (channelRetryAt && channelRetryAt > now) {
      return {
        allowed: false,
        reason: "A TLDR was requested in this channel recently.",
        retryAt: channelRetryAt,
      };
    }

    if (userId === this.config.adminUserId) {
      return { allowed: true };
    }

    const windowResult = this.checkWindow(
      this.userWindows,
      userId,
      this.config.userWindowLimit,
      this.config.userWindowMs,
      now,
      `You have reached the limit of ${
        this.config.userWindowLimit
      } TLDR requests per ${Math.round(
        this.config.userWindowMs / 60_000
      )} minutes.`
    );
    if (!windowResult.allowed) return windowResult;

    return this.checkWindow(
      this.userDailyWindows,
      userId,
      this.config.userDailyLimit,
      24 * 60 * 60 * 1000,
      now,
      `You have reached the daily limit of ${this.config.userDailyLimit} TLDR requests.`
    );
  }

  commit(userId: string, channelId: string): void {
    const now = Date.now();
    this.channelCooldowns.set(channelId, now + this.config.channelCooldownMs);

    if (userId === this.config.adminUserId) return;

    this.incrementWindow(
      this.userWindows,
      userId,
      this.config.userWindowMs,
      now
    );
    this.incrementWindow(
      this.userDailyWindows,
      userId,
      24 * 60 * 60 * 1000,
      now
    );
  }

  private checkWindow(
    store: Map<string, WindowState>,
    key: string,
    limit: number,
    windowMs: number,
    now: number,
    reason: string
  ): RateLimitResult {
    const current = store.get(key);
    if (!current || current.resetAt <= now) {
      return { allowed: true };
    }

    if (current.count >= limit) {
      return { allowed: false, reason, retryAt: current.resetAt };
    }

    return { allowed: true };
  }

  private incrementWindow(
    store: Map<string, WindowState>,
    key: string,
    windowMs: number,
    now: number
  ): void {
    const current = store.get(key);
    if (!current || current.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }

    current.count += 1;
  }
}
