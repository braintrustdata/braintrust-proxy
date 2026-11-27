import { z } from "zod";
import { _urljoin } from "../src/util";
import { cacheWritePricingShape } from "./cache-metrics.generated";

export const PromptInputs = ["chat", "completion"] as const;
export type PromptInputType = (typeof PromptInputs)[number];

export const ModelFlavors = [
  "chat",
  "completion",
  "embedding",
  "evaluation",
  "decisions",
  "realtime",
  "live",
  "speech",
  "transcription",
] as const;
export type ModelFlavor = (typeof ModelFlavors)[number];

export const ModelFormats = [
  "openai",
  "anthropic",
  "google",
  "window",
  "js",
  "converse",
  "typesafe",
] as const;
export type ModelFormat = (typeof ModelFormats)[number];

export const ModelEndpointType = [
  "openai",
  "braintrust",
  "anthropic",
  "google",
  "mistral",
  "bedrock",
  "vertex",
  "together",
  "fireworks",
  "baseten",
  "perplexity",
  "xAI",
  "groq",
  "azure",
  "azure_ai_gateway",
  "databricks",
  "lepton",
  "cerebras",
  "ollama",
  "replicate",
  "cohere",
  "typesafe",
  "nace",
  "openrouter",
  "js",
] as const;
export type ModelEndpointType = (typeof ModelEndpointType)[number];

export const PricingTiers = [
  "standard",
  "flex",
  "batch",
  "priority",
  "fast",
  "ultrafast",
] as const;
export type PricingTier = (typeof PricingTiers)[number];

const pricingFieldsSchema = z.object({
  input_cost_per_mil_tokens: z.number().nullish(),
  output_cost_per_mil_tokens: z.number().nullish(),
  input_cache_read_cost_per_mil_tokens: z.number().nullish(),
  input_cache_write_cost_per_mil_tokens: z
    .number()
    .nullish()
    .describe("Total cache-write token price for the default TTL."),
  ...cacheWritePricingShape,
  input_audio_cost_per_mil_tokens: z.number().nullish(),
  output_audio_cost_per_mil_tokens: z.number().nullish(),
  input_audio_cache_read_cost_per_mil_tokens: z.number().nullish(),
  audio_duration_cost_per_second: z
    .number()
    .nullish()
    .describe("USD per second of metered audio duration."),
  audio_standby_cost_per_second: z
    .number()
    .nullish()
    .describe("USD per second of standby audio duration."),
});

export const PricingRateSchema = pricingFieldsSchema.extend({
  endpoints: z
    .array(z.string())
    .nullish()
    .describe(
      "Required provider endpoint hosts, Bedrock endpoint names, or OpenRouter endpoint tags. Omit only for prices verified across all eligible endpoints for this model, provider, and tier.",
    ),
  supported_regions: z.array(z.string()).nullish(),
  inference_geo: z
    .string()
    .nullish()
    .describe(
      "Required inference geography, such as Anthropic's global or us.",
    ),
  deployment_type: z.string().nullish(),
  model_id: z
    .string()
    .nullish()
    .describe("Required upstream model or inference profile ID."),
  model_version: z.string().nullish(),
  min_input_tokens: z
    .number()
    .nullish()
    .describe("Inclusive lower bound on prompt length for these rates."),
  max_input_tokens: z
    .number()
    .nullish()
    .describe("Inclusive upper bound on prompt length for these rates."),
  valid_from: z.string().nullish(),
  valid_until: z.string().nullish(),
});
export type PricingRate = z.infer<typeof PricingRateSchema>;

export const PricingTierSchema = z.union([
  z.array(PricingRateSchema).min(1),
  z.object({ alias: z.enum(PricingTiers) }).strict(),
]);

const providerPricingSchema = z
  .record(z.enum(PricingTiers), PricingTierSchema)
  .superRefine((tiers, ctx) => {
    for (const tier of PricingTiers) {
      const entry = tiers[tier];
      if (
        entry &&
        !Array.isArray(entry) &&
        !Array.isArray(tiers[entry.alias])
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [tier, "alias"],
          message:
            "A pricing alias must reference a rate array in the same model and provider; missing targets, chains, and cycles are not allowed.",
        });
      }
    }
  });

export const StoredModelPricingSchema = z.record(
  z.enum(ModelEndpointType),
  providerPricingSchema,
);

export const ModelPricingSchema = z.record(
  z.enum(ModelEndpointType),
  providerPricingSchema.transform((tiers) => {
    const resolved: Partial<Record<PricingTier, PricingRate[]>> = {};
    for (const tier of PricingTiers) {
      const entry = tiers[tier];
      if (entry !== undefined) {
        // The refinement above requires every alias to point directly to rates.
        resolved[tier] = Array.isArray(entry)
          ? entry
          : (tiers[entry.alias] as PricingRate[]);
      }
    }
    return resolved;
  }),
);
export type ModelPricing = z.infer<typeof ModelPricingSchema>;

