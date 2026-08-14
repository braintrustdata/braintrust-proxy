import fs from "fs";
import https from "https";
import path from "path";
import prettier from "prettier";
import { z } from "zod";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { exec } from "child_process";
import { promisify } from "util";
import { pathToFileURL } from "url";
import { ModelSchema, ModelSpec } from "../schema/models";
import ts from "typescript";
import {
  canonicalizeLocalModelName,
  getEquivalentLocalModelNames,
  isSupportedTranslatedModelName,
  translateToBraintrust,
} from "./model_name_translation";
import deprecatedModelIds from "./deprecated_model_ids.json";
import {
  getProviderMappingForModel,
  matchesProviderFilter,
  orderModelsByProviderAndClass,
} from "./sync_model_catalog";
import {
  fetchVertexSupportedRegions,
  GOOGLE_VERTEX_LOCATIONS_URL,
  syncVertexSupportedRegions,
} from "./sync_vertex_regions";

const execAsync = promisify(exec);

// Fields that are intentionally maintained by hand in model_list.json and must
// NOT be overwritten by the LiteLLM sync, because the upstream (LiteLLM) value
// is stale or wrong for these models. Keyed by local model name -> the
// ModelSpec fields to preserve. The `updateModelsCommand` cost/token-limit
// sync skips these fields (it neither reports a discrepancy nor writes a
// change for them).
//
// Update an entry only when the *authoritative provider* value genuinely
// changes; remove an entry to re-enable blind LiteLLM sync for that field.
// Without this list every sync run reverts these manual corrections (the
// recurring "chore: sync new models" regressions).
const GROK_FAST_COST_FIELDS = [
  "input_cost_per_mil_tokens",
  "output_cost_per_mil_tokens",
  "input_cache_read_cost_per_mil_tokens",
] as const satisfies ReadonlyArray<keyof ModelSpec>;
const INPUT_OUTPUT_COST_FIELDS = [
  "input_cost_per_mil_tokens",
  "output_cost_per_mil_tokens",
] as const satisfies ReadonlyArray<keyof ModelSpec>;
const INPUT_OUTPUT_CACHE_COST_FIELDS = [
  "input_cost_per_mil_tokens",
  "output_cost_per_mil_tokens",
  "input_cache_read_cost_per_mil_tokens",
] as const satisfies ReadonlyArray<keyof ModelSpec>;
const GROK_420_FIELDS = [
  "input_cost_per_mil_tokens",
  "output_cost_per_mil_tokens",
  "max_input_tokens",
] as const satisfies ReadonlyArray<keyof ModelSpec>;
const GPT5_CONTEXT_FIELDS = [
  "max_input_tokens",
] as const satisfies ReadonlyArray<keyof ModelSpec>;
const CACHE_READ_FIELD = [
  "input_cache_read_cost_per_mil_tokens",
] as const satisfies ReadonlyArray<keyof ModelSpec>;

export const SYNC_PRESERVED_FIELDS: Record<
  string,
  ReadonlyArray<keyof ModelSpec>
> = {
  // Deprecated grok "fast" models redirect to grok-4.3 at xAI and therefore
  // bill at grok-4.3 rates ($1.25 in / $2.50 out / $0.20 cache-read per 1M).
  // LiteLLM still lists the pre-redirect $0.20/$0.50 rates, which undercounts.
  "grok-4-1-fast-non-reasoning": GROK_FAST_COST_FIELDS,
  "grok-4-1-fast-non-reasoning-latest": GROK_FAST_COST_FIELDS,
  "grok-4-1-fast-reasoning": GROK_FAST_COST_FIELDS,
  "grok-4-1-fast-reasoning-latest": GROK_FAST_COST_FIELDS,
  "grok-4-fast-non-reasoning": GROK_FAST_COST_FIELDS,
  "grok-4-fast-reasoning": GROK_FAST_COST_FIELDS,
  // Grok 4.20: xAI docs list $1.25 in / $2.50 out per 1M and a 1,000,000-token
  // context window for the reasoning model and its beta/multi-agent aliases
  // (https://docs.x.ai/developers/models/grok-4.20-0309-reasoning). LiteLLM
  // lists a 2,000,000 context window, so the sync keeps re-raising
  // max_input_tokens; pin the verified price + context.
  "grok-4.20-0309-non-reasoning": GROK_420_FIELDS,
  "grok-4.20-0309-reasoning": GROK_420_FIELDS,
  "grok-4.20-beta-0309-non-reasoning": GROK_420_FIELDS,
  "grok-4.20-beta-0309-reasoning": GROK_420_FIELDS,
  "grok-4.20-multi-agent-beta-0309": GROK_420_FIELDS,
  // Grok 4.5 cached-input is $0.30/1M per xAI (docs.x.ai/docs/models: $2 in /
  // $6 out / $0.30 cache-read for sub-200k prompts). LiteLLM lists $0.50 and the
  // sync keeps re-raising the cache-read cost; input/output already match, so
  // pin only the cache-read field.
  "grok-4.5": ["input_cache_read_cost_per_mil_tokens"],
  "grok-4.5-latest": ["input_cache_read_cost_per_mil_tokens"],
  // Claude Sonnet 4's documented standard context window is 200k (1M is a
  // beta tier); LiteLLM reports the 1M beta window.
  "claude-sonnet-4-20250514": ["max_input_tokens"],
  "claude-4-sonnet-20250514": ["max_input_tokens"],
  // gpt-oss pricing taken from the provider pricing pages; LiteLLM is stale
  // (lists lower rates). Groq's gpt-oss-120b cached-input rate is $0.075 (50% of
  // input); LiteLLM reports $0.10, so pin the cache-read field too.
  "openai/gpt-oss-120b": INPUT_OUTPUT_CACHE_COST_FIELDS,
  // Groq's public GPT-OSS 20B price is $0.075/$0.30; LiteLLM carries Together's
  // lower $0.05/$0.20 and the sync keeps re-applying it. This id is pinned to
  // Groq (its priced/routable provider), so preserve its input/output cost.
  "openai/gpt-oss-20b": INPUT_OUTPUT_COST_FIELDS,
  "accounts/fireworks/models/gpt-oss-20b": INPUT_OUTPUT_COST_FIELDS,
  // mistral-small-latest = Mistral Small 4 ($0.15/$0.60 per the model card);
  // LiteLLM is stale at $0.10/$0.30.
  "mistral-small-latest": INPUT_OUTPUT_COST_FIELDS,
  // Claude Sonnet 4.6 max output is 128k per Anthropic's model card; LiteLLM
  // carries the stale 64k, so the sync keeps trying to lower it.
  "claude-sonnet-4-6": ["max_output_tokens"],
  // GPT-5 family context window is 400k per OpenAI's model pages, but LiteLLM
  // still reports 272000/128000, so update-models reverts these every OpenAI
  // sync run (the recurring gpt-5 churn on #967/#972/#973/#979). Pin max_input.
  "gpt-5": GPT5_CONTEXT_FIELDS,
  "gpt-5-2025-08-07": GPT5_CONTEXT_FIELDS,
  "gpt-5-mini": GPT5_CONTEXT_FIELDS,
  "gpt-5-mini-2025-08-07": GPT5_CONTEXT_FIELDS,
  "gpt-5-pro": GPT5_CONTEXT_FIELDS,
  "gpt-5-pro-2025-10-06": GPT5_CONTEXT_FIELDS,
  "gpt-5.3-codex": GPT5_CONTEXT_FIELDS,
  // GPT-5 Pro tier has no cached-input pricing per OpenAI, but LiteLLM keeps
  // re-adding a $3/M cache-read. Pin the field so the sync leaves it unset.
  "gpt-5.4-pro": CACHE_READ_FIELD,
  "gpt-5.4-pro-2026-03-05": CACHE_READ_FIELD,
  "gpt-5.5-pro": CACHE_READ_FIELD,
  "gpt-5.5-pro-2026-04-23": CACHE_READ_FIELD,
  // grok-code-fast is an xAI alias of grok-build-0.1 ($1 in / $0.20 cached /
  // $2 out per 1M); LiteLLM lists the old $0.20/$0.02/$1.50 and the sync keeps
  // reverting to it.
  "grok-code-fast": GROK_FAST_COST_FIELDS,
  // Fireworks GLM 5.2 cached input is $0.14/M per Fireworks' pricing page;
  // LiteLLM carries the GLM 5.1 $0.26 rate and the sync keeps re-applying it.
  "accounts/fireworks/models/glm-5p2": CACHE_READ_FIELD,
  // The Baseten/Together-served zai-org/GLM-5.2 publishes $0.26/M cached input
  // (Fireworks' $0.14 belongs to glm-5p2 above); pin it so applyBasetenPricing /
  // the sync stop re-applying Fireworks' $0.14 to this id.
  "zai-org/GLM-5.2": CACHE_READ_FIELD,
};

// Returns true if `field` of `modelName` is hand-maintained and must not be
// overwritten by the LiteLLM sync.
export function isFieldManuallyPreserved(
  modelName: string,
  field: keyof ModelSpec,
): boolean {
  return SYNC_PRESERVED_FIELDS[modelName]?.includes(field) ?? false;
}

// Model ids that must NEVER be auto-added by the LiteLLM sync, even though the
// remote source lists them. These are entries the source carries but that are
// not real, invocable models at the provider, so `add-models` re-introduces
// them on every run and they have to be removed by hand each time.
//
// Each id is matched against both the translated (local) name and the raw
// remote name. Add an id here only after confirming the provider rejects it;
// remove it if the provider later ships the model for real.
// Manual, non-deprecation sync exclusions (sync quirks that are not provider
// "model not found" deprecations): a phantom dated snapshot LiteLLM keeps
// listing, and a non-chat model that cannot be invoked via chat/completions.
const MANUAL_SYNC_EXCLUDED_MODELS: ReadonlyArray<string> = [
  // Phantom dated snapshot: Anthropic's Opus 4.7 generation uses the dateless
  // canonical id `claude-opus-4-7`; the API returns not_found for this dated id,
  // but LiteLLM still lists it, so the sync kept re-adding it.
  "claude-opus-4-7-20260416",
  // Not a chat model: OpenAI's realtime transcription model is rejected by
  // /v1/chat/completions ("This is not a chat model").
  "gpt-realtime-whisper",
  // Realtime models: not supported — Braintrust has no realtime endpoint, so
  // none of these invoke via /v1/chat/completions ("This is not a chat model"),
  // but LiteLLM (mode "realtime") keeps surfacing them so the sync re-adds them.
  "gpt-realtime-2.1",
  "gpt-realtime-2.1-mini",
  "gpt-realtime-2",
  "gpt-realtime-2025-08-28",
  "gpt-realtime-1.5",
  "gpt-realtime",
  "gpt-realtime-mini",
  "gpt-realtime-mini-2025-12-15",
  "gpt-realtime-mini-2025-10-06",
  "gpt-4o-realtime-preview",
  "gpt-4o-realtime-preview-2025-06-03",
  "gpt-4o-realtime-preview-2024-12-17",
  "gpt-4o-mini-realtime-preview",
  "gpt-4o-mini-realtime-preview-2024-12-17",
  // Realtime translation + audio transcription models: rejected by
  // /v1/chat/completions ("This is not a chat model and thus not supported in
  // the v1/chat/completions endpoint"), but LiteLLM surfaces them so the sync
  // re-adds them.
  "gpt-realtime-translate",
  "gpt-transcribe",
  "gpt-live-transcribe",
  // Live model: Gemini Live uses a bidirectional API and is rejected by
  // generateContent ("not supported for generateContent"), so it is not a
  // chat/completions model. Excluded permanently (see PR that trimmed it from
  // the daily catalog batch).
  "gemini-3.1-flash-live-preview",
  // Not deployed on the Braintrust Databricks account: these return
  // ENDPOINT_NOT_FOUND from Databricks (the endpoint does not exist), so they are
  // not invocable, but the daily bot keeps re-proposing them.
  "databricks-gpt-5-4-mini",
  "databricks-gemini-3-6-flash",
  // Vertex MaaS (OpenAI/xAI/Mistral/Meta): these are real models, but routing them
  // requires a gateway OpenAPI change, so they are added deliberately via a
  // dedicated PR (with that routing) rather than by the daily automation, which
  // otherwise auto-adds them without the routing change and produces entries that
  // 400 through the gateway. Exclude from auto-add.
  "publishers/meta/models/llama-4-maverick-17b-128e-instruct-maas",
  "publishers/meta/models/llama-4-scout-17b-16e-instruct-maas",
  "publishers/mistralai/models/mistral-medium-3",
  "publishers/mistralai/models/mistral-small-2503",
  "publishers/mistralai/models/codestral-2",
  "publishers/openai/models/gpt-oss-120b-maas",
  "publishers/openai/models/gpt-oss-20b-maas",
  "publishers/xai/models/grok-4.3",
  "publishers/xai/models/grok-4.20-non-reasoning",
  // Not accessible on the Braintrust Baseten account: these return 403
  // ("please check the api-key you provided") on invocation even though the key
  // works for other Baseten models, so they are not usable but the sync keeps
  // surfacing them from Baseten's model list.
  "inception/mercury-2",
  "sid/sid-1",
  // bedrock-mantle only: AWS serves Claude Mythos 5 exclusively through the
  // `bedrock-mantle` messages endpoint and marks bedrock-runtime / Invoke /
  // Converse unsupported (model card:
  // model-card-anthropic-claude-mythos-5.html). Our `bedrock` provider uses the
  // Bedrock runtime (InvokeModel/Converse), so this id is not invocable via the
  // gateway and must not be auto-added until Mantle routing exists.
  "anthropic.claude-mythos-5",
];

// The full exclusion set: manual quirks above + the provider-confirmed
// deprecations the audit maintains in scripts/deprecated_model_ids.json
// (written by scripts/apply_deprecations.ts — do not edit that JSON by hand).
export const SYNC_EXCLUDED_MODELS: ReadonlySet<string> = new Set<string>([
  ...MANUAL_SYNC_EXCLUDED_MODELS,
  ...deprecatedModelIds,
]);

// Returns true if `modelName` must not be auto-added by the sync.
export function isModelExcludedFromSync(modelName: string): boolean {
  return SYNC_EXCLUDED_MODELS.has(modelName);
}

// Perplexity Gateway (router) models are third-party ids (e.g.
// `perplexity/kimi-k3`, `perplexity/glm-5.2`) that Perplexity serves only through
// its gateway at https://api.perplexity.ai/router/v1/chat/completions. The
// `perplexity` provider (TS proxy EndpointProviderToBaseURL + lingua) points at
// the standard https://api.perplexity.ai, which serves only Sonar, so these ids
// are not routable and must never be auto-added. Match on the `perplexity/`
// prefix scoped to the `perplexity` provider so openrouter-served slugs such as
// `perplexity/sonar-pro-search` (available_providers ["openrouter"]) are kept.
export function isPerplexityGatewayModel(
  modelName: string,
  providers: string | ReadonlyArray<string> | undefined,
): boolean {
  if (!modelName.startsWith("perplexity/")) {
    return false;
  }
  const list = typeof providers === "string" ? [providers] : providers ?? [];
  return list.length > 0 && list.every((provider) => provider === "perplexity");
}

