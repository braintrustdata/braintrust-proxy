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
  const known = new Set([
    "claude-opus-4-8",
    "claude-opus-4-7",
    "gpt-5.3-codex",
  ]);
  const isKnown = (name: string) => known.has(name);

  // Exact matches pass through untouched.
  expect(normalizeModelNameForCost("claude-opus-4-8", isKnown)).toBe(
    "claude-opus-4-8",
  );

  // Effort and thinking suffixes collapse to the base model.
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
  expect(
    normalizeModelNameForCost("claude-opus-4-7-thinking-high", isKnown),
  ).toBe("claude-opus-4-7");
  expect(normalizeModelNameForCost("gpt-5.3-codex-low", isKnown)).toBe(
    "gpt-5.3-codex",
  );

  // Unknown base models are not invented.
  expect(
    normalizeModelNameForCost("some-unknown-model-high", isKnown),
  ).toBeUndefined();
  expect(normalizeModelNameForCost("gpt-9-max", isKnown)).toBeUndefined();
});

it("does not strip -fast, which can denote a distinct model", () => {
  const known = new Set(["grok-4"]);
  const isKnown = (name: string) => known.has(name);
  // grok-4-fast is a separate, cheaper model, so it stays unpriced rather than
  // collapsing onto grok-4.
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
