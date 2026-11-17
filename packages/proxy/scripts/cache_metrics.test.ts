import fs from "node:fs";
import { describe, expect, it } from "vitest";
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
