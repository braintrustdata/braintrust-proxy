import { z } from "zod";

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

import models from "./model_list.json";
export const AvailableModels = models as { [name: string]: ModelSpec };

// Dynamic model loader with expiration
let cachedModels: { [name: string]: ModelSpec } | null = null;
let cacheTimestamp: number | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour in milliseconds

function isCacheValid(): boolean {
  return !!(
    cachedModels &&
    cacheTimestamp &&
    Date.now() - cacheTimestamp < CACHE_TTL_MS
  );
}

async function loadModelsFromGitHub(
  url: string = "https://raw.githubusercontent.com/braintrustdata/braintrust-proxy/main/packages/proxy/schema/model_list.json",
): Promise<{ [name: string]: ModelSpec } | null> {
  // Return cached models if still valid
  if (isCacheValid()) {
    return cachedModels;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }
    const data = await response.json();
    cachedModels = data as { [name: string]: ModelSpec };
    cacheTimestamp = Date.now();
  } catch (error) {
    console.warn(
      "Failed to load models dynamically from GitHub, falling back to static import:",
      error,
    );
  }
  return cachedModels;
}

// Initialize models on startup and refresh when expired
export async function initializeModels(url?: string): Promise<void> {
  if (isCacheValid()) {
    return;
  }

  const githubModels = await loadModelsFromGitHub(url);
  if (githubModels) {
    Object.assign(AvailableModels, githubModels);
  }
}
