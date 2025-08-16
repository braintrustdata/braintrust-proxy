import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { RateLimiter } from "./rate-limiter";
import { Cache } from "./index";
import {
  RateLimit,
  RateLimitResponse,
  mergeRateLimitResponses,
} from "@schema/rate_limits";

class InMemoryCache implements Cache {
  private store: Map<string, { value: any; expiresAt?: number }> = new Map();

  async get<T>(key: string): Promise<T | null> {
    const item = this.store.get(key);
    if (!item) return null;

    if (item.expiresAt && item.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }

    return item.value as T;
  }

  async set<T>(
    key: string,
    value: T,
    options?: { ttl?: number },
  ): Promise<void> {
    const expiresAt = options?.ttl
      ? Date.now() + options.ttl * 1000
      : undefined;
    this.store.set(key, { value, expiresAt });
  }

  clear() {
    this.store.clear();
  }
}

describe("RateLimiter", () => {
  let cache: InMemoryCache;
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    cache = new InMemoryCache();
    rateLimiter = new RateLimiter(cache);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should allow requests within the limit", async () => {
    const limit: RateLimit = {
      resource_id: "test-resource",
      limit: 5,
      window: "minute",
    };

    for (let i = 0; i < 5; i++) {
      const response = await rateLimiter.checkLimit("user-123", limit);
      expect(response.type).toBe("ok");
      if (response.type === "ok") {
        expect(response.remaining).toBe(5 - i - 1);
      }
    }
  });

  it("should block requests exceeding the limit", async () => {
    const limit: RateLimit = {
      resource_id: "test-resource",
      limit: 3,
      window: "minute",
    };

    // Use up the limit
    for (let i = 0; i < 3; i++) {
      await rateLimiter.checkLimit("user-123", limit);
    }

    // Next request should be blocked
    const response = await rateLimiter.checkLimit("user-123", limit);
    expect(response.type).toBe("exceeded");
    if (response.type === "exceeded") {
      expect(response.try_again_seconds).toBeGreaterThan(0);
      expect(response.try_again_seconds).toBeLessThanOrEqual(60);
    }
  });

  it("should reset limits after the window expires", async () => {
    const limit: RateLimit = {
      resource_id: "test-resource",
      limit: 2,
      window: "minute",
    };

    // Use up the limit
    for (let i = 0; i < 2; i++) {
      await rateLimiter.checkLimit("user-123", limit);
    }

    // Should be blocked
    let response = await rateLimiter.checkLimit("user-123", limit);
    expect(response.type).toBe("exceeded");

    // Advance time by 61 seconds
    vi.advanceTimersByTime(61 * 1000);

    // Should be allowed again
    response = await rateLimiter.checkLimit("user-123", limit);
    expect(response.type).toBe("ok");
    if (response.type === "ok") {
      expect(response.remaining).toBe(1);
    }
  });

  it("should track different resources independently", async () => {
    const limit1: RateLimit = {
      resource_id: "resource-1",
      limit: 2,
      window: "minute",
    };

    const limit2: RateLimit = {
      resource_id: "resource-2",
      limit: 3,
      window: "minute",
    };

    // Use up limit1
    for (let i = 0; i < 2; i++) {
      await rateLimiter.checkLimit("user-123", limit1);
    }

    // limit1 should be exceeded
    let response = await rateLimiter.checkLimit("user-123", limit1);
    expect(response.type).toBe("exceeded");

    // limit2 should still be available
    response = await rateLimiter.checkLimit("user-123", limit2);
    expect(response.type).toBe("ok");
    if (response.type === "ok") {
      expect(response.remaining).toBe(2);
    }
  });

  it("should track different users independently", async () => {
    const limit: RateLimit = {
      resource_id: "test-resource",
      limit: 2,
      window: "minute",
    };

    // Use up limit for user-123
    for (let i = 0; i < 2; i++) {
      await rateLimiter.checkLimit("user-123", limit);
    }

    // user-123 should be exceeded
    let response = await rateLimiter.checkLimit("user-123", limit);
    expect(response.type).toBe("exceeded");

    // user-456 should still be available
    response = await rateLimiter.checkLimit("user-456", limit);
    expect(response.type).toBe("ok");
    if (response.type === "ok") {
      expect(response.remaining).toBe(1);
    }
  });

  it("should handle hour window correctly", async () => {
    const limit: RateLimit = {
      resource_id: "test-resource",
      limit: 10,
      window: "hour",
    };

    // Use some requests
    for (let i = 0; i < 5; i++) {
      await rateLimiter.checkLimit("user-123", limit);
    }

    // Advance time by 30 minutes - should still be in same window
    vi.advanceTimersByTime(30 * 60 * 1000);

    const response = await rateLimiter.checkLimit("user-123", limit);
    expect(response.type).toBe("ok");
    if (response.type === "ok") {
      expect(response.remaining).toBe(4);
    }
  });

  it("should handle day window correctly", async () => {
    const limit: RateLimit = {
      resource_id: "test-resource",
      limit: 100,
      window: "day",
    };

    // Use some requests
    for (let i = 0; i < 50; i++) {
      await rateLimiter.checkLimit("user-123", limit);
    }

    const response = await rateLimiter.checkLimit("user-123", limit);
    expect(response.type).toBe("ok");
    if (response.type === "ok") {
      expect(response.remaining).toBe(49);
    }
  });

  it("should check multiple limits correctly", async () => {
    const limits: RateLimit[] = [
      {
        resource_id: "resource-1",
        limit: 5,
        window: "minute",
      },
      {
        resource_id: "resource-2",
        limit: 10,
        window: "hour",
      },
    ];

    const responses = await rateLimiter.checkLimits("user-123", limits);
    expect(responses).toHaveLength(2);
    expect(responses[0].type).toBe("ok");
    expect(responses[1].type).toBe("ok");
  });

  it("should correctly calculate try_again_seconds", async () => {
    const limit: RateLimit = {
      resource_id: "test-resource",
      limit: 1,
      window: "minute",
    };

    // Use up the limit
    await rateLimiter.checkLimit("user-123", limit);

    // Advance time by 30 seconds
    vi.advanceTimersByTime(30 * 1000);

    // Should be blocked with ~30 seconds remaining
    const response = await rateLimiter.checkLimit("user-123", limit);
    expect(response.type).toBe("exceeded");
    if (response.type === "exceeded") {
      expect(response.try_again_seconds).toBeGreaterThanOrEqual(29);
      expect(response.try_again_seconds).toBeLessThanOrEqual(31);
    }
  });
});