// Models Baseten still lists in /v1/models but has DEPRECATED for invocation
// (calls return HTTP 410 "the model version ... has been deprecated"). They are
// NOT excluded from the sync entirely because other providers (e.g. Together)
// still serve them — we only stop the Baseten sync from re-unioning the dead
// `baseten` provider back onto them each run.
const BASETEN_DEPRECATED_MODELS: ReadonlySet<string> = new Set<string>([
  "zai-org/GLM-5",
  "moonshotai/Kimi-K2.5",
]);

// Returns true if Baseten has deprecated `modelName` for invocation (so the
// Baseten sync must not add/keep `baseten` as one of its providers).
export function isBasetenDeprecated(modelName: string): boolean {
  return BASETEN_DEPRECATED_MODELS.has(modelName);
}

// Zod schema for individual model details
const searchContextCostPerQuerySchema = z
  .object({
    search_context_size_low: z.number().optional(),
    search_context_size_medium: z.number().optional(),
    search_context_size_high: z.number().optional(),
  })
  .optional();

// Schema for LiteLLM remote model details
const liteLLMModelDetailSchema = z
  .object({
    max_tokens: z.union([z.number(), z.string()]).optional(), // LEGACY: Can be number or string
    max_input_tokens: z
      .preprocess(
        (val) => (typeof val === "string" ? parseInt(val, 10) : val),
        z.number().optional(),
      )
      .optional(),
    max_output_tokens: z
      .preprocess(
        (val) => (typeof val === "string" ? parseInt(val, 10) : val),
        z.number().optional(),
      )
      .optional(),
    input_cost_per_token: z.number().optional(),
    output_cost_per_token: z.number().optional(),
    input_cost_per_mil_tokens: z.number().optional(), // From LiteLLM if available
    output_cost_per_mil_tokens: z.number().optional(), // From LiteLLM if available
    output_cost_per_reasoning_token: z.number().optional(),
    cache_creation_input_token_cost: z.number().optional(), // from LiteLLM, maps to input_cache_write
    cache_read_input_token_cost: z.number().optional(), // from LiteLLM, maps to input_cache_read
    litellm_provider: z.string().optional(),
    mode: z
      .enum([
        "chat",
        "embedding",
        "completion",
        "image_generation",
        "audio_transcription",
        "audio_speech",
        "moderation",
        "rerank",
        "responses",
        "video_generation",
        "search",
        "ocr",
        "vector_store",
        "image_edit",
        "realtime",
      ])
      .optional(),
    supports_function_calling: z.boolean().optional(),
    supports_parallel_function_calling: z.boolean().optional(),
    supports_vision: z.boolean().optional(),
    supports_audio_input: z.boolean().optional(),
    supports_audio_output: z.boolean().optional(),
    supports_prompt_caching: z.boolean().optional(),
    supports_response_schema: z.boolean().optional(),
    supports_system_messages: z.boolean().optional(),
    supports_reasoning: z.boolean().optional(),
    supports_web_search: z.boolean().optional(),
    search_context_cost_per_query: searchContextCostPerQuerySchema,
    deprecation_date: z.string().optional(), // YYYY-MM-DD
  })
  .passthrough();

const liteLLMModelListSchema = z.record(liteLLMModelDetailSchema);

type LiteLLMModelDetail = z.infer<typeof liteLLMModelDetailSchema>;
type LiteLLMModelList = z.infer<typeof liteLLMModelListSchema>;
type LocalModelDetail = ModelSpec; // Use ModelSpec from schema/models.ts
type LocalModelList = { [name: string]: ModelSpec }; // Use ModelSpec from schema/models.ts

export function isSupportedRemoteModel(
  remoteModel: LiteLLMModelDetail,
): boolean {
  return remoteModel.mode !== "embedding";
}

const LOCAL_MODEL_LIST_PATH = path.resolve(
  __dirname,
  "../schema/model_list.json",
);
const SCHEMA_INDEX_PATH = path.resolve(__dirname, "../schema/index.ts");
const SYNC_DEFAULT_ENDPOINT_TYPES = {
  openai: ["openai", "azure"],
  anthropic: ["anthropic"],
  google: ["google"],
  js: ["js"],
  window: ["js"],
  converse: ["bedrock"],
} satisfies Record<
  ModelSpec["format"],
  NonNullable<ModelSpec["available_providers"]>
>;
const REMOTE_MODEL_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/refs/heads/main/litellm/model_prices_and_context_window_backup.json";

async function fetchRemoteModels(url: string): Promise<LiteLLMModelList> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const jsonData = JSON.parse(data);
            if (
              jsonData &&
              typeof jsonData === "object" &&
              "sample_spec" in jsonData
            ) {
              delete jsonData.sample_spec;
            }
            const parsedModels = liteLLMModelListSchema.parse(jsonData);
            resolve(parsedModels);
          } catch (error) {
            if (error instanceof z.ZodError) {
              console.error(
                "Zod validation errors in remote data:",
                error.errors,
              );
              reject(
                new Error(
                  "Failed to parse remote JSON due to schema validation errors.",
                ),
              );
            } else {
              reject(
                new Error(
                  "Failed to parse remote JSON: " + (error as Error).message,
                ),
              );
            }
          }
        });
      })
      .on("error", (err) => {
        reject(new Error("Failed to fetch remote models: " + err.message));
      });
  });
}

// Baseten Model APIs expose an OpenAI-compatible /v1/models endpoint that lists
// the models currently served on Baseten's shared inference surface, with
// pricing (per token, as strings), context length, and feature flags. This is
// the authoritative source for Baseten availability — LiteLLM lags it.
const BASETEN_MODEL_URL = "https://inference.baseten.co/v1/models";

const basetenPricingSchema = z
  .object({
    prompt: z.string().optional(),
    completion: z.string().optional(),
    input_cache_read: z.string().optional(),
  })
  .passthrough();

const basetenModelSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    context_length: z.number().optional(),
    max_completion_tokens: z.number().optional(),
    pricing: basetenPricingSchema.optional(),
    supported_features: z.array(z.string()).optional(),
    input_modalities: z.array(z.string()).optional(),
    output_modalities: z.array(z.string()).optional(),
  })
  .passthrough();

const basetenModelListSchema = z
  .object({ data: z.array(basetenModelSchema) })
  .passthrough();

type BasetenModel = z.infer<typeof basetenModelSchema>;

async function fetchBasetenModels(apiKey: string): Promise<BasetenModel[]> {
  return new Promise((resolve, reject) => {
    https
      .get(
        BASETEN_MODEL_URL,
        { headers: { Authorization: `Bearer ${apiKey}` } },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(
                new Error(
                  `Baseten /v1/models returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`,
                ),
              );
              return;
            }
            try {
              const parsed = basetenModelListSchema.parse(JSON.parse(data));
              resolve(parsed.data);
            } catch (error) {
              if (error instanceof z.ZodError) {
                console.error(
                  "Zod validation errors in Baseten data:",
                  error.errors,
                );
                reject(
                  new Error(
                    "Failed to parse Baseten /v1/models due to schema validation errors.",
                  ),
                );
              } else {
                reject(
                  new Error(
                    "Failed to parse Baseten /v1/models: " +
                      (error as Error).message,
                  ),
                );
              }
            }
          });
        },
      )
      .on("error", (err) => {
        reject(new Error("Failed to fetch Baseten models: " + err.message));
      });
  });
}

// OpenRouter's public model directory (https://openrouter.ai/api/v1/models).
// Prices are per-token decimal strings; context_length / top_provider carry the
// window and max output. We only mirror models we ALREADY carry under a
// different (openrouter slug) id, so the directory is used as an authoritative
// source of the slug + pricing/context for those alternates.
const OPENROUTER_MODEL_URL = "https://openrouter.ai/api/v1/models";

const openRouterPricingSchema = z
  .object({
    prompt: z.string().optional(),
    completion: z.string().optional(),
    input_cache_read: z.string().optional(),
  })
  .passthrough();

const openRouterArchitectureSchema = z
  .object({
    input_modalities: z.array(z.string()).optional(),
    output_modalities: z.array(z.string()).optional(),
  })
  .passthrough();

const openRouterTopProviderSchema = z
  .object({
    context_length: z.number().nullish(),
    max_completion_tokens: z.number().nullish(),
  })
  .passthrough();

const openRouterModelSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    context_length: z.number().nullish(),
    pricing: openRouterPricingSchema.optional(),
    architecture: openRouterArchitectureSchema.optional(),
    supported_parameters: z.array(z.string()).optional(),
    top_provider: openRouterTopProviderSchema.optional(),
  })
  .passthrough();

const openRouterModelListSchema = z
  .object({ data: z.array(openRouterModelSchema) })
  .passthrough();

type OpenRouterModel = z.infer<typeof openRouterModelSchema>;

// The /api/v1/models directory is public; no API key is required to list models.
async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  return new Promise((resolve, reject) => {
    https
      .get(OPENROUTER_MODEL_URL, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(
              new Error(
                `OpenRouter /api/v1/models returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`,
              ),
            );
            return;
          }
          try {
            const parsed = openRouterModelListSchema.parse(JSON.parse(data));
            resolve(parsed.data);
          } catch (error) {
            if (error instanceof z.ZodError) {
              console.error(
                "Zod validation errors in OpenRouter data:",
                error.errors,
              );
              reject(
                new Error(
                  "Failed to parse OpenRouter /api/v1/models due to schema validation errors.",
                ),
              );
            } else {
              reject(
                new Error(
                  "Failed to parse OpenRouter /api/v1/models: " +
                    (error as Error).message,
                ),
              );
            }
          }
        });
      })
      .on("error", (err) => {
        reject(new Error("Failed to fetch OpenRouter models: " + err.message));
      });
  });
}

// Cohere hosts only its own models, keyed by their bare name (e.g.
// `command-a-03-2025`). GET /v1/models is the authoritative, paginated directory
// of what Cohere currently serves; filtering by `endpoint=chat` returns the
// chat-capable models. Cohere's models endpoint carries NO pricing, so the sync
// overlays pricing from LiteLLM where LiteLLM has the model (see
// convertCohereToLocalModel); the newest models Cohere has not yet published
// pricing for anywhere are left price-less rather than fabricated.
const COHERE_MODEL_URL = "https://api.cohere.com/v1/models";

const cohereModelSchema = z
  .object({
    name: z.string(),
    endpoints: z.array(z.string()).optional(),
    finetuned: z.boolean().optional(),
    is_deprecated: z.boolean().optional(),
    context_length: z.number().optional(),
  })
  .passthrough();

const cohereModelListSchema = z
  .object({
    models: z.array(cohereModelSchema),
    next_page_token: z.string().nullish(),
  })
  .passthrough();

type CohereModel = z.infer<typeof cohereModelSchema>;

function fetchCohereModelsPage(
  apiKey: string,
  pageToken?: string,
): Promise<{ models: CohereModel[]; nextPageToken?: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(COHERE_MODEL_URL);
    url.searchParams.set("endpoint", "chat");
    url.searchParams.set("page_size", "1000");
    if (pageToken) {
      url.searchParams.set("page_token", pageToken);
    }
    https
      .get(url, { headers: { Authorization: `Bearer ${apiKey}` } }, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(
              new Error(
                `Cohere /v1/models returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`,
              ),
            );
            return;
          }
          try {
            const parsed = cohereModelListSchema.parse(JSON.parse(data));
            resolve({
              models: parsed.models,
              nextPageToken: parsed.next_page_token ?? undefined,
            });
          } catch (error) {
            if (error instanceof z.ZodError) {
              console.error(
                "Zod validation errors in Cohere data:",
                error.errors,
              );
              reject(
                new Error(
                  "Failed to parse Cohere /v1/models due to schema validation errors.",
                ),
              );
            } else {
              reject(
                new Error(
                  "Failed to parse Cohere /v1/models: " +
                    (error as Error).message,
                ),
              );
            }
          }
        });
      })
      .on("error", (err) => {
        reject(new Error("Failed to fetch Cohere models: " + err.message));
      });
  });
}

async function fetchCohereModels(apiKey: string): Promise<CohereModel[]> {
  const all: CohereModel[] = [];
  let pageToken: string | undefined;
  // Bound the pagination so a malformed next_page_token can never loop forever.
  for (let page = 0; page < 100; page++) {
    const { models, nextPageToken } = await fetchCohereModelsPage(
      apiKey,
      pageToken,
    );
    all.push(...models);
    if (!nextPageToken) {
      return all;
    }
    pageToken = nextPageToken;
  }
  return all;
}

async function readLocalModels(filePath: string): Promise<LocalModelList> {
  try {
    const fileContent = await fs.promises.readFile(filePath, "utf-8");
    return canonicalizeLocalModelsContent(fileContent).models;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(
        "Zod validation errors in local model_list.json:",
        error.errors,
      );
      throw new Error("Local model_list.json failed Zod validation.");
    }
    throw new Error(
      "Failed to read or parse local model list: " + (error as Error).message,
    );
  }
}

type CanonicalizedLocalModels = {
  models: LocalModelList;
  renamedKeys: Array<{ from: string; to: string }>;
  canonicalContent: string;
};

export function canonicalizeLocalModelsContent(
  fileContent: string,
): CanonicalizedLocalModels {
  const localData = JSON.parse(fileContent);
  const parsedModels = z.record(ModelSchema).parse(localData);
  const normalizedLocalData = normalizeLocalModels(parsedModels);
  const reorderedModels = reorderModelProperties(normalizedLocalData.models);

  return {
    models: reorderedModels,
    renamedKeys: normalizedLocalData.renamedKeys,
    canonicalContent: JSON.stringify(reorderedModels, null, 2) + "\n",
  };
}

function getJsonPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }

  if (ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}

export function findDuplicateJsonKeys(fileContent: string): string[] {
  const sourceFile = ts.parseJsonText(LOCAL_MODEL_LIST_PATH, fileContent);
  const [statement] = sourceFile.statements;
  if (!statement || !ts.isExpressionStatement(statement)) {
    return [];
  }

  const duplicates: string[] = [];

  const visit = (node: ts.Node, path: string[]) => {
    if (ts.isObjectLiteralExpression(node)) {
      const seenKeys = new Set<string>();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) {
          continue;
        }

        const propertyName = getJsonPropertyName(property.name);
        if (!propertyName) {
          continue;
        }

        const propertyPath = [...path, propertyName].join(".");
        if (seenKeys.has(propertyName)) {
          duplicates.push(propertyPath);
        } else {
          seenKeys.add(propertyName);
        }

        visit(property.initializer, [...path, propertyName]);
      }
      return;
    }

    if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach((element, index) => {
        visit(element, [...path, String(index)]);
      });
    }
  };

  visit(statement.expression, []);
  return duplicates;
}

type ResolvedRemoteEntry = {
  remoteModelName: string;
  remoteModel: LiteLLMModelDetail;
  mergedProviders: string[];
};

