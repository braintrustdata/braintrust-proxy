import { Cache } from "./index";
import {
  RateLimit,
  RateLimitResponse,
  rateLimitWindowSchema,
} from "@schema/rate_limits";

const RATE_LIMIT_CACHE_PREFIX = "rate-limit:";

interface RateLimiterCacheValue {
  points: number;
  resetAt: number;
}

export class RateLimiter {
  private cache: Cache;

  constructor(cache: Cache) {
    this.cache = cache;
  }

  private getWindowSeconds(window: typeof rateLimitWindowSchema._type): number {
    switch (window) {
      case "minute":
        return 60;
      case "hour":
        return 3600;
      case "day":
        return 86400;
    }
  }

  private getCacheKey(idKey: string, resourceId: string): string {
    return `${RATE_LIMIT_CACHE_PREFIX}${idKey}:${resourceId}`;
  }

  async checkLimit(
    idKey: string,
    limit: RateLimit,
  ): Promise<RateLimitResponse> {
    const now = Date.now();
    const windowSeconds = this.getWindowSeconds(limit.window);
    const windowMs = windowSeconds * 1000;
    const cacheKey = this.getCacheKey(idKey, limit.resource_id);

    const cachedValue = await this.cache.get<RateLimiterCacheValue>(cacheKey);

    if (cachedValue && cachedValue.resetAt > now) {
      // We're still in the current window
      if (cachedValue.points >= limit.limit) {
        // Rate limit exceeded
        return {
          type: "exceeded",
          try_again_seconds: Math.ceil((cachedValue.resetAt - now) / 1000),
        };
      }

      // Increment the counter
      const newValue: RateLimiterCacheValue = {
        points: cachedValue.points + 1,
        resetAt: cachedValue.resetAt,
      };
      await this.cache.set(cacheKey, newValue, {
        ttl: Math.ceil((cachedValue.resetAt - now) / 1000),
      });

      return {
        type: "ok",
        remaining: limit.limit - newValue.points,
      };
    } else {
      // New window or no cached value
      const resetAt = now + windowMs;
      const newValue: RateLimiterCacheValue = {
        points: 1,
        resetAt,
      };
      await this.cache.set(cacheKey, newValue, {
        ttl: windowSeconds,
      });

      return {
        type: "ok",
        remaining: limit.limit - 1,
      };
    }
  }

  async checkLimits(
    idKey: string,
    limits: RateLimit[],
  ): Promise<RateLimitResponse[]> {
    return Promise.all(limits.map((limit) => this.checkLimit(idKey, limit)));
  }
}
