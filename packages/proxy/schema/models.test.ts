import { expect } from "vitest";
import { it } from "vitest";
import raw_models from "./model_list.json";
import { getDirectModelEndpointTypes, getModelEndpointTypes } from "./index";
import {
  getAvailableModels,
  markModelsPastDeprecationDate,
  ModelSchema,
  ModelPricingSchema,
  PricingTiers,
  normalizeModelNameForCost,
} from "./models";
import { z } from "zod";

it("parse model list", () => {
  const models = z.record(z.unknown()).parse(raw_models);
  for (const [key, value] of Object.entries(models)) {
    const result = ModelSchema.safeParse(value);
    if (!result.success) {
      console.log("failed to parse ", key, result.error);
    }
    expect(result.success).toBe(true);
  }
});

it("preserves top-level prices when tier pricing is absent or null", () => {
  const base = {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000002,
    output_cost_per_token: 0,
    input_cost_per_mil_tokens: 2,
    output_cost_per_mil_tokens: 0,
    input_cache_read_cost_per_mil_tokens: 0.2,
    input_cache_write_cost_per_mil_tokens: 2.5,
    input_cache_write_5m_cost_per_mil_tokens: null,
    input_cache_write_30m_cost_per_mil_tokens: 2.5,
    input_cache_write_1h_cost_per_mil_tokens: 4,
    input_cache_write_12h_cost_per_mil_tokens: 5,
  };
  expect(ModelSchema.parse(base)).toEqual(base);
  const model = { ...base, pricing: null };
  expect(ModelSchema.parse(model)).toEqual(model);
});

it.each(PricingTiers)("preserves %s rates and all cache TTL prices", (tier) => {
  const rate = {
    input_cost_per_mil_tokens: 1,
    output_cost_per_mil_tokens: 0,
    input_cache_read_cost_per_mil_tokens: 0.1,
    input_cache_write_cost_per_mil_tokens: 1.25,
    input_cache_write_5m_cost_per_mil_tokens: 1.25,
    input_cache_write_30m_cost_per_mil_tokens: 1.25,
    input_cache_write_1h_cost_per_mil_tokens: 2,
    input_cache_write_12h_cost_per_mil_tokens: 2.5,
    endpoints: ["provider.example"],
    supported_regions: ["global"],
    inference_geo: "us",
    deployment_type: "GlobalStandard",
    model_id: "upstream-model",
    model_version: "2026-10-01",
    min_input_tokens: 1,
    max_input_tokens: 200000,
    valid_from: "2026-10-01",
    valid_until: "2026-12-31",
  };
  const model = {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000002,
    input_cost_per_mil_tokens: 2,
    output_cost_per_mil_tokens: 10,
    pricing: { openai: { [tier]: [rate] } },
  };

  expect(ModelSchema.parse(model)).toEqual(model);
});

it("does not infer missing tier prices or support from batch rates", () => {
  const model = ModelSchema.parse({
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 2,
    pricing: { openai: { batch: [{ endpoints: ["provider.example"] }] } },
  });

  expect(
    model.pricing?.openai?.batch?.[0].input_cost_per_mil_tokens,
  ).toBeUndefined();
  expect(model.pricing?.openai?.flex).toBeUndefined();
  expect(model.pricing?.openai?.fast).toBeUndefined();
  expect(model.pricing?.openai?.ultrafast).toBeUndefined();
  expect(model.pricing?.vertex).toBeUndefined();
});

it.each(["openai", "openrouter"] as const)(
  "keeps the verified fast/priority aliases equal for %s",
  (provider) => {
    for (const [name, model] of Object.entries(getAvailableModels())) {
      const pricing = model.pricing?.[provider];
      if (pricing?.fast) {
        expect(pricing.priority, name).toEqual(pricing.fast);
      }
    }
  },
);

it("keeps Fireworks router prices separate from priority service-tier prices", () => {
  const models = getAvailableModels();
  const pricing =
    models["accounts/fireworks/models/glm-5p3"].pricing!.fireworks!;
  expect(pricing.fast![0].model_id).toBe(
    "accounts/fireworks/routers/glm-5p3-fast",
  );
  expect(pricing.fast).not.toEqual(pricing.priority);
  expect(
    models["accounts/fireworks/models/deepseek-v4p1-flash-1017"].pricing!
      .fireworks!.ultrafast![0].model_id,
  ).toBe("accounts/fireworks/routers/deepseek-v4p1-flash-1017-ultrafast");
});