// Deduplicate remote models by their translated (local) name.
// When multiple remote names translate to the same local name, the model data
// from the first entry is kept and providers from all entries are merged.
function resolveRemoteModels(
  remoteModels: LiteLLMModelList,
  providerFilter?: string,
): Map<string, ResolvedRemoteEntry> {
  const result = new Map<string, ResolvedRemoteEntry>();

  // Sort by provider then model name so collision resolution is deterministic
  // regardless of JSON key order. The alphabetically earliest provider wins as
  // the primary entry (its model data is kept); remaining entries only contribute
  // their providers to the merged list.
  const sortedNames = Object.keys(remoteModels).sort((a, b) => {
    const pa = remoteModels[a].litellm_provider ?? "";
    const pb = remoteModels[b].litellm_provider ?? "";
    return pa !== pb ? pa.localeCompare(pb) : a.localeCompare(b);
  });

  for (const remoteModelName of sortedNames) {
    const remoteModel = remoteModels[remoteModelName];

    if (!matchesProviderFilter(remoteModelName, remoteModel, providerFilter)) {
      continue;
    }
    if (!isSupportedRemoteModel(remoteModel)) {
      continue;
    }

    const translatedName = translateToBraintrust(
      remoteModelName,
      remoteModel.litellm_provider,
    );
    if (
      !isSupportedTranslatedModelName(
        translatedName,
        remoteModel.litellm_provider,
      )
    ) {
      console.warn(
        `Skipping unsupported remote model: "${remoteModelName}" -> "${translatedName}"`,
      );
      continue;
    }
    const providers = getProviderMappingForModel(remoteModelName, remoteModel);

    if (result.has(translatedName)) {
      const existing = result.get(translatedName)!;
      const newProviders = providers.filter(
        (p) => !existing.mergedProviders.includes(p),
      );
      const mergedProviders = [...existing.mergedProviders, ...newProviders];
      if (newProviders.length > 0) {
        console.warn(
          `⚠️  Collision: "${remoteModelName}" and "${existing.remoteModelName}" both translate to "${translatedName}" — merging providers: ${JSON.stringify(mergedProviders)}`,
        );
      } else {
        console.warn(
          `⚠️  Collision: "${remoteModelName}" and "${existing.remoteModelName}" both translate to "${translatedName}" — same providers, keeping first entry`,
        );
      }
      result.set(translatedName, { ...existing, mergedProviders });
    } else {
      result.set(translatedName, {
        remoteModelName,
        remoteModel,
        mergedProviders: providers,
      });
    }
  }

  return result;
}

function mergeLocalModelDetails(
  primary: LocalModelDetail,
  secondary: LocalModelDetail,
): LocalModelDetail {
  return {
    ...secondary,
    ...primary,
  };
}

export function getUpdatedAvailableProviders(
  currentProviders: string[] | undefined,
  remoteProviders: string[],
  providerFilterApplied: boolean,
): string[] {
  if (!providerFilterApplied) {
    return remoteProviders;
  }

  const mergedProviders = [...(currentProviders ?? [])];
  for (const provider of remoteProviders) {
    if (!mergedProviders.includes(provider)) {
      mergedProviders.push(provider);
    }
  }
  return mergedProviders;
}

const ANTHROPIC_BEDROCK_SCOPES = new Set(["us", "eu", "apac", "global"]);
const MISTRAL_VERTEX_EQUIVALENT_MODELS = new Set([
  "codestral-2501",
  "mistral-large-2411",
]);

// AWS Bedrock serves OpenAI's GPT models through the Mantle engine under an
// `openai.` prefix (optionally region-scoped, e.g. `us.openai.gpt-5.5`). These
// are the same models as the canonical `gpt-*` ids available via openai/azure,
// so register the Bedrock ids as fallbacks for the canonical model. The
// open-weight `gpt-oss` family is excluded: it is a distinct (converse-format)
// model served outside openai/azure, so it must not be grouped here.
const BEDROCK_OPENAI_GPT_PATTERN =
  /^(?:(?:global|us|eu|apac)\.)?openai\.(gpt-(?!oss).+)$/;

type EquivalentModelCandidate = {
  canonicalName: string;
  managed: boolean;
  provider?: string;
};

function equivalentModelCandidate(
  modelName: string,
): EquivalentModelCandidate | undefined {
  const anthropicVertexPrefix = "publishers/anthropic/models/";
  if (modelName.startsWith(anthropicVertexPrefix)) {
    return {
      canonicalName: modelName.substring(anthropicVertexPrefix.length),
      managed: true,
      provider: "vertex",
    };
  }

  const googleVertexPrefix = "publishers/google/models/";
  if (modelName.startsWith(googleVertexPrefix)) {
    const canonicalName = modelName.substring(googleVertexPrefix.length);
    return {
      canonicalName,
      managed: canonicalName.startsWith("gemini-"),
      provider: "vertex",
    };
  }

  const mistralVertexPrefix = "publishers/mistralai/models/";
  if (modelName.startsWith(mistralVertexPrefix)) {
    const canonicalName = modelName.substring(mistralVertexPrefix.length);
    return {
      canonicalName,
      managed: MISTRAL_VERTEX_EQUIVALENT_MODELS.has(canonicalName),
      provider: "vertex",
    };
  }

  if (modelName.startsWith("anthropic.")) {
    return {
      canonicalName: modelName.substring("anthropic.".length),
      managed: true,
    };
  }

  const parts = modelName.split(".");
  if (
    parts.length >= 3 &&
    ANTHROPIC_BEDROCK_SCOPES.has(parts[0]) &&
    parts[1] === "anthropic"
  ) {
    return {
      canonicalName: parts.slice(2).join("."),
      managed: true,
    };
  }

  const bedrockOpenAiGptMatch = modelName.match(BEDROCK_OPENAI_GPT_PATTERN);
  if (bedrockOpenAiGptMatch) {
    return {
      canonicalName: bedrockOpenAiGptMatch[1],
      managed: true,
    };
  }

  if (
    modelName.startsWith("claude-") ||
    modelName.startsWith("gemini-") ||
    MISTRAL_VERTEX_EQUIVALENT_MODELS.has(modelName)
  ) {
    return { canonicalName: modelName, managed: true };
  }

  return undefined;
}

export function applyEquivalentModels(
  localModels: LocalModelList,
): LocalModelList {
  const modelNames = new Set(Object.keys(localModels));
  const groups = new Map<string, string[]>();
  const managedNames = new Set<string>();
  const managedProviders = new Map<string, string>();

  for (const modelName of modelNames) {
    const candidate = equivalentModelCandidate(modelName);
    if (!candidate?.managed || !modelNames.has(candidate.canonicalName)) {
      continue;
    }

    const group = groups.get(candidate.canonicalName) ?? [];
    group.push(modelName);
    groups.set(candidate.canonicalName, group);
    managedNames.add(modelName);
    managedNames.add(candidate.canonicalName);
    if (candidate.provider) {
      managedProviders.set(modelName, candidate.provider);
    }
  }

  const updatedModels: LocalModelList = {};
  for (const [modelName, model] of Object.entries(localModels)) {
    if (managedNames.has(modelName)) {
      const { fallback_models: _fallbackModels, ...rest } = model;
      const provider = managedProviders.get(modelName);
      if (provider && !rest.available_providers?.length) {
        rest.available_providers = [provider];
      }
      updatedModels[modelName] = rest;
    } else {
      updatedModels[modelName] = model;
    }
  }

  for (const [canonicalName, group] of groups) {
    const equivalentModels = Array.from(new Set(group))
      .filter((modelName) => modelName !== canonicalName)
      .sort();
    if (equivalentModels.length === 0) {
      continue;
    }

    const canonicalModel = updatedModels[canonicalName];
    if (!canonicalModel) {
      continue;
    }

    if (
      MISTRAL_VERTEX_EQUIVALENT_MODELS.has(canonicalName) &&
      !canonicalModel.available_providers?.length
    ) {
      canonicalModel.available_providers = ["mistral"];
    }

    updatedModels[canonicalName] = {
      ...canonicalModel,
      fallback_models: equivalentModels,
    };
  }

  return updatedModels;
}

export function normalizeLocalModels(localModels: LocalModelList): {
  models: LocalModelList;
  renamedKeys: Array<{ from: string; to: string }>;
} {
  const normalizedModels: LocalModelList = {};
  const orderedNames: string[] = [];
  const renamedKeys: Array<{ from: string; to: string }> = [];

  for (const [modelName, model] of Object.entries(localModels)) {
    const canonicalName = canonicalizeLocalModelName(modelName);
    if (canonicalName !== modelName) {
      renamedKeys.push({ from: modelName, to: canonicalName });
    }

    const existing = normalizedModels[canonicalName];
    if (!existing) {
      normalizedModels[canonicalName] = model;
      orderedNames.push(canonicalName);
      continue;
    }

    const hasCanonicalSource = Object.prototype.hasOwnProperty.call(
      localModels,
      canonicalName,
    );

    if (canonicalName === modelName) {
      normalizedModels[canonicalName] = model;
      continue;
    }

    if (hasCanonicalSource) {
      continue;
    }

    normalizedModels[canonicalName] = mergeLocalModelDetails(existing, model);
  }

  const orderedModels: LocalModelList = {};
  for (const modelName of orderedNames) {
    orderedModels[modelName] = normalizedModels[modelName];
  }

  return {
    models: applyEquivalentModels(orderedModels),
    renamedKeys,
  };
}

function reorderModelProperties(localModels: LocalModelList): LocalModelList {
  const orderedModelsToWrite: LocalModelList = {};
  const schemaKeys = Object.keys(ModelSchema.shape) as Array<keyof ModelSpec>;

  for (const modelName in localModels) {
    const originalModel = localModels[modelName];
    const orderedModel: Partial<ModelSpec> = {};

    for (const key of schemaKeys) {
      if (Object.prototype.hasOwnProperty.call(originalModel, key)) {
        (orderedModel as any)[key] = originalModel[key];
      }
    }

    for (const key in originalModel) {
      if (Object.prototype.hasOwnProperty.call(originalModel, key)) {
        if (!schemaKeys.includes(key as keyof ModelSpec)) {
          (orderedModel as any)[key] = (originalModel as any)[key];
        }
      }
    }

    orderedModelsToWrite[modelName] = orderedModel as ModelSpec;
  }

  return orderedModelsToWrite;
}

async function writeLocalModels(localModels: LocalModelList): Promise<void> {
  const orderedModelsToWrite = reorderModelProperties(
    stablyOrderByExisting(localModels),
  );
  await fs.promises.writeFile(
    LOCAL_MODEL_LIST_PATH,
    JSON.stringify(orderedModelsToWrite, null, 2) + "\n",
  );
}

// Preserve the existing on-disk top-level key order so a sync/bot write does not
// reshuffle the whole file. Existing ids keep their positions (the order stops
// "flopping"); a genuinely-new id is inserted at the FRONT of its group — before
// the first existing model that shares its primary provider — so newer models
// display first within their provider grouping. Falls back to appending if the
// provider group does not exist yet.
function stablyOrderByExisting(localModels: LocalModelList): LocalModelList {
  let existingOrder: string[] = [];
  try {
    existingOrder = Object.keys(
      JSON.parse(fs.readFileSync(LOCAL_MODEL_LIST_PATH, "utf-8")),
    );
  } catch {
    // No existing catalog on disk (or unreadable) — fall back to insertion order.
    return localModels;
  }
  const primaryProvider = (name: string): string | undefined =>
    localModels[name]?.available_providers?.[0];
  const idNamespace = (name: string): string =>
    name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "";
  // Existing models first, in their current on-disk order.
  const orderedNames = existingOrder.filter((name) =>
    Object.prototype.hasOwnProperty.call(localModels, name),
  );
  // Insert each new model at the front of its group (newest-first). The catalog
  // is grouped by primary provider, then by namespace within a provider region,
  // so prefer the same (provider, namespace) sub-group; otherwise fall back to
  // the front of the provider region; otherwise append.
  for (const name in localModels) {
    if (orderedNames.includes(name)) {
      continue;
    }
    const provider = primaryProvider(name);
    const ns = idNamespace(name);
    let insertAt = orderedNames.findIndex(
      (existing) =>
        primaryProvider(existing) === provider && idNamespace(existing) === ns,
    );
    if (insertAt < 0) {
      insertAt = orderedNames.findIndex(
        (existing) => primaryProvider(existing) === provider,
      );
    }
    if (insertAt < 0) {
      insertAt = orderedNames.length;
    }
    orderedNames.splice(insertAt, 0, name);
  }
  // Display ordering: keep openrouter-only entries (available_providers is
  // exactly ["openrouter"]) below every other model. These are mirrored from
  // OpenRouter for models no first-class provider serves, so they sort last.
  // Stable partition preserves relative order within each side.
  const isOpenRouterOnly = (name: string): boolean => {
    const providers = localModels[name]?.available_providers;
    return (
      Array.isArray(providers) &&
      providers.length === 1 &&
      providers[0] === "openrouter"
    );
  };
  const sunkOrder = [
    ...orderedNames.filter((name) => !isOpenRouterOnly(name)),
    ...orderedNames.filter((name) => isOpenRouterOnly(name)),
  ];
  const ordered: LocalModelList = {};
  for (const name of sunkOrder) {
    ordered[name] = localModels[name];
  }
  return ordered;
}

function getNonZeroNumber(value: number | undefined): number | undefined {
  if (typeof value !== "number" || value === 0) {
    return undefined;
  }

  return value;
}

type ProviderMappingEntryRange = {
  start: number;
  end: number;
};

type ProviderMappingUpdate = {
  name: string;
  providers: string[];
};

function isProviderMappingEntryEnd(line: string): boolean {
  return /\],(?:\s*\/\/.*)?$/.test(line.trim());
}

function getProviderMappingKey(line: string): string | undefined {
  const match = line.match(/^  (?:"([^"]+)"|([A-Za-z_$][\w$]*)):/);
  return match?.[1] ?? match?.[2];
}

function findProviderMappingEntryRange(
  lines: string[],
  modelName: string,
): ProviderMappingEntryRange | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (getProviderMappingKey(lines[i]) !== modelName) {
      continue;
    }

    let end = i;
    while (end < lines.length && !isProviderMappingEntryEnd(lines[end])) {
      end += 1;
    }

    return { start: i, end };
  }

  return undefined;
}

export function normalizeProviderMappingContent(schemaContent: string): string {
  const lines = schemaContent.split("\n");
  const normalizedLines: string[] = [];
  const seenCanonicalKeys = new Set<string>();
  let inAvailableEndpointTypes = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("export const AvailableEndpointTypes")) {
      inAvailableEndpointTypes = true;
      normalizedLines.push(lines[i]);
      continue;
    }

    if (!inAvailableEndpointTypes) {
      normalizedLines.push(lines[i]);
      continue;
    }

    if (lines[i].trim() === "};") {
      inAvailableEndpointTypes = false;
      normalizedLines.push(lines[i]);
      continue;
    }

    const originalKey = getProviderMappingKey(lines[i]);
    if (!originalKey) {
      if (lines[i].trim() === "],") {
        continue;
      }

      normalizedLines.push(lines[i]);
      continue;
    }

    const canonicalKey = canonicalizeLocalModelName(originalKey);
    const entryLines = [lines[i]];

    while (
      i + 1 < lines.length &&
      !isProviderMappingEntryEnd(entryLines[entryLines.length - 1])
    ) {
      i += 1;
      entryLines.push(lines[i]);
    }

    if (seenCanonicalKeys.has(canonicalKey)) {
      continue;
    }

    if (canonicalKey !== originalKey) {
      entryLines[0] = entryLines[0].replace(originalKey, canonicalKey);
    }

    normalizedLines.push(...entryLines);
    seenCanonicalKeys.add(canonicalKey);
  }

  while (
    normalizedLines.length > 0 &&
    normalizedLines[normalizedLines.length - 1].trim() === ""
  ) {
    normalizedLines.pop();
  }

  if (normalizedLines.length === 0) {
    return "";
  }

  return `${normalizedLines.join("\n")}\n`;
}