const ProviderMetadataSchema = z.object({
  deprecation_date: z.string().nullish(),
  retirement_date: z.string().nullish(),
  retired: z.boolean().nullish(),
  max_input_tokens: z.number().nullish(),
  max_output_tokens: z.number().nullish(),
});

export const ModelSchema = z.object({
  format: z.enum(ModelFormats),
  flavor: z.enum(ModelFlavors),
  multimodal: z.boolean().nullish(),
  input_cost_per_token: z.number().nullish(),
  output_cost_per_token: z.number().nullish(),
  ...pricingFieldsSchema.shape,
  pricing: ModelPricingSchema.nullish().describe(
    "Verified USD prices per million tokens or per second of audio, as indicated by each field, keyed by the resolved provider and pricing tier. Each rate applies only to its endpoint, region, inference geography, deployment, model version, prompt length, and inclusive UTC date bounds. Missing prices are unknown, not zero. Missing non-standard tiers have no verified support and do not fall back to standard prices. Top-level price fields hold default standard prices; pricing.standard can specify conditional standard rates. Tier names are pricing categories, not provider API parameter values; use the tier actually served, not merely requested.",
  ),
  providers: z
    .record(z.enum(ModelEndpointType), ProviderMetadataSchema)
    .optional(),
  displayName: z
    .string()
    .nullish()
    .describe("The model is the latest production/stable"),
  o1_like: z.boolean().nullish().describe('DEPRECATED use "reasoning" instead'),
  reasoning: z
    .boolean()
    .nullish()
    .describe("The model supports reasoning/thinking tokens"),
  reasoning_budget: z
    .boolean()
    .nullish()
    .describe("The model supports reasoning/thinking budgets"),
  experimental: z
    .boolean()
    .nullish()
    .describe("The model is not allowed production load or API is unstable."),
  deprecated: z
    .boolean()
    .nullish()
    .describe(
      "Discourage the use of the model (we will hide the model in the UI).",
    ),
  deprecation_date: z
    .string()
    .nullish()
    .describe("Date after which the model will be treated as deprecated"),
  retired: z
    .boolean()
    .nullish()
    .describe("Model is no longer served by the provider"),
  retirement_date: z
    .string()
    .nullish()
    .describe("Date after which the model will be treated as retired"),
  parent: z.string().nullish().describe("The model was replaced this model."),
  fallback_models: z
    .array(z.string())
    .nullish()
    .describe(
      "Other catalog model ids for the same underlying model on provider-specific surfaces.",
    ),
  endpoint_types: z.array(z.enum(ModelEndpointType)).nullish(),
  locations: z.array(z.string()).nullish(),
  supported_regions: z
    .array(z.string())
    .nullish()
    .describe("Documented supported regions for the model on the provider."),
  description: z.string().nullish(),
  max_input_tokens: z
    .number()
    .nullish()
    .describe("The model supports a maximum input token limit."),
  max_output_tokens: z
    .number()
    .nullish()
    .describe("The model supports a maximum output token limit."),
  supports_streaming: z
    .boolean()
    .nullish()
    .describe("The model supports native streaming responses."),
  supports_decisions: z
    .boolean()
    .nullish()
    .describe(
      "The model answers decision requests (POST /v1/decisions): typed answers to questions about an input.",
    ),
  streaming_only: z
    .boolean()
    .nullish()
    .describe(
      "The upstream provider requires requests for this model to be sent with streaming enabled.",
    ),
  available_providers: z.array(z.enum(ModelEndpointType)).nullish(),
});

export type ModelSpec = z.infer<typeof ModelSchema>;

// Catalog editors retain references; ModelSchema resolves them for consumers.
export const StoredModelSchema = ModelSchema.extend({
  pricing: StoredModelPricingSchema.nullish().describe(
    'Provider/tier prices as rate arrays or {"alias": "tier"} references within the same model and provider. Aliases inherit all target rates and conditions. Use ModelSchema to resolve aliases.',
  ),
});
export type StoredModelSpec = z.infer<typeof StoredModelSchema>;

export function summarizeModelProviders(
  providers: NonNullable<ModelSpec["providers"]>,
) {
  const entries = Object.entries(providers) as [
    ModelEndpointType,
    z.infer<typeof ProviderMetadataSchema>,
  ][];
  const active = entries.filter(([, provider]) => provider.retired !== true);
  const latestRetirement = entries
    .map(([, provider]) => provider.retirement_date)
    .reduce<
      string | undefined
    >((latest, date) => (date && (!latest || date > latest) ? date : latest), undefined);
  const minLimit = (field: "max_input_tokens" | "max_output_tokens") => {
    const limits = active.flatMap(([, provider]) => provider[field] ?? []);
    return limits.length > 0 ? Math.min(...limits) : undefined;
  };

  return {
    available_providers: active.map(([provider]) => provider),
    retirement_date: active.some(([, provider]) => !provider.retirement_date)
      ? undefined
      : latestRetirement,
    retired: entries.length > 0 && active.length === 0,
    max_input_tokens: minLimit("max_input_tokens"),
    max_output_tokens: minLimit("max_output_tokens"),
  };
}

