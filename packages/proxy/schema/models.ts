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
  displayName: z.string().nullish(),
  o1_like: z.boolean().nullish(),
  experimental: z.boolean().nullish(),
  deprecated: z.boolean().nullish(),
  parent: z.string().nullish(),
  endpoint_types: z.array(z.enum(ModelEndpointType)).nullish(),
  locations: z.array(z.string()).nullish(),
});

export type ModelSpec = z.infer<typeof ModelSchema>;

import models from "./model_list.json";
export const AvailableModels = models as { [name: string]: ModelSpec };