async function normalizeProviderMappingsFile(): Promise<void> {
  const schemaContent = await fs.promises.readFile(SCHEMA_INDEX_PATH, "utf-8");
  const normalizedContent = normalizeProviderMappingContent(schemaContent);

  if (normalizedContent !== schemaContent) {
    await fs.promises.writeFile(SCHEMA_INDEX_PATH, normalizedContent);
  }
}

export function formatProviderMappingProviders(providers: string[]): string {
  return `[${providers.map((provider) => JSON.stringify(provider)).join(", ")}]`;
}

function isVertexModelName(modelName: string): boolean {
  return (
    modelName.startsWith("publishers/") ||
    /^(?:global|us|eu|apac)\./.test(modelName)
  );
}

function providersForExactModelName(
  modelName: string,
  providers: NonNullable<ModelSpec["available_providers"]>,
): NonNullable<ModelSpec["available_providers"]> {
  return providers.filter(
    (provider) =>
      (provider !== "vertex" || isVertexModelName(modelName)) &&
      // openrouter is an aggregator: it is a routable provider recorded in
      // available_providers, but it must not enter a model's DIRECT index.ts
      // endpoint types unless it is the model's only provider (an
      // openrouter-only entry). This keeps native/first-class models
      // native-only for getDirectModelEndpointTypes (BT-5895), mirroring how
      // vertex is represented via its separate publishers/ fallback id.
      (provider !== "openrouter" || providers.length === 1),
  );
}

export function getMissingProviderMappings(
  localModels: LocalModelList,
  schemaContent: string,
  modelNames: string[] = Object.keys(localModels),
): ProviderMappingUpdate[] {
  const lines = normalizeProviderMappingContent(schemaContent).split("\n");
  const missingProviderMappings: ProviderMappingUpdate[] = [];

  for (const name of modelNames) {
    const model = localModels[name];
    const providers = model?.available_providers;
    if (!providers || providers.length === 0) {
      continue;
    }
    const exactModelProviders = providersForExactModelName(name, providers);
    if (exactModelProviders.length === 0) {
      continue;
    }
    if (findProviderMappingEntryRange(lines, name)) {
      continue;
    }
    const defaultProviders = model && SYNC_DEFAULT_ENDPOINT_TYPES[model.format];
    const matchesDefault =
      defaultProviders &&
      defaultProviders.length === exactModelProviders.length &&
      defaultProviders.every(
        (provider, i) => provider === exactModelProviders[i],
      );
    if (matchesDefault) {
      continue;
    }

    missingProviderMappings.push({ name, providers: exactModelProviders });
  }

  return missingProviderMappings;
}

// Delete the AvailableEndpointTypes entries for the given model ids from
// schema/index.ts (used when a model_list.json key is removed, so its mapping
// does not dangle). No-op for ids that have no entry.
export function removeProviderMappingEntriesFromContent(
  content: string,
  names: string[],
): string {
  let out = content;
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`^  "${escaped}":[^\\n]*\\n`, "m"), "");
  }
  return out;
}

async function removeProviderMappingEntries(names: string[]): Promise<void> {
  if (names.length === 0) {
    return;
  }
  const content = await fs.promises.readFile(SCHEMA_INDEX_PATH, "utf-8");
  await fs.promises.writeFile(
    SCHEMA_INDEX_PATH,
    removeProviderMappingEntriesFromContent(content, names),
  );
}

async function syncProviderMappingsForLocalModels(
  localModels: LocalModelList,
  modelNames: string[] = Object.keys(localModels),
): Promise<void> {
  const schemaContent = await fs.promises.readFile(SCHEMA_INDEX_PATH, "utf-8");
  const missingProviderMappings = getMissingProviderMappings(
    localModels,
    schemaContent,
    modelNames,
  );
  if (missingProviderMappings.length > 0) {
    console.log(
      `\nUpdating ${missingProviderMappings.length} missing provider mappings...`,
    );
    await updateProviderMapping(
      missingProviderMappings,
      Object.keys(localModels),
    );
    return;
  }

  await normalizeProviderMappingsFile();
}

async function updateProviderMapping(
  newModels: ProviderMappingUpdate[],
  completeModelOrder?: string[],
): Promise<void> {
  try {
    const schemaContent = await fs.promises.readFile(
      SCHEMA_INDEX_PATH,
      "utf-8",
    );
    const normalizedContent = normalizeProviderMappingContent(schemaContent);
    const lines = normalizedContent.split("\n");
    let changed = normalizedContent !== schemaContent;

    for (const { name, providers } of newModels) {
      if (findProviderMappingEntryRange(lines, name)) {
        continue;
      }

      const newEntry = `  ${JSON.stringify(name)}: ${formatProviderMappingProviders(providers)},`;
      let insertionIndex = -1;

      if (completeModelOrder) {
        const modelPosition = completeModelOrder.indexOf(name);
        if (modelPosition !== -1) {
          for (let i = modelPosition - 1; i >= 0; i--) {
            const range = findProviderMappingEntryRange(
              lines,
              completeModelOrder[i],
            );
            if (range) {
              insertionIndex = range.end + 1;
              break;
            }
          }

          if (insertionIndex === -1) {
            for (
              let i = modelPosition + 1;
              i < completeModelOrder.length;
              i++
            ) {
              const range = findProviderMappingEntryRange(
                lines,
                completeModelOrder[i],
              );
              if (range) {
                insertionIndex = range.start;
                break;
              }
            }
          }
        }
      }

      if (insertionIndex === -1) {
        const closingBraceIndex = lines.lastIndexOf("};");
        insertionIndex =
          closingBraceIndex === -1 ? lines.length : closingBraceIndex;
      }

      lines.splice(insertionIndex, 0, newEntry);
      changed = true;
    }

    if (changed) {
      await fs.promises.writeFile(
        SCHEMA_INDEX_PATH,
        normalizeProviderMappingContent(lines.join("\n")),
      );
      console.log(
        `✅ Updated provider mappings for ${newModels.length} models in schema/index.ts`,
      );
    }
  } catch (error) {
    console.error("Failed to update provider mappings:", error);
  }
}

// Widen EXISTING AvailableEndpointTypes entries to include `provider` (pure).
// `updateProviderMapping`/`getMissingProviderMappings` only ADD entries for
// models with no mapping at all; they never widen an existing entry. This is
// needed when a model already mapped to one provider (e.g. Together) is also
// served by Baseten under the same id. Returns the rewritten content and the
// names actually widened (entries missing or already containing the provider
// are left untouched).
export function addProviderToProviderMappingContent(
  schemaContent: string,
  modelNames: string[],
  provider: string,
): { content: string; updated: string[] } {
  const updated: string[] = [];
  if (modelNames.length === 0) {
    return { content: schemaContent, updated };
  }

  const lines = normalizeProviderMappingContent(schemaContent).split("\n");

  // Resolve ranges first, then apply bottom-up so earlier indices don't shift.
  const targets = modelNames
    .map((name) => ({
      name,
      range: findProviderMappingEntryRange(lines, name),
    }))
    .filter(
      (t): t is { name: string; range: ProviderMappingEntryRange } =>
        t.range !== undefined,
    )
    .sort((a, b) => b.range.start - a.range.start);

  for (const { name, range } of targets) {
    const entryText = lines.slice(range.start, range.end + 1).join("\n");
    const arrayMatch = entryText.match(/\[([^\]]*)\]/);
    if (!arrayMatch) {
      continue;
    }
    const providers = Array.from(arrayMatch[1].matchAll(/"([^"]+)"/g)).map(
      (m) => m[1],
    );
    if (providers.includes(provider)) {
      continue;
    }
    providers.push(provider);
    const commentMatch = entryText.match(/\],\s*(\/\/.*)$/);
    const comment = commentMatch ? ` ${commentMatch[1]}` : "";
    const newLine = `  ${JSON.stringify(name)}: ${formatProviderMappingProviders(providers)},${comment}`;
    lines.splice(range.start, range.end - range.start + 1, newLine);
    updated.push(name);
  }

  return {
    content: normalizeProviderMappingContent(lines.join("\n")),
    updated,
  };
}

async function addProviderToExistingMappings(
  modelNames: string[],
  provider: string,
): Promise<string[]> {
  if (modelNames.length === 0) {
    return [];
  }
  const schemaContent = await fs.promises.readFile(SCHEMA_INDEX_PATH, "utf-8");
  const { content, updated } = addProviderToProviderMappingContent(
    schemaContent,
    modelNames,
    provider,
  );
  if (updated.length > 0) {
    await fs.promises.writeFile(SCHEMA_INDEX_PATH, content);
  }
  return updated;
}

export function convertRemoteToLocalModel(
  remoteModelName: string,
  remoteModel: LiteLLMModelDetail,
): ModelSpec {
  const baseModel: Partial<ModelSpec> = {
    format: "openai", // Default format for most models
    flavor: "chat", // Default flavor for most models
  };

  // Helper to round cost values to avoid floating point precision issues
  const roundCost = (costPerToken: number): number => {
    return parseFloat((costPerToken * 1_000_000).toFixed(8));
  };

  // Add multimodal support if indicated
  if (remoteModel.supports_vision) {
    baseModel.multimodal = true;
  }

  // Add reasoning support if indicated
  if (remoteModel.supports_reasoning) {
    baseModel.reasoning = true;
  }

  // Convert cost information
  const inputCostPerToken = getNonZeroNumber(remoteModel.input_cost_per_token);
  if (inputCostPerToken !== undefined) {
    baseModel.input_cost_per_mil_tokens = roundCost(inputCostPerToken);
  }
  const outputCostPerToken = getNonZeroNumber(
    remoteModel.output_cost_per_token,
  );
  if (outputCostPerToken !== undefined) {
    baseModel.output_cost_per_mil_tokens = roundCost(outputCostPerToken);
  }
  const cacheReadInputTokenCost = getNonZeroNumber(
    remoteModel.cache_read_input_token_cost,
  );
  if (cacheReadInputTokenCost !== undefined) {
    baseModel.input_cache_read_cost_per_mil_tokens = roundCost(
      cacheReadInputTokenCost,
    );
  }
  const cacheCreationInputTokenCost = getNonZeroNumber(
    remoteModel.cache_creation_input_token_cost,
  );
  if (cacheCreationInputTokenCost !== undefined) {
    baseModel.input_cache_write_cost_per_mil_tokens = roundCost(
      cacheCreationInputTokenCost,
    );
  }
  // Note: output_reasoning_cost_per_mil_tokens may not be in ModelSpec yet,
  // so we'll skip this for now to avoid type errors
  // if (remoteModel.output_cost_per_reasoning_token) {
  //   baseModel.output_reasoning_cost_per_mil_tokens = roundCost(remoteModel.output_cost_per_reasoning_token);
  // }

  // Add token limits
  const maxInputTokens = getNonZeroNumber(remoteModel.max_input_tokens);
  if (maxInputTokens !== undefined) {
    baseModel.max_input_tokens = maxInputTokens;
  }
  const maxOutputTokens = getNonZeroNumber(remoteModel.max_output_tokens);
  if (maxOutputTokens !== undefined) {
    baseModel.max_output_tokens = maxOutputTokens;
  }
  if (remoteModel.deprecation_date) {
    baseModel.deprecation_date = remoteModel.deprecation_date;
  }

  const providers = getProviderMappingForModel(remoteModelName, remoteModel);
  if (providers.length > 0) {
    baseModel.available_providers =
      providers as ModelSpec["available_providers"];
  }

  return baseModel as ModelSpec;
}

