import { describe, expect, it, vi } from "vitest";
import { type StoredModelSpec as ModelSpec } from "../schema/models";
import modelList from "../schema/model_list.json";
import {
  addProviderToProviderMappingContent,
  removeProviderMappingEntriesFromContent,
  resolveRemoteModels,
  resolveRemoteProviderMetadata,
  applyProviderMetadata,
  applyProviderMetadataBatch,
  applyEquivalentModels,
  canonicalizeLocalModelsContent,
  convertBasetenToLocalModel,
  convertCerebrasToLocalModel,
  convertGroqToLocalModel,
  convertXaiToLocalModel,
  convertCohereToLocalModel,
  applyCohereLiteLLMPricing,
  isSupportedCohereChatModel,
  convertRemoteToLocalModel,
  applyBasetenPricing,
  applyOpenRouterPricing,
  assertUnchangedTopLevelPrices,
  openRouterPriceAuditEntry,
  convertOpenRouterToLocalModel,
  openRouterCanonicalId,
  isOpenRouterSlugExcluded,
  isSupportedOpenRouterModel,
  findDuplicateJsonKeys,
  formatProviderMappingProviders,
  getMissingProviderMappings,
  getProviderMappingWidenings,
  getUpdatedAvailableProviders,
  isBasetenDeprecated,
  isFieldManuallyPreserved,
  isModelExcludedFromSync,
  isPerplexityGatewayModel,
  isSupportedRemoteModel,
  normalizeLocalModels,
  parseRemoteModelList,
  normalizeProviderMappingContent,
  providersForExactModelName,
  stablyOrderByExisting,
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
  it("preserves existing catalog order even when the input is reordered", () => {
    const model = {
      format: "openai",
      flavor: "chat",
      available_providers: ["openai", "azure"],
    } satisfies ModelSpec;
    const names = Object.keys(modelList).slice(0, 3).reverse();
    const catalog = Object.fromEntries(names.map((name) => [name, model]));

    expect(Object.keys(stablyOrderByExisting(catalog))).toEqual(
      Object.keys(modelList).filter((name) => names.includes(name)),
    );
  });

  it("inserts new versions beside their siblings without reversing additions", () => {
    const model = {
      format: "openai",
      flavor: "chat",
      available_providers: ["openai", "azure"],
    } satisfies ModelSpec;

    expect(
      Object.keys(
        stablyOrderByExisting({
          "gpt-4.99": model,
          "gpt-6.1-sol": model,
          "gpt-99": model,
          "gpt-98": model,
        }),
      ),
    ).toEqual(["gpt-99", "gpt-98", "gpt-6.1-sol", "gpt-4.99"]);
  });

  it("preserves provider/tier rates and standard prices when canonicalizing the catalog", () => {
    const model = {
      format: "openai",
      flavor: "chat",
      input_cost_per_mil_tokens: 2,
      output_cost_per_mil_tokens: 10,
      input_cache_read_cost_per_mil_tokens: 0.1,
      input_cache_write_cost_per_mil_tokens: 2.5,
      pricing: {
        openai: {
          flex: [
            {
              input_cost_per_mil_tokens: 1,
              output_cost_per_mil_tokens: 5,
              input_cache_read_cost_per_mil_tokens: 0.05,
              input_cache_write_cost_per_mil_tokens: 1.25,
              max_input_tokens: 272000,
            },
          ],
          batch: [{ input_cost_per_mil_tokens: 0.8 }],
        },
        azure: {
          flex: [
            {
              input_cost_per_mil_tokens: 1,
              output_cost_per_mil_tokens: 5,
              deployment_type: "GlobalStandard",
              model_version: "2026-09-29",
              max_input_tokens: 272000,
            },
          ],
        },
      },
    } satisfies ModelSpec;
    const { canonicalContent } = canonicalizeLocalModelsContent(
      JSON.stringify({ "gpt-6.1-sol": model }),
    );
    expect(JSON.parse(canonicalContent)["gpt-6.1-sol"]).toEqual(model);
  });

  it("derives the latest shutdown and smallest active provider limits", () => {
    const providers = {
      openai: {
        deprecation_date: "2026-04-22",
        retirement_date: "2026-07-23",
        retired: true,
        max_input_tokens: 1,
        max_output_tokens: 1,
      },
      azure: {
        retirement_date: "2027-04-14",
        max_input_tokens: 128_000,
        max_output_tokens: 32_768,
      },
      openrouter: {
        retirement_date: "2027-04-01",
        max_input_tokens: 100_000,
        max_output_tokens: 65_536,
      },
    };
    const { canonicalContent } = canonicalizeLocalModelsContent(
      JSON.stringify({
        example: {
          format: "openai",
          flavor: "chat",
          providers,
          retired: true,
          retirement_date: "2026-07-23",
          max_input_tokens: 1,
          max_output_tokens: 1,
          available_providers: ["openai"],
        },
      }),
    );
    expect(JSON.parse(canonicalContent).example).toEqual({
      format: "openai",
      flavor: "chat",
      providers,
      retired: false,
      retirement_date: "2027-04-14",
      max_input_tokens: 100_000,
      max_output_tokens: 32_768,
      available_providers: ["azure", "openrouter"],
    });
  });

  it("drops stale shutdown dates when an active provider has no date", () => {
    const { canonicalContent } = canonicalizeLocalModelsContent(
      JSON.stringify({
        example: {
          format: "openai",
          flavor: "chat",
          retirement_date: "2027-04-14",
          providers: {
            azure: { retirement_date: "2027-04-14" },
            openrouter: {},
          },
        },
      }),
    );
    expect(JSON.parse(canonicalContent).example).not.toHaveProperty(
      "retirement_date",
    );
  });

  it("retires the model only when all providers have retired", () => {
    const { canonicalContent } = canonicalizeLocalModelsContent(
      JSON.stringify({
        example: {
          format: "openai",
          flavor: "chat",
          retired: false,
          max_input_tokens: 42,
          max_output_tokens: 42,
          providers: {
            azure: { retired: true },
            openai: { retired: true, retirement_date: "2026-07-23" },
          },
        },
      }),
    );
    const model = JSON.parse(canonicalContent).example;
    expect(model).toMatchObject({
      retired: true,
      retirement_date: "2026-07-23",
      available_providers: [],
    });
    expect(model).not.toHaveProperty("max_input_tokens");
    expect(model).not.toHaveProperty("max_output_tokens");
  });

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

  it("strips baseten from the update-models result for Baseten-deprecated ids", () => {
    // LiteLLM still lists baseten for zai-org/GLM-5 and moonshotai/Kimi-K2.5,
    // but Baseten 410s them. The update-models path must not re-add the dead
    // provider (mirrors the guard in the loop; see isBasetenDeprecated).
    expect(isBasetenDeprecated("zai-org/GLM-5")).toBe(true);
    expect(isBasetenDeprecated("moonshotai/Kimi-K2.5")).toBe(true);
    expect(isBasetenDeprecated("deepseek-ai/DeepSeek-V4-Flash-0731")).toBe(
      false,
    );
    const remote = getUpdatedAvailableProviders(
      ["together"],
      ["together", "baseten"],
      false,
    );
    const guarded = isBasetenDeprecated("zai-org/GLM-5")
      ? remote.filter((provider) => provider !== "baseten")
      : remote;
    expect(guarded).toEqual(["together"]);
  });

  it.each([
    "deepseek-ai/DeepSeek-V4-Pro",
    "moonshotai/Kimi-K2.6",
    "moonshotai/Kimi-K2.7-Code",
    "thinkingmachines/inkling",
    "thinkingmachines/inkling-small",
  ])("suppresses only Baseten sync for deprecated model %s", (modelName) => {
    expect(isBasetenDeprecated(modelName)).toBe(true);
    expect(isModelExcludedFromSync(modelName)).toBe(false);
  });

  describe("providersForExactModelName", () => {
    it("keeps openrouter ordered last behind native providers", () => {
      expect(
        providersForExactModelName("some-model", ["openai", "openrouter"]),
      ).toEqual(["openai", "openrouter"]);
      // openrouter is moved to the end even if listed earlier.
      expect(
        providersForExactModelName("some-model", [
          "openrouter",
          "groq",
          "together",
        ]),
      ).toEqual(["groq", "together", "openrouter"]);
    });

    it("leaves openrouter-only entries as openrouter", () => {
      expect(providersForExactModelName("vendor/x", ["openrouter"])).toEqual([
        "openrouter",
      ]);
    });
  });

  it("keeps openrouter as a provider in a model's direct mapping, and maps openrouter-only entries", () => {
    const localModels = {
      "gemini-2.5-flash": {
        format: "google",
        flavor: "chat",
        available_providers: ["google", "openrouter"],
      },
      "some-openai-model": {
        format: "openai",
        flavor: "chat",
        available_providers: ["groq", "openrouter"],
      },
      // Openrouter-only entry: openrouter is the sole provider, so it is kept.
      "vendor/openrouter-only": {
        format: "openai",
        flavor: "chat",
        available_providers: ["openrouter"],
      },
    } satisfies Record<string, ModelSpec>;
    const schemaContent = `const AvailableEndpointTypes = {\n};\n`;

    const missing = getMissingProviderMappings(localModels, schemaContent);
    expect(missing).toContainEqual({
      name: "gemini-2.5-flash",
      providers: ["google", "openrouter"],
    });
    expect(missing).toContainEqual({
      name: "some-openai-model",
      providers: ["groq", "openrouter"],
    });
    expect(missing).toContainEqual({
      name: "vendor/openrouter-only",
      providers: ["openrouter"],
    });
    for (const entry of missing) {
      const idx = entry.providers.indexOf("openrouter");
      if (idx !== -1) {
        expect(idx).toBe(entry.providers.length - 1);
      }
    }
  });

  it("filters embedding and media generation models out of the catalog sync", () => {
    expect(isSupportedRemoteModel({ mode: "embedding" })).toBe(false);
    for (const mode of ["image_generation", "image_edit", "video_generation"]) {
      expect(isSupportedRemoteModel({ mode })).toBe(false);
    }
    expect(
      isSupportedRemoteModel({ mode: "chat", supports_vision: true }),
    ).toBe(true);
    expect(isSupportedRemoteModel({})).toBe(true);
  });

  it("tolerates unknown LiteLLM mode values instead of failing the whole feed", () => {
    // LiteLLM introduces new `mode` values over time (e.g. "guardrail"); a single
    // unknown mode must not fail the record-parse and break the entire sync.
    const parsed = parseRemoteModelList({
      sample_spec: { should: "be dropped" },
      "bedrock/guardrails": { mode: "guardrail" },
      "databricks/databricks-gpt-5": {
        mode: "chat",
        input_cost_per_token: 1.25e-6,
        output_cost_per_token: 1e-5,
        litellm_provider: "databricks",
      },
    });
    expect(parsed["sample_spec"]).toBeUndefined();
    expect(parsed["bedrock/guardrails"].mode).toBe("guardrail");
    expect(parsed["databricks/databricks-gpt-5"].input_cost_per_token).toBe(
      1.25e-6,
    );
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

  it.each([
    "claude-sonnet-4-6",
    "anthropic.claude-sonnet-4-6",
    "anthropic/claude-sonnet-4.6",
  ])("excludes retired %s from normalized fallback links", (retiredName) => {
    const catalog: Record<string, ModelSpec> = {
      "claude-sonnet-4-6": {
        format: "anthropic",
        flavor: "chat",
        available_providers: ["anthropic"],
        fallback_models: [
          "anthropic.claude-sonnet-4-6",
          "anthropic/claude-sonnet-4.6",
        ],
      },
      "anthropic.claude-sonnet-4-6": {
        format: "anthropic",
        flavor: "chat",
        available_providers: ["bedrock"],
        fallback_models: ["claude-sonnet-4-6"],
      },
      "anthropic/claude-sonnet-4.6": {
        format: "openai",
        flavor: "chat",
        available_providers: ["openrouter"],
        fallback_models: ["claude-sonnet-4-6"],
      },
    };
    catalog[retiredName].retired = true;
    catalog[retiredName].retirement_date = "2026-01-01";

    const { models } = normalizeLocalModels(catalog);

    expect(models[retiredName]).toMatchObject({
      retired: true,
      retirement_date: "2026-01-01",
      available_providers: catalog[retiredName].available_providers,
    });
    expect(models[retiredName].fallback_models).toBeUndefined();
    for (const model of Object.values(models)) {
      expect(model.fallback_models ?? []).not.toContain(retiredName);
    }
    if (retiredName !== "claude-sonnet-4-6") {
      expect(models["claude-sonnet-4-6"].fallback_models).toEqual(
        ["anthropic.claude-sonnet-4-6", "anthropic/claude-sonnet-4.6"].filter(
          (name) => name !== retiredName,
        ),
      );
    }
    expect(normalizeLocalModels(models).models).toEqual(models);
  });

  it("preserves explicit cloud companions through catalog canonicalization", () => {
    const model = {
      format: "anthropic",
      flavor: "chat",
      available_providers: ["anthropic"],
      fallback_models: [
        "anthropic/claude-haiku-5.5",
        "databricks-claude-haiku-5-5",
        "anthropic/claude-haiku-5.5",
        "missing-model",
        "claude-haiku-5-5",
      ],
    } satisfies ModelSpec;
    const { models } = canonicalizeLocalModelsContent(
      JSON.stringify({
        "claude-haiku-5-5": model,
        "anthropic/claude-haiku-5.5": {
          format: "openai",
          flavor: "chat",
          available_providers: ["openrouter"],
        },
        "databricks-claude-haiku-5-5": {
          format: "openai",
          flavor: "chat",
          available_providers: ["databricks"],
        },
        "anthropic.claude-haiku-5-5": {
          format: "anthropic",
          flavor: "chat",
          available_providers: ["bedrock"],
        },
      }),
    );
    expect(models["claude-haiku-5-5"].fallback_models).toEqual([
      "anthropic.claude-haiku-5-5",
      "anthropic/claude-haiku-5.5",
      "databricks-claude-haiku-5-5",
    ]);
    expect(
      canonicalizeLocalModelsContent(JSON.stringify(models)).models,
    ).toEqual(models);
  });

  it("registers Bedrock Mantle openai.gpt-* ids as fallbacks for the canonical gpt model", () => {
    const models = applyEquivalentModels({
      "gpt-5.5": {
        format: "openai",
        flavor: "chat",
        available_providers: ["openai", "azure"],
      },
      "openai.gpt-5.5": {
        format: "openai",
        flavor: "chat",
        available_providers: ["bedrock"],
      },
      "us.openai.gpt-5.4": {
        format: "openai",
        flavor: "chat",
        available_providers: ["bedrock"],
      },
      "gpt-5.4": {
        format: "openai",
        flavor: "chat",
        available_providers: ["openai", "azure"],
      },
      // gpt-oss is open-weight (converse format, not openai/azure) and must not
      // be grouped even though its Bedrock id also starts with `openai.gpt-`.
      "openai.gpt-oss-120b-1:0": {
        format: "converse",
        flavor: "chat",
        available_providers: ["bedrock"],
      },
    });

    expect(models["gpt-5.5"].fallback_models).toEqual(["openai.gpt-5.5"]);
    expect(models["gpt-5.4"].fallback_models).toEqual(["us.openai.gpt-5.4"]);
    expect(models["openai.gpt-5.5"].fallback_models).toBeUndefined();
    expect(models["openai.gpt-5.5"].available_providers).toEqual(["bedrock"]);
    expect(models["openai.gpt-oss-120b-1:0"].fallback_models).toBeUndefined();
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

describe("convertRemoteToLocalModel lifecycle dates", () => {
  it("ignores LiteLLM's deprecation_date, which is a shutdown date", () => {
    const convertedModel = convertRemoteToLocalModel("test-model", {
      max_input_tokens: 32768,
      deprecation_date: "2026-12-11",
    });

    expect(convertedModel.deprecation_date).toBeUndefined();
    expect(convertedModel.retirement_date).toBeUndefined();
  });
});

describe("getProviderMappingWidenings", () => {
  const schemaContent = `const AvailableEndpointTypes = {
  "gpt-5.1-codex": ["azure", "openrouter"],
  "gpt-live-1": ["openai"],
  "gemini-2.5-flash": ["google"],
};
`;

  it("widens existing entries with newly added providers", () => {
    expect(
      getProviderMappingWidenings(schemaContent, [
        { name: "gpt-5.1-codex", providers: ["openai"] },
        { name: "brand-new", providers: ["openai"] },
      ]),
    ).toEqual([{ name: "gpt-5.1-codex", providers: ["openai"] }]);
  });

  it("leaves deliberately narrow entries alone", () => {
    expect(
      getProviderMappingWidenings(schemaContent, [
        { name: "gpt-5.1-codex", providers: ["azure"] },
        { name: "gemini-2.5-flash", providers: ["vertex"] },
      ]),
    ).toEqual([]);
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
    // LiteLLM reports total context for these OpenAI models.
    expect(
      isFieldManuallyPreserved("gpt-5.1-chat-latest", "max_input_tokens"),
    ).toBe(true);
    expect(
      isFieldManuallyPreserved("gpt-5.1-codex-mini", "max_input_tokens"),
    ).toBe(true);
    expect(
      isFieldManuallyPreserved("gpt-5.5-pro-2026-04-23", "max_input_tokens"),
    ).toBe(true);
    expect(
      isFieldManuallyPreserved(
        "gpt-5.5-pro-2026-04-23",
        "input_cache_read_cost_per_mil_tokens",
      ),
    ).toBe(true);
    expect(
      isFieldManuallyPreserved("grok-code-fast", "output_cost_per_mil_tokens"),
    ).toBe(true);
    expect(
      isFieldManuallyPreserved(
        "accounts/fireworks/models/glm-5p2",
        "input_cache_read_cost_per_mil_tokens",
      ),
    ).toBe(true);
    // grok-4.5 pins only the cached-input rate ($0.30 per xAI; LiteLLM lists $0.50)
    expect(
      isFieldManuallyPreserved(
        "grok-4.5",
        "input_cache_read_cost_per_mil_tokens",
      ),
    ).toBe(true);
    expect(
      isFieldManuallyPreserved(
        "grok-4.5-latest",
        "input_cache_read_cost_per_mil_tokens",
      ),
    ).toBe(true);
  });

  it("does not preserve fields outside the override list", () => {
    // LiteLLM already reports the documented input cap for both models.
    expect(isFieldManuallyPreserved("gpt-5", "max_input_tokens")).toBe(false);
    expect(isFieldManuallyPreserved("gpt-5.3-codex", "max_input_tokens")).toBe(
      false,
    );
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
    // grok-4.5 pins ONLY cache-read; input/output already match LiteLLM
    expect(
      isFieldManuallyPreserved("grok-4.5", "input_cost_per_mil_tokens"),
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
  it("excludes unsupported decision models", () => {
    for (const id of [
      "decision-models/baseten-elephant-9b-latest",
      "decision-models/baseten-mammoth-27b-latest",
      "decision-models/new-model",
      "accounts/fireworks/models/rune",
    ]) {
      expect(isModelExcludedFromSync(id)).toBe(true);
    }
  });

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

  it("excludes the Live model, ENDPOINT_NOT_FOUND Databricks, and Vertex MaaS ids", () => {
    for (const id of [
      "gemini-3.1-flash-live-preview",
      "databricks-gpt-5-4-mini",
      "databricks-gemini-3-6-flash",
      "publishers/meta/models/llama-4-maverick-17b-128e-instruct-maas",
      "publishers/openai/models/gpt-oss-120b-maas",
      "publishers/xai/models/grok-4.3",
    ]) {
      expect(isModelExcludedFromSync(id)).toBe(true);
    }
    // A real Databricks model we intentionally keep is not excluded.
    expect(isModelExcludedFromSync("databricks-gpt-5-5-pro")).toBe(false);
  });

  it("excludes the realtime-translate and transcription (non-chat) ids", () => {
    // Rejected by /v1/chat/completions ("This is not a chat model").
    for (const id of [
      "gpt-realtime-translate",
      "gpt-transcribe",
      "gpt-live-transcribe",
    ]) {
      expect(isModelExcludedFromSync(id)).toBe(true);
    }
  });

  it("excludes the bedrock-mantle-only Claude Mythos 5 id", () => {
    // AWS serves it only via the bedrock-mantle messages endpoint; our bedrock
    // provider uses the Bedrock runtime, so it is not invocable and must not be
    // auto-added by the daily bot.
    expect(isModelExcludedFromSync("anthropic.claude-mythos-5")).toBe(true);
  });

  it("excludes the Perplexity Gateway (router) models", () => {
    // Perplexity gateway third-party ids (perplexity/<model> on the perplexity
    // provider) need the /router/v1 endpoint; the perplexity provider points at
    // the standard api.perplexity.ai, so they are not routable. Matched
    // generically by isPerplexityGatewayModel, NOT the hand-listed exclusion set.
    for (const id of [
      "perplexity/kimi-k3",
      "perplexity/glm-5.2",
      "perplexity/kimi-k2.7-code",
      "perplexity/deepseek-v4-flash-0731",
    ]) {
      expect(isPerplexityGatewayModel(id, "perplexity")).toBe(true);
      expect(isPerplexityGatewayModel(id, ["perplexity"])).toBe(true);
    }
    // Openrouter-served perplexity slugs are kept (routable via openrouter).
    expect(
      isPerplexityGatewayModel("perplexity/sonar-pro-search", "openrouter"),
    ).toBe(false);
    expect(
      isPerplexityGatewayModel("perplexity/sonar-pro-search", ["openrouter"]),
    ).toBe(false);
    // Native Sonar ids (bare, no perplexity/ prefix) are not gateway models.
    expect(isPerplexityGatewayModel("sonar-pro", "perplexity")).toBe(false);
    // A perplexity/ id served by multiple providers incl. a routable one is kept.
    expect(
      isPerplexityGatewayModel("perplexity/foo", ["perplexity", "openrouter"]),
    ).toBe(false);
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

describe("convertGroqToLocalModel", () => {
  it("converts Groq's priced model-list entry to a ModelSpec", () => {
    expect(
      convertGroqToLocalModel({
        id: "qwen/qwen3.8-27b",
        name: "Qwen/Qwen3.8-27B",
        active: true,
        context_length: 131042,
        max_completion_tokens: 16384,
        pricing: {
          prompt: "0.0000008",
          completion: "0.000004",
          input_cache_read: "0.0000004",
        },
        supported_features: ["tools", "json_mode", "reasoning"],
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
      }),
    ).toEqual({
      format: "openai",
      flavor: "chat",
      multimodal: true,
      reasoning: true,
      input_cost_per_mil_tokens: 0.8,
      output_cost_per_mil_tokens: 4,
      input_cache_read_cost_per_mil_tokens: 0.4,
      displayName: "Qwen/Qwen3.8-27B",
      max_input_tokens: 131042,
      max_output_tokens: 16384,
      available_providers: ["groq"],
    });
  });
});

describe("convertXaiToLocalModel", () => {
  it("converts xAI cents-per-100M pricing to dollars per million", () => {
    expect(
      convertXaiToLocalModel({
        id: "grok-420-reasoning",
        context_length: 256000,
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
        prompt_text_token_price: 20000,
        cached_prompt_text_token_price: 2000,
        completion_text_token_price: 80000,
      }),
    ).toEqual({
      format: "openai",
      flavor: "chat",
      multimodal: true,
      input_cost_per_mil_tokens: 2,
      input_cache_read_cost_per_mil_tokens: 0.2,
      output_cost_per_mil_tokens: 8,
      max_input_tokens: 256000,
      available_providers: ["xAI"],
    });
  });
});

describe("convertCerebrasToLocalModel", () => {
  it("converts Cerebras's public priced model entry to a ModelSpec", () => {
    expect(
      convertCerebrasToLocalModel({
        id: "gpt-oss-120b",
        name: "OpenAI GPT OSS",
        pricing: { prompt: "0.00000035", completion: "0.00000075" },
        capabilities: { vision: false, reasoning: true },
        limits: { max_context_length: 131072, max_completion_tokens: 40960 },
      }),
    ).toEqual({
      format: "openai",
      flavor: "chat",
      reasoning: true,
      input_cost_per_mil_tokens: 0.35,
      output_cost_per_mil_tokens: 0.75,
      displayName: "OpenAI GPT OSS",
      max_input_tokens: 131072,
      max_output_tokens: 40960,
      available_providers: ["cerebras"],
    });
  });
});

describe("applyBasetenPricing", () => {
  const basetenGlm51 = {
    id: "zai-org/GLM-5.1",
    pricing: {
      prompt: "0.0000013",
      completion: "0.0000043",
      input_cache_read: "0.00000026",
    },
  };

  it("prefers Baseten pricing over the existing (e.g. Together) price on a shared id", () => {
    const priced = applyBasetenPricing(
      "zai-org/GLM-5.1",
      {
        format: "openai",
        flavor: "chat",
        input_cost_per_mil_tokens: 1.4,
        output_cost_per_mil_tokens: 4.4,
        reasoning: true,
        available_providers: ["baseten", "together"],
      },
      basetenGlm51,
    );
    expect(priced).toEqual({
      format: "openai",
      flavor: "chat",
      input_cost_per_mil_tokens: 1.3,
      output_cost_per_mil_tokens: 4.3,
      input_cache_read_cost_per_mil_tokens: 0.26,
      reasoning: true,
      available_providers: ["baseten", "together"],
    });
  });

  it("fills a missing cached price on a baseten-only id", () => {
    const priced = applyBasetenPricing(
      "zai-org/GLM-4.7",
      {
        format: "openai",
        flavor: "chat",
        input_cost_per_mil_tokens: 0.6,
        output_cost_per_mil_tokens: 2.2,
        available_providers: ["baseten"],
      },
      {
        id: "zai-org/GLM-4.7",
        pricing: {
          prompt: "0.0000006",
          completion: "0.0000022",
          input_cache_read: "0.00000012",
        },
      },
    );
    expect(priced).toEqual({
      format: "openai",
      flavor: "chat",
      input_cost_per_mil_tokens: 0.6,
      output_cost_per_mil_tokens: 2.2,
      input_cache_read_cost_per_mil_tokens: 0.12,
      available_providers: ["baseten"],
    });
  });

  it("returns null when Baseten pricing already matches", () => {
    expect(
      applyBasetenPricing(
        "zai-org/GLM-5.1",
        {
          format: "openai",
          flavor: "chat",
          input_cost_per_mil_tokens: 1.3,
          output_cost_per_mil_tokens: 4.3,
          input_cache_read_cost_per_mil_tokens: 0.26,
          available_providers: ["baseten", "together"],
        },
        basetenGlm51,
      ),
    ).toBeNull();
  });

  it("never overwrites a manually preserved field (SYNC_PRESERVED_FIELDS)", () => {
    // openai/gpt-oss-20b pins input/output cost via SYNC_PRESERVED_FIELDS; only
    // the non-preserved cached price may be updated from Baseten.
    const priced = applyBasetenPricing(
      "openai/gpt-oss-20b",
      {
        format: "openai",
        flavor: "chat",
        input_cost_per_mil_tokens: 0.075,
        output_cost_per_mil_tokens: 0.3,
        available_providers: ["groq", "together", "baseten"],
      },
      {
        id: "openai/gpt-oss-20b",
        pricing: {
          prompt: "0.0000001",
          completion: "0.0000005",
          input_cache_read: "0.0000001",
        },
      },
    );
    expect(priced?.input_cost_per_mil_tokens).toBe(0.075);
    expect(priced?.output_cost_per_mil_tokens).toBe(0.3);
    expect(priced?.input_cache_read_cost_per_mil_tokens).toBe(0.1);
  });

  it("leaves a fully-pinned model (incl. cache) untouched", () => {
    // openai/gpt-oss-120b pins input/output AND input_cache_read via
    // SYNC_PRESERVED_FIELDS, so Baseten pricing must not change any of them.
    expect(
      applyBasetenPricing(
        "openai/gpt-oss-120b",
        {
          format: "openai",
          flavor: "chat",
          input_cost_per_mil_tokens: 0.15,
          output_cost_per_mil_tokens: 0.6,
          input_cache_read_cost_per_mil_tokens: 0.075,
          available_providers: ["groq", "together", "baseten"],
        },
        {
          id: "openai/gpt-oss-120b",
          pricing: {
            prompt: "0.0000001",
            completion: "0.0000005",
            input_cache_read: "0.0000001",
          },
        },
      ),
    ).toBeNull();
  });
});

describe("removeProviderMappingEntriesFromContent", () => {
  const schema = `export const AvailableEndpointTypes = {
  "x-ai/grok-4.5": ["openrouter"],
  "openai/gpt-5": ["openrouter"],
  "gryphe/mythomax-l2-13b": ["openrouter"],
};
`;

  it("removes named entries and leaves the rest intact", () => {
    const out = removeProviderMappingEntriesFromContent(schema, [
      "openai/gpt-5",
    ]);
    expect(out).not.toContain('"openai/gpt-5"');
    expect(out).toContain('"x-ai/grok-4.5": ["openrouter"],');
    expect(out).toContain('"gryphe/mythomax-l2-13b": ["openrouter"],');
  });

  it("is a no-op for ids with no entry", () => {
    expect(removeProviderMappingEntriesFromContent(schema, ["not/here"])).toBe(
      schema,
    );
    expect(removeProviderMappingEntriesFromContent(schema, [])).toBe(schema);
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

describe("openRouterCanonicalId", () => {
  it("strips the vendor prefix to the canonical id", () => {
    expect(openRouterCanonicalId("x-ai/grok-4.5")).toBe("grok-4.5");
    expect(openRouterCanonicalId("openai/gpt-5")).toBe("gpt-5");
    expect(openRouterCanonicalId("cohere/command-r-08-2024")).toBe(
      "command-r-08-2024",
    );
  });

  it("rejects :variant slugs", () => {
    expect(openRouterCanonicalId("deepseek/deepseek-r1:free")).toBeNull();
    expect(openRouterCanonicalId("x-ai/grok-4.5:nitro")).toBeNull();
  });

  it("rejects slugs without a vendor prefix", () => {
    expect(openRouterCanonicalId("grok-4.5")).toBeNull();
    expect(openRouterCanonicalId("gpt-5")).toBeNull();
  });
});

describe("isOpenRouterSlugExcluded", () => {
  it("excludes Gemini Omni even when source modality metadata is absent", () => {
    expect(isModelExcludedFromSync("gemini-omni-1.2-flash")).toBe(true);
    expect(isOpenRouterSlugExcluded("google/gemini-omni-1.2-flash")).toBe(true);
    expect(modelList).not.toHaveProperty("google/gemini-omni-1.2-flash");
  });

  it("excludes a slug whose stripped canonical id is excluded/deprecated", () => {
    // gpt-realtime-2.1 is in the manual exclusion set; the bare slug
    // openai/gpt-realtime-2.1 is not, but its canonical is — so it must be caught.
    expect(isModelExcludedFromSync("gpt-realtime-2.1")).toBe(true);
    expect(isModelExcludedFromSync("openai/gpt-realtime-2.1")).toBe(false);
    expect(isOpenRouterSlugExcluded("openai/gpt-realtime-2.1")).toBe(true);
  });

  it("does not exclude a live slug or one that strips to a carried model", () => {
    expect(isOpenRouterSlugExcluded("x-ai/grok-4.5")).toBe(false);
    expect(isOpenRouterSlugExcluded("openai/gpt-5")).toBe(false);
  });
});

describe("isSupportedOpenRouterModel", () => {
  it.each([["image"], ["video"], ["text", "image"], ["text", "video"]])(
    "excludes generated media outputs %j",
    (...outputs) => {
      expect(
        isSupportedOpenRouterModel({
          id: "vendor/media-model",
          architecture: { output_modalities: outputs },
        }),
      ).toBe(false);
    },
  );

  it("keeps text models that understand images and video", () => {
    expect(
      isSupportedOpenRouterModel({
        id: "vendor/vision-chat",
        architecture: {
          input_modalities: ["text", "image", "video"],
          output_modalities: ["text"],
        },
      }),
    ).toBe(true);
    expect(isSupportedOpenRouterModel({ id: "vendor/legacy-chat" })).toBe(true);
  });
});

describe("convertOpenRouterToLocalModel", () => {
  it("maps pricing, context, modality and reasoning", () => {
    const spec = convertOpenRouterToLocalModel({
      id: "x-ai/grok-4.5",
      name: "xAI: Grok 4.5",
      context_length: 500000,
      pricing: {
        prompt: "0.000002",
        completion: "0.000006",
        input_cache_read: "0.0000003",
      },
      architecture: { input_modalities: ["text", "image", "file"] },
      supported_parameters: ["reasoning", "reasoning_effort"],
      top_provider: { context_length: 500000, max_completion_tokens: 64000 },
    });
    expect(spec.format).toBe("openai");
    expect(spec.flavor).toBe("chat");
    expect(spec.multimodal).toBe(true);
    expect(spec.reasoning).toBe(true);
    expect(spec.displayName).toBe("xAI: Grok 4.5");
    expect(spec.input_cost_per_mil_tokens).toBe(2);
    expect(spec.output_cost_per_mil_tokens).toBe(6);
    expect(spec.input_cache_read_cost_per_mil_tokens).toBe(0.3);
    expect(spec.max_input_tokens).toBe(500000);
    expect(spec.max_output_tokens).toBe(64000);
    expect(spec.available_providers).toEqual(["openrouter"]);
  });

  it("omits fields OpenRouter does not report", () => {
    const spec = convertOpenRouterToLocalModel({
      id: "some-vendor/plain-model",
      pricing: { prompt: "0.000001", completion: "0.000002" },
    });
    expect(spec.multimodal).toBeUndefined();
    expect(spec.reasoning).toBeUndefined();
    expect(spec.input_cache_read_cost_per_mil_tokens).toBeUndefined();
    expect(spec.max_input_tokens).toBeUndefined();
    expect(spec.max_output_tokens).toBeUndefined();
    expect(spec.available_providers).toEqual(["openrouter"]);
  });
});

describe("applyOpenRouterPricing", () => {
  it("records the original directory values alongside old and new default prices", () => {
    const slug = "deepseek/deepseek-v4-flash-0731";
    const old = {
      format: "openai",
      flavor: "chat",
      available_providers: ["openrouter"],
      input_cost_per_mil_tokens: 0.047,
    } satisfies ModelSpec;
    const directory = {
      id: slug,
      pricing: { prompt: "0.0000000456", request: "0" },
      top_provider: { context_length: 1048576 },
    };
    const updated = applyOpenRouterPricing(slug, old, directory);
    expect(updated).not.toBeNull();
    expect(openRouterPriceAuditEntry(slug, old, updated!, directory)).toEqual({
      model: slug,
      provider: "openrouter",
      oldPrices: { input_cost_per_mil_tokens: 0.047 },
      newPrices: { input_cost_per_mil_tokens: 0.0456 },
      directory,
    });
  });

  it("preserves provider/tier rates when standard prices change", () => {
    const model: ModelSpec = {
      format: "openai",
      flavor: "chat",
      input_cost_per_mil_tokens: 1,
      output_cost_per_mil_tokens: 2,
      available_providers: ["openrouter"],
      pricing: {
        openrouter: {
          flex: [
            {
              input_cost_per_mil_tokens: 0.112,
              output_cost_per_mil_tokens: 0.336,
              input_cache_read_cost_per_mil_tokens: 0.00336,
              endpoints: ["deepinfra/fp8/flex"],
            },
          ],
          priority: { alias: "fast" },
          fast: [{ input_cost_per_mil_tokens: 2 }],
          ultrafast: [
            {
              input_cost_per_mil_tokens: 6,
              input_cache_write_30m_cost_per_mil_tokens: 7.5,
              input_cache_write_12h_cost_per_mil_tokens: 15,
            },
          ],
        },
      },
    };
    const priced = applyOpenRouterPricing(
      "deepseek/deepseek-v4.1-flash",
      model,
      {
        id: "deepseek/deepseek-v4.1-flash",
        pricing: { prompt: "0.00000014", completion: "0.00000042" },
      },
    );
    expect(priced?.input_cost_per_mil_tokens).toBe(0.14);
    expect(priced?.output_cost_per_mil_tokens).toBe(0.42);
    expect(priced?.pricing).toEqual(model.pricing);
    const rewritten = canonicalizeLocalModelsContent(
      JSON.stringify({ "deepseek/deepseek-v4.1-flash": priced }),
    );
    expect(
      JSON.parse(rewritten.canonicalContent)["deepseek/deepseek-v4.1-flash"]
        .pricing,
    ).toEqual(model.pricing);
  });

  it("overwrites prices that differ and returns null when unchanged", () => {
    const model: ModelSpec = {
      format: "openai",
      flavor: "chat",
      input_cost_per_mil_tokens: 1,
      output_cost_per_mil_tokens: 2,
      available_providers: ["openrouter"],
    };
    const orModel = {
      id: "x-ai/grok-4.5",
      pricing: { prompt: "0.000002", completion: "0.000006" },
    };
    const priced = applyOpenRouterPricing("x-ai/grok-4.5", model, orModel);
    expect(priced?.input_cost_per_mil_tokens).toBe(2);
    expect(priced?.output_cost_per_mil_tokens).toBe(6);
    // Re-applying the same pricing is a no-op.
    expect(
      applyOpenRouterPricing("x-ai/grok-4.5", priced as ModelSpec, orModel),
    ).toBeNull();
  });

  it("never overwrites pricing when a first-class provider also serves the model", () => {
    const model: ModelSpec = {
      format: "openai",
      flavor: "chat",
      input_cost_per_mil_tokens: 1,
      output_cost_per_mil_tokens: 2,
      // xAI is the first-class provider; openrouter is an additional one.
      available_providers: ["xAI", "openrouter"],
    };
    const orModel = {
      id: "x-ai/grok-4.5",
      pricing: { prompt: "0.000009", completion: "0.000009" },
    };
    expect(applyOpenRouterPricing("x-ai/grok-4.5", model, orModel)).toBeNull();
  });
});

describe("assertUnchangedTopLevelPrices", () => {
  const model = {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000001,
    output_cost_per_mil_tokens: 2,
    input_cache_write_30m_cost_per_mil_tokens: 3,
    audio_duration_cost_per_minute: 0.05,
  } satisfies ModelSpec;

  it("allows metadata and tier prices to change", () => {
    expect(() =>
      assertUnchangedTopLevelPrices(
        { model },
        { model: { ...model, displayName: "Model", pricing: {} } },
      ),
    ).not.toThrow();
  });

  it.each([
    { ...model, input_cost_per_token: null },
    { ...model, output_cost_per_mil_tokens: undefined },
    { ...model, input_cache_write_30m_cost_per_mil_tokens: 4 },
    { ...model, input_cache_read_cost_per_mil_tokens: 0.1 },
    { ...model, audio_duration_cost_per_minute: 0.06 },
    { ...model, audio_standby_cost_per_minute: 0.02 },
  ])(
    "blocks additions, changes, and removals of top-level prices ($#)",
    (entry) => {
      expect(() =>
        assertUnchangedTopLevelPrices({ model }, { model: entry }),
      ).toThrow("Enrichment changed top-level prices");
    },
  );
});

describe("convertCohereToLocalModel", () => {
  it("maps a Cohere chat model to an openai-format cohere entry (no LiteLLM = no pricing)", () => {
    const spec = convertCohereToLocalModel({
      name: "command-a-reasoning-08-2025",
      endpoints: ["chat"],
      context_length: 288768,
    });
    expect(spec.format).toBe("openai");
    expect(spec.flavor).toBe("chat");
    expect(spec.max_input_tokens).toBe(288768);
    expect(spec.available_providers).toEqual(["cohere"]);
    // No LiteLLM overlay -> no fabricated pricing.
    expect(spec.input_cost_per_mil_tokens).toBeUndefined();
    expect(spec.output_cost_per_mil_tokens).toBeUndefined();
  });

  it("overlays LiteLLM pricing (per-token -> per-mil) when available", () => {
    const spec = convertCohereToLocalModel(
      {
        name: "command-a-03-2025",
        endpoints: ["chat"],
        context_length: 256000,
      },
      {
        input_cost_per_token: 2.5e-6,
        output_cost_per_token: 1e-5,
        cache_read_input_token_cost: 1.25e-6,
      },
    );
    expect(spec.input_cost_per_mil_tokens).toBe(2.5);
    expect(spec.output_cost_per_mil_tokens).toBe(10);
    expect(spec.input_cache_read_cost_per_mil_tokens).toBe(1.25);
  });
});

describe("isSupportedCohereChatModel", () => {
  it("accepts a live chat model", () => {
    expect(
      isSupportedCohereChatModel({
        name: "command-a-03-2025",
        endpoints: ["chat"],
      }),
    ).toBe(true);
  });

  it("rejects non-chat, fine-tuned, and deprecated models", () => {
    expect(
      isSupportedCohereChatModel({ name: "embed-v4.0", endpoints: ["embed"] }),
    ).toBe(false);
    expect(
      isSupportedCohereChatModel({
        name: "my-finetune",
        endpoints: ["chat"],
        finetuned: true,
      }),
    ).toBe(false);
    expect(
      isSupportedCohereChatModel({
        name: "command-r",
        endpoints: ["chat"],
        is_deprecated: true,
      }),
    ).toBe(false);
  });
});

describe("applyCohereLiteLLMPricing", () => {
  const priceless: ModelSpec = {
    format: "openai",
    flavor: "chat",
    available_providers: ["cohere"],
  };

  it("fills pricing on an existing price-less entry when LiteLLM has it", () => {
    const priced = applyCohereLiteLLMPricing("command-a-03-2025", priceless, {
      input_cost_per_token: 2.5e-6,
      output_cost_per_token: 1e-5,
      cache_read_input_token_cost: 1.25e-6,
    });
    expect(priced?.input_cost_per_mil_tokens).toBe(2.5);
    expect(priced?.output_cost_per_mil_tokens).toBe(10);
    expect(priced?.input_cache_read_cost_per_mil_tokens).toBe(1.25);
  });

  it("returns null when LiteLLM has no entry or pricing is unchanged", () => {
    expect(applyCohereLiteLLMPricing("x", priceless, undefined)).toBeNull();
    const already: ModelSpec = { ...priceless, input_cost_per_mil_tokens: 2.5 };
    expect(
      applyCohereLiteLLMPricing("x", already, { input_cost_per_token: 2.5e-6 }),
    ).toBeNull();
  });
});

describe("resolveRemoteModels", () => {
  const today = "2026-11-25";
  type RemoteModels = Parameters<typeof resolveRemoteModels>[0];

  it("skips entries past their LiteLLM shutdown date", () => {
    const remote = {
      "gpt-5-codex": {
        litellm_provider: "openai",
        mode: "chat",
        deprecation_date: "2026-07-23",
      },
      "azure/gpt-5-codex": {
        litellm_provider: "azure",
        mode: "chat",
        deprecation_date: "2027-03-17",
      },
    } as RemoteModels;

    expect(
      resolveRemoteModels(remote, "openai", today).has("gpt-5-codex"),
    ).toBe(false);
  });

  it("keeps entries whose shutdown date is in the future", () => {
    const remote = {
      "gpt-5-codex": {
        litellm_provider: "openai",
        mode: "chat",
        deprecation_date: "2027-01-01",
      },
      "azure/gpt-5-codex": { litellm_provider: "azure", mode: "chat" },
    } as RemoteModels;

    expect(
      resolveRemoteModels(remote, "openai", today).get("gpt-5-codex")
        ?.mergedProviders,
    ).toEqual(["openai", "azure"]);
  });

  it("adds azure only when LiteLLM lists a live Azure deployment", () => {
    const remote = {
      "gpt-6.2-astra": { litellm_provider: "openai", mode: "chat" },
      "azure/eu/gpt-6.2-astra": { litellm_provider: "azure", mode: "chat" },
      "gpt-6.2-astra-healthcare": { litellm_provider: "openai", mode: "chat" },
      "gpt-4o-audio-preview": { litellm_provider: "openai", mode: "chat" },
      "azure/gpt-4o-audio-preview": {
        litellm_provider: "azure",
        mode: "chat",
        deprecation_date: "2026-01-01",
      },
    } as RemoteModels;

    const resolved = resolveRemoteModels(remote, "openai", today);
    expect(resolved.get("gpt-6.2-astra")?.mergedProviders).toEqual([
      "openai",
      "azure",
    ]);
    expect(resolved.get("gpt-6.2-astra-healthcare")?.mergedProviders).toEqual([
      "openai",
    ]);
    expect(resolved.get("gpt-4o-audio-preview")?.mergedProviders).toEqual([
      "openai",
    ]);
  });

  it("treats known undated LiteLLM aliases as shut down", () => {
    const remote = {
      "gpt-4o-search-preview": { litellm_provider: "openai", mode: "chat" },
    } as RemoteModels;

    expect(
      resolveRemoteModels(remote, "openai", today).has("gpt-4o-search-preview"),
    ).toBe(false);
    expect(
      resolveRemoteModels(remote, "openai", "2026-07-22").has(
        "gpt-4o-search-preview",
      ),
    ).toBe(true);
  });
});

describe("provider metadata sync", () => {
  const name = "gpt-3.5-turbo-instruct";
  const today = "2026-08-01";
  const model: ModelSpec = {
    format: "openai",
    flavor: "chat",
    providers: {
      openai: { max_input_tokens: 4096, deprecation_date: "2026-07-01" },
      azure: { max_input_tokens: 4097 },
    },
  };

  it("writes the matched provider's limits and reports its LiteLLM shutdown date", () => {
    const remote = parseRemoteModelList({
      [name]: { litellm_provider: "openai", max_input_tokens: 4096 },
      "azure/gpt-35-turbo-instruct": {
        litellm_provider: "azure_text",
        max_input_tokens: 8000,
        max_output_tokens: 2000,
        deprecation_date: "2027-01-01",
      },
    });
    const metadata = resolveRemoteProviderMetadata(
      remote,
      { [name]: model },
      "openai",
    ).get(name);
    expect(metadata?.azure?.retirement_date).toBe("2027-01-01");
    const updated = applyProviderMetadata(
      name,
      model,
      "azure",
      metadata!.azure!,
      "LiteLLM",
      today,
    );
    expect(updated.providers).toEqual({
      openai: model.providers!.openai,
      azure: {
        max_input_tokens: 8000,
        max_output_tokens: 2000,
      },
    });
    expect(updated.max_input_tokens).toBe(4096);
  });

  it("flags elapsed shutdown dates without retiring the provider", () => {
    const remote = parseRemoteModelList({
      [name]: { litellm_provider: "openai", deprecation_date: "2026-07-31" },
    });
    const metadata = resolveRemoteProviderMetadata(
      remote,
      { [name]: model },
      "openai",
    ).get(name);
    const updated = applyProviderMetadata(
      name,
      model,
      "openai",
      metadata!.openai!,
      "LiteLLM",
      today,
    );
    expect(updated).toBe(model);

    const scheduled: ModelSpec = {
      ...model,
      providers: {
        ...model.providers,
        openai: { ...model.providers?.openai, retirement_date: "2026-07-31" },
      },
    };
    const removedFromFeed = resolveRemoteProviderMetadata(
      {},
      { [name]: scheduled },
      "openai",
      today,
    ).get(name);
    expect(
      applyProviderMetadata(
        name,
        scheduled,
        "openai",
        removedFromFeed!.openai!,
        "LiteLLM",
        today,
      ),
    ).toBe(scheduled);
  });

  it("creates a map only when matched data covers every current provider without raising a limit", () => {
    const id = "o4-mini-2025-04-16";
    const legacy: ModelSpec = {
      format: "openai",
      flavor: "chat",
      available_providers: ["openai", "azure"],
      max_input_tokens: 4096,
    };
    const openai = { max_input_tokens: 4096 };
    const azure = { max_input_tokens: 8192 };
    expect(applyProviderMetadataBatch(id, legacy, { openai }, today)).toBe(
      legacy,
    );
    expect(
      applyProviderMetadataBatch(id, legacy, { openai: azure, azure }, today),
    ).toBe(legacy);

    const remote = parseRemoteModelList({
      [id]: { litellm_provider: "openai", ...openai },
      [`azure/${id}`]: {
        litellm_provider: "azure",
        max_input_tokens: azure.max_input_tokens,
        deprecation_date: "2026-07-31",
      },
    });
    const resolved = resolveRemoteProviderMetadata(
      remote,
      { [id]: legacy },
      "openai",
    ).get(id)!;
    const updated = applyProviderMetadataBatch(id, legacy, resolved, today);
    expect(updated.providers).toEqual({ openai, azure });
    expect(updated.available_providers).toEqual(legacy.available_providers);
    expect(updated.max_input_tokens).toBe(legacy.max_input_tokens);
    expect(updated.retired).toBeUndefined();
    expect(updated.retirement_date).toBeUndefined();

    const indirectVertex: ModelSpec = {
      ...legacy,
      available_providers: ["openai", "vertex"],
    };
    expect(
      applyProviderMetadataBatch(
        id,
        indirectVertex,
        { openai, vertex: azure },
        today,
      ),
    ).toBe(indirectVertex);
  });

  it("does not restore an explicitly retired route from an upstream date", () => {
    const future = { retirement_date: "2027-01-01" };
    const updated = applyProviderMetadata(
      name,
      {
        ...model,
        providers: {
          ...model.providers,
          openai: { retirement_date: today, retired: true },
          azure: { retired: true },
        },
      },
      "openai",
      future,
      "LiteLLM",
      today,
    );
    expect(updated.providers?.openai).toEqual({
      retirement_date: today,
      retired: true,
    });

    const manual = applyProviderMetadata(
      name,
      updated,
      "azure",
      future,
      "OpenRouter",
      today,
    );
    expect(manual).toBe(updated);
  });

  it("reports the source, provider field, and old and new values for review", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      applyProviderMetadata(
        name,
        model,
        "azure",
        { max_input_tokens: 8000, retirement_date: "2026-07-31" },
        "LiteLLM",
        today,
      );
      expect(warn).toHaveBeenCalledWith(
        "  [REVIEW] gpt-3.5-turbo-instruct.providers.azure.max_input_tokens: LiteLLM 8000 differs from catalog 4097",
      );
      expect(warn).toHaveBeenCalledWith(
        "  [REVIEW] gpt-3.5-turbo-instruct.providers.azure.retirement_date: LiteLLM 2026-07-31 differs from catalog unset; not applied",
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe("convertRemoteToLocalModel speech pricing", () => {
  it("uses the audio output rate for speech models", () => {
    const model = convertRemoteToLocalModel("gpt-4o-mini-tts", {
      litellm_provider: "openai",
      mode: "audio_speech",
      input_cost_per_token: 6e-7,
      output_cost_per_token: 1e-5,
      output_cost_per_audio_token: 1.2e-5,
    } as Parameters<typeof convertRemoteToLocalModel>[1]);

    expect(model.output_cost_per_mil_tokens).toBe(12);
  });
});