it("retains provider-specific batch cache prices and context boundaries", () => {
  const models = getAvailableModels();
  const google = models["gemini-3.1-pro-preview"].pricing!.google!.batch!;
  const vertex = models["gemini-3.1-pro-preview"].pricing!.vertex!.batch!;
  expect(google[0].input_cache_read_cost_per_mil_tokens).toBe(0.2);
  expect(vertex[0].input_cache_read_cost_per_mil_tokens).toBeUndefined();
  expect(google[0].max_input_tokens).toBe(200000);
  expect(google[1].min_input_tokens).toBe(200001);
  const xai = models["grok-4.7"].pricing!.xAI!.batch!;
  expect(xai[0].max_input_tokens).toBe(199999);
  expect(xai[1].min_input_tokens).toBe(200000);
  const groq = models["openai/gpt-oss-120b"].pricing!.groq!.batch![0];
  expect(groq.input_cache_read_cost_per_mil_tokens).toBe(
    groq.input_cost_per_mil_tokens,
  );
});

it("uses OpenRouter batch endpoint prices independently of direct providers", () => {
  const models = getAvailableModels();
  const pricing = models["gpt-5.4"].pricing!;
  expect(pricing.openrouter!.batch![0]).toMatchObject({
    input_cache_read_cost_per_mil_tokens: 0.125,
    endpoints: ["openai"],
    max_input_tokens: 272000,
  });
  expect(pricing.openai!.batch![0].input_cache_read_cost_per_mil_tokens).toBe(
    0.13,
  );
  const haiku = models["anthropic/claude-haiku-5.5"].pricing!.openrouter!;
  expect(haiku.batch![1]).toMatchObject({
    min_input_tokens: 100001,
    input_cache_write_1h_cost_per_mil_tokens: 0.5,
  });
});

it.each([
  { openai: { flex: [] } },
  { openai: { flxe: [{}] } },
  { openai: { standard: [{}] } },
  { unknown_provider: { flex: [{}] } },
  { openai: { flex: null } },
])("rejects invalid provider/tier rates: %j", (pricing) => {
  expect(
    ModelSchema.safeParse({ format: "openai", flavor: "chat", pricing })
      .success,
  ).toBe(false);
});

it("preserves provider prices and their conditions throughout the catalog", () => {
  const models = getAvailableModels();
  for (const [name, model] of Object.entries(raw_models)) {
    if (!("pricing" in model)) continue;
    expect(models[name].pricing, name).toEqual(
      ModelPricingSchema.parse(model.pricing),
    );
    for (const [provider, tiers] of Object.entries(models[name].pricing!)) {
      expect(models[name].available_providers, name).toContain(provider);
      for (const [tier, prices] of Object.entries(tiers)) {
        expect(prices.length, `${name}.${provider}.${tier}`).toBeGreaterThan(0);
        for (const price of prices) {
          for (const [key, value] of Object.entries(price)) {
            if (key.endsWith("_cost_per_mil_tokens")) {
              expect(
                value,
                `${name}.${provider}.${tier}.${key}`,
              ).toBeGreaterThanOrEqual(0);
            }
          }
          expect(price.min_input_tokens ?? 0, name).toBeLessThanOrEqual(
            price.max_input_tokens ?? Infinity,
          );
          if (price.supported_regions) {
            expect(price.supported_regions.length, name).toBeGreaterThan(0);
          }
          if (price.endpoints) {
            expect(price.endpoints.length, name).toBeGreaterThan(0);
          }
        }
      }
    }
  }
});

it.each(["jev-1.13.0", "jev-latest", "jev-preview"] as const)(
  "exposes Typesafe evaluation pricing for %s",
  (model) => {
    expect(raw_models[model]).toMatchObject({
      format: "typesafe",
      flavor: "decisions",
      available_providers: ["typesafe"],
      input_cost_per_mil_tokens: 0.042,
      output_cost_per_mil_tokens: 0,
    });
    expect(getModelEndpointTypes(model)).toEqual(["typesafe"]);
  },
);

it("keeps equivalent model references within the catalog", () => {
  const models = z.record(ModelSchema).parse(raw_models);
  for (const [key, value] of Object.entries(models)) {
    for (const equivalentModel of value.fallback_models ?? []) {
      expect(
        models[equivalentModel],
        `${key} -> ${equivalentModel}`,
      ).toBeDefined();
    }
  }
});

it("Uses available providers for Fireworks model endpoint types", () => {
  expect(getModelEndpointTypes("accounts/fireworks/models/minimax-m3")).toEqual(
    ["fireworks"],
  );
});

it.each([
  { name: "direct", lookup: getDirectModelEndpointTypes },
  { name: "fallback-aware", lookup: getModelEndpointTypes },
])("$name endpoint lookup includes all GPT-6.1 Sol providers", ({ lookup }) => {
  expect(lookup("gpt-6.1-sol")).toEqual(
    expect.arrayContaining(raw_models["gpt-6.1-sol"].available_providers),
  );
});