function parseBasetenPrice(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function convertBasetenToLocalModel(model: BasetenModel): ModelSpec {
  const roundCost = (costPerToken: number): number =>
    parseFloat((costPerToken * 1_000_000).toFixed(8));

  const baseModel: Partial<ModelSpec> = { format: "openai", flavor: "chat" };

  if (model.input_modalities?.includes("image")) {
    baseModel.multimodal = true;
  }
  if (model.supported_features?.includes("reasoning")) {
    baseModel.reasoning = true;
  }

  const inputCost = getNonZeroNumber(parseBasetenPrice(model.pricing?.prompt));
  if (inputCost !== undefined) {
    baseModel.input_cost_per_mil_tokens = roundCost(inputCost);
  }
  const outputCost = getNonZeroNumber(
    parseBasetenPrice(model.pricing?.completion),
  );
  if (outputCost !== undefined) {
    baseModel.output_cost_per_mil_tokens = roundCost(outputCost);
  }
  const cacheReadCost = getNonZeroNumber(
    parseBasetenPrice(model.pricing?.input_cache_read),
  );
  if (cacheReadCost !== undefined) {
    baseModel.input_cache_read_cost_per_mil_tokens = roundCost(cacheReadCost);
  }

  if (model.name) {
    baseModel.displayName = model.name;
  }

  const maxInputTokens = getNonZeroNumber(model.context_length);
  if (maxInputTokens !== undefined) {
    baseModel.max_input_tokens = maxInputTokens;
  }

  baseModel.available_providers = ["baseten"];
  return baseModel as ModelSpec;
}

// Convert a Cohere /v1/models entry to a catalog spec. Cohere exposes its chat
// models through an OpenAI-compatible API, so format is "openai". Cohere's models
// endpoint carries no pricing, so pricing is overlaid from the matching LiteLLM
// entry when one exists (`litellm`); models LiteLLM does not yet carry are left
// price-less rather than fabricated.
export function convertCohereToLocalModel(
  model: CohereModel,
  litellm?: LiteLLMModelDetail,
): ModelSpec {
  const baseModel: Partial<ModelSpec> = {
    format: "openai",
    flavor: "chat",
  };
  const maxInputTokens = getNonZeroNumber(model.context_length);
  if (maxInputTokens !== undefined) {
    baseModel.max_input_tokens = maxInputTokens;
  }
  baseModel.available_providers = ["cohere"];

  // Cohere's models endpoint carries no pricing, so overlay it from LiteLLM when
  // LiteLLM knows this id (else the entry is left price-less, never fabricated).
  const spec = baseModel as ModelSpec;
  const priced = applyCohereLiteLLMPricing(model.name, spec, litellm);
  return priced ?? spec;
}

// Overlay LiteLLM pricing (per-token -> per-mil) onto a Cohere model. Fills /
// refreshes input, output and cache-read cost when LiteLLM carries the id, so a
// model added before LiteLLM knew its price gets cost metadata on a later run
// (never touching a manually preserved field). Returns a new ModelSpec if
// anything changed, else null.
export function applyCohereLiteLLMPricing(
  name: string,
  model: ModelSpec,
  litellm?: LiteLLMModelDetail,
): ModelSpec | null {
  if (!litellm) {
    return null;
  }
  const roundCost = (costPerToken: number): number =>
    parseFloat((costPerToken * 1_000_000).toFixed(8));
  const updated: ModelSpec = { ...model };
  let changed = false;

  const apply = (
    field:
      | "input_cost_per_mil_tokens"
      | "output_cost_per_mil_tokens"
      | "input_cache_read_cost_per_mil_tokens",
    perToken: number | undefined,
  ): void => {
    if (isFieldManuallyPreserved(name, field)) {
      return;
    }
    const value = getNonZeroNumber(perToken);
    if (value === undefined) {
      return;
    }
    const rounded = roundCost(value);
    if (updated[field] === rounded) {
      return;
    }
    updated[field] = rounded;
    changed = true;
  };

  apply("input_cost_per_mil_tokens", litellm.input_cost_per_token);
  apply("output_cost_per_mil_tokens", litellm.output_cost_per_token);
  apply(
    "input_cache_read_cost_per_mil_tokens",
    litellm.cache_read_input_token_cost,
  );

  return changed ? updated : null;
}

// A Cohere model is a chat model we should carry when it advertises the chat
// endpoint and is neither fine-tuned (account-specific) nor deprecated.
export function isSupportedCohereChatModel(model: CohereModel): boolean {
  return (
    (model.endpoints?.includes("chat") ?? false) &&
    !model.finetuned &&
    !model.is_deprecated
  );
}

// Apply Baseten's authoritative /v1/models pricing to a model Baseten serves.
// The catalog holds one price per id, and Baseten + another provider (e.g.
// Together) can price the same model differently, so we deliberately PREFER
// Baseten's pricing for any id Baseten serves — including ids shared with
// Together. Overwrites input/output/cached prices from Baseten, but never
// touches a field in SYNC_PRESERVED_FIELDS (those are hand-maintained
// overrides). Returns a new ModelSpec if anything changed, else null.
export function applyBasetenPricing(
  name: string,
  model: ModelSpec,
  basetenModel: BasetenModel,
): ModelSpec | null {
  const roundCost = (costPerToken: number): number =>
    parseFloat((costPerToken * 1_000_000).toFixed(8));
  const updated: ModelSpec = { ...model };
  let changed = false;

  const apply = (
    field:
      | "input_cost_per_mil_tokens"
      | "output_cost_per_mil_tokens"
      | "input_cache_read_cost_per_mil_tokens",
    raw: string | undefined,
  ): void => {
    if (isFieldManuallyPreserved(name, field)) {
      return;
    }
    const value = getNonZeroNumber(parseBasetenPrice(raw));
    if (value === undefined) {
      return;
    }
    const rounded = roundCost(value);
    if (updated[field] === rounded) {
      return;
    }
    updated[field] = rounded;
    changed = true;
  };

  apply("input_cost_per_mil_tokens", basetenModel.pricing?.prompt);
  apply("output_cost_per_mil_tokens", basetenModel.pricing?.completion);
  apply(
    "input_cache_read_cost_per_mil_tokens",
    basetenModel.pricing?.input_cache_read,
  );

  return changed ? updated : null;
}

// OpenRouter keys models by a `<vendor>/<model>` slug (e.g. `x-ai/grok-4.5`,
// `openai/gpt-5`) and also exposes `:free`/`:nitro`/etc. routing variants. Strip
// the vendor prefix (and reject variant slugs) to get the candidate canonical id
// we might already carry. Returns null when the slug is a variant, has no vendor
// prefix, or strips to an empty id.
export function openRouterCanonicalId(slug: string): string | null {
  if (slug.includes(":")) {
    return null;
  }
  const slash = slug.indexOf("/");
  if (slash < 0) {
    return null;
  }
  const canonical = slug.slice(slash + 1);
  if (!canonical || canonical === slug) {
    return null;
  }
  return canonical;
}

// An OpenRouter slug is excluded when EITHER the full slug or its stripped
// canonical id is in SYNC_EXCLUDED_MODELS. OpenRouter frequently lists a
// deprecated model (e.g. `gpt-4-turbo-preview`, in deprecated_model_ids.json)
// under a vendor slug (`openai/gpt-4-turbo-preview`); checking only the slug
// would re-expose the deprecated model as an active openrouter-only entry.
export function isOpenRouterSlugExcluded(slug: string): boolean {
  if (isModelExcludedFromSync(slug)) {
    return true;
  }
  const canonical = openRouterCanonicalId(slug);
  return canonical !== null && isModelExcludedFromSync(canonical);
}

export function convertOpenRouterToLocalModel(
  model: OpenRouterModel,
): ModelSpec {
  const roundCost = (costPerToken: number): number =>
    parseFloat((costPerToken * 1_000_000).toFixed(8));

  const baseModel: Partial<ModelSpec> = { format: "openai", flavor: "chat" };

  if (model.architecture?.input_modalities?.includes("image")) {
    baseModel.multimodal = true;
  }
  const params = model.supported_parameters ?? [];
  if (params.includes("reasoning") || params.includes("reasoning_effort")) {
    baseModel.reasoning = true;
  }

  const inputCost = getNonZeroNumber(parseBasetenPrice(model.pricing?.prompt));
  if (inputCost !== undefined) {
    baseModel.input_cost_per_mil_tokens = roundCost(inputCost);
  }
  const outputCost = getNonZeroNumber(
    parseBasetenPrice(model.pricing?.completion),
  );
  if (outputCost !== undefined) {
    baseModel.output_cost_per_mil_tokens = roundCost(outputCost);
  }
  const cacheReadCost = getNonZeroNumber(
    parseBasetenPrice(model.pricing?.input_cache_read),
  );
  if (cacheReadCost !== undefined) {
    baseModel.input_cache_read_cost_per_mil_tokens = roundCost(cacheReadCost);
  }

  if (model.name) {
    baseModel.displayName = model.name;
  }

  const maxInputTokens = getNonZeroNumber(
    model.context_length ?? model.top_provider?.context_length ?? undefined,
  );
  if (maxInputTokens !== undefined) {
    baseModel.max_input_tokens = maxInputTokens;
  }
  const maxOutputTokens = getNonZeroNumber(
    model.top_provider?.max_completion_tokens ?? undefined,
  );
  if (maxOutputTokens !== undefined) {
    baseModel.max_output_tokens = maxOutputTokens;
  }

  baseModel.available_providers = ["openrouter"];
  return baseModel as ModelSpec;
}

// Refresh an openrouter-managed alternate's pricing from OpenRouter's directory.
// Mirrors applyBasetenPricing: overwrites input/output/cached prices, never
// touches a field in SYNC_PRESERVED_FIELDS. Returns a new ModelSpec if anything
// changed, else null.
export function applyOpenRouterPricing(
  name: string,
  model: ModelSpec,
  openRouterModel: OpenRouterModel,
): ModelSpec | null {
  // Only ever write OpenRouter pricing when openrouter is the model's ONLY
  // provider. For a model any first-class provider also serves, that provider's
  // pricing is authoritative and must not be overwritten with OpenRouter's
  // (which carries an aggregator markup).
  const providers = model.available_providers ?? [];
  if (providers.length !== 1 || providers[0] !== "openrouter") {
    return null;
  }
  const roundCost = (costPerToken: number): number =>
    parseFloat((costPerToken * 1_000_000).toFixed(8));
  const updated: ModelSpec = { ...model };
  let changed = false;

  const apply = (
    field:
      | "input_cost_per_mil_tokens"
      | "output_cost_per_mil_tokens"
      | "input_cache_read_cost_per_mil_tokens",
    raw: string | undefined,
  ): void => {
    if (isFieldManuallyPreserved(name, field)) {
      return;
    }
    const value = getNonZeroNumber(parseBasetenPrice(raw));
    if (value === undefined) {
      return;
    }
    const rounded = roundCost(value);
    if (updated[field] === rounded) {
      return;
    }
    updated[field] = rounded;
    changed = true;
  };

  apply("input_cost_per_mil_tokens", openRouterModel.pricing?.prompt);
  apply("output_cost_per_mil_tokens", openRouterModel.pricing?.completion);
  apply(
    "input_cache_read_cost_per_mil_tokens",
    openRouterModel.pricing?.input_cache_read,
  );

  return changed ? updated : null;
}

async function findMissingCommand(argv: any) {
  try {
    console.log("Fetching remote models from:", REMOTE_MODEL_URL);
    const remoteModels = await fetchRemoteModels(REMOTE_MODEL_URL);
    console.log(`Fetched ${Object.keys(remoteModels).length} remote models.`);

    console.log("Reading local models from:", LOCAL_MODEL_LIST_PATH);
    const localModels = normalizeLocalModels(
      await readLocalModels(LOCAL_MODEL_LIST_PATH),
    ).models;
    console.log(`Read ${Object.keys(localModels).length} local models.`);

    const localModelNames = new Set(Object.keys(localModels));
    const missingInLocal: string[] = [];
    const consideredRemoteModels: LiteLLMModelList = {};
    const filteredRemoteModels: LiteLLMModelList = {};

    for (const [remoteModelName, remoteModel] of Object.entries(remoteModels)) {
      if (
        matchesProviderFilter(remoteModelName, remoteModel, argv.provider) &&
        isSupportedRemoteModel(remoteModel)
      ) {
        filteredRemoteModels[remoteModelName] = remoteModel;
      }
    }

    const resolvedRemote = resolveRemoteModels(filteredRemoteModels);

    for (const [
      translatedName,
      { remoteModelName, remoteModel },
    ] of resolvedRemote) {
      consideredRemoteModels[remoteModelName] = remoteModel;
      if (argv.provider) {
        console.log(
          `[DEBUG] Remote: ${remoteModelName} (Provider: ${
            remoteModel.litellm_provider || "N/A"
          }) -> Translated: ${translatedName}`,
        );
      }
      if (!localModelNames.has(translatedName)) {
        missingInLocal.push(remoteModelName);
      }
    }

    if (argv.summarize) {
      console.log("\n--- Model Summary by Provider ---");
      if (argv.provider) {
        console.log(`(Filtered for provider: ${argv.provider})`);
      }
      const providerSummary: {
        [provider: string]: { totalRemote: number; missingInLocal: number };
      } = {};

      for (const modelName in filteredRemoteModels) {
        const modelDetail = filteredRemoteModels[modelName];
        const provider = modelDetail.litellm_provider || "Unknown Provider";
        if (!providerSummary[provider]) {
          providerSummary[provider] = { totalRemote: 0, missingInLocal: 0 };
        }
        providerSummary[provider].totalRemote++;
      }

      for (const modelName of missingInLocal) {
        const modelDetail = consideredRemoteModels[modelName];
        if (modelDetail) {
          const provider = modelDetail.litellm_provider || "Unknown Provider";
          if (!providerSummary[provider]) {
            providerSummary[provider] = { totalRemote: 0, missingInLocal: 0 };
          }
          providerSummary[provider].missingInLocal++;
        } else {
          const unknownProvider = "Unknown Provider (Details Missing)";
          if (!providerSummary[unknownProvider]) {
            providerSummary[unknownProvider] = {
              totalRemote: 0,
              missingInLocal: 0,
            };
          }
          providerSummary[unknownProvider].missingInLocal++;
        }
      }

      const partiallyMissingProviders: string[] = [];
      const completelyMissingProviders: string[] = [];
      const allPresentProviders: string[] = [];
      const sortedProviderNames = Object.keys(providerSummary).sort();

      for (const provider of sortedProviderNames) {
        const summary = providerSummary[provider];
        if (summary.missingInLocal > 0) {
          if (summary.missingInLocal < summary.totalRemote) {
            partiallyMissingProviders.push(provider);
          } else {
            completelyMissingProviders.push(provider);
          }
        } else {
          allPresentProviders.push(provider);
        }
      }

      if (partiallyMissingProviders.length > 0) {
        console.log("\n--- Providers with Some Models Missing ---");
        for (const provider of partiallyMissingProviders) {
          const summary = providerSummary[provider];
          console.log(
            `${provider}: ${summary.missingInLocal} missing out of ${summary.totalRemote} total remote models.`,
          );
        }
      }

      if (completelyMissingProviders.length > 0) {
        console.log("\n--- Providers with All Models Missing ---");
        for (const provider of completelyMissingProviders) {
          const summary = providerSummary[provider];
          console.log(
            `${provider}: All ${summary.missingInLocal} of ${summary.totalRemote} remote models are missing.`,
          );
        }
      }

      if (allPresentProviders.length > 0) {
        console.log("\n--- Providers with All Models Present ---");
        for (const provider of allPresentProviders) {
          const summary = providerSummary[provider];
          console.log(
            `${provider}: All ${summary.totalRemote} remote models present locally.`,
          );
        }
      }

      if (missingInLocal.length === 0) {
        console.log(
          "\nAll models from the remote list are present in the local model_list.json.",
        );
      } else if (
        partiallyMissingProviders.length === 0 &&
        completelyMissingProviders.length === 0
      ) {
        // This implies missingInLocal > 0 but they didn't fit categories,
        // possibly due to provider filtering or no provider info.
        console.log(
          "\nSome models are missing. If a provider filter was used, they might be outside that scope or have no provider information.",
        );
        if (!argv.provider)
          console.log(
            "Run without --summarize to see individual missing models.",
          );
      }
    } else {
      if (missingInLocal.length > 0) {
        if (argv.provider) {
          console.log(
            `\nModels for provider '${argv.provider}' present in remote but missing in local:`,
          );
        } else {
          console.log(
            "\nModels present in remote but missing in local model_list.json:",
          );
        }
        missingInLocal.forEach((modelName) => {
          const detail = consideredRemoteModels[modelName];
          const translated = translateToBraintrust(
            modelName,
            detail?.litellm_provider,
          );
          console.log(
            `${modelName} (Provider: ${
              detail?.litellm_provider || "N/A"
            }, Translated: ${translated})`,
          );
        });
      } else {
        console.log(
          "\nAll models from the remote list (matching filter if any) are present in the local model_list.json.",
        );
      }
    }
  } catch (error) {
    console.error("Error during find-missing command:", error);
    process.exit(1);
  }
}

async function updateModelsCommand(argv: any) {
  try {
    console.log("Fetching remote models for model update...");
    const remoteModels = await fetchRemoteModels(REMOTE_MODEL_URL);
    console.log(`Fetched ${Object.keys(remoteModels).length} remote models.`);

    console.log("Reading local models for model update...");
    const normalizedLocalData = normalizeLocalModels(
      await readLocalModels(LOCAL_MODEL_LIST_PATH),
    );
    const localModels = normalizedLocalData.models;
    console.log(`Read ${Object.keys(localModels).length} local models.`);

    const updatedLocalModels = JSON.parse(
      JSON.stringify(localModels),
    ) as LocalModelList;
    let madeChanges = false;

    console.log("\n--- Model Update Report ---");
    if (argv.provider) {
      console.log(`(Filtered for provider: ${argv.provider})`);
    }
    let discrepanciesFound = 0;

    const modelsToCompare: Array<{
      localModelName: string;
      localModelDetail: LocalModelDetail;
      remoteModelName: string;
      remoteModelDetail: LiteLLMModelDetail;
      mergedProviders: string[];
    }> = [];

    const resolvedRemote = resolveRemoteModels(remoteModels, argv.provider);

    if (argv.provider) {
      for (const [
        translatedRemoteModelName,
        { remoteModelName, remoteModel: remoteModelDetail, mergedProviders },
      ] of resolvedRemote) {
        if (localModels[translatedRemoteModelName]) {
          modelsToCompare.push({
            localModelName: translatedRemoteModelName,
            localModelDetail: localModels[translatedRemoteModelName],
            remoteModelName,
            remoteModelDetail,
            mergedProviders,
          });
        }
      }
    } else {
      for (const localModelName in localModels) {
        const localModelDetail = localModels[localModelName];
        const resolvedEntry = resolvedRemote.get(localModelName);
        if (resolvedEntry) {
          modelsToCompare.push({
            localModelName,
            localModelDetail,
            remoteModelName: resolvedEntry.remoteModelName,
            remoteModelDetail: resolvedEntry.remoteModel,
            mergedProviders: resolvedEntry.mergedProviders,
          });
        }
      }
    }

    for (const item of modelsToCompare) {
      const {
        localModelName,
        localModelDetail,
        remoteModelName: originalRemoteModelName,
        remoteModelDetail,
        mergedProviders,
      } = item;
      const modelInUpdatedList = updatedLocalModels[localModelName];

      const localInputCost = localModelDetail.input_cost_per_mil_tokens;
      const localOutputCost = localModelDetail.output_cost_per_mil_tokens;
      const localCacheReadCost =
        localModelDetail.input_cache_read_cost_per_mil_tokens;
      const localCacheWriteCost =
        localModelDetail.input_cache_write_cost_per_mil_tokens;

      const remoteInputCostPerToken = remoteModelDetail.input_cost_per_token;
      const remoteOutputCostPerToken = remoteModelDetail.output_cost_per_token;
      const remoteCacheReadCostPerToken =
        remoteModelDetail.cache_read_input_token_cost;
      const remoteCacheWriteCostPerToken =
        remoteModelDetail.cache_creation_input_token_cost;

      let modelReportedThisIteration = false;

      const reportModelIfNeeded = () => {
        if (!modelReportedThisIteration) {
          console.log(
            argv.write
              ? `\n[WRITE] Updating model for: ${localModelName} (Remote: ${originalRemoteModelName})`
              : `\nModel: ${localModelName} (Remote: ${originalRemoteModelName})`,
          );
          modelReportedThisIteration = true;
        }
      };

      const checkAndUpdateCost = (
        costType: string,
        localCost: number | undefined | null,
        remoteCostPerToken: number | undefined,
        localFieldName: keyof ModelSpec,
      ) => {
        if (isFieldManuallyPreserved(localModelName, localFieldName)) {
          console.log(
            `  [PRESERVE] ${localModelName}.${String(
              localFieldName,
            )} kept at local value (${
              localCost ?? "unset"
            }); LiteLLM sync skipped`,
          );
          return;
        }
        const normalizedRemoteCostPerToken =
          getNonZeroNumber(remoteCostPerToken);
        if (normalizedRemoteCostPerToken !== undefined) {
          const remoteCostPerMil = normalizedRemoteCostPerToken * 1_000_000;
          const roundedRemoteCostPerMil = parseFloat(
            remoteCostPerMil.toFixed(8),
          );

          if (
            localCost === null ||
            typeof localCost !== "number" ||
            Math.abs(localCost - remoteCostPerMil) > 1e-9
          ) {
            if (!argv.write) {
              reportModelIfNeeded();
              console.log(
                `  ${costType} Cost Mismatch/Missing: Local: ${
                  localCost ?? "Not available"
                }, Remote (calc): ${remoteCostPerMil} (would write: ${roundedRemoteCostPerMil}) (from ${normalizedRemoteCostPerToken}/token)`,
              );
            }
            discrepanciesFound++;
            if (argv.write) {
              Reflect.set(
                modelInUpdatedList,
                localFieldName,
                roundedRemoteCostPerMil,
              );
              madeChanges = true;
              reportModelIfNeeded();
              console.log(
                `  [WRITE] Updated ${costType} Cost to: ${roundedRemoteCostPerMil}`,
              );
            }
          }
        } else if (typeof localCost === "number") {
          if (!argv.write) {
            reportModelIfNeeded();
            console.log(
              `  ${costType} Cost: Local: ${localCost}, Remote: Not available`,
            );
          }
        }
      };

      const checkAndUpdateTokenLimit = (
        limitType: string,
        localLimit: number | undefined | null,
        remoteLimit: number | undefined,
        localFieldName: keyof ModelSpec,
      ) => {
        if (isFieldManuallyPreserved(localModelName, localFieldName)) {
          console.log(
            `  [PRESERVE] ${localModelName}.${String(
              localFieldName,
            )} kept at local value (${
              localLimit ?? "unset"
            }); LiteLLM sync skipped`,
          );
          return;
        }
        const normalizedRemoteLimit = getNonZeroNumber(remoteLimit);
        if (normalizedRemoteLimit !== undefined) {
          if (
            localLimit === null ||
            typeof localLimit !== "number" ||
            localLimit !== normalizedRemoteLimit
          ) {
            if (!argv.write) {
              reportModelIfNeeded();
              console.log(
                `  ${limitType} Token Limit Mismatch/Missing: Local: ${
                  localLimit ?? "Not available"
                }, Remote: ${normalizedRemoteLimit}`,
              );
            }
            discrepanciesFound++;
            if (argv.write) {
              Reflect.set(
                modelInUpdatedList,
                localFieldName,
                normalizedRemoteLimit,
              );
              madeChanges = true;
              reportModelIfNeeded();
              console.log(
                `  [WRITE] Updated ${limitType} Token Limit to: ${normalizedRemoteLimit}`,
              );
            }
          }
        } else if (typeof localLimit === "number") {
          if (!argv.write) {
            reportModelIfNeeded();
            console.log(
              `  ${limitType} Token Limit: Local: ${localLimit}, Remote: Not available`,
            );
          }
        }
      };

      const checkAndUpdateDeprecationDate = (
        localDeprecationDate: string | undefined | null,
        remoteDeprecationDate: string | undefined,
      ) => {
        if (typeof remoteDeprecationDate === "string") {
          if (
            localDeprecationDate === null ||
            typeof localDeprecationDate !== "string" ||
            localDeprecationDate !== remoteDeprecationDate
          ) {
            if (!argv.write) {
              reportModelIfNeeded();
              console.log(
                `  Deprecation Date Mismatch/Missing: Local: ${
                  localDeprecationDate ?? "Not available"
                }, Remote: ${remoteDeprecationDate}`,
              );
            }
            discrepanciesFound++;
            if (argv.write) {
              Reflect.set(
                modelInUpdatedList,
                "deprecation_date",
                remoteDeprecationDate,
              );
              madeChanges = true;
              reportModelIfNeeded();
              console.log(
                `  [WRITE] Updated Deprecation Date to: ${remoteDeprecationDate}`,
              );
            }
          }
        } else if (typeof localDeprecationDate === "string") {
          if (!argv.write) {
            reportModelIfNeeded();
            console.log(
              `  Deprecation Date: Local: ${localDeprecationDate}, Remote: Not available`,
            );
          }
        }
      };

      checkAndUpdateCost(
        "Input",
        localInputCost,
        remoteInputCostPerToken,
        "input_cost_per_mil_tokens",
      );
      checkAndUpdateCost(
        "Output",
        localOutputCost,
        remoteOutputCostPerToken,
        "output_cost_per_mil_tokens",
      );
      checkAndUpdateCost(
        "Cache Read",
        localCacheReadCost,
        remoteCacheReadCostPerToken,
        "input_cache_read_cost_per_mil_tokens",
      );
      checkAndUpdateCost(
        "Cache Write",
        localCacheWriteCost,
        remoteCacheWriteCostPerToken,
        "input_cache_write_cost_per_mil_tokens",
      );

      // Check and update token limits
      const localMaxInputTokens = localModelDetail.max_input_tokens;
      const localMaxOutputTokens = localModelDetail.max_output_tokens;
      const remoteMaxInputTokens = remoteModelDetail.max_input_tokens;
      const remoteMaxOutputTokens = remoteModelDetail.max_output_tokens;

      // Check and update deprecation date
      const localDeprecationDate = localModelDetail.deprecation_date;
      const remoteDeprecationDate = remoteModelDetail.deprecation_date;

      checkAndUpdateTokenLimit(
        "Max Input",
        localMaxInputTokens,
        remoteMaxInputTokens,
        "max_input_tokens",
      );
      checkAndUpdateTokenLimit(
        "Max Output",
        localMaxOutputTokens,
        remoteMaxOutputTokens,
        "max_output_tokens",
      );

      // Check and update deprecation date
      checkAndUpdateDeprecationDate(
        localDeprecationDate,
        remoteDeprecationDate,
      );

      // Set available_providers from remote (using merged providers across all colliding remote entries)
      let remoteProviders = getUpdatedAvailableProviders(
        Array.isArray(modelInUpdatedList.available_providers)
          ? modelInUpdatedList.available_providers
          : undefined,
        mergedProviders,
        Boolean(argv.provider),
      );
      // LiteLLM can still list `baseten` for ids Baseten has since deprecated
      // (they return 410 on invocation). The sync-baseten guard only covers its
      // own path, so strip the dead provider here too — otherwise the LiteLLM
      // refresh keeps re-adding it onto these ids every run.
      if (isBasetenDeprecated(localModelName)) {
        remoteProviders = remoteProviders.filter(
          (provider) => provider !== "baseten",
        );
      }
      if (remoteProviders.length > 0) {
        const currentProviders = (modelInUpdatedList as any)
          .available_providers;
        const same =
          Array.isArray(currentProviders) &&
          currentProviders.length === remoteProviders.length &&
          currentProviders.every(
            (p: string, i: number) => p === remoteProviders[i],
          );
        if (!same) {
          (modelInUpdatedList as any).available_providers = remoteProviders;
          discrepanciesFound++;
          madeChanges = true;
          if (!modelReportedThisIteration) {
            console.log(
              `\n[WRITE] Updating model for: ${localModelName} (Remote: ${originalRemoteModelName})`,
            );
            modelReportedThisIteration = true;
          }
          console.log(
            `  [WRITE] Updated available_providers to: ${JSON.stringify(remoteProviders)}`,
          );
        }
      }
    }

    // Only sync Vertex regions for models that were actually in scope for this
    // run (i.e. the provider-filtered set), not the entire local model list.
    // This prevents `update-models --provider openai` from touching unrelated
    // Vertex Gemini entries.
    const modelsInScope = modelsToCompare.map((item) => item.localModelName);
    const shouldSyncVertexRegions = modelsInScope.some((name) =>
      updatedLocalModels[name]?.available_providers?.includes("vertex"),
    );

    if (shouldSyncVertexRegions) {
      console.log(
        `\nFetching Vertex supported regions from: ${GOOGLE_VERTEX_LOCATIONS_URL}`,
      );
      const supportedRegionsByModel = await fetchVertexSupportedRegions();
      const updatedVertexModels = syncVertexSupportedRegions(
        updatedLocalModels,
        supportedRegionsByModel,
      );
      if (updatedVertexModels.size > 0) {
        discrepanciesFound += updatedVertexModels.size;
        madeChanges = true;
        for (const [modelName, supportedRegions] of updatedVertexModels) {
          const regions = supportedRegions.length
            ? supportedRegions.join(", ")
            : "(cleared)";
          console.log(
            `  ${argv.write ? "[WRITE]" : "[DRY RUN]"} Updating supported_regions for ${modelName}: ${regions}`,
          );
        }
      }
    }

    if (argv.write) {
      if (madeChanges) {
        await writeLocalModels(updatedLocalModels);
        console.log(
          `\nLocal model_list.json has been updated with new model information (pricing, token limits) and keys ordered according to schema.`,
        );
      } else {
        console.log(
          "\nNo model updates were necessary for local model_list.json.",
        );
      }

      await syncProviderMappingsForLocalModels(
        updatedLocalModels,
        modelsInScope,
      );
    } else {
      if (discrepanciesFound === 0) {
        console.log(
          "\nNo model discrepancies found for models present in both lists (or matching filter).",
        );
      } else {
        console.log(
          `\nFound ${discrepanciesFound} model discrepancies/missing local data that could be updated from remote.`,
        );
      }
    }
  } catch (error) {
    console.error("Error during update-models command:", error);
    process.exit(1);
  }
}

async function addModelsCommand(argv: any) {
  try {
    console.log("Fetching remote models from:", REMOTE_MODEL_URL);
    const remoteModels = await fetchRemoteModels(REMOTE_MODEL_URL);
    console.log(`Fetched ${Object.keys(remoteModels).length} remote models.`);

    console.log("Reading local models from:", LOCAL_MODEL_LIST_PATH);
    const normalizedLocalData = normalizeLocalModels(
      await readLocalModels(LOCAL_MODEL_LIST_PATH),
    );
    const localModels = normalizedLocalData.models;
    console.log(`Read ${Object.keys(localModels).length} local models.`);

    const localModelNames = new Set(Object.keys(localModels));
    const missingInLocal: Array<{
      remoteModelName: string;
      translatedName: string;
      remoteModel: LiteLLMModelDetail;
      mergedProviders: string[];
    }> = [];

    // Find missing models, deduplicating by translated name and merging providers
    const resolvedRemote = resolveRemoteModels(remoteModels, argv.provider);
    for (const [
      translatedModelName,
      { remoteModelName, remoteModel: modelDetail, mergedProviders },
    ] of resolvedRemote) {
      if (argv.filter) {
        const lowerFilter = argv.filter.toLowerCase();
        if (
          !translatedModelName.toLowerCase().includes(lowerFilter) &&
          !remoteModelName.toLowerCase().includes(lowerFilter)
        ) {
          continue;
        }
      }

      if (
        isModelExcludedFromSync(translatedModelName) ||
        isModelExcludedFromSync(remoteModelName)
      ) {
        console.log(
          `  [EXCLUDED] Skipping ${translatedModelName} (in SYNC_EXCLUDED_MODELS)`,
        );
        continue;
      }

      const equivalentLocalNames =
        getEquivalentLocalModelNames(translatedModelName);
      if (!equivalentLocalNames.some((name) => localModelNames.has(name))) {
        missingInLocal.push({
          remoteModelName,
          translatedName: translatedModelName,
          remoteModel: modelDetail,
          mergedProviders,
        });
      }
    }

    if (missingInLocal.length === 0) {
      console.log("No missing models found to add.");

      // Check if we need to update provider mappings for existing models
      if (argv.updateProviders) {
        console.log("Checking for missing provider mappings...");
        const schemaContent = await fs.promises.readFile(
          SCHEMA_INDEX_PATH,
          "utf-8",
        );
        const modelsInScope = Array.from(resolvedRemote.keys()).filter((name) =>
          Object.prototype.hasOwnProperty.call(localModels, name),
        );
        const missingProviderMappings = getMissingProviderMappings(
          localModels,
          schemaContent,
          modelsInScope,
        );

        if (missingProviderMappings.length > 0) {
          console.log(
            `Found ${missingProviderMappings.length} models missing provider mappings`,
          );
          await updateProviderMapping(
            missingProviderMappings,
            Object.keys(localModels),
          );
        } else {
          console.log("All models have provider mappings");
        }
      }

      return;
    }

    console.log(`\nFound ${missingInLocal.length} missing models:`);
    missingInLocal.forEach(({ remoteModelName, translatedName }) => {
      console.log(`  ${remoteModelName} -> ${translatedName}`);
    });

    // Convert remote models to local format
    const modelsToAdd = missingInLocal.map(
      ({ remoteModelName, translatedName, remoteModel, mergedProviders }) => {
        const model = convertRemoteToLocalModel(remoteModelName, remoteModel);
        // Override with merged providers (may include providers from colliding remote entries)
        if (mergedProviders.length > 0) {
          model.available_providers =
            mergedProviders as ModelSpec["available_providers"];
        }
        return { name: translatedName, model };
      },
    );

    // Prepare provider mapping data
    const providerMappingData = missingInLocal.map(
      ({ translatedName, remoteModel, mergedProviders }) => ({
        name: translatedName,
        providers: mergedProviders,
        remoteModel: remoteModel,
      }),
    );

    // Get complete deterministic ordering.
    console.log("\nDetermining optimal model ordering...");
    const mergedCatalog = { ...localModels };
    for (const { name, model } of modelsToAdd) {
      mergedCatalog[name] = model;
    }
    const completeModelOrder = orderModelsByProviderAndClass(mergedCatalog);

    // Rebuild the entire model list in the optimal order
    const updatedModels: LocalModelList = {};

    for (const modelName of completeModelOrder) {
      if (localModels[modelName]) {
        // Existing model - keep original
        updatedModels[modelName] = localModels[modelName];
      } else {
        // New model - add from modelsToAdd
        const modelToAdd = modelsToAdd.find((m) => m.name === modelName);
        if (modelToAdd) {
          updatedModels[modelName] = modelToAdd.model;
          console.log(`Added ${modelName}`);
        }
      }
    }

    // Only sync Vertex regions for the newly added models, not all pre-existing
    // models in updatedModels. This prevents `add-models -p openai` from
    // rewriting unrelated pre-existing Vertex Gemini records.
    const shouldSyncVertexRegions = modelsToAdd.some((m) =>
      m.model.available_providers?.includes("vertex"),
    );

    if (shouldSyncVertexRegions) {
      console.log(
        `\nFetching Vertex supported regions from: ${GOOGLE_VERTEX_LOCATIONS_URL}`,
      );
      const supportedRegionsByModel = await fetchVertexSupportedRegions();
      const updatedVertexModels = syncVertexSupportedRegions(
        updatedModels,
        supportedRegionsByModel,
      );
      for (const [modelName, supportedRegions] of updatedVertexModels) {
        const regions = supportedRegions.length
          ? supportedRegions.join(", ")
          : "(cleared)";
        console.log(
          `  ${argv.write ? "[WRITE]" : "[DRY RUN]"} Updating supported_regions for ${modelName}: ${regions}`,
        );
      }
    }

    if (argv.write) {
      await writeLocalModels(updatedModels);
      console.log(
        `\n✅ Successfully added ${missingInLocal.length} models to ${LOCAL_MODEL_LIST_PATH}`,
      );

      // Update provider mappings in schema/index.ts
      console.log("\nUpdating provider mappings...");
      await updateProviderMapping(providerMappingData, completeModelOrder);
    } else {
      console.log(`\n📋 To actually add these models, run with --write flag`);
      console.log(
        `   Example: npx tsx packages/proxy/scripts/sync_models.ts add-models -p ${
          argv.provider || "PROVIDER"
        } --write`,
      );
    }
  } catch (error) {
    console.error("Error during add-models command:", error);
    process.exit(1);
  }
}

// Sync the catalog against Baseten's authoritative /v1/models list. Additive
// and provider-union only: adds models Baseten serves that are missing locally,
// and unions `baseten` into the available_providers (and index.ts mapping) of
// models already present under the same id. It does NOT prune models absent
// from /v1/models — that list is not exhaustive (some served ids are unlisted),
// so removals stay a manual decision. Requires BASETEN_API_KEY.
async function syncBasetenModelsCommand(argv: any) {
  try {
    const apiKey = process.env.BASETEN_API_KEY;
    if (!apiKey) {
      throw new Error(
        "BASETEN_API_KEY environment variable is required to sync Baseten models.",
      );
    }

    console.log("Fetching Baseten models from:", BASETEN_MODEL_URL);
    const basetenModels = await fetchBasetenModels(apiKey);
    console.log(`Fetched ${basetenModels.length} Baseten models.`);

    console.log("Reading local models from:", LOCAL_MODEL_LIST_PATH);
    const localModels = normalizeLocalModels(
      await readLocalModels(LOCAL_MODEL_LIST_PATH),
    ).models;
    console.log(`Read ${Object.keys(localModels).length} local models.`);

    const modelsToAdd: Array<{ name: string; model: ModelSpec }> = [];
    const providerUnions: string[] = [];
    const pricingUpdates: string[] = [];

    for (const basetenModel of basetenModels) {
      const id = basetenModel.id;
      if (!isSupportedTranslatedModelName(id, "baseten")) {
        console.warn(`  [INVALID] Skipping unsupported model id: ${id}`);
        continue;
      }
      if (isModelExcludedFromSync(id)) {
        console.log(`  [EXCLUDED] Skipping ${id} (in SYNC_EXCLUDED_MODELS)`);
        continue;
      }
      if (isBasetenDeprecated(id)) {
        console.log(
          `  [BASETEN-DEPRECATED] Skipping ${id} (still listed but returns 410; served by other providers)`,
        );
        continue;
      }

      const existingName = getEquivalentLocalModelNames(id).find((name) =>
        Object.prototype.hasOwnProperty.call(localModels, name),
      );

      if (existingName) {
        const existing = localModels[existingName];
        const currentProviders = existing.available_providers ?? [];
        let next = existing;

        if (!currentProviders.includes("baseten")) {
          next = {
            ...next,
            available_providers: [
              ...currentProviders,
              "baseten",
            ] as ModelSpec["available_providers"],
          };
          providerUnions.push(existingName);
          console.log(`  [UNION] add baseten to ${existingName}`);
        }

        // Prefer Baseten's pricing for any id Baseten serves, including ids
        // shared with Together. The catalog stores one price per id and the two
        // providers can price the same model differently (e.g. GLM-5.1,
        // DeepSeek-V4-Pro), so we deliberately use Baseten's. Manually
        // preserved fields (SYNC_PRESERVED_FIELDS) are left untouched.
        const priced = applyBasetenPricing(existingName, next, basetenModel);
        if (priced) {
          next = priced;
          pricingUpdates.push(existingName);
          console.log(`  [PRICING] prefer Baseten pricing on ${existingName}`);
        }

        if (next !== existing) {
          localModels[existingName] = next;
        }
      } else {
        modelsToAdd.push({
          name: id,
          model: convertBasetenToLocalModel(basetenModel),
        });
        console.log(`  [NEW] ${id}`);
      }
    }

    if (
      modelsToAdd.length === 0 &&
      providerUnions.length === 0 &&
      pricingUpdates.length === 0
    ) {
      console.log("Baseten catalog already in sync. No changes needed.");
      return;
    }

    console.log(
      `\n${modelsToAdd.length} new Baseten model(s), ${providerUnions.length} provider union(s), ${pricingUpdates.length} pricing fill(s).`,
    );

    if (!argv.write) {
      console.log("\n📋 Dry run. Re-run with --write to apply.");
      for (const { name } of modelsToAdd) {
        console.log(`  would add: ${name}`);
      }
      for (const name of providerUnions) {
        console.log(`  would add baseten to: ${name}`);
      }
      for (const name of pricingUpdates) {
        console.log(`  would fill missing Baseten prices on: ${name}`);
      }
      return;
    }

    // Rebuild the model list with new models inserted in a stable order.
    const mergedCatalog = { ...localModels };
    for (const { name, model } of modelsToAdd) {
      mergedCatalog[name] = model;
    }
    const completeModelOrder = orderModelsByProviderAndClass(mergedCatalog);
    const updatedModels: LocalModelList = {};
    for (const modelName of completeModelOrder) {
      if (localModels[modelName]) {
        updatedModels[modelName] = localModels[modelName];
      } else {
        const toAdd = modelsToAdd.find((m) => m.name === modelName);
        if (toAdd) {
          updatedModels[modelName] = toAdd.model;
        }
      }
    }

    await writeLocalModels(updatedModels);
    console.log(`\n✅ Wrote ${LOCAL_MODEL_LIST_PATH}`);

    if (modelsToAdd.length > 0) {
      await updateProviderMapping(
        modelsToAdd.map(({ name, model }) => ({
          name,
          providers: (model.available_providers ?? []) as string[],
        })),
        completeModelOrder,
      );
    }
    if (providerUnions.length > 0) {
      const widened = await addProviderToExistingMappings(
        providerUnions,
        "baseten",
      );
      console.log(
        `✅ Widened ${widened.length} existing provider mapping(s) with baseten`,
      );
    }
    // Catch-all: add any still-missing mappings and normalize index.ts.
    await syncProviderMappingsForLocalModels(updatedModels, completeModelOrder);
  } catch (error) {
    console.error("Error during sync-baseten command:", error);
    process.exit(1);
  }
}

// Sync the catalog against OpenRouter's model directory. For each OpenRouter
// model we strip the `<vendor>/` prefix to a canonical id; if we already carry
// that model (by canonical id, or failing that by the full slug), we UNION
// `openrouter` into its existing `available_providers` — the model keeps its
// primary provider(s) and gains openrouter, so fallback ordering stays obvious.
// Only when no first-class provider serves the model do we add a NEW entry keyed
// by the full slug (`format:"openai"`, `available_providers:["openrouter"]`,
// pricing/context from OpenRouter); those openrouter-only entries are sunk to the
// bottom of the catalog (stablyOrderByExisting) for display ordering. `:free`/
// `:nitro`/etc. variant slugs are skipped.
async function syncOpenRouterModelsCommand(argv: any) {
  try {
    console.log("Fetching OpenRouter models from:", OPENROUTER_MODEL_URL);
    const openRouterModels = await fetchOpenRouterModels();
    console.log(`Fetched ${openRouterModels.length} OpenRouter models.`);

    console.log("Reading local models from:", LOCAL_MODEL_LIST_PATH);
    const localModels = normalizeLocalModels(
      await readLocalModels(LOCAL_MODEL_LIST_PATH),
    ).models;
    console.log(`Read ${Object.keys(localModels).length} local models.`);

    const modelsToAdd: Array<{ name: string; model: ModelSpec }> = [];
    const providerUnions: string[] = [];
    const pricingUpdates: string[] = [];
    // Full-slug openrouter-only entries removed because a canonical key (served
    // by a first-class provider) now exists for the same model.
    const migratedSlugs: string[] = [];
    let variantSkipped = 0;

    for (const openRouterModel of openRouterModels) {
      const slug = openRouterModel.id;
      const canonical = openRouterCanonicalId(slug);
      if (canonical === null) {
        // Variant slug (`:free`/`:nitro`/…) or no vendor prefix — skip.
        variantSkipped++;
        continue;
      }
      if (!isSupportedTranslatedModelName(slug, "openrouter")) {
        console.warn(`  [INVALID] Skipping unsupported model id: ${slug}`);
        continue;
      }
      // Skip if EITHER the openrouter slug or its stripped canonical id is
      // excluded/deprecated (see isOpenRouterSlugExcluded).
      if (isOpenRouterSlugExcluded(slug)) {
        const excludedId = isModelExcludedFromSync(slug) ? slug : canonical;
        console.log(
          `  [EXCLUDED] Skipping ${slug} (${excludedId} in SYNC_EXCLUDED_MODELS)`,
        );
        continue;
      }

      // Prefer to attach openrouter to a model we already carry: first the
      // stripped canonical id (openrouter `x-ai/grok-4.5` -> our `grok-4.5`),
      // otherwise the full slug if that is itself an existing key (e.g. an id we
      // carry that already looks like `vendor/model`).
      const target = Object.prototype.hasOwnProperty.call(
        localModels,
        canonical,
      )
        ? canonical
        : Object.prototype.hasOwnProperty.call(localModels, slug)
          ? slug
          : null;

      if (target) {
        const existing = localModels[target];
        const providers = existing.available_providers ?? [];
        if (!providers.includes("openrouter")) {
          localModels[target] = {
            ...existing,
            available_providers: [
              ...providers,
              "openrouter",
            ] as ModelSpec["available_providers"],
          };
          providerUnions.push(target);
          console.log(`  [UNION] add openrouter to ${target}`);
        } else if (providers.length === 1) {
          // Openrouter-only entry we previously added: refresh its pricing.
          const priced = applyOpenRouterPricing(
            target,
            localModels[target],
            openRouterModel,
          );
          if (priced) {
            localModels[target] = priced;
            pricingUpdates.push(target);
            console.log(`  [PRICING] refresh OpenRouter pricing on ${target}`);
          }
        }

        // Invariant: the full slug entry exists ONLY while no first-class
        // provider serves the model. When we attach to the canonical key, a
        // stale openrouter-only `vendor/model` entry for the same model (added
        // before the canonical existed) is now a duplicate — remove it (its
        // openrouter coverage is preserved on the canonical via the union above).
        if (
          target === canonical &&
          slug !== canonical &&
          Object.prototype.hasOwnProperty.call(localModels, slug)
        ) {
          const staleProviders = localModels[slug].available_providers ?? [];
          if (
            staleProviders.length === 1 &&
            staleProviders[0] === "openrouter"
          ) {
            delete localModels[slug];
            migratedSlugs.push(slug);
            console.log(
              `  [MIGRATE] remove openrouter-only ${slug} (canonical ${canonical} now exists)`,
            );
          }
        }
        continue;
      }

      // No first-class provider serves this model — add a new openrouter-only
      // entry keyed by the full slug. stablyOrderByExisting sinks it to the
      // bottom of the catalog for display ordering.
      modelsToAdd.push({
        name: slug,
        model: convertOpenRouterToLocalModel(openRouterModel),
      });
      console.log(`  [NEW] ${slug} (openrouter-only)`);
    }

    console.log(`\nSkipped ${variantSkipped} variant slug(s).`);

    if (
      modelsToAdd.length === 0 &&
      providerUnions.length === 0 &&
      pricingUpdates.length === 0 &&
      migratedSlugs.length === 0
    ) {
      console.log("OpenRouter catalog already in sync. No changes needed.");
      return;
    }

    console.log(
      `${modelsToAdd.length} new openrouter-only model(s), ${providerUnions.length} provider union(s), ${pricingUpdates.length} pricing refresh(es), ${migratedSlugs.length} slug(s) migrated to canonical.`,
    );

    if (!argv.write) {
      console.log("\n📋 Dry run. Re-run with --write to apply.");
      for (const { name } of modelsToAdd) {
        console.log(`  would add (openrouter-only): ${name}`);
      }
      for (const name of providerUnions) {
        console.log(`  would add openrouter to: ${name}`);
      }
      for (const name of pricingUpdates) {
        console.log(`  would refresh OpenRouter pricing on: ${name}`);
      }
      for (const name of migratedSlugs) {
        console.log(`  would remove stale openrouter-only slug: ${name}`);
      }
      return;
    }

    const mergedCatalog = { ...localModels };
    for (const { name, model } of modelsToAdd) {
      mergedCatalog[name] = model;
    }
    const completeModelOrder = orderModelsByProviderAndClass(mergedCatalog);
    const updatedModels: LocalModelList = {};
    for (const modelName of completeModelOrder) {
      if (localModels[modelName]) {
        updatedModels[modelName] = localModels[modelName];
      } else {
        const toAdd = modelsToAdd.find((m) => m.name === modelName);
        if (toAdd) {
          updatedModels[modelName] = toAdd.model;
        }
      }
    }

    await writeLocalModels(updatedModels);
    console.log(`\n✅ Wrote ${LOCAL_MODEL_LIST_PATH}`);

    if (migratedSlugs.length > 0) {
      await removeProviderMappingEntries(migratedSlugs);
      console.log(
        `✅ Removed ${migratedSlugs.length} stale openrouter-only slug mapping(s) from index.ts`,
      );
    }
    if (modelsToAdd.length > 0) {
      await updateProviderMapping(
        modelsToAdd.map(({ name, model }) => ({
          name,
          providers: (model.available_providers ?? []) as string[],
        })),
        completeModelOrder,
      );
    }
    // Catch-all: add any still-missing mappings and normalize index.ts. Unions
    // are reflected in model_list.json available_providers (the routing source
    // of truth); openrouter is deliberately kept out of a model's DIRECT
    // index.ts endpoint types unless it is the sole provider (see
    // providersForExactModelName / BT-5895), so there is no index.ts widening
    // step for provider unions here.
    await syncProviderMappingsForLocalModels(updatedModels, completeModelOrder);
  } catch (error) {
    console.error("Error during sync-openrouter command:", error);
    process.exit(1);
  }
}

// Sync the catalog against Cohere's /v1/models (authoritative for the current,
// live set of Cohere-hosted chat models). Cohere hosts only its own models keyed
// by their bare name, so this adds any chat model we do not yet carry as a new
// `["cohere"]` entry and unions the cohere provider onto an existing entry that
// is missing it. Fine-tuned and deprecated models are skipped. Pricing is
// overlaid from LiteLLM where LiteLLM carries the model; the newest models Cohere
// has not published pricing for anywhere are left price-less. Deprecation (models
// Cohere removes) is handled separately by the deprecation audit's cohere
// adapter. Requires COHERE_API_KEY.
async function syncCohereModelsCommand(argv: any) {
  try {
    const apiKey = process.env.COHERE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "COHERE_API_KEY environment variable is required to sync Cohere models.",
      );
    }

    console.log("Fetching Cohere models from:", COHERE_MODEL_URL);
    const cohereModels = await fetchCohereModels(apiKey);
    console.log(`Fetched ${cohereModels.length} Cohere models.`);

    // LiteLLM is the pricing source (Cohere's models endpoint carries none). It
    // is best-effort: if the fetch fails, new models are still added, just
    // without a pricing overlay.
    let remoteModels: LiteLLMModelList = {};
    try {
      console.log("Fetching LiteLLM pricing from:", REMOTE_MODEL_URL);
      remoteModels = await fetchRemoteModels(REMOTE_MODEL_URL);
    } catch (error) {
      console.warn(
        `Could not fetch LiteLLM pricing (${(error as Error).message}); adding Cohere models without a pricing overlay.`,
      );
    }

    console.log("Reading local models from:", LOCAL_MODEL_LIST_PATH);
    const localModels = normalizeLocalModels(
      await readLocalModels(LOCAL_MODEL_LIST_PATH),
    ).models;
    console.log(`Read ${Object.keys(localModels).length} local models.`);

    const modelsToAdd: Array<{ name: string; model: ModelSpec }> = [];
    const providerUnions: string[] = [];
    const pricingUpdates: string[] = [];
    let skippedNonChat = 0;
    let pricedFromLiteLLM = 0;

    for (const cohereModel of cohereModels) {
      const name = cohereModel.name;
      if (!isSupportedCohereChatModel(cohereModel)) {
        skippedNonChat++;
        continue;
      }
      if (!isSupportedTranslatedModelName(name, "cohere")) {
        console.warn(`  [INVALID] Skipping unsupported model id: ${name}`);
        continue;
      }
      if (isModelExcludedFromSync(name)) {
        console.log(`  [EXCLUDED] Skipping ${name} (in SYNC_EXCLUDED_MODELS)`);
        continue;
      }

      const existing = localModels[name];
      if (existing) {
        let next = existing;
        const providers = next.available_providers ?? [];
        if (!providers.includes("cohere")) {
          next = {
            ...next,
            available_providers: [
              ...providers,
              "cohere",
            ] as ModelSpec["available_providers"],
          };
          providerUnions.push(name);
          console.log(`  [UNION] add cohere to ${name}`);
        }
        // Overlay LiteLLM pricing onto the existing entry too, so a model added
        // before LiteLLM knew its price (e.g. Cohere's newest ids) gets cost
        // metadata once LiteLLM publishes it — this branch must not `continue`
        // without consulting remoteModels.
        const priced = applyCohereLiteLLMPricing(
          name,
          next,
          remoteModels[name],
        );
        if (priced) {
          next = priced;
          pricingUpdates.push(name);
          console.log(`  [PRICING] overlay LiteLLM pricing on ${name}`);
        }
        if (next !== existing) {
          localModels[name] = next;
        }
        continue;
      }

      const litellm = remoteModels[name];
      const spec = convertCohereToLocalModel(cohereModel, litellm);
      if (spec.input_cost_per_mil_tokens !== undefined) {
        pricedFromLiteLLM++;
      }
      modelsToAdd.push({ name, model: spec });
      console.log(
        `  [NEW] ${name}${litellm ? " (pricing from LiteLLM)" : " (no pricing available)"}`,
      );
    }

    console.log(
      `\nSkipped ${skippedNonChat} non-chat/finetuned/deprecated model(s). ${pricedFromLiteLLM}/${modelsToAdd.length} new model(s) priced from LiteLLM.`,
    );

    if (
      modelsToAdd.length === 0 &&
      providerUnions.length === 0 &&
      pricingUpdates.length === 0
    ) {
      console.log("Cohere catalog already in sync. No changes needed.");
      return;
    }

    console.log(
      `${modelsToAdd.length} new Cohere model(s), ${providerUnions.length} provider union(s), ${pricingUpdates.length} pricing overlay(s).`,
    );

    if (!argv.write) {
      console.log("\n📋 Dry run. Re-run with --write to apply.");
      for (const { name, model } of modelsToAdd) {
        console.log(
          `  would add: ${name} (in=${model.input_cost_per_mil_tokens ?? "?"} out=${model.output_cost_per_mil_tokens ?? "?"})`,
        );
      }
      for (const name of providerUnions) {
        console.log(`  would add cohere to: ${name}`);
      }
      for (const name of pricingUpdates) {
        console.log(`  would overlay LiteLLM pricing on: ${name}`);
      }
      return;
    }

    const mergedCatalog = { ...localModels };
    for (const { name, model } of modelsToAdd) {
      mergedCatalog[name] = model;
    }
    const completeModelOrder = orderModelsByProviderAndClass(mergedCatalog);
    const updatedModels: LocalModelList = {};
    for (const modelName of completeModelOrder) {
      if (localModels[modelName]) {
        updatedModels[modelName] = localModels[modelName];
      } else {
        const toAdd = modelsToAdd.find((m) => m.name === modelName);
        if (toAdd) {
          updatedModels[modelName] = toAdd.model;
        }
      }
    }

    await writeLocalModels(updatedModels);
    console.log(`\n✅ Wrote ${LOCAL_MODEL_LIST_PATH}`);

    if (modelsToAdd.length > 0) {
      await updateProviderMapping(
        modelsToAdd.map(({ name, model }) => ({
          name,
          providers: (model.available_providers ?? []) as string[],
        })),
        completeModelOrder,
      );
    }
    if (providerUnions.length > 0) {
      const widened = await addProviderToExistingMappings(
        providerUnions,
        "cohere",
      );
      console.log(
        `✅ Widened ${widened.length} existing provider mapping(s) with cohere`,
      );
    }
    // Catch-all: add any still-missing mappings and normalize index.ts.
    await syncProviderMappingsForLocalModels(updatedModels, completeModelOrder);
  } catch (error) {
    console.error("Error during sync-cohere command:", error);
    process.exit(1);
  }
}

