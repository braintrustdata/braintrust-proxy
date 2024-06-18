export const PromptInputs = ["completion", "chat"] as const;
export type PromptInputType = (typeof PromptInputs)[number];

export const ModelFormats = ["openai", "anthropic", "google", "js"] as const;
export type ModelFormat = (typeof ModelFormats)[number];

export interface ModelSpec {
  format: ModelFormat;
  flavor: PromptInputType;
  multimodal?: boolean;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  displayName: string;
}

export const AvailableModels: { [name: string]: ModelSpec } = {
  "gpt-3.5-turbo": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000005,
    output_cost_per_token: 0.0000015,
    displayName: "GPT 3.5T",
  },
  "gpt-35-turbo": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000005,
    output_cost_per_token: 0.0000015,
    displayName: "GPT 3.5T",
  },
  "gpt-3.5-turbo-0125": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000005,
    output_cost_per_token: 0.0000015,
    displayName: "GPT 3.5T 0125",
  },
  "gpt-3.5-turbo-1106": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000001,
    output_cost_per_token: 0.000002,
    displayName: "GPT 3.5T 1106",
  },
  "gpt-3.5-turbo-16k": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000004,
    displayName: "GPT 3.5T 16k",
  },
  "gpt-35-turbo-16k": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000004,
    displayName: "GPT 3.5T 16k",
  },
  "gpt-4": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00003,
    output_cost_per_token: 0.00006,
    displayName: "GPT 4",
  },
  "gpt-4o": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.000015,
    displayName: "GPT 4o",
  },
  "gpt-4o-2024-05-13": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.000015,
    displayName: "GPT 4o 2024-05-13",
  },
  "gpt-4-32k": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00006,
    output_cost_per_token: 0.00012,
    displayName: "GPT 4 32k",
  },
  "gpt-4-vision-preview": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00003,
    displayName: "GPT 4 Vision-Preview",
  },
  "gpt-4-1106-vision-preview": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00003,
    displayName: "GPT 4 1106 Vision-Preview",
  },
  "gpt-4-turbo": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00003,
    displayName: "GPT 4T",
  },
  "gpt-4-turbo-2024-04-09": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00003,
    displayName: "GPT 4T 2024-04-09",
  },
  "gpt-4-turbo-preview": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00003,
    displayName: "GPT 4T Preview",
  },
  "gpt-4-0125-preview": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00003,
    displayName: "GPT 4 0125 Preview",
  },
  "gpt-4-1106-preview": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00003,
    displayName: "GPT 4 1106 Preview",
  },
  "gpt-3.5-turbo-0613": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000015,
    output_cost_per_token: 0.000002,
    displayName: "GPT 3.5T 0613",
  },
  "gpt-3.5-turbo-16k-0613": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000004,
    displayName: "GPT 3.5T 16k 0613",
  },
  "gpt-3.5-turbo-0301": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000015,
    output_cost_per_token: 0.000002,
    displayName: "GPT 3.5T 0301",
  },
  "gpt-4-0613": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00003,
    output_cost_per_token: 0.00006,
    displayName: "GPT 4 0613",
  },
  "gpt-4-32k-0613": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00006,
    output_cost_per_token: 0.00012,
    displayName: "GPT 4 32k 0613",
  },
  "gpt-4-0314": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00003,
    output_cost_per_token: 0.00006,
    displayName: "GPT 4 0314",
  },
  "gpt-4-32k-0314": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00006,
    output_cost_per_token: 0.00012,
    displayName: "GPT 4 32k 0314",
  },
  "gpt-3.5-turbo-instruct": {
    format: "openai",
    flavor: "completion",
    input_cost_per_token: 0.0000015,
    output_cost_per_token: 0.000002,
    displayName: "GPT 3.5T Instruct",
  },
  "gpt-3.5-turbo-instruct-0914": {
    format: "openai",
    flavor: "completion",
    input_cost_per_token: 0.0000015,
    output_cost_per_token: 0.000002,
    displayName: "GPT 3.5T Instruct 0914",
  },
  "text-davinci-003": {
    format: "openai",
    flavor: "completion",
    input_cost_per_token: 0.000002,
    output_cost_per_token: 0.000002,
    displayName: "Text Davinci 003",
  },
  "claude-2": {
    format: "anthropic",
    flavor: "chat",
    input_cost_per_token: 0.000008,
    output_cost_per_token: 0.000024,
    displayName: "Claude 2",
  },
  "claude-instant-1": {
    format: "anthropic",
    flavor: "chat",
    input_cost_per_token: 0.0000008,
    output_cost_per_token: 0.0000024,
    displayName: "Claude Instant 1",
  },
  "claude-2.0": {
    format: "anthropic",
    flavor: "chat",
    input_cost_per_token: 0.000008,
    output_cost_per_token: 0.000024,
    displayName: "Claude 2.0",
  },
  "claude-2.1": {
    format: "anthropic",
    flavor: "chat",
    input_cost_per_token: 0.000008,
    output_cost_per_token: 0.000024,
    displayName: "Claude 2.1",
  },
  "claude-instant-1.2": {
    format: "anthropic",
    flavor: "chat",
    input_cost_per_token: 0.0000008,
    output_cost_per_token: 0.0000024,
    displayName: "Claude Instant 1.2",
  },
  "claude-3-opus-20240229": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.000015,
    output_cost_per_token: 0.000075,
    displayName: "Claude 3 Opus",
  },
  "claude-3-sonnet-20240229": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    displayName: "Claude 3 Sonnet",
  },
  "claude-3-haiku-20240307": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.00000025,
    output_cost_per_token: 0.00000125,
    displayName: "Claude 3 Haiku",
  },
  "anthropic.claude-3-opus-20240229-v1:0": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.000015,
    output_cost_per_token: 0.000075,
    displayName: "Claude 3 Opus v1.0",
  },
  "anthropic.claude-3-haiku-20240307-v1:0": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.00000025,
    output_cost_per_token: 0.00000125,
    displayName: "Claude 3 Haiku v1.0",
  },
  "anthropic.claude-3-sonnet-20240229-v1:0": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    displayName: "Claude 3 Sonnet v1.0",
  },
  "meta/llama-2-70b-chat": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00000065,
    output_cost_per_token: 0.00000275,
    displayName: "LLaMA 2 70b Chat",
  },
  "llama-2-70b-chat": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000001,
    output_cost_per_token: 0.000001,
    displayName: "LLaMA 2 70b Chat",
  },
  "llama-2-13b-chat": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00000014,
    output_cost_per_token: 0.00000056,
    displayName: "LLaMA 2 13b Chat",
  },
  "llama3-8b-8192": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000001,
    output_cost_per_token: 0.0000001,
    displayName: "LLaMA 3 8b 8192",
  },
  "llama3-70b-8192": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00000064,
    output_cost_per_token: 0.0000008,
    displayName: "LLaMA 3 70b 8192",
  },
  "llama2-70b-4096": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000007,
    output_cost_per_token: 0.0000008,
    displayName: "LLaMA 2 70b 4096",
  },
  "codellama-34b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00000035,
    output_cost_per_token: 0.0000014,
    displayName: "LLaMA Code 34b Instruct",
  },
  "mistral-7b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00000007,
    output_cost_per_token: 0.00000028,
    displayName: "Mistral 7b Instruct",
  },
  "mixtral-8x7b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00000007,
    output_cost_per_token: 0.00000028,
    displayName: "Mixtral 8x7B Instruct",
  },
  "mixtral-8x22b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000001,
    output_cost_per_token: 0.000001,
    displayName: "Mixtral 8x22B Instruct",
  },
  "mixtral-8x7b-32768": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00000027,
    output_cost_per_token: 0.00000027,
    displayName: "Mixtral 8x7B 32768",
  },
  "gemma-7b-it": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000001,
    output_cost_per_token: 0.0000001,
    displayName: "Gemma 7b IT",
  },
  "mistralai/Mistral-7B-Instruct-v0.1": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000002,
    output_cost_per_token: 0.0000002,
    displayName: "Mistral 7b Intruct v0.1",
  },
  "mistralai/mixtral-8x7b-32kseqlen": {
    format: "openai",
    flavor: "completion",
    input_cost_per_token: 0.00000006,
    output_cost_per_token: 0.00000006,
    displayName: "Mixtral 8x7B 32k",
  },
  "mistralai/Mixtral-8x7B-Instruct-v0.1": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000006,
    output_cost_per_token: 0.0000006,
    displayName: "Mixtral 8x7B Instruct v0.1",
  },
  "mistralai/Mixtral-8x7B-Instruct-v0.1-json": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000006,
    output_cost_per_token: 0.0000006,
    displayName: "Mixtral 8x7B Instruct v0.1 JSON",
  },
  "mistralai/Mixtral-8x22B": {
    format: "openai",
    flavor: "completion",
    input_cost_per_token: 0.00000108,
    output_cost_per_token: 0.00000108,
    displayName: "Mixtral 8x22B",
  },
  "mistralai/Mixtral-8x22B-Instruct-v0.1": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000012,
    output_cost_per_token: 0.0000012,
    displayName: "Mixtral 8x22B Instruct",
  },
  "meta-llama/Llama-2-70b-chat-hf": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000009,
    output_cost_per_token: 0.0000009,
    displayName: "LLaMA 2 70b Chat HF",
  },
  "meta-llama/Meta-Llama-3-70B": {
    format: "openai",
    flavor: "completion",
    input_cost_per_token: 0.0000009,
    output_cost_per_token: 0.0000009,
    displayName: "LLaMA 3 70b",
  },
  "meta-llama/Llama-3-70b-chat-hf": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000009,
    output_cost_per_token: 0.0000009,
    displayName: "LLaMA 3 70b Chat HF",
  },
  "meta-llama/Llama-3-8b-hf": {
    format: "openai",
    flavor: "completion",
    input_cost_per_token: 0.0000002,
    output_cost_per_token: 0.0000002,
    displayName: "LLaMA 3 8b HF",
  },
  "meta-llama/Llama-3-8b-chat-hf": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000002,
    output_cost_per_token: 0.0000002,
    displayName: "LLaMA 3 8b Chat HF",
  },
  "NousResearch/Nous-Hermes-2-Yi-34B": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000008,
    output_cost_per_token: 0.0000008,
    displayName: "Nous Hermes 2 Yi 34B",
  },
  "deepseek-ai/deepseek-coder-33b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000008,
    output_cost_per_token: 0.0000008,
    displayName: "Deepseek Coder 33b Instruct",
  },
  "llama-3-8b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000002,
    output_cost_per_token: 0.0000002,
    displayName: "LLaMA 3 8b Instruct",
  },
  "llama-3-70b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000001,
    output_cost_per_token: 0.000001,
    displayName: "LLaMA 3 70b Instruct",
  },
  "codellama-70b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000007,
    output_cost_per_token: 0.0000028,
    displayName: "LLaMA Code 70b Instruct",
  },
  mistral: {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0,
    output_cost_per_token: 0.0,
    displayName: "Mistral",
  },
  "mistral-tiny": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00000015,
    output_cost_per_token: 0.00000046,
    displayName: "Mistral Tiny",
  },
  "mistral-small": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000002,
    output_cost_per_token: 0.000006,
    displayName: "Mistral Small",
  },
  "mistral-medium": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000027,
    output_cost_per_token: 0.0000081,
    displayName: "Mistral Medium",
  },
  "openhermes-2-mistral-7b": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000002,
    output_cost_per_token: 0.0000002,
    displayName: "OpenHermes 2",
  },
  "openhermes-2.5-mistral-7b": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000002,
    output_cost_per_token: 0.0000002,
    displayName: "OpenHermes 2.5",
  },
  "pplx-7b-chat": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00000007,
    output_cost_per_token: 0.00000028,
    displayName: "Perplexity 7b Chat",
  },
  "pplx-70b-chat": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000007,
    output_cost_per_token: 0.0000028,
    displayName: "Perplexity 70b Chat",
  },
  "pplx-7b-online": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000002,
    output_cost_per_token: 0.0000002,
    displayName: "Perplexity 7b Online",
  },
  "pplx-70b-online": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000001,
    output_cost_per_token: 0.000001,
    displayName: "Perplexity 70b Online",
  },
  phi: {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0,
    output_cost_per_token: 0.0,
    displayName: "Phi",
  },
  "gemini-1.5-flash-latest": {
    format: "google",
    flavor: "chat",
    input_cost_per_token: 0.0000007,
    output_cost_per_token: 0.0000021,
    displayName: "Gemini 1.5 Flash Latest",
  },
  "gemini-1.5-pro-latest": {
    format: "google",
    flavor: "chat",
    input_cost_per_token: 0.000007,
    output_cost_per_token: 0.000021,
    displayName: "Gemini 1.5 Pro Latest",
  },
  "gemini-1.0-pro": {
    format: "google",
    flavor: "chat",
    input_cost_per_token: 0.0000005,
    output_cost_per_token: 0.0000015,
    displayName: "Gemini 1.0 Pro",
  },
  "gemini-pro": {
    format: "google",
    flavor: "chat",
    input_cost_per_token: 0.00000025,
    output_cost_per_token: 0.0000005,
    displayName: "Gemini Pro",
  },
  "text-block": {
    format: "js",
    flavor: "completion",
    displayName: "Text-block",
  },
};