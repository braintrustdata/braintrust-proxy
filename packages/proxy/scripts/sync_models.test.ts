import { describe, expect, it } from "vitest";
import { type ModelSpec } from "../schema/models";
import {
  getUpdatedAvailableProviders,
  isSupportedRemoteModel,
  normalizeLocalModels,
  normalizeProviderMappingContent,
} from "./sync_models";

const canonicalFireworksModel = {
  format: "openai",
  flavor: "chat",
  input_cost_per_mil_tokens: 0.9,
  output_cost_per_mil_tokens: 0.9,
  max_input_tokens: 32768,
  max_output_tokens: 32768,
  available_providers: ["fireworks"],
} satisfies ModelSpec;

const legacyFireworksModel = {
  format: "openai",
  flavor: "chat",
  input_cost_per_mil_tokens: 0.8,
  output_cost_per_mil_tokens: 0.8,
  displayName: "Qwen 2.5 Coder 32B Instruct",
} satisfies ModelSpec;

describe("sync_models", () => {
  it("keeps the canonical Fireworks payload when collapsing legacy aliases", () => {
    const normalizedVariants = [
      normalizeLocalModels({
        "fireworks_ai/accounts/fireworks/models/qwen2-72b-instruct":
          legacyFireworksModel,
        "accounts/fireworks/models/qwen2-72b-instruct": canonicalFireworksModel,
      }),
      normalizeLocalModels({
        "accounts/fireworks/models/qwen2-72b-instruct": canonicalFireworksModel,
        "fireworks_ai/accounts/fireworks/models/qwen2-72b-instruct":
          legacyFireworksModel,
      }),
    ];

    for (const { models, renamedKeys } of normalizedVariants) {
      expect(Object.keys(models)).toEqual([
        "accounts/fireworks/models/qwen2-72b-instruct",
      ]);
      expect(models["accounts/fireworks/models/qwen2-72b-instruct"]).toEqual(
        canonicalFireworksModel,
      );
      expect(renamedKeys).toEqual([
        {
          from: "fireworks_ai/accounts/fireworks/models/qwen2-72b-instruct",
          to: "accounts/fireworks/models/qwen2-72b-instruct",
        },
      ]);
    }
  });

  it("rewrites legacy-only Fireworks ids to canonical local keys", () => {
    const { models } = normalizeLocalModels({
      "fireworks_ai/accounts/fireworks/models/glm-4p5-air":
        canonicalFireworksModel,
    });

    expect(Object.keys(models)).toEqual([
      "accounts/fireworks/models/glm-4p5-air",
    ]);
    expect(models["accounts/fireworks/models/glm-4p5-air"]).toEqual(
      canonicalFireworksModel,
    );
  });

  it("normalizes provider mapping files to a single trailing newline", () => {
    const schemaContent = `export const MODEL_PROVIDER_MAPPING = {\n  "moonshotai/Kimi-K2.5": ["baseten"],\n};\n\n\n`;

    expect(normalizeProviderMappingContent(schemaContent)).toBe(
      `export const MODEL_PROVIDER_MAPPING = {\n  "moonshotai/Kimi-K2.5": ["baseten"],\n};\n`,
    );
  });

  it("preserves existing providers during provider-filtered updates", () => {
    expect(
      getUpdatedAvailableProviders(["groq", "together"], ["baseten"], true),
    ).toEqual(["groq", "together", "baseten"]);
  });

  it("uses the remote providers for unfiltered updates", () => {
    expect(
      getUpdatedAvailableProviders(["groq", "together"], ["baseten"], false),
    ).toEqual(["baseten"]);
  });

  it("filters embedding models out of the playground catalog sync flow", () => {
    expect(isSupportedRemoteModel({ mode: "embedding" })).toBe(false);
    expect(isSupportedRemoteModel({ mode: "chat" })).toBe(true);
    expect(isSupportedRemoteModel({})).toBe(true);
  });
});