// Format schema/index.ts with Prettier so the catalog scripts never emit
// unlinted TypeScript. fix_bot_issue.ts, the LLM enrichment/Codex-response
// steps, and older writers can all leave entries like ["openai","azure"]
// (no space after the comma) that fail the prettier pre-commit hook; this
// guarantees the file matches the repo style before it is committed.
// (model_list.json is intentionally excluded from the prettier hook, so it is
// canonicalized separately and not run through Prettier here.)
async function formatIndexFileWithPrettier(): Promise<void> {
  const source = await fs.promises.readFile(SCHEMA_INDEX_PATH, "utf-8");
  const config = await prettier.resolveConfig(SCHEMA_INDEX_PATH);
  const formatted = await prettier.format(source, {
    ...config,
    filepath: SCHEMA_INDEX_PATH,
  });
  if (formatted !== source) {
    await fs.promises.writeFile(SCHEMA_INDEX_PATH, formatted);
    console.log("✅ Formatted schema/index.ts with Prettier");
  }
}

async function normalizeLocalModelsCommand(argv: any) {
  try {
    console.log("Reading local models from:", LOCAL_MODEL_LIST_PATH);
    const rawLocalModelContent = await fs.promises.readFile(
      LOCAL_MODEL_LIST_PATH,
      "utf-8",
    );
    const canonicalizedLocalModels =
      canonicalizeLocalModelsContent(rawLocalModelContent);
    const renamedKeys = canonicalizedLocalModels.renamedKeys;
    const duplicateJsonKeys = findDuplicateJsonKeys(rawLocalModelContent);
    const needsRewrite =
      renamedKeys.length > 0 ||
      duplicateJsonKeys.length > 0 ||
      rawLocalModelContent !== canonicalizedLocalModels.canonicalContent;

    if (!needsRewrite) {
      console.log("Local model catalog already normalized.");
      if (argv.write) {
        await syncProviderMappingsForLocalModels(
          canonicalizedLocalModels.models,
        );
        await formatIndexFileWithPrettier();
      }
      return;
    }

    console.log(`Found ${renamedKeys.length} local model keys to normalize:`);
    for (const { from, to } of renamedKeys) {
      console.log(`  ${from} -> ${to}`);
    }

    if (duplicateJsonKeys.length > 0) {
      console.log(
        `Found ${duplicateJsonKeys.length} duplicate JSON key occurrences that would be removed:`,
      );
      for (const duplicateKey of duplicateJsonKeys.slice(0, 10)) {
        console.log(`  ${duplicateKey}`);
      }
      if (duplicateJsonKeys.length > 10) {
        console.log(
          `  ...and ${duplicateJsonKeys.length - 10} more duplicate key occurrences`,
        );
      }
    }

    if (!argv.write) {
      console.log(
        "\n📋 To actually rewrite the local catalog, run with --write flag",
      );
      return;
    }

    await fs.promises.writeFile(
      LOCAL_MODEL_LIST_PATH,
      canonicalizedLocalModels.canonicalContent,
    );
    await syncProviderMappingsForLocalModels(canonicalizedLocalModels.models);
    await formatIndexFileWithPrettier();
    console.log(
      `\n✅ Canonicalized local model catalog${renamedKeys.length > 0 ? ` and normalized ${renamedKeys.length} local model keys` : ""}.`,
    );
  } catch (error) {
    console.error("Error during normalize-local-models command:", error);
    process.exit(1);
  }
}