describe("mergeRateLimitResponses", () => {
  it("should return ok when all responses are ok", () => {
    const responses: RateLimitResponse[] = [
      { type: "ok", remaining: 10 },
      { type: "ok", remaining: 5 },
      { type: "ok" },
    ];

    const result = mergeRateLimitResponses(responses);
    expect(result.type).toBe("ok");
    if (result.type === "ok") {
      expect(result.remaining).toBe(5); // Should be the minimum
    }
  });

  it("should return exceeded when any response is exceeded", () => {
    const responses: RateLimitResponse[] = [
      { type: "ok", remaining: 10 },
      { type: "exceeded", try_again_seconds: 30 },
      { type: "ok", remaining: 5 },
    ];

    const result = mergeRateLimitResponses(responses);
    expect(result.type).toBe("exceeded");
    if (result.type === "exceeded") {
      expect(result.try_again_seconds).toBe(30);
    }
  });

  it("should return maximum try_again_seconds when multiple are exceeded", () => {
    const responses: RateLimitResponse[] = [
      { type: "exceeded", try_again_seconds: 30 },
      { type: "exceeded", try_again_seconds: 60 },
      { type: "exceeded", try_again_seconds: 45 },
    ];

    const result = mergeRateLimitResponses(responses);
    expect(result.type).toBe("exceeded");
    if (result.type === "exceeded") {
      expect(result.try_again_seconds).toBe(60); // Should be the maximum
    }
  });

  it("should handle empty responses", () => {
    const result = mergeRateLimitResponses([]);
    expect(result.type).toBe("ok");
    expect(result.remaining).toBeUndefined();
  });
});
