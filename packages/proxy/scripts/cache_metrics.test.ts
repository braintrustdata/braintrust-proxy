import fs from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  cacheWriteMetricGroups,
  mapCacheWriteMetrics,
  mapCacheWriteUsage,
  type CacheWriteMetricName,
  type CacheWriteUsageName,
} from "../schema/cache-metric-definitions.generated";
import {
  loadCacheMetrics,
  parseCacheMetricGroups,
  renderPricingSchema,
} from "./cache_metrics.mjs";

describe("cache metric registry", () => {
  it("matches the committed pricing schema", () => {
    const committed = fs.readFileSync(
      new URL("../schema/cache-metrics.generated.ts", import.meta.url),
      "utf8",
    );
    expect(committed).toBe(renderPricingSchema(loadCacheMetrics()));
  });

  it.each([
    [[], "nonempty array"],
    [[null], "Invalid cache metric group at index 0"],
    [
      [{ id: "a", metrics: [null] }],
      "Invalid cache metric at index 0 of group a",
    ],
    [
      [
        {
          id: "a",
          metrics: [
            {
              ttl: "5m",
              metric: "prompt_cache_creation_5m_tokens",
              rate_key: "input_cache_write_5m_cost_per_mil_tokens",
            },
          ],
        },
        {
          id: "b",
          metrics: [
            {
              ttl: "5m",
              metric: "prompt_cache_creation_5m_tokens",
              rate_key: "input_cache_write_5m_cost_per_mil_tokens",
            },
          ],
        },
      ],
      "duplicate cache TTL: 5m",
    ],
    [
      [
        {
          id: "a",
          metrics: [
            {
              ttl: "5m",
              metric: "prompt_cache_creation_5m_tokens",
              rate_key: "input_cache_write_5m_cost_per_mil_tokens",
            },
            {
              ttl: "1h",
              metric: "prompt_cache_creation_5m_tokens",
              rate_key: "input_cache_write_1h_cost_per_mil_tokens",
            },
          ],
        },
      ],
      "duplicate cache metric name: prompt_cache_creation_5m_tokens",
    ],
    [
      [
        {
          id: "a",
          metrics: [
            {
              ttl: "30m",
              metric: "prompt_cache_creation_30m_tokens",
              rate_key: "input_cache_write_12h_cost_per_mil_tokens",
            },
          ],
        },
      ],
      "do not match TTL 30m",
    ],
  ])("rejects invalid registries", (groups, message) => {
    expect(() => parseCacheMetricGroups(groups)).toThrow(message);
  });
});

describe("cache write descriptors", () => {
  const tokens = {
    prompt_cache_creation_5m_tokens: 0,
    prompt_cache_creation_1h_tokens: 100,
    prompt_cache_creation_30m_tokens: undefined,
    prompt_cache_creation_12h_tokens: 200,
  };

  it("keeps provider-specific cache write groups separate", () => {
    expect(
      cacheWriteMetricGroups.map(({ id, metrics }) => ({
        id,
        metrics: metrics.map(({ metric }) => metric),
      })),
    ).toEqual([
      {
        id: "anthropic",
        metrics: [
          "prompt_cache_creation_5m_tokens",
          "prompt_cache_creation_1h_tokens",
        ],
      },
      {
        id: "openai",
        metrics: [
          "prompt_cache_creation_30m_tokens",
          "prompt_cache_creation_12h_tokens",
        ],
      },
    ]);
  });

  it("transforms every metric while preserving zero and missing values", () => {
    const result = mapCacheWriteMetrics((metric) => {
      const value = tokens[metric];
      return value === undefined ? undefined : value / 100;
    });
    expect(result).toEqual({
      prompt_cache_creation_5m_tokens: 0,
      prompt_cache_creation_1h_tokens: 1,
      prompt_cache_creation_30m_tokens: undefined,
      prompt_cache_creation_12h_tokens: 2,
    });
    expectTypeOf(result).toEqualTypeOf<
      Record<CacheWriteMetricName, number | undefined>
    >();
  });

  it("maps metric values to usage keys without mixing TTLs", () => {
    const result = mapCacheWriteUsage((metric) => tokens[metric]);
    expect(result).toEqual({
      promptCacheCreation5mTokens: 0,
      promptCacheCreation1hTokens: 100,
      promptCacheCreation30mTokens: undefined,
      promptCacheCreation12hTokens: 200,
    });
    expectTypeOf(result).toEqualTypeOf<
      Record<CacheWriteUsageName, number | undefined>
    >();
  });
});
