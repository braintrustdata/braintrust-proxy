import { z } from "zod";

export const PromptInputs = ["chat", "completion"] as const;
export type PromptInputType = (typeof PromptInputs)[number];

export const ModelFormats = [
  "openai",
  "anthropic",
  "google",
  "window",
  "js",
] as const;
export type ModelFormat = (typeof ModelFormats)[number];

export const ModelSchema = z.object({
  format: z.enum(ModelFormats),
  flavor: z.enum(PromptInputs),
  multimodal: z.boolean().nullish(),
  input_cost_per_token: z.number().nullish(),
  output_cost_per_token: z.number().nullish(),
  input_cost_per_mil_tokens: z.number().nullish(),
  output_cost_per_mil_tokens: z.number().nullish(),
  displayName: z.string().nullish(),
  o1_like: z.boolean().nullish(),
});

export type ModelSpec = z.infer<typeof ModelSchema>;

export const AvailableModels: { [name: string]: ModelSpec } = {
  // OPENAI / AZURE MODELS
  "gpt-4o": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 2.5,
    output_cost_per_mil_tokens: 10,
    displayName: "GPT 4o",
  },
  "gpt-4o-mini": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 0.15,
    output_cost_per_mil_tokens: 0.6,
    displayName: "GPT 4o mini",
  },
  "gpt-4o-2024-11-20": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 2.5,
    output_cost_per_mil_tokens: 10,
    displayName: "GPT 4o 2024-11-20",
  },
  "gpt-4o-2024-08-06": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 2.5,
    output_cost_per_mil_tokens: 10,
    displayName: "GPT 4o 2024-08-06",
  },
  "gpt-4o-2024-05-13": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 5,
    output_cost_per_mil_tokens: 15,
    displayName: "GPT 4o 2024-05-13",
  },
  "gpt-4o-mini-2024-07-18": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 0.15,
    output_cost_per_mil_tokens: 0.6,
    displayName: "GPT 4o mini 2024-07-18",
  },
  o1: {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    displayName: "O1",
    input_cost_per_mil_tokens: 15.0,
    output_cost_per_mil_tokens: 60,
    o1_like: true,
  },
  "o1-preview": {
    format: "openai",
    flavor: "chat",
    multimodal: false,
    displayName: "O1 preview",
    input_cost_per_mil_tokens: 15.0,
    output_cost_per_mil_tokens: 60,
    o1_like: true,
  },
  "o1-mini": {
    format: "openai",
    flavor: "chat",
    multimodal: false,
    displayName: "O1 mini",
    input_cost_per_mil_tokens: 3.0,
    output_cost_per_mil_tokens: 12.0,
    o1_like: true,
  },
  "o1-2024-12-17": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    displayName: "O1 2024-12-17",
    input_cost_per_mil_tokens: 15.0,
    output_cost_per_mil_tokens: 60,
    o1_like: true,
  },
  "o1-preview-2024-09-12": {
    format: "openai",
    flavor: "chat",
    multimodal: false,
    displayName: "O1 preview 2024-09-12",
    input_cost_per_mil_tokens: 15.0,
    output_cost_per_mil_tokens: 60.0,
    o1_like: true,
  },
  "o1-mini-2024-09-12": {
    format: "openai",
    flavor: "chat",
    multimodal: false,
    displayName: "O1 mini 2024-09-12",
    input_cost_per_mil_tokens: 3.0,
    output_cost_per_mil_tokens: 12.0,
    o1_like: true,
  },
  "gpt-4-turbo": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 10,
    output_cost_per_mil_tokens: 30,
    displayName: "GPT 4T",
  },
  "gpt-4-turbo-2024-04-09": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 10,
    output_cost_per_mil_tokens: 30,
    displayName: "GPT 4T 2024-04-09",
  },
  "gpt-4-turbo-preview": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 10,
    output_cost_per_mil_tokens: 30,
    displayName: "GPT 4T Preview",
  },
  "gpt-4-0125-preview": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 10,
    output_cost_per_mil_tokens: 30,
    displayName: "GPT 4 0125 Preview",
  },
  "gpt-4-1106-preview": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 10,
    output_cost_per_mil_tokens: 30,
    displayName: "GPT 4 1106 Preview",
  },
  "gpt-4": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 30,
    output_cost_per_mil_tokens: 60,
    displayName: "GPT 4",
  },
  "gpt-4-0613": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 30,
    output_cost_per_mil_tokens: 60,
    displayName: "GPT 4 0613",
  },
  "gpt-4-0314": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 30,
    output_cost_per_mil_tokens: 60,
    displayName: "GPT 4 0314",
  },
  "gpt-3.5-turbo-0125": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.5,
    output_cost_per_mil_tokens: 1.5,
    displayName: "GPT 3.5T 0125",
  },
  "gpt-3.5-turbo": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.5,
    output_cost_per_mil_tokens: 1.5,
    displayName: "GPT 3.5T",
  },
  "gpt-35-turbo": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.5,
    output_cost_per_mil_tokens: 1.5,
    displayName: "GPT 3.5T",
  },
  "gpt-3.5-turbo-1106": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 1,
    output_cost_per_mil_tokens: 2,
    displayName: "GPT 3.5T 1106",
  },
  "gpt-3.5-turbo-instruct": {
    format: "openai",
    flavor: "completion",
    input_cost_per_mil_tokens: 1.5,
    output_cost_per_mil_tokens: 2,
    displayName: "GPT 3.5T Instruct",
  },
  "gpt-3.5-turbo-instruct-0914": {
    format: "openai",
    flavor: "completion",
    input_cost_per_mil_tokens: 1.5,
    output_cost_per_mil_tokens: 2,
    displayName: "GPT 3.5T Instruct 0914",
  },
  "gpt-4-32k": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 60,
    output_cost_per_mil_tokens: 120,
    displayName: "GPT 4 32k",
  },
  "gpt-4-32k-0613": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 60,
    output_cost_per_mil_tokens: 120,
    displayName: "GPT 4 32k 0613",
  },
  "gpt-4-32k-0314": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 60,
    output_cost_per_mil_tokens: 120,
    displayName: "GPT 4 32k 0314",
  },
  "gpt-4-vision-preview": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 10,
    output_cost_per_mil_tokens: 30,
    displayName: "GPT 4 Vision-Preview",
  },
  "gpt-4-1106-vision-preview": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 10,
    output_cost_per_mil_tokens: 30,
    displayName: "GPT 4 1106 Vision-Preview",
  },
  "gpt-3.5-turbo-16k": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 3,
    output_cost_per_mil_tokens: 4,
    displayName: "GPT 3.5T 16k",
  },
  "gpt-35-turbo-16k": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 3,
    output_cost_per_mil_tokens: 4,
    displayName: "GPT 3.5T 16k",
  },
  "gpt-3.5-turbo-16k-0613": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 3,
    output_cost_per_mil_tokens: 4,
    displayName: "GPT 3.5T 16k 0613",
  },
  "gpt-3.5-turbo-0613": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 1.5,
    output_cost_per_mil_tokens: 2,
    displayName: "GPT 3.5T 0613",
  },
  "gpt-3.5-turbo-0301": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 1.5,
    output_cost_per_mil_tokens: 2,
    displayName: "GPT 3.5T 0301",
  },
  "text-davinci-003": {
    format: "openai",
    flavor: "completion",
    input_cost_per_mil_tokens: 2,
    output_cost_per_mil_tokens: 2,
    displayName: "Text Davinci 003",
  },

  // ANTHROPIC MODELS
  "claude-3-5-sonnet-latest": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 3,
    output_cost_per_mil_tokens: 15,
    displayName: "Claude 3.5 Sonnet Latest",
  },
  "claude-3-5-sonnet-20241022": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 3,
    output_cost_per_mil_tokens: 15,
    displayName: "Claude 3.5 Sonnet 2024-10-22",
  },
  "claude-3-5-sonnet-20240620": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 3,
    output_cost_per_mil_tokens: 15,
    displayName: "Claude 3.5 Sonnet 2024-06-20",
  },
  "claude-3-5-haiku-20241022": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 1,
    output_cost_per_mil_tokens: 5,
    displayName: "Claude 3.5 Haiku 2024-10-22",
  },
  "claude-3-haiku-20240307": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 0.25,
    output_cost_per_mil_tokens: 1.25,
    displayName: "Claude 3 Haiku",
  },
  "claude-3-sonnet-20240229": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 3,
    output_cost_per_mil_tokens: 15,
    displayName: "Claude 3 Sonnet",
  },
  "claude-3-opus-20240229": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 15,
    output_cost_per_mil_tokens: 75,
    displayName: "Claude 3 Opus",
  },
  "anthropic.claude-3-5-sonnet-20241022-v2:0": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 3,
    output_cost_per_mil_tokens: 15,
    displayName: "Claude 3.5 Sonnet v2.0",
  },
  "anthropic.claude-3-5-sonnet-20240620-v1:0": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 3,
    output_cost_per_mil_tokens: 15,
    displayName: "Claude 3.5 Sonnet v1.0",
  },
  "anthropic.claude-3-haiku-20240307-v1:0": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 0.25,
    output_cost_per_mil_tokens: 1.25,
    displayName: "Claude 3 Haiku v1.0",
  },
  "anthropic.claude-3-sonnet-20240229-v1:0": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 3,
    output_cost_per_mil_tokens: 15,
    displayName: "Claude 3 Sonnet v1.0",
  },
  "anthropic.claude-3-opus-20240229-v1:0": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_mil_tokens: 15,
    output_cost_per_mil_tokens: 75,
    displayName: "Claude 3 Opus v1.0",
  },
  "claude-instant-1.2": {
    format: "anthropic",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.8,
    output_cost_per_mil_tokens: 2.4,
    displayName: "Claude Instant 1.2",
  },
  "claude-instant-1": {
    format: "anthropic",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.8,
    output_cost_per_mil_tokens: 2.4,
    displayName: "Claude Instant 1",
  },
  "claude-2.1": {
    format: "anthropic",
    flavor: "chat",
    input_cost_per_mil_tokens: 8,
    output_cost_per_mil_tokens: 24,
    displayName: "Claude 2.1",
  },
  "claude-2.0": {
    format: "anthropic",
    flavor: "chat",
    input_cost_per_mil_tokens: 8,
    output_cost_per_mil_tokens: 24,
    displayName: "Claude 2.0",
  },
  "claude-2": {
    format: "anthropic",
    flavor: "chat",
    input_cost_per_mil_tokens: 8,
    output_cost_per_mil_tokens: 24,
    displayName: "Claude 2",
  },

  // REPLICATE MODELS
  "meta/llama-2-70b-chat": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.65,
    output_cost_per_mil_tokens: 2.75,
    displayName: "LLaMA 2 70b Chat",
  },

  // OLLAMA MODELS
  mistral: {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.0,
    output_cost_per_mil_tokens: 0.0,
    displayName: "Mistral",
  },
  phi: {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.0,
    output_cost_per_mil_tokens: 0.0,
    displayName: "Phi",
  },

  // PERPLEXITY MODELS
  "pplx-7b-chat": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.07,
    output_cost_per_mil_tokens: 0.28,
    displayName: "Perplexity 7b Chat",
  },
  "pplx-7b-online": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.2,
    output_cost_per_mil_tokens: 0.2,
    displayName: "Perplexity 7b Online",
  },
  "pplx-70b-chat": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.7,
    output_cost_per_mil_tokens: 2.8,
    displayName: "Perplexity 70b Chat",
  },
  "pplx-70b-online": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 1,
    output_cost_per_mil_tokens: 1,
    displayName: "Perplexity 70b Online",
  },
  "codellama-34b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.35,
    output_cost_per_mil_tokens: 1.4,
    displayName: "Code Llama 34b Instruct",
  },
  "codellama-70b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.7,
    output_cost_per_mil_tokens: 2.8,
    displayName: "Code Llama 70b Instruct",
  },
  "llama-3-8b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.2,
    output_cost_per_mil_tokens: 0.2,
    displayName: "LLaMA 3 8b Instruct",
  },
  "llama-3-70b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 1,
    output_cost_per_mil_tokens: 1,
    displayName: "LLaMA 3 70b Instruct",
  },
  "llama-2-13b-chat": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.14,
    output_cost_per_mil_tokens: 0.56,
    displayName: "LLaMA 2 13b Chat",
  },
  "llama-2-70b-chat": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 1,
    output_cost_per_mil_tokens: 1,
    displayName: "LLaMA 2 70b Chat",
  },
  "mistral-7b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.07,
    output_cost_per_mil_tokens: 0.28,
    displayName: "Mistral 7b Instruct",
  },
  "mixtral-8x7b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.07,
    output_cost_per_mil_tokens: 0.28,
    displayName: "Mixtral 8x7B Instruct",
  },
  "mixtral-8x22b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 1,
    output_cost_per_mil_tokens: 1,
    displayName: "Mixtral 8x22B Instruct",
  },
  "openhermes-2-mistral-7b": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.2,
    output_cost_per_mil_tokens: 0.2,
    displayName: "OpenHermes 2",
  },
  "openhermes-2.5-mistral-7b": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.2,
    output_cost_per_mil_tokens: 0.2,
    displayName: "OpenHermes 2.5",
  },

  // TOGETHER MODELS
  "meta-llama/Llama-3.3-70B-Instruct-Turbo": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.88,
    output_cost_per_mil_tokens: 0.88,
    displayName: "LLaMA 3.3 70B Instruct Turbo",
  },
  "meta-llama/Llama-3.2-3B-Instruct-Turbo": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.06,
    output_cost_per_mil_tokens: 0.06,
    displayName: "LLaMA 3.2 3B Instruct Turbo",
    multimodal: true,
  },
  "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.18,
    output_cost_per_mil_tokens: 0.18,
    displayName: "LLaMA 3.1 8B Instruct Turbo",
  },
  "meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.18,
    output_cost_per_mil_tokens: 0.18,
    displayName: "LLaMA 3.2 11B Vision Instruct Turbo",
    multimodal: true,
  },
  "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.88,
    output_cost_per_mil_tokens: 0.88,
    displayName: "LLaMA 3.1 70B Instruct Turbo",
  },
  "meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 1.2,
    output_cost_per_mil_tokens: 1.2,
    displayName: "LLaMA 3.2 90B Vision Instruct Turbo",
    multimodal: true,
  },
  "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 5,
    output_cost_per_mil_tokens: 15,
    displayName: "LLaMA 3.1 405B Instruct Turbo",
  },
  "meta-llama/Meta-Llama-3-70B": {
    format: "openai",
    flavor: "completion",
    input_cost_per_mil_tokens: 0.9,
    output_cost_per_mil_tokens: 0.9,
    displayName: "LLaMA 3 70b",
  },
  "meta-llama/Llama-3-8b-hf": {
    format: "openai",
    flavor: "completion",
    input_cost_per_mil_tokens: 0.2,
    output_cost_per_mil_tokens: 0.2,
    displayName: "LLaMA 3 8b HF",
  },
  "meta-llama/Llama-3-8b-chat-hf": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.2,
    output_cost_per_mil_tokens: 0.2,
    displayName: "LLaMA 3 8b Chat HF",
  },
  "meta-llama/Llama-3-70b-chat-hf": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.9,
    output_cost_per_mil_tokens: 0.9,
    displayName: "LLaMA 3 70b Chat HF",
  },
  "meta-llama/Llama-2-70b-chat-hf": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.9,
    output_cost_per_mil_tokens: 0.9,
    displayName: "LLaMA 2 70b Chat HF",
  },
  "mistralai/Mistral-7B-Instruct-v0.1": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.2,
    output_cost_per_mil_tokens: 0.2,
    displayName: "Mistral 7b Instruct v0.1",
  },
  "mistralai/mixtral-8x7b-32kseqlen": {
    format: "openai",
    flavor: "completion",
    input_cost_per_mil_tokens: 0.06,
    output_cost_per_mil_tokens: 0.06,
    displayName: "Mixtral 8x7B 32k",
  },
  "mistralai/Mixtral-8x7B-Instruct-v0.1": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.6,
    output_cost_per_mil_tokens: 0.6,
    displayName: "Mixtral 8x7B Instruct v0.1",
  },
  "mistralai/Mixtral-8x7B-Instruct-v0.1-json": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.6,
    output_cost_per_mil_tokens: 0.6,
    displayName: "Mixtral 8x7B Instruct v0.1 JSON",
  },
  "mistralai/Mixtral-8x22B": {
    format: "openai",
    flavor: "completion",
    input_cost_per_mil_tokens: 1.08,
    output_cost_per_mil_tokens: 1.08,
    displayName: "Mixtral 8x22B",
  },
  "mistralai/Mixtral-8x22B-Instruct-v0.1": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 1.2,
    output_cost_per_mil_tokens: 1.2,
    displayName: "Mixtral 8x22B Instruct",
  },
  "NousResearch/Nous-Hermes-2-Yi-34B": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.8,
    output_cost_per_mil_tokens: 0.8,
    displayName: "Nous Hermes 2 Yi 34B",
  },
  "deepseek-ai/deepseek-coder-33b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.8,
    output_cost_per_mil_tokens: 0.8,
    displayName: "Deepseek Coder 33b Instruct",
  },

  // MISTRAL MODELS
  "mistral-large-latest": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 3,
    output_cost_per_mil_tokens: 9,
    displayName: "Mistral Large 2",
  },
  "pixtral-12b-2409": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.15,
    output_cost_per_mil_tokens: 0.15,
    displayName: "Pixtral 12b 24096",
    multimodal: true,
  },
  "open-mistral-nemo": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.3,
    output_cost_per_mil_tokens: 0.3,
    displayName: "Mistral Nemo",
  },
  "codestral-latest": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 1,
    output_cost_per_mil_tokens: 3,
    displayName: "Codestral",
  },
  // "mistral-embed": {
  //   format: "openai",
  //   flavor: "chat",
  //   input_cost_per_mil_tokens: 0.1,
  //   output_cost_per_mil_tokens: 0.1,
  //   displayName: "Mistral Embed",
  // },
  "open-mixtral-8x22b": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 2,
    output_cost_per_mil_tokens: 6,
    displayName: "Mixtral 8x22B",
  },
  "open-codestral-mamba": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.6,
    output_cost_per_mil_tokens: 0.6,
    displayName: "Codestral Mamba",
  },
  "mistral-tiny": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.15,
    output_cost_per_mil_tokens: 0.46,
    displayName: "Mistral Tiny",
  },
  "mistral-small": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 1,
    output_cost_per_mil_tokens: 3,
    displayName: "Mistral Small",
  },
  "mistral-medium": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 2.75,
    output_cost_per_mil_tokens: 8.1,
    displayName: "Mistral Medium",
  },

  // GROQ MODELS
  "llama-3.3-70b-versatile": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.59,
    output_cost_per_mil_tokens: 0.79,
    displayName: "LLaMA 3.3 70b Versatile",
  },
  "llama-3.1-8b-instant": {
    format: "openai",
    flavor: "chat",
    displayName: "LLaMA 3.1 8b Instant",
    // NOTE: At time of writing, costs are not available
    // for these models.
  },
  "llama-3.1-70b-versatile": {
    format: "openai",
    flavor: "chat",
    displayName: "LLaMA 3.1 70b Versatile",
  },
  "llama-3.1-405b-reasoning": {
    format: "openai",
    flavor: "chat",
    displayName: "LLaMA 3.1 405b Reasoning",
  },
  "gemma-7b-it": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.1,
    output_cost_per_mil_tokens: 0.1,
    displayName: "Gemma 7b IT",
  },
  "llama3-8b-8192": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.1,
    output_cost_per_mil_tokens: 0.1,
    displayName: "LLaMA 3 8b 8192",
  },
  "llama3-70b-8192": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.64,
    output_cost_per_mil_tokens: 0.8,
    displayName: "LLaMA 3 70b 8192",
  },
  "llama2-70b-4096": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.7,
    output_cost_per_mil_tokens: 0.8,
    displayName: "LLaMA 2 70b 4096",
  },
  "mixtral-8x7b-32768": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.27,
    output_cost_per_mil_tokens: 0.27,
    displayName: "Mixtral 8x7B 32768",
  },

  // LEPTON MODELS
  "llama3-1-8b": {
    format: "openai",
    flavor: "chat",
    displayName: "LLaMA 3.1 8b",
    input_cost_per_mil_tokens: 0.07,
    output_cost_per_mil_tokens: 0.07,
  },
  "llama3-1-70b": {
    format: "openai",
    flavor: "chat",
    displayName: "LLaMA 3.1 70b",
    input_cost_per_mil_tokens: 0.8,
    output_cost_per_mil_tokens: 0.8,
  },
  "llama3-1-405b": {
    format: "openai",
    flavor: "chat",
    displayName: "LLaMA 3.1 405b",
    input_cost_per_mil_tokens: 2.8,
    output_cost_per_mil_tokens: 2.8,
  },

  // FIREWORKS MODELS
  "accounts/fireworks/models/llama-v3p3-70b-instruct": {
    format: "openai",
    flavor: "chat",
    displayName: "LLaMA 3.3 70B Instruct",
    input_cost_per_mil_tokens: 0.9,
    output_cost_per_mil_tokens: 0.9,
  },
  "accounts/fireworks/models/llama-v3p2-3b-instruct": {
    format: "openai",
    flavor: "chat",
    displayName: "LLaMA 3.2 3B Instruct",
    input_cost_per_mil_tokens: 0.1,
    output_cost_per_mil_tokens: 0.1,
    multimodal: true,
  },
  "accounts/fireworks/models/llama-v3p1-8b-instruct": {
    format: "openai",
    flavor: "chat",
    displayName: "LLaMA 3.1 8b",
    input_cost_per_mil_tokens: 0.2,
    output_cost_per_mil_tokens: 0.2,
  },
  "accounts/fireworks/models/llama-v3p2-11b-vision-instruct": {
    format: "openai",
    flavor: "chat",
    displayName: "LLaMA 3.2 11B Vision Instruct",
    input_cost_per_mil_tokens: 0.18,
    output_cost_per_mil_tokens: 0.18,
    multimodal: true,
  },
  "accounts/fireworks/models/llama-v3p1-70b-instruct": {
    format: "openai",
    flavor: "chat",
    displayName: "LLaMA 3.1 70b",
    input_cost_per_mil_tokens: 0.2,
    output_cost_per_mil_tokens: 0.2,
  },
  "accounts/fireworks/models/llama-v3p2-90b-vision-instruct": {
    format: "openai",
    flavor: "chat",
    displayName: "LLaMA 3.2 90B Vision Instruct",
    input_cost_per_mil_tokens: 0.9,
    output_cost_per_mil_tokens: 0.9,
    multimodal: true,
  },
  "accounts/fireworks/models/llama-v3p1-405b-instruct": {
    format: "openai",
    flavor: "chat",
    displayName: "LLaMA 3.1 405b",
    input_cost_per_mil_tokens: 3,
    output_cost_per_mil_tokens: 3,
  },

  // CEREBRAS MODELS
  "llama3.1-8b": {
    format: "openai",
    flavor: "chat",
    displayName: "Llama 3.1 8B",
    input_cost_per_mil_tokens: 0.1,
    output_cost_per_mil_tokens: 0.1,
  },
  "llama3.1-70b": {
    format: "openai",
    flavor: "chat",
    displayName: "Llama 3.1 70B",
    input_cost_per_mil_tokens: 0.6,
    output_cost_per_mil_tokens: 0.6,
  },

  // GOOGLE MODELS
  "gemini-1.5-pro": {
    format: "google",
    flavor: "chat",
    input_cost_per_mil_tokens: 1.25,
    output_cost_per_mil_tokens: 5.0,
    displayName: "Gemini 1.5 Pro",
    multimodal: true,
  },
  "gemini-1.5-flash": {
    format: "google",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.075,
    output_cost_per_mil_tokens: 0.3,
    displayName: "Gemini 1.5 Flash",
    multimodal: true,
  },
  "gemini-2.0-flash-exp": {
    format: "google",
    flavor: "chat",
    input_cost_per_mil_tokens: 0, // TODO: Appears to be free for now?
    output_cost_per_mil_tokens: 0,
    displayName: "Gemini 2.0 Flash Exp",
    multimodal: true,
  },
  "gemini-exp-1206": {
    format: "google",
    flavor: "chat",
    input_cost_per_mil_tokens: 0, // TODO: Appears to be free for now?
    output_cost_per_mil_tokens: 0,
    displayName: "Gemini Exp 1206",
    multimodal: true,
  },
  "gemini-exp-1114": {
    format: "google",
    flavor: "chat",
    input_cost_per_mil_tokens: 0, // TODO: Appears to be free for now?
    output_cost_per_mil_tokens: 0,
    displayName: "Gemini Exp 1114",
    multimodal: true,
  },
  "gemini-exp-1121": {
    format: "google",
    flavor: "chat",
    input_cost_per_mil_tokens: 0, // TODO: Appears to be free for now?
    output_cost_per_mil_tokens: 0,
    displayName: "Gemini Exp 1121",
    multimodal: true,
  },
  "gemini-1.5-pro-002": {
    format: "google",
    flavor: "chat",
    input_cost_per_mil_tokens: 1.25,
    output_cost_per_mil_tokens: 5.0,
    displayName: "Gemini 1.5 Pro 002",
    multimodal: true,
  },
  "gemini-1.5-flash-002": {
    format: "google",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.075,
    output_cost_per_mil_tokens: 0.3,
    displayName: "Gemini 1.5 Flash 002",
    multimodal: true,
  },
  "gemini-1.5-pro-latest": {
    format: "google",
    flavor: "chat",
    input_cost_per_mil_tokens: 1.25,
    output_cost_per_mil_tokens: 5.0,
    displayName: "Gemini 1.5 Pro Latest",
    multimodal: true,
  },
  "gemini-1.5-flash-latest": {
    format: "google",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.075,
    output_cost_per_mil_tokens: 0.3,
    displayName: "Gemini 1.5 Flash Latest",
    multimodal: true,
  },
  "gemini-1.5-flash-8b": {
    format: "google",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.0375,
    output_cost_per_mil_tokens: 0.15,
    displayName: "Gemini 1.5 Flash 8B",
    multimodal: true,
  },
  "gemini-1.0-pro": {
    format: "google",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.5,
    output_cost_per_mil_tokens: 1.5,
    displayName: "Gemini 1.0 Pro",
  },
  "gemini-pro": {
    format: "google",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.25,
    output_cost_per_mil_tokens: 0.5,
    displayName: "Gemini Pro",
  },

  // XAI MODELS
  "grok-beta": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 5,
    output_cost_per_mil_tokens: 15,
    displayName: "Grok Beta",
  },

  // BEDROCK MODELS
  "amazon.nova-pro-v1:0": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.8,
    output_cost_per_mil_tokens: 3.2,
    displayName: "Amazon Nova Pro",
  },
  "amazon.nova-lite-v1:0": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.06,
    output_cost_per_mil_tokens: 0.24,
    displayName: "Amazon Nova Lite",
  },
  "amazon.nova-micro-v1:0": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.035,
    output_cost_per_mil_tokens: 0.14,
    displayName: "Amazon Nova Micro",
  },

  "text-block": {
    format: "js",
    flavor: "completion",
    displayName: "Text-block",
  },

  // Novita AI Models
  "meta-llama/llama-3.3-70b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.39,
    output_cost_per_mil_tokens: 0.39,
    displayName: "meta-llama/llama-3.3-70b-instruct",
  },
  "meta-llama/llama-3.1-8b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.05,
    output_cost_per_mil_tokens: 0.05,
    displayName: "meta-llama/llama-3.1-8b-instruct",
  },
  "meta-llama/llama-3.1-8b-instruct-max": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.05,
    output_cost_per_mil_tokens: 0.05,
    displayName: "meta-llama/llama-3.1-8b-instruct-max",
  },
  "meta-llama/llama-3.1-70b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.34,
    output_cost_per_mil_tokens: 0.39,
    displayName: "meta-llama/llama-3.1-70b-instruct",
  },
  "meta-llama/llama-3.1-405b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 2.75,
    output_cost_per_mil_tokens: 2.75,
    displayName: "meta-llama/llama-3.1-405b-instruct",
  },
  "meta-llama/llama-3-8b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.04,
    output_cost_per_mil_tokens: 0.04,
    displayName: "meta-llama/llama-3-8b-instruct",
  },
  "meta-llama/llama-3-70b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.51,
    output_cost_per_mil_tokens: 0.74,
    displayName: "meta-llama/llama-3-70b-instruct",
  },
  "gryphe/mythomax-l2-13b": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.09,
    output_cost_per_mil_tokens: 0.09,
    displayName: "gryphe/mythomax-l2-13b",
  },
  "google/gemma-2-9b-it": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.08,
    output_cost_per_mil_tokens: 0.08,
    displayName: "google/gemma-2-9b-it",
  },
  "mistralai/mistral-nemo": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.17,
    output_cost_per_mil_tokens: 0.17,
    displayName: "mistralai/mistral-nemo",
  },
  "microsoft/wizardlm-2-8x22b": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.62,
    output_cost_per_mil_tokens: 0.62,
    displayName: "microsoft/wizardlm-2-8x22b",
  },
  "mistralai/mistral-7b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.059,
    output_cost_per_mil_tokens: 0.059,
    displayName: "mistralai/mistral-7b-instruct",
  },
  "openchat/openchat-7b": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.06,
    output_cost_per_mil_tokens: 0.06,
    displayName: "openchat/openchat-7b",
  },
  "nousresearch/hermes-2-pro-llama-3-8b": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.14,
    output_cost_per_mil_tokens: 0.14,
    displayName: "nousresearch/hermes-2-pro-llama-3-8b",
  },
  "sao10k/l3-70b-euryale-v2.1": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 1.48,
    output_cost_per_mil_tokens: 1.48,
    displayName: "sao10k/l3-70b-euryale-v2.1",
  },
  "cognitivecomputations/dolphin-mixtral-8x22b": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.90,
    output_cost_per_mil_tokens: 0.90,
    displayName: "cognitivecomputations/dolphin-mixtral-8x22b",
  },
  "jondurbin/airoboros-l2-70b": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.50,
    output_cost_per_mil_tokens: 0.50,
    displayName: "jondurbin/airoboros-l2-70b",
  },
  "lzlv_70b": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.58,
    output_cost_per_mil_tokens: 0.78,
    displayName: "lzlv_70b",
  },
  "nousresearch/nous-hermes-llama2-13b": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.17,
    output_cost_per_mil_tokens: 0.17,
    displayName: "nousresearch/nous-hermes-llama2-13b",
  },
  "teknium/openhermes-2.5-mistral-7b": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.17,
    output_cost_per_mil_tokens: 0.17,
    displayName: "teknium/openhermes-2.5-mistral-7b",
  },
  "sophosympatheia/midnight-rose-70b": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.80,
    output_cost_per_mil_tokens: 0.80,
    displayName: "sophosympatheia/midnight-rose-70b",
  },
  "Sao10K/L3-8B-Stheno-v3.2": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.05,
    output_cost_per_mil_tokens: 0.05,
    displayName: "Sao10K/L3-8B-Stheno-v3.2",
  },
  "sao10k/l3-8b-lunaris": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.05,
    output_cost_per_mil_tokens: 0.05,
    displayName: "sao10k/l3-8b-lunaris",
  },
  "qwen/qwen-2-vl-72b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.45,
    output_cost_per_mil_tokens: 0.45,
    displayName: "qwen/qwen-2-vl-72b-instruct",
  },
  "meta-llama/llama-3.2-1b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.02,
    output_cost_per_mil_tokens: 0.02,
    displayName: "meta-llama/llama-3.2-1b-instruct",
  },
  "meta-llama/llama-3.2-11b-vision-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.06,
    output_cost_per_mil_tokens: 0.06,
    displayName: "meta-llama/llama-3.2-11b-vision-instruct",
  },
  "meta-llama/llama-3.2-3b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.03,
    output_cost_per_mil_tokens: 0.05,
    displayName: "meta-llama/llama-3.2-3b-instruct",
  },
  "meta-llama/llama-3.1-8b-instruct-bf16": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.06,
    output_cost_per_mil_tokens: 0.06,
    displayName: "meta-llama/llama-3.1-8b-instruct-bf16",
  },
  "qwen/qwen-2.5-72b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.38,
    output_cost_per_mil_tokens: 0.40,
    displayName: "qwen/qwen-2.5-72b-instruct",
  },
  "sao10k/l31-70b-euryale-v2.2": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 1.48,
    output_cost_per_mil_tokens: 1.48,
    displayName: "sao10k/l31-70b-euryale-v2.2",
  },
  "qwen/qwen-2-7b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.054,
    output_cost_per_mil_tokens: 0.054,
    displayName: "qwen/qwen-2-7b-instruct",
  },
  "qwen/qwen-2-72b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_mil_tokens: 0.34,
    output_cost_per_mil_tokens: 0.39,
    displayName: "qwen/qwen-2-72b-instruct",
  }
};
