import { z } from "zod";
import { _urljoin } from "@braintrust/core";

export const PromptInputs = ["chat", "completion"] as const;
export type PromptInputType = (typeof PromptInputs)[number];

export const ModelFormats = [
  "openai",
  "anthropic",
  "google",
  "window",
  "js",
  "converse",
] as const;
export type ModelFormat = (typeof ModelFormats)[number];

export const ModelEndpointType = [
  "openai",
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
  "databricks",
  "lepton",
  "cerebras",
  "ollama",
  "replicate",
  "js",
] as const;
export type ModelEndpointType = (typeof ModelEndpointType)[number];

export const ModelSchema = z.object({
  format: z.enum(ModelFormats),
  flavor: z.enum(PromptInputs),
  multimodal: z.boolean().nullish(),
  input_cost_per_token: z.number().nullish(),
  output_cost_per_token: z.number().nullish(),
  input_cost_per_mil_tokens: z.number().nullish(),
  output_cost_per_mil_tokens: z.number().nullish(),
  input_cache_read_cost_per_mil_tokens: z.number().nullish(),
  input_cache_write_cost_per_mil_tokens: z.number().nullish(),
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
  parent: z.string().nullish().describe("The model was replaced this model."),
  endpoint_types: z.array(z.enum(ModelEndpointType)).nullish(),
  locations: z.array(z.string()).nullish(),
  description: z.string().nullish(),
  max_input_tokens: z
    .number()
    .nullish()
    .describe("The model supports a maximum input token limit."),
  max_output_tokens: z
    .number()
    .nullish()
    .describe("The model supports a maximum output token limit."),
});

export type ModelSpec = z.infer<typeof ModelSchema>;

import modelListJson from "./model_list.json";
const modelListJsonTyped = z.record(ModelSchema).parse(modelListJson);

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
  return globalThis._proxy_availableModels ?? modelListJsonTyped;
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
      const data = await response.json();
      globalThis._proxy_cachedModels = data as { [name: string]: ModelSpec };
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
