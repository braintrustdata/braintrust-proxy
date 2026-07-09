import fs from "fs";
import https from "https";
import path from "path";
import prettier from "prettier";
import { z } from "zod";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { exec, spawn } from "child_process";
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
  getFallbackCompleteOrdering,
  getProviderMappingForModel,
  matchesProviderFilter,
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
const GROK_420_FIELDS = [
  "input_cost_per_mil_tokens",
  "output_cost_per_mil_tokens",
  "max_input_tokens",
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
  // Claude Sonnet 4's documented standard context window is 200k (1M is a
  // beta tier); LiteLLM reports the 1M beta window.
  "claude-sonnet-4-20250514": ["max_input_tokens"],
  "claude-4-sonnet-20250514": ["max_input_tokens"],
  // gpt-oss pricing taken from the provider pricing pages; LiteLLM is stale
  // (lists lower rates).
  "openai/gpt-oss-120b": INPUT_OUTPUT_COST_FIELDS,
  "accounts/fireworks/models/gpt-oss-20b": INPUT_OUTPUT_COST_FIELDS,
  // mistral-small-latest = Mistral Small 4 ($0.15/$0.60 per the model card);
  // LiteLLM is stale at $0.10/$0.30.
  "mistral-small-latest": INPUT_OUTPUT_COST_FIELDS,
  // Claude Sonnet 4.6 max output is 128k per Anthropic's model card; LiteLLM
  // carries the stale 64k, so the sync keeps trying to lower it.
  "claude-sonnet-4-6": ["max_output_tokens"],
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
  const orderedModelsToWrite = reorderModelProperties(localModels);
  await fs.promises.writeFile(
    LOCAL_MODEL_LIST_PATH,
    JSON.stringify(orderedModelsToWrite, null, 2) + "\n",
  );
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
    (provider) => provider !== "vertex" || isVertexModelName(modelName),
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

      const newEntry = `  "${name}": ${formatProviderMappingProviders(providers)},`;
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
    const newLine = `  "${name}": ${formatProviderMappingProviders(providers)},${comment}`;
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

async function getOptimalModelOrderingFromClaude(
  modelsToAdd: Array<{ name: string; model: ModelSpec }>,
  existingModels: LocalModelList,
): Promise<string[]> {
  const existingModelNames = Object.keys(existingModels);
  const newModelNames = modelsToAdd.map((m) => m.name);

  // Focus on grok models for validation
  const grokModels = existingModelNames.filter((name) => name.includes("grok"));

  const prompt = `Order these Grok models optimally:

EXISTING: ${grokModels.join(", ")}
NEW: ${newModelNames.join(", ")}

Rules: version desc (4→3→2), then base→latest→variants, then larger→smaller sizes.

JSON array only:`;

  try {
    const output = await callClaudeWithSpawn(prompt);

    // Try to extract JSON from the output
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const parsedOrder = JSON.parse(jsonMatch[0]);

        // Validate that all grok models are included
        const allGrokModels = [...grokModels, ...newModelNames];
        if (
          parsedOrder.length === allGrokModels.length &&
          parsedOrder.every((name) => allGrokModels.includes(name)) &&
          allGrokModels.every((name) => parsedOrder.includes(name))
        ) {
          console.log("✅ Claude Code provided optimal Grok ordering");
          // Rebuild complete model list with optimally ordered grok models
          return rebuildCompleteModelList(existingModelNames, parsedOrder);
        } else {
          console.warn(
            `Claude response validation failed: got ${parsedOrder.length} grok models, expected ${allGrokModels.length}`,
          );
        }
      } catch (parseError) {
        console.warn(
          "Failed to parse Claude's JSON response:",
          parseError.message,
        );
      }
    } else {
      console.warn("No JSON array found in Claude's response");
    }

    console.warn(
      "Could not use Claude's response, falling back to smart ordering",
    );
    return getFallbackCompleteOrdering(existingModelNames, newModelNames);
  } catch (error) {
    console.warn("Failed to get ordering from Claude:", error.message);
    return getFallbackCompleteOrdering(existingModelNames, newModelNames);
  }
}

function callClaudeWithSpawn(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const claude = spawn("claude", [], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let isResolved = false;

    // Set up timeout
    const timeout = setTimeout(() => {
      if (!isResolved) {
        claude.kill("SIGTERM");
        isResolved = true;
        reject(new Error("Claude CLI timeout after 15 seconds"));
      }
    }, 15000);

    claude.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    claude.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    claude.on("close", (code) => {
      clearTimeout(timeout);
      if (!isResolved) {
        isResolved = true;
        if (code === 0) {
          // Try stderr first, then stdout
          const output = stderr.trim() || stdout.trim();
          resolve(output);
        } else {
          reject(new Error(`Claude CLI exited with code ${code}`));
        }
      }
    });

    claude.on("error", (error) => {
      clearTimeout(timeout);
      if (!isResolved) {
        isResolved = true;
        reject(error);
      }
    });

    // Send the prompt to stdin and close it
    claude.stdin.write(prompt);
    claude.stdin.end();
  });
}

function rebuildCompleteModelList(
  existingModelNames: string[],
  orderedGrokModels: string[],
): string[] {
  // Start with existing models, replace grok models with the optimally ordered ones
  const result: string[] = [];
  const grokModelSet = new Set(orderedGrokModels);
  let grokInserted = false;

  for (const modelName of existingModelNames) {
    if (modelName.includes("grok")) {
      // Skip individual grok models, we'll insert them all at once
      if (!grokInserted) {
        result.push(...orderedGrokModels);
        grokInserted = true;
      }
    } else {
      result.push(modelName);
    }
  }

  // If no grok models were in the original list, add them at the end
  if (!grokInserted) {
    result.push(...orderedGrokModels);
  }

  return result;
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
      const remoteProviders = getUpdatedAvailableProviders(
        Array.isArray(modelInUpdatedList.available_providers)
          ? modelInUpdatedList.available_providers
          : undefined,
        mergedProviders,
        Boolean(argv.provider),
      );
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

    const newModelNames = modelsToAdd.map((m) => m.name);

    // Prepare provider mapping data
    const providerMappingData = missingInLocal.map(
      ({ translatedName, remoteModel, mergedProviders }) => ({
        name: translatedName,
        providers: mergedProviders,
        remoteModel: remoteModel,
      }),
    );

    // Get complete optimal ordering
    console.log("\nDetermining optimal model ordering...");
    let completeModelOrder;

    if (process.env.USE_CLAUDE === "true") {
      console.log("Using Claude Code for ordering (USE_CLAUDE=true)");
      completeModelOrder = await getOptimalModelOrderingFromClaude(
        modelsToAdd,
        localModels,
      );
    } else {
      console.log("Using smart fallback ordering");
      completeModelOrder = getFallbackCompleteOrdering(
        Object.keys(localModels),
        newModelNames,
      );
    }

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
      if (isModelExcludedFromSync(id)) {
        console.log(`  [EXCLUDED] Skipping ${id} (in SYNC_EXCLUDED_MODELS)`);
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
    const newModelNames = modelsToAdd.map((m) => m.name);
    const completeModelOrder = getFallbackCompleteOrdering(
      Object.keys(localModels),
      newModelNames,
    );
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
    .demandCommand(
      1,
      "You need to specify a command (e.g., find-missing, update-models, add-models, or sync-baseten).",
    )
    .help()
    .alias("help", "h")
    .strict().argv;
}

const entryPointPath = process.argv[1];
if (entryPointPath && import.meta.url === pathToFileURL(entryPointPath).href) {
  void main();
}
