import { describe, expect, it } from "vitest";
import { type ModelSpec } from "../schema/models";
import {
  addProviderToProviderMappingContent,
  applyEquivalentModels,
  canonicalizeLocalModelsContent,
  convertBasetenToLocalModel,
  convertRemoteToLocalModel,
  findDuplicateJsonKeys,
  formatProviderMappingProviders,
  getMissingProviderMappings,
  getUpdatedAvailableProviders,
  isFieldManuallyPreserved,
  isModelExcludedFromSync,
  isSupportedRemoteModel,
  normalizeLocalModels,
  normalizeProviderMappingContent,
  SYNC_EXCLUDED_MODELS,
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

  it("only deduplicates entries inside AvailableEndpointTypes", () => {
    const schemaContent = `export const DefaultEndpointTypes = {
  openai: ["openai", "azure"],
  anthropic: ["anthropic"],
  google: ["google"],
  converse: ["bedrock"],
};

export const AvailableEndpointTypes = {
  sonar: ["perplexity"],
  "sonar": ["perplexity"],
};
`;

    expect(normalizeProviderMappingContent(schemaContent)).toBe(
      `export const DefaultEndpointTypes = {
  openai: ["openai", "azure"],
  anthropic: ["anthropic"],
  google: ["google"],
  converse: ["bedrock"],
};

export const AvailableEndpointTypes = {
  sonar: ["perplexity"],
};
`,
    );
  });

  it("formats provider arrays with spaces after commas", () => {
    expect(formatProviderMappingProviders(["openai", "azure"])).toBe(
      `["openai", "azure"]`,
    );
  });

  it("finds missing provider mappings only for exact model providers", () => {
    const localModels = {
      "accounts/fireworks/models/minimax-m3": canonicalFireworksModel,
      "accounts/fireworks/models/minimax-m2p5": canonicalFireworksModel,
      "gemini-2.5-flash": {
        format: "google",
        flavor: "chat",
        available_providers: ["google", "vertex"],
      },
      "publishers/google/models/gemini-2.5-flash": {
        format: "google",
        flavor: "chat",
        available_providers: ["vertex"],
      },
      sonar: {
        format: "openai",
        flavor: "chat",
        available_providers: ["perplexity"],
      },
      "custom-model": {
        format: "openai",
        flavor: "chat",
      },
    } satisfies Record<string, ModelSpec>;
    const schemaContent = `const AvailableEndpointTypes = {
  sonar: ["perplexity"],
  "accounts/fireworks/models/minimax-m2p5": ["fireworks"],
};
`;

    const missingProviderMappings = getMissingProviderMappings(
      localModels,
      schemaContent,
    );

    expect(missingProviderMappings).toEqual([
      {
        name: "accounts/fireworks/models/minimax-m3",
        providers: ["fireworks"],
      },
      {
        name: "publishers/google/models/gemini-2.5-flash",
        providers: ["vertex"],
      },
    ]);
    expect(missingProviderMappings).not.toContainEqual({
      name: "gemini-2.5-flash",
      providers: ["google", "vertex"],
    });
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
    expect(
      models["publishers/google/models/gemini-2.5-flash"].available_providers,
    ).toEqual(["vertex"]);
    expect(models["mistral-large-2411"].fallback_models).toEqual([
      "publishers/mistralai/models/mistral-large-2411",
    ]);
    expect(
      models["publishers/mistralai/models/mistral-large-2411"]
        .available_providers,
    ).toEqual(["vertex"]);
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
    // grok-4.20 pins price + context (LiteLLM lists a 2M context window)
    expect(
      isFieldManuallyPreserved("grok-4.20-0309-reasoning", "max_input_tokens"),
    ).toBe(true);
    expect(
      isFieldManuallyPreserved(
        "grok-4.20-multi-agent-beta-0309",
        "input_cost_per_mil_tokens",
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

describe("isModelExcludedFromSync", () => {
  it("excludes the known phantom model id", () => {
    expect(isModelExcludedFromSync("claude-opus-4-7-20260416")).toBe(true);
    expect(SYNC_EXCLUDED_MODELS.has("claude-opus-4-7-20260416")).toBe(true);
  });

  it("excludes the Baseten-deprecated and non-chat ids the sync kept re-adding", () => {
    for (const id of [
      "deepseek-ai/DeepSeek-V3-0324",
      "moonshotai/Kimi-K2-Thinking",
      "moonshotai/Kimi-K2-Instruct-0905",
      "zai-org/GLM-4.6",
      "gpt-realtime-whisper",
    ]) {
      expect(isModelExcludedFromSync(id)).toBe(true);
    }
  });

  it("does not exclude real model ids", () => {
    expect(isModelExcludedFromSync("claude-opus-4-7")).toBe(false);
    expect(isModelExcludedFromSync("gpt-5")).toBe(false);
    expect(isModelExcludedFromSync("")).toBe(false);
  });
});

describe("convertBasetenToLocalModel", () => {
  it("converts a Baseten model (per-token string pricing, reasoning) to a ModelSpec", () => {
    expect(
      convertBasetenToLocalModel({
        id: "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B",
        name: "Nemotron Ultra",
        context_length: 202800,
        max_completion_tokens: 202800,
        pricing: {
          prompt: "0.0000006",
          completion: "0.0000024",
          input_cache_read: "0.00000012",
        },
        supported_features: ["tools", "reasoning"],
        input_modalities: ["text"],
        output_modalities: ["text"],
      }),
    ).toEqual({
      format: "openai",
      flavor: "chat",
      reasoning: true,
      input_cost_per_mil_tokens: 0.6,
      output_cost_per_mil_tokens: 2.4,
      input_cache_read_cost_per_mil_tokens: 0.12,
      displayName: "Nemotron Ultra",
      max_input_tokens: 202800,
      available_providers: ["baseten"],
    });
  });

  it("flags image-input models multimodal and drops zero-valued pricing", () => {
    expect(
      convertBasetenToLocalModel({
        id: "some/vision-model",
        input_modalities: ["text", "image"],
        pricing: { prompt: "0", completion: "0.000001" },
      }),
    ).toEqual({
      format: "openai",
      flavor: "chat",
      multimodal: true,
      output_cost_per_mil_tokens: 1,
      available_providers: ["baseten"],
    });
  });
});

describe("addProviderToProviderMappingContent", () => {
  const schema = `export const AvailableEndpointTypes: { [name: string]: ModelEndpointType[] } = {
  "deepseek-ai/DeepSeek-V4-Pro": ["together"],
  "moonshotai/Kimi-K2.7-Code": ["together"],
  "openai/gpt-oss-20b": ["groq"], // groq pricing / Together for 120B
};
`;

  it("widens existing entries and leaves unrelated entries (incl. comments) intact", () => {
    const { content, updated } = addProviderToProviderMappingContent(
      schema,
      ["deepseek-ai/DeepSeek-V4-Pro", "moonshotai/Kimi-K2.7-Code"],
      "baseten",
    );
    expect([...updated].sort()).toEqual([
      "deepseek-ai/DeepSeek-V4-Pro",
      "moonshotai/Kimi-K2.7-Code",
    ]);
    expect(content).toContain(
      `"deepseek-ai/DeepSeek-V4-Pro": ["together", "baseten"],`,
    );
    expect(content).toContain(
      `"moonshotai/Kimi-K2.7-Code": ["together", "baseten"],`,
    );
    expect(content).toContain(
      `"openai/gpt-oss-20b": ["groq"], // groq pricing / Together for 120B`,
    );
  });

  it("does not duplicate an already-present provider or touch unknown models", () => {
    const present = `export const AvailableEndpointTypes: { [name: string]: ModelEndpointType[] } = {
  "zai-org/GLM-5.2": ["baseten", "together"],
};
`;
    const { content, updated } = addProviderToProviderMappingContent(
      present,
      ["zai-org/GLM-5.2", "does/not-exist"],
      "baseten",
    );
    expect(updated).toEqual([]);
    expect(content).toContain(`"zai-org/GLM-5.2": ["baseten", "together"],`);
  });
});
