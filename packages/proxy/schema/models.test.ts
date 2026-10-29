import { expect } from "vitest";
import { it } from "vitest";
import raw_models from "./model_list.json";
import { getDirectModelEndpointTypes, getModelEndpointTypes } from "./index";
import {
  getAvailableModels,
  markModelsPastDeprecationDate,
  ModelSchema,
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

// OpenAI's Flex table, checked 2026-10-29:
// https://developers.openai.com/api/docs/pricing.md
// These are published base-context prices, including rounded cached-input rates.
it.each([
  [["gpt-6-astra"], 5, 25, 0.5, 6.25],
  [["gpt-6.1-sol"], 1, 5, 0.05, 1.25],
  [["gpt-6.1-terra"], 0.5, 2.5, 0.025, 0.625],
  [["gpt-6-luna"], 0.05, 0.25, 0.005, 0.0625],
  [["gpt-6-sol"], 1, 5, 0.1, 1.25],
  [["gpt-5.6-sol", "gpt-5.6"], 2, 10, 0.2, 2.5],
  [["gpt-5.6-terra"], 1, 6, 0.1, 1.25],
  [["gpt-5.6-luna"], 0.1, 0.6, 0.01, 0.125],
  [["gpt-5.5", "gpt-5.5-2026-04-23"], 2.5, 15, 0.25, undefined],
  [["gpt-5.5-pro", "gpt-5.5-pro-2026-04-23"], 15, 90, undefined, undefined],
  [["gpt-5.4", "gpt-5.4-2026-03-05"], 1.25, 7.5, 0.13, undefined],
  [["gpt-5.4-pro", "gpt-5.4-pro-2026-03-05"], 15, 90, undefined, undefined],
  [["gpt-5.4-mini", "gpt-5.4-mini-2026-03-17"], 0.375, 2.25, 0.0375, undefined],
  [["gpt-5.4-nano", "gpt-5.4-nano-2026-03-17"], 0.1, 0.625, 0.01, undefined],
  [["gpt-5.2", "gpt-5.2-2025-12-11"], 0.875, 7, 0.0875, undefined],
  [["gpt-5.1", "gpt-5.1-2025-11-13"], 0.625, 5, 0.0625, undefined],
  [["gpt-5", "gpt-5-2025-08-07"], 0.625, 5, 0.0625, undefined],
  [["gpt-5-mini", "gpt-5-mini-2025-08-07"], 0.125, 1, 0.0125, undefined],
  [["gpt-5-nano", "gpt-5-nano-2025-08-07"], 0.025, 0.2, 0.0025, undefined],
  [["o3", "o3-2025-04-16"], 1, 4, 0.25, undefined],
  [["o4-mini", "o4-mini-2025-04-16"], 0.55, 2.2, 0.138, undefined],
] as const)(
  "exposes published flex prices for %j through the model schema",
  (names, input, output, cacheRead, cacheWrite) => {
    const models = getAvailableModels();
    for (const name of names) {
      const price = models[name].flex_pricing?.openai?.[0];
      expect(price).toBeDefined();
      expect(price?.input_cost_per_mil_tokens).toBe(input);
      expect(price?.output_cost_per_mil_tokens).toBe(output);
      expect(price?.input_cache_read_cost_per_mil_tokens).toBe(cacheRead);
      expect(price?.input_cache_write_cost_per_mil_tokens).toBe(cacheWrite);
    }
  },
);

it.each([
  "gpt-4o",
  "gpt-5.2-pro",
  "gpt-5.2-chat-latest",
  "gpt-5.2-codex",
  "gpt-5.3-codex",
  "gpt-5.6-cyber",
  "openai.gpt-6-astra",
  "us.openai.gpt-6.1-sol",
])("does not infer OpenAI flex support for %s", (name) => {
  const model = getAvailableModels()[name];
  expect(model).toBeDefined();
  expect(model.flex_pricing).toBeUndefined();
});

it("preserves absent and null flex metadata without a default", () => {
  const base = { format: "openai", flavor: "chat" };
  expect(ModelSchema.parse(base)).toEqual(base);
  const model = { ...base, flex_pricing: null };
  expect(ModelSchema.parse(model)).toEqual(model);
});

it("preserves provider prices and their conditions throughout the catalog", () => {
  const models = getAvailableModels();
  for (const [name, model] of Object.entries(raw_models)) {
    if (!("flex_pricing" in model)) continue;
    expect(models[name].flex_pricing, name).toEqual(model.flex_pricing);
    for (const [provider, prices] of Object.entries(
      models[name].flex_pricing!,
    )) {
      expect(models[name].available_providers, name).toContain(provider);
      expect(prices.length, name).toBeGreaterThan(0);
      for (const price of prices) {
        for (const [key, value] of Object.entries(price)) {
          if (key.endsWith("_cost_per_mil_tokens")) {
            expect(value, `${name}.${provider}.${key}`).toBeGreaterThanOrEqual(
              0,
            );
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
});

it("keeps direct Google, Vertex, and OpenRouter cache prices separate", () => {
  const model = getAvailableModels()["gemini-3.5-flash-lite"];
  expect(model.flex_pricing?.google?.[0]).toMatchObject({
    input_cost_per_mil_tokens: 0.15,
    output_cost_per_mil_tokens: 1.25,
    input_cache_read_cost_per_mil_tokens: 0.02,
  });
  expect(model.flex_pricing?.vertex?.[0]).toMatchObject({
    input_cache_read_cost_per_mil_tokens: 0.015,
    supported_regions: ["global"],
  });
  const pro = getAvailableModels()["gemini-3.1-pro-preview"];
  expect(
    pro.flex_pricing?.google?.[0].input_cache_read_cost_per_mil_tokens,
  ).toBe(0.2);
  expect(
    pro.flex_pricing?.vertex?.[0].input_cache_read_cost_per_mil_tokens,
  ).toBeUndefined();
  expect(pro.flex_pricing?.openrouter?.[0]).toMatchObject({
    input_cache_read_cost_per_mil_tokens: 0.1,
    endpoints: ["google-vertex/global/flex", "google-ai-studio/flex"],
  });
});

it("does not infer Vertex flex support from Google's direct API or Batch prices", () => {
  for (const name of ["gemini-2.5-pro", "gemini-4-argon"]) {
    expect(getAvailableModels()[name].flex_pricing?.google).toBeDefined();
    expect(getAvailableModels()[name].flex_pricing?.vertex).toBeUndefined();
    expect(
      getAvailableModels()[`publishers/google/models/${name}`].flex_pricing,
    ).toBeUndefined();
  }
});

it("restricts Azure flex to its documented deployment and model version", () => {
  const model = getAvailableModels()["gpt-6.1-sol"];
  expect(model.flex_pricing?.azure?.[0]).toMatchObject({
    input_cost_per_mil_tokens: 1,
    output_cost_per_mil_tokens: 5,
    input_cache_read_cost_per_mil_tokens: 0.05,
    deployment_type: "GlobalStandard",
    model_version: "2026-09-29",
    max_input_tokens: 272000,
  });
  for (const name of ["gpt-6.1-terra", "gpt-5.4", "gpt-5.6"]) {
    expect(getAvailableModels()[name].flex_pricing?.azure).toBeUndefined();
  }
});

it("keeps long-context boundaries and promotional expiry dates", () => {
  const models = getAvailableModels();
  expect(models["gpt-5.4"].flex_pricing?.openai).toEqual([
    {
      input_cost_per_mil_tokens: 1.25,
      output_cost_per_mil_tokens: 7.5,
      input_cache_read_cost_per_mil_tokens: 0.13,
      endpoints: ["api.openai.com"],
      max_input_tokens: 272000,
    },
    {
      input_cost_per_mil_tokens: 2.5,
      output_cost_per_mil_tokens: 11.25,
      input_cache_read_cost_per_mil_tokens: 0.25,
      endpoints: ["api.openai.com"],
      min_input_tokens: 272001,
    },
  ]);
  expect(
    models["gemini-3.1-pro-preview"].flex_pricing?.openrouter?.[1],
  ).toMatchObject({
    min_input_tokens: 200001,
    input_cost_per_mil_tokens: 2,
    output_cost_per_mil_tokens: 9,
    input_cache_read_cost_per_mil_tokens: 0.2,
  });
  expect(models["gemini-4-argon"].flex_pricing?.google).toEqual([
    {
      input_cost_per_mil_tokens: 1,
      output_cost_per_mil_tokens: 5,
      input_cache_read_cost_per_mil_tokens: 0.05,
      valid_until: "2026-11-30",
    },
    {
      input_cost_per_mil_tokens: 2,
      output_cost_per_mil_tokens: 10,
      input_cache_read_cost_per_mil_tokens: 0.1,
      valid_from: "2026-12-01",
    },
  ]);
});

it("keeps Bedrock endpoint, inference profile, and region restrictions", () => {
  const models = getAvailableModels();
  const gemma = models["google.gemma-4-31b"].flex_pricing?.bedrock;
  expect(gemma).toBeDefined();
  expect(
    gemma?.every((price) => price.endpoints?.join() === "bedrock-mantle"),
  ).toBe(true);
  const nova = models[
    "global.amazon.nova-2-lite-v1:0"
  ].flex_pricing?.bedrock?.find((price) =>
    price.supported_regions?.includes("us-east-1"),
  );
  expect(nova).toMatchObject({
    endpoints: ["bedrock-runtime"],
    model_id: "global.amazon.nova-2-lite-v1:0",
    input_cost_per_mil_tokens: 0.15,
    output_cost_per_mil_tokens: 1.25,
    input_cache_read_cost_per_mil_tokens: 0.0375,
  });
  const usNova = models[
    "us.amazon.nova-2-lite-v1:0"
  ].flex_pricing?.bedrock?.find((price) =>
    price.supported_regions?.includes("us-east-1"),
  );
  expect(usNova).toMatchObject({
    model_id: "us.amazon.nova-2-lite-v1:0",
    input_cost_per_mil_tokens: 0.165,
    output_cost_per_mil_tokens: 1.375,
  });
  const glm = models["zai.glm-5.3"].flex_pricing?.bedrock;
  expect(glm).toBeDefined();
  expect(glm?.every((price) => price.model_id !== "zai.glm-5.3")).toBe(true);
  expect(
    glm?.every((price) => price.input_cost_per_mil_tokens === undefined),
  ).toBe(true);
});

it("records DeepInfra flex only on the documented OpenRouter endpoint", () => {
  const model = getAvailableModels()["deepseek/deepseek-v4.1-flash"];
  expect(Object.keys(model.flex_pricing!)).toEqual(["openrouter"]);
  expect(model.flex_pricing?.openrouter).toEqual([
    {
      input_cost_per_mil_tokens: 0.112,
      output_cost_per_mil_tokens: 0.336,
      input_cache_read_cost_per_mil_tokens: 0.00336,
      endpoints: ["deepinfra/fp8/flex"],
    },
  ]);
});

it.each(["jev-1.13.0", "jev-latest", "jev-preview"] as const)(
  "exposes Typesafe evaluation pricing for %s",
  (model) => {
    expect(raw_models[model]).toMatchObject({
      format: "typesafe",
      flavor: "evaluation",
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