async function main() {
  await yargs(hideBin(process.argv))
    .command(
      "normalize-local-models",
      "Normalize legacy local model ids and canonicalize model_list.json",
      (y) => {
        return y.option("write", {
          type: "boolean",
          description:
            "Write canonicalized local model ids and JSON content back to disk",
          default: false,
        });
      },
      async (argv) => {
        await normalizeLocalModelsCommand(argv);
      },
    )
    .command(
      "find-missing",
      "Find models in the remote list that are missing locally",
      (y) => {
        return y
          .option("summarize", {
            alias: "s",
            type: "boolean",
            description: "Summarize missing models by provider",
            default: false,
          })
          .option("provider", {
            alias: "p",
            type: "string",
            description: "Filter models by a specific provider",
          });
      },
      async (argv) => {
        await findMissingCommand(argv);
      },
    )
    .command(
      "update-models",
      "Update local models with pricing, token limits, and other attributes from remote models",
      (y) => {
        return y
          .option("provider", {
            alias: "p",
            type: "string",
            description: "Filter models by a specific provider for updating",
          })
          .option("write", {
            type: "boolean",
            description:
              "Write updated model information back to the local model_list.json file",
            default: false,
          });
      },
      async (argv) => {
        await updateModelsCommand(argv);
      },
    )
    .command(
      "add-models",
      "Add missing models from remote to local model list with smart ordering",
      (y) => {
        return y
          .option("provider", {
            alias: "p",
            type: "string",
            description: "Filter models by a specific provider for adding",
          })
          .option("filter", {
            alias: "f",
            type: "string",
            description: "Filter models by name substring (e.g., 'gpt-5')",
          })
          .option("write", {
            type: "boolean",
            description:
              "Write the new models to the local model_list.json file",
            default: false,
          })
          .option("updateProviders", {
            type: "boolean",
            description:
              "Update provider mappings in schema/index.ts for existing models",
            default: false,
          });
      },
      async (argv) => {
        await addModelsCommand(argv);
      },
    )
    .command(
      "sync-baseten",
      "Sync the catalog against Baseten's /v1/models (add missing Baseten models and union the baseten provider into existing ids). Requires BASETEN_API_KEY.",
      (y) => {
        return y.option("write", {
          type: "boolean",
          description:
            "Write the new models and provider mappings to model_list.json / index.ts",
          default: false,
        });
      },
      async (argv) => {
        await syncBasetenModelsCommand(argv);
      },
    )
    .command(
      "sync-openrouter",
      "Sync the catalog against OpenRouter's /api/v1/models. Unions the openrouter provider into models we already carry (matched by stripped canonical id or full slug); models no first-class provider serves are added as new full-slug entries sunk to the bottom of the catalog. Skips :variant slugs. The endpoint is public; no API key required.",
      (y) => {
        return y.option("write", {
          type: "boolean",
          description:
            "Write the new models and provider mappings to model_list.json / index.ts",
          default: false,
        });
      },
      async (argv) => {
        await syncOpenRouterModelsCommand(argv);
      },
    )
    .command(
      "sync-cohere",
      "Sync the catalog against Cohere's /v1/models (add missing Cohere chat models keyed by name; overlay pricing from LiteLLM where available; union the cohere provider into existing ids). Requires COHERE_API_KEY.",
      (y) => {
        return y.option("write", {
          type: "boolean",
          description:
            "Write the new models and provider mappings to model_list.json / index.ts",
          default: false,
        });
      },
      async (argv) => {
        await syncCohereModelsCommand(argv);
      },
    )

    .demandCommand(
      1,
      "You need to specify a command (e.g., find-missing, update-models, add-models, sync-baseten, or sync-openrouter).",
    )
    .help()
    .alias("help", "h")
    .strict().argv;
}

const entryPointPath = process.argv[1];
if (entryPointPath && import.meta.url === pathToFileURL(entryPointPath).href) {
  void main();
}