it("Marks models as deprecated once deprecation date has been reached", () => {
  const result = markModelsPastDeprecationDate({
    testModel: {
      format: "anthropic",
      flavor: "chat",
      multimodal: true,
      input_cost_per_mil_tokens: 0.8,
      output_cost_per_mil_tokens: 4,
      input_cache_read_cost_per_mil_tokens: 0.08,
      input_cache_write_cost_per_mil_tokens: 1,
      parent: "claude-3-5-haiku-latest",
      max_input_tokens: 200000,
      max_output_tokens: 8192,
      deprecation_date: "2026-01-10",
    },
  });
  expect(result["testModel"].deprecated).toBe(true);
});

it("Does not deprecate models if deprecation date has not yet passed", () => {
  const now = new Date();
  const oneYearFromNow = new Date(
    now.setFullYear(now.getFullYear() + 1),
  ).toDateString();
  const result = markModelsPastDeprecationDate({
    testModel: {
      format: "anthropic",
      flavor: "chat",
      multimodal: true,
      input_cost_per_mil_tokens: 0.8,
      output_cost_per_mil_tokens: 4,
      input_cache_read_cost_per_mil_tokens: 0.08,
      input_cache_write_cost_per_mil_tokens: 1,
      parent: "claude-3-5-haiku-latest",
      max_input_tokens: 200000,
      max_output_tokens: 8192,
      deprecation_date: oneYearFromNow,
    },
  });
  expect(result["testModel"].deprecated).toBe(undefined);
});

it("normalizes Cursor CLI reasoning-effort slugs to the base model for cost", () => {
  const known = new Set(["claude-opus-4-8", "gpt-5.3-codex", "gemini-2.5-pro"]);
  const isKnown = (name: string) => known.has(name);

  expect(normalizeModelNameForCost("claude-opus-4-8", isKnown)).toBe(
    "claude-opus-4-8",
  );

  for (const slug of [
    "claude-opus-4-8-low",
    "claude-opus-4-8-medium",
    "claude-opus-4-8-high",
    "claude-opus-4-8-xhigh",
    "claude-opus-4-8-max",
    "claude-opus-4-8-thinking-high",
    "claude-opus-4-8-thinking-max",
  ]) {
    expect(normalizeModelNameForCost(slug, isKnown)).toBe("claude-opus-4-8");
  }
  expect(normalizeModelNameForCost("gpt-5.3-codex-low", isKnown)).toBe(
    "gpt-5.3-codex",
  );
  expect(
    normalizeModelNameForCost(" Claude-Opus-4-8-Thinking-High ", isKnown),
  ).toBe("claude-opus-4-8");

  expect(
    normalizeModelNameForCost("some-unknown-model-high", isKnown),
  ).toBeUndefined();
  expect(normalizeModelNameForCost("gpt-9-max", isKnown)).toBeUndefined();
  expect(normalizeModelNameForCost("gemini-2.5-pro-high", isKnown)).toBe(
    "gemini-2.5-pro",
  );
});

it("prefers exact catalog entries over Cursor model normalization", () => {
  const known = new Set(["gpt-5.3-codex", "gpt-5.3-codex-low"]);
  expect(
    normalizeModelNameForCost("gpt-5.3-codex-low", (name) => known.has(name)),
  ).toBe("gpt-5.3-codex-low");
});

it("does not strip -fast, which can denote a distinct model", () => {
  const known = new Set(["grok-4"]);
  const isKnown = (name: string) => known.has(name);
  expect(normalizeModelNameForCost("grok-4-fast", isKnown)).toBeUndefined();
});

it("Ignores malformed deprecation dates", () => {
  const result = markModelsPastDeprecationDate({
    testModel: {
      format: "anthropic",
      flavor: "chat",
      multimodal: true,
      input_cost_per_mil_tokens: 0.8,
      output_cost_per_mil_tokens: 4,
      input_cache_read_cost_per_mil_tokens: 0.08,
      input_cache_write_cost_per_mil_tokens: 1,
      parent: "claude-3-5-haiku-latest",
      max_input_tokens: 200000,
      max_output_tokens: 8192,
      deprecation_date: "not a date",
    },
  });
  expect(result["testModel"].deprecated).toBe(undefined);
});

it("resolves voice model providers and preserves voice flavors", () => {
  for (const [model, flavor] of [
    ["gpt-realtime-2.1", "realtime"],
    ["gpt-live-1", "live"],
  ]) {
    const models = z.record(ModelSchema).parse(raw_models);
    expect(models[model].flavor).toEqual(flavor);
    expect(getModelEndpointTypes(model)).toEqual(["openai"]);
  }
});
