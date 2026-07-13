import { expect } from "vitest";
import { it } from "vitest";
import raw_models from "./model_list.json";
import { getModelEndpointTypes } from "./index";
import {
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
  expect(
    normalizeModelNameForCost("gemini-2.5-pro-high", isKnown),
  ).toBeUndefined();
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
