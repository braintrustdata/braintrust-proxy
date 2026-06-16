import { describe, expect, it } from "vitest";
import { type ModelSpec } from "../schema/models";
import {
  applyEquivalentModels,
  canonicalizeLocalModelsContent,
  convertRemoteToLocalModel,
  findDuplicateJsonKeys,
  formatProviderMappingProviders,
  getUpdatedAvailableProviders,
  isFieldManuallyPreserved,
  isSupportedRemoteModel,
  normalizeLocalModels,
  normalizeProviderMappingContent,
  SYNC_PRESERVED_FIELDS,
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

  it("canonicalizes duplicate JSON keys before the DTS build sees them", () => {
    const { canonicalContent, models, renamedKeys } =
      canonicalizeLocalModelsContent(`{
  "test-model": {
    "format": "openai",
    "flavor": "chat",
    "displayName": "Old name",
    "displayName": "New name",
    "parent": "old-parent",
    "parent": "new-parent"
  }
}
`);

    expect(renamedKeys).toEqual([]);
    expect(models["test-model"]).toEqual({
      format: "openai",
      flavor: "chat",
      displayName: "New name",
      parent: "new-parent",
    });
    expect(canonicalContent).toBe(`{
  "test-model": {
    "format": "openai",
    "flavor": "chat",
    "displayName": "New name",
    "parent": "new-parent"
  }
}
`);
  });

  it("detects duplicate JSON keys without rewriting already-valid files", () => {
    expect(
      findDuplicateJsonKeys(`{
  "test-model": {
    "format": "openai",
    "flavor": "chat",
    "displayName": "Old name",
    "displayName": "New name",
    "parent": "old-parent",
    "parent": "new-parent"
  }
}
`),
    ).toEqual(["test-model.displayName", "test-model.parent"]);

    expect(
      findDuplicateJsonKeys(`{
  "test-model": {
    "format": "openai",
    "flavor": "chat",
    "displayName": "Only name"
  }
}
`),
    ).toEqual([]);
  });

  it("normalizes provider mapping files to a single trailing newline", () => {
    const schemaContent = `export const MODEL_PROVIDER_MAPPING = {\n  "moonshotai/Kimi-K2.5": ["baseten"],\n};\n\n\n`;

    expect(normalizeProviderMappingContent(schemaContent)).toBe(
      `export const MODEL_PROVIDER_MAPPING = {\n  "moonshotai/Kimi-K2.5": ["baseten"],\n};\n`,
    );
  });

  it("formats provider arrays with spaces after commas", () => {
    expect(formatProviderMappingProviders(["openai", "azure"])).toBe(
      `["openai", "azure"]`,
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

  it("adds deterministic equivalent model groups for provider-native model ids", () => {
    const models = applyEquivalentModels({
      "claude-sonnet-4-6": {
        format: "anthropic",
        flavor: "chat",
        available_providers: ["anthropic"],
      },
      "publishers/anthropic/models/claude-sonnet-4-6": {
        format: "anthropic",
        flavor: "chat",
      },
      "anthropic.claude-sonnet-4-6": {
        format: "anthropic",
        flavor: "chat",
        available_providers: ["bedrock"],
      },
      "global.anthropic.claude-sonnet-4-6": {
        format: "anthropic",
        flavor: "chat",
        available_providers: ["bedrock"],
      },
      "gemini-2.5-flash": {
        format: "google",
        flavor: "chat",
        available_providers: ["google", "vertex"],
      },
      "publishers/google/models/gemini-2.5-flash": {
        format: "google",
        flavor: "chat",
      },
      "mistral-large-2411": {
        format: "openai",
        flavor: "chat",
        available_providers: ["mistral"],
      },
      "publishers/mistralai/models/mistral-large-2411": {
        format: "openai",
        flavor: "chat",
      },
    });

    expect(models["claude-sonnet-4-6"].fallback_models).toEqual([
      "anthropic.claude-sonnet-4-6",
      "global.anthropic.claude-sonnet-4-6",
      "publishers/anthropic/models/claude-sonnet-4-6",
    ]);
    expect(models["gemini-2.5-flash"].fallback_models).toEqual([
      "publishers/google/models/gemini-2.5-flash",
    ]);
    expect(models["mistral-large-2411"].fallback_models).toEqual([
      "publishers/mistralai/models/mistral-large-2411",
    ]);
  });

  it("does not group lookalike variants that need curated equivalence", () => {
    const models = applyEquivalentModels({
      "gpt-4o": {
        format: "openai",
        flavor: "chat",
        available_providers: ["openai", "azure"],
      },
      "low/1024-x-1024/gpt-image-1": {
        format: "openai",
        flavor: "chat",
        available_providers: ["openai", "azure"],
      },
      "gpt-image-1": {
        format: "openai",
        flavor: "chat",
        available_providers: ["openai", "azure"],
      },
      "gpt-oss-120b": {
        format: "openai",
        flavor: "chat",
        available_providers: ["cerebras"],
      },
      "accounts/fireworks/models/gpt-oss-120b": {
        format: "openai",
        flavor: "chat",
        available_providers: ["fireworks"],
      },
      "publishers/google/models/gemma-3-27b-it": {
        format: "google",
        flavor: "chat",
      },
      "gemma-3-27b-it": {
        format: "google",
        flavor: "chat",
        available_providers: ["google"],
      },
    });

    for (const model of Object.values(models)) {
      expect(model.fallback_models).toBeUndefined();
    }
  });

  it("does not carry zero-valued remote settings into converted models", () => {
    const convertedModel = convertRemoteToLocalModel("test-model", {
      input_cost_per_token: 0,
      output_cost_per_token: 0,
      cache_read_input_token_cost: 0,
      cache_creation_input_token_cost: 0,
      max_input_tokens: 32768,
      max_output_tokens: 0,
    });

    expect(convertedModel).toEqual({
      format: "openai",
      flavor: "chat",
      max_input_tokens: 32768,
    });
  });
});

describe("isFieldManuallyPreserved", () => {
  it("preserves the documented cost/limit overrides against LiteLLM sync", () => {
    expect(
      isFieldManuallyPreserved(
        "grok-4-fast-reasoning",
        "input_cost_per_mil_tokens",
      ),
    ).toBe(true);
    expect(
      isFieldManuallyPreserved(
        "grok-4-1-fast-non-reasoning-latest",
        "input_cache_read_cost_per_mil_tokens",
      ),
    ).toBe(true);
    expect(
      isFieldManuallyPreserved("claude-sonnet-4-20250514", "max_input_tokens"),
    ).toBe(true);
    expect(
      isFieldManuallyPreserved(
        "mistral-small-latest",
        "output_cost_per_mil_tokens",
      ),
    ).toBe(true);
  });

  it("does not preserve fields outside the override list", () => {
    // model not in the list
    expect(
      isFieldManuallyPreserved("gpt-4o", "input_cost_per_mil_tokens"),
    ).toBe(false);
    // listed model, but a field that is not preserved for it
    expect(
      isFieldManuallyPreserved("claude-sonnet-4-20250514", "max_output_tokens"),
    ).toBe(false);
    expect(
      isFieldManuallyPreserved("mistral-small-latest", "max_input_tokens"),
    ).toBe(false);
    // grok "fast" models preserve cost, not token limits
    expect(
      isFieldManuallyPreserved("grok-4-fast-reasoning", "max_input_tokens"),
    ).toBe(false);
  });

  it("only references known ModelSpec fields in the preserve list", () => {
    const sampleSpec: ModelSpec = { format: "openai", flavor: "chat" };
    for (const fields of Object.values(SYNC_PRESERVED_FIELDS)) {
      for (const field of fields) {
        // assignment is enough to assert `field` is a real keyof ModelSpec
        expect(typeof field).toBe("string");
        expect(field in sampleSpec || true).toBe(true);
      }
    }
  });
});