import modelListJson from "./model_list.json";
const modelListJsonTyped = z.record(ModelSchema).parse(modelListJson);

export type ModelName = keyof typeof modelListJson;

// Because this file can be included and bundled in various ways, it's important to
// really inject these variables into the global scope, rather than let the bundler
// have its way with them.
declare global {
  var _proxy_availableModels: { [name: string]: ModelSpec } | undefined;
  var _proxy_cachedModels: { [name: string]: ModelSpec } | null;
  var _proxy_cacheTimestamp: number | null;
}

// This function will always return at least the static model list,
export function getAvailableModels(): { [name: string]: ModelSpec } {
  return markModelsPastDeprecationDate(
    globalThis._proxy_availableModels ?? modelListJsonTyped,
  );
}

// This function will reach out to the control plane and update the
// available models. It is not required to call. If you don't, you'll
// just get whatever models are in the static list.
export async function refreshModels(appUrl: string): Promise<void> {
  if (isCacheValid()) {
    return;
  }

  const dynamicModels = await loadModelsFromControlPlane(appUrl);
  if (dynamicModels) {
    if (!globalThis._proxy_availableModels) {
      globalThis._proxy_availableModels = { ...modelListJsonTyped };
    }
    Object.assign(globalThis._proxy_availableModels, dynamicModels);
  }
}

// Dynamic model loader with expiration
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour in milliseconds

function isCacheValid(): boolean {
  return !!(
    globalThis._proxy_cachedModels &&
    globalThis._proxy_cacheTimestamp &&
    Date.now() - globalThis._proxy_cacheTimestamp < CACHE_TTL_MS
  );
}

// Global variable to track ongoing fetch request (acts as a mutex)
let _loadModelsPromise: Promise<{ [name: string]: ModelSpec } | null> | null =
  null;

async function loadModelsFromControlPlane(
  appUrl: string,
): Promise<{ [name: string]: ModelSpec } | null> {
  // Return cached models if still valid
  if (isCacheValid()) {
    return globalThis._proxy_cachedModels;
  }

  // If there's already a request in progress, wait for it
  if (_loadModelsPromise) {
    return await _loadModelsPromise;
  }

  // Create and store the promise to prevent concurrent requests
  _loadModelsPromise = (async () => {
    const fetchUrl = _urljoin(appUrl, "api/models/model_list.json");

    try {
      const response = await fetch(fetchUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }
      const data: { [name: string]: ModelSpec } = await response.json();
      for (const model of Object.values(data)) {
        if (model.pricing != null) {
          model.pricing = ModelPricingSchema.parse(model.pricing);
        }
      }
      globalThis._proxy_cachedModels = data;
      globalThis._proxy_cacheTimestamp = Date.now();
    } catch (error) {
      console.warn(
        `Failed to load models dynamically from control plane (${fetchUrl}), falling back to static import:`,
        error,
      );
    }
    return globalThis._proxy_cachedModels;
  })();

  try {
    // Wait for the request to complete
    const result = await _loadModelsPromise;
    return result;
  } finally {
    // Clear the promise so future requests can proceed
    _loadModelsPromise = null;
  }
}

const COST_MODEL_SUFFIX_TOKENS = new Set([
  "thinking",
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export function normalizeModelNameForCost(
  modelName: string,
  isKnownModel: (name: string) => boolean,
): string | undefined {
  if (isKnownModel(modelName)) {
    return modelName;
  }
  let candidate = modelName.trim().toLowerCase();
  while (true) {
    const dash = candidate.lastIndexOf("-");
    if (dash <= 0) {
      return undefined;
    }
    if (!COST_MODEL_SUFFIX_TOKENS.has(candidate.slice(dash + 1))) {
      return undefined;
    }
    candidate = candidate.slice(0, dash);
    if (isKnownModel(candidate)) {
      return candidate;
    }
  }
}

export function markModelsPastDeprecationDate(models: {
  [name: string]: ModelSpec;
}): { [name: string]: ModelSpec } {
  for (let modelName of Object.keys(models)) {
    const { deprecation_date, retirement_date } = models[modelName];
    if (
      deprecation_date &&
      Date.parse(deprecation_date) &&
      new Date() > new Date(deprecation_date)
    ) {
      models[modelName].deprecated = true;
    }
    if (
      retirement_date &&
      Date.parse(retirement_date) &&
      new Date() > new Date(retirement_date)
    ) {
      models[modelName].retired = true;
    }
    if (models[modelName].retired) {
      models[modelName].deprecated = true;
    }
  }
  return models;
}
