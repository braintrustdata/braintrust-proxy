import { z } from "zod";
import type {
  AnyModelParam,
  Message,
  MessageRole,
  ModelParams,
} from "@braintrust/core/typespecs";

export * from "./secrets";

export type PromptInputType = "completion" | "chat";

export type ModelFormat = "openai" | "anthropic" | "google" | "js";
export const ModelEndpointType = [
  "openai",
  "azure",
  "google",
  "bedrock",
  "perplexity",
  "replicate",
  "anthropic",
  "together",
  "mistral",
  "ollama",
  "groq",
  "js",
] as const;
export type ModelEndpointType = (typeof ModelEndpointType)[number];

export interface ModelSpec {
  format: ModelFormat;
  flavor: PromptInputType;
  multimodal?: boolean;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
}

export const MessageTypes: { [name in ModelFormat]: MessageRole[] } = {
  openai: ["system", "user", "assistant" /*, "function" */],
  anthropic: ["system", "user", "assistant"],
  google: ["user", "model"],
  js: ["system"],
};

export const MessageTypeToMessageType: {
  [messageType in MessageRole]: MessageRole | undefined;
} = {
  system: undefined,
  function: undefined,
  tool: undefined,
  user: "user",
  assistant: "assistant",
  model: "assistant",
};

export const defaultModelParams: { [name in ModelFormat]: ModelParams } = {
  openai: {
    temperature: 0,
    max_tokens: 1024,
    use_cache: true,
  },
  anthropic: {
    temperature: 0,
    max_tokens: 1024,
    use_cache: true,
  },
  google: {
    temperature: 0,
    maxOutputTokens: 1024,
    use_cache: true,
  },
  js: {},
};

export const modelParamToModelParam: {
  [name: string]: keyof AnyModelParam | null;
} = {
  temperature: "temperature",
  top_p: "top_p",
  max_tokens: "max_tokens",
  max_tokens_to_sample: null,
  use_cache: "use_cache",
  maxOutputTokens: "max_tokens",
  topP: "top_p",
  topK: "top_k",
  tool_choice: null,
  function_call: null,
  n: null,
  logprobs: null,
  stream_options: null,
};

export const sliderSpecs: {
  // min, max, step, required
  [name: string]: [number, number, number, boolean];
} = {
  temperature: [0, 1, 0.01, false],
  top_p: [0, 1, 0.01, false],
  max_tokens: [1, 10240, 1, false],
  maxOutputTokens: [1, 10240, 1, true],
  frequency_penalty: [0, 1, 0.01, false],
  presence_penalty: [0, 1, 0.01, false],
  top_k: [1, 100, 1, true],
};

// These values resemble the default values in OpenAI's playground and Anthropic's docs.
// Even though some of them are not set, it's useful for the "greyed out" placeholders.
export const defaultModelParamSettings: {
  [name in ModelFormat]: ModelParams;
} = {
  openai: {
    temperature: 0,
    max_tokens: 1024,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    response_format: null,
    use_cache: true,
  },
  anthropic: {
    temperature: 0,
    max_tokens: 1024,
    top_p: 0.7,
    top_k: 5,
    use_cache: true,
  },
  google: {
    temperature: 0,
    maxOutputTokens: 1024,
    topP: 0.7,
    topK: 5,
    use_cache: true,
  },
  js: {},
};

export const modelProviderHasTools: {
  [name in ModelFormat]: boolean;
} = {
  openai: true,
  anthropic: false,
  google: false,
  js: false,
};

export const AvailableModels: { [name: string]: ModelSpec } = {
  "gpt-3.5-turbo": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000005,
    output_cost_per_token: 0.0000015,
  },
  "gpt-35-turbo": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000005,
    output_cost_per_token: 0.0000015,
  },
  "gpt-3.5-turbo-0125": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000005,
    output_cost_per_token: 0.0000015,
  },
  "gpt-3.5-turbo-1106": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000001,
    output_cost_per_token: 0.000002,
  },
  "gpt-3.5-turbo-16k": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000004,
  },
  "gpt-35-turbo-16k": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000004,
  },
  "gpt-4": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00003,
    output_cost_per_token: 0.00006,
  },
  "gpt-4o": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.000015,
  },
  "gpt-4o-2024-05-13": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.000015,
  },
  "gpt-4-32k": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00006,
    output_cost_per_token: 0.00012,
  },
  "gpt-4-vision-preview": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00003,
  },
  "gpt-4-1106-vision-preview": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00003,
  },
  "gpt-4-turbo": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00003,
  },
  "gpt-4-turbo-2024-04-09": {
    format: "openai",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00003,
  },
  "gpt-4-turbo-preview": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00003,
  },
  "gpt-4-0125-preview": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00003,
  },
  "gpt-4-1106-preview": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00003,
  },
  "gpt-3.5-turbo-0613": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000015,
    output_cost_per_token: 0.000002,
  },
  "gpt-3.5-turbo-16k-0613": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000004,
  },
  "gpt-3.5-turbo-0301": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000015,
    output_cost_per_token: 0.000002,
  },
  "gpt-4-0613": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00003,
    output_cost_per_token: 0.00006,
  },
  "gpt-4-32k-0613": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00006,
    output_cost_per_token: 0.00012,
  },
  "gpt-4-0314": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00003,
    output_cost_per_token: 0.00006,
  },
  "gpt-4-32k-0314": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00006,
    output_cost_per_token: 0.00012,
  },
  "gpt-3.5-turbo-instruct": {
    format: "openai",
    flavor: "completion",
    input_cost_per_token: 0.0000015,
    output_cost_per_token: 0.000002,
  },
  "gpt-3.5-turbo-instruct-0914": {
    format: "openai",
    flavor: "completion",
    input_cost_per_token: 0.0000015,
    output_cost_per_token: 0.000002,
  },
  "text-davinci-003": {
    format: "openai",
    flavor: "completion",
    input_cost_per_token: 0.000002,
    output_cost_per_token: 0.000002,
  },
  "claude-2": {
    format: "anthropic",
    flavor: "chat",
    input_cost_per_token: 0.000008,
    output_cost_per_token: 0.000024,
  },
  "claude-instant-1": {
    format: "anthropic",
    flavor: "chat",
    input_cost_per_token: 0.0000008,
    output_cost_per_token: 0.0000024,
  },
  "claude-2.0": {
    format: "anthropic",
    flavor: "chat",
    input_cost_per_token: 0.000008,
    output_cost_per_token: 0.000024,
  },
  "claude-2.1": {
    format: "anthropic",
    flavor: "chat",
    input_cost_per_token: 0.000008,
    output_cost_per_token: 0.000024,
  },
  "claude-instant-1.2": {
    format: "anthropic",
    flavor: "chat",
    input_cost_per_token: 0.0000008,
    output_cost_per_token: 0.0000024,
  },
  "claude-3-opus-20240229": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.000015,
    output_cost_per_token: 0.000075,
  },
  "claude-3-sonnet-20240229": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
  },
  "claude-3-haiku-20240307": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.00000025,
    output_cost_per_token: 0.00000125,
  },
  "anthropic.claude-3-opus-20240229-v1:0": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.000015,
    output_cost_per_token: 0.000075,
  },
  "anthropic.claude-3-haiku-20240307-v1:0": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.00000025,
    output_cost_per_token: 0.00000125,
  },
  "anthropic.claude-3-sonnet-20240229-v1:0": {
    format: "anthropic",
    flavor: "chat",
    multimodal: true,
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
  },
  "meta/llama-2-70b-chat": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00000065,
    output_cost_per_token: 0.00000275,
  },
  "llama-2-70b-chat": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000001,
    output_cost_per_token: 0.000001,
  },
  "llama-2-13b-chat": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00000014,
    output_cost_per_token: 0.00000056,
  },
  "llama3-8b-8192": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000001,
    output_cost_per_token: 0.0000001,
  },
  "llama3-70b-8192": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00000064,
    output_cost_per_token: 0.0000008,
  },
  "llama2-70b-4096": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000007,
    output_cost_per_token: 0.0000008,
  },
  "codellama-34b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00000035,
    output_cost_per_token: 0.0000014,
  },
  "mistral-7b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00000007,
    output_cost_per_token: 0.00000028,
  },
  "mixtral-8x7b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00000007,
    output_cost_per_token: 0.00000028,
  },
  "mixtral-8x22b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000001,
    output_cost_per_token: 0.000001,
  },
  "mixtral-8x7b-32768": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00000027,
    output_cost_per_token: 0.00000027,
  },
  "gemma-7b-it": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000001,
    output_cost_per_token: 0.0000001,
  },
  "mistralai/Mistral-7B-Instruct-v0.1": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000002,
    output_cost_per_token: 0.0000002,
  },
  "mistralai/mixtral-8x7b-32kseqlen": {
    format: "openai",
    flavor: "completion",
    input_cost_per_token: 0.00000006,
    output_cost_per_token: 0.00000006,
  },
  "mistralai/Mixtral-8x7B-Instruct-v0.1": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000006,
    output_cost_per_token: 0.0000006,
  },
  "mistralai/Mixtral-8x22B": {
    format: "openai",
    flavor: "completion",
    input_cost_per_token: 0.00000108,
    output_cost_per_token: 0.00000108,
  },
  "mistralai/Mixtral-8x22B-Instruct-v0.1": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000012,
    output_cost_per_token: 0.0000012,
  },
  "meta-llama/Llama-2-70b-chat-hf": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000009,
    output_cost_per_token: 0.0000009,
  },
  "meta-llama/Meta-Llama-3-70B": {
    format: "openai",
    flavor: "completion",
    input_cost_per_token: 0.0000009,
    output_cost_per_token: 0.0000009,
  },
  "meta-llama/Llama-3-70b-chat-hf": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000009,
    output_cost_per_token: 0.0000009,
  },
  "meta-llama/Llama-3-8b-hf": {
    format: "openai",
    flavor: "completion",
    input_cost_per_token: 0.0000002,
    output_cost_per_token: 0.0000002,
  },
  "meta-llama/Llama-3-8b-chat-hf": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000002,
    output_cost_per_token: 0.0000002,
  },
  "NousResearch/Nous-Hermes-2-Yi-34B": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000008,
    output_cost_per_token: 0.0000008,
  },
  "deepseek-ai/deepseek-coder-33b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000008,
    output_cost_per_token: 0.0000008,
  },
  "llama-3-8b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000002,
    output_cost_per_token: 0.0000002,
  },
  "llama-3-70b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000001,
    output_cost_per_token: 0.000001,
  },
  "codellama-70b-instruct": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000007,
    output_cost_per_token: 0.0000028,
  },
  mistral: {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0,
    output_cost_per_token: 0.0,
  },
  "mistral-tiny": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00000015,
    output_cost_per_token: 0.00000046,
  },
  "mistral-small": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000002,
    output_cost_per_token: 0.000006,
  },
  "mistral-medium": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000027,
    output_cost_per_token: 0.0000081,
  },
  "openhermes-2-mistral-7b": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000002,
    output_cost_per_token: 0.0000002,
  },
  "openhermes-2.5-mistral-7b": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000002,
    output_cost_per_token: 0.0000002,
  },
  "pplx-7b-chat": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.00000007,
    output_cost_per_token: 0.00000028,
  },
  "pplx-70b-chat": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000007,
    output_cost_per_token: 0.0000028,
  },
  "pplx-7b-online": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0000002,
    output_cost_per_token: 0.0000002,
  },
  "pplx-70b-online": {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.000001,
    output_cost_per_token: 0.000001,
  },
  phi: {
    format: "openai",
    flavor: "chat",
    input_cost_per_token: 0.0,
    output_cost_per_token: 0.0,
  },
  "gemini-1.5-flash-latest": {
    format: "google",
    flavor: "chat",
    input_cost_per_token: 0.0000007,
    output_cost_per_token: 0.0000021,
  },
  "gemini-1.5-pro-latest": {
    format: "google",
    flavor: "chat",
    input_cost_per_token: 0.000007,
    output_cost_per_token: 0.000021,
  },
  "gemini-1.0-pro": {
    format: "google",
    flavor: "chat",
    input_cost_per_token: 0.0000005,
    output_cost_per_token: 0.0000015,
  },
  "gemini-pro": {
    format: "google",
    flavor: "chat",
    input_cost_per_token: 0.00000025,
    output_cost_per_token: 0.0000005,
  },
  "text-block": { format: "js", flavor: "completion" },
};

export const DefaultEndpointTypes: {
  [name in ModelFormat]: ModelEndpointType[];
} = {
  openai: ["openai", "azure"],
  anthropic: ["anthropic"],
  google: ["google"],
  js: ["js"],
};

export const AvailableEndpointTypes: { [name: string]: ModelEndpointType[] } = {
  "gpt-35-turbo": ["azure"],
  "gpt-35-turbo-16k": ["azure"],
  "llama-2-70b-chat": ["perplexity"],
  "llama-2-13b-chat": ["perplexity"],
  "llama-3-8b-instruct": ["perplexity"],
  "llama-3-70b-instruct": ["perplexity"],
  "codellama-70b-instruct": ["perplexity"],
  "codellama-34b-instruct": ["perplexity"],
  "mistral-7b-instruct": ["perplexity"],
  "mixtral-8x7b-instruct": ["perplexity"],
  "mixtral-8x22b-instruct": ["perplexity"],
  "openhermes-2-mistral-7b": ["perplexity"],
  "openhermes-2.5-mistral-7b": ["perplexity"],
  "pplx-7b-chat": ["perplexity"],
  "pplx-70b-chat": ["perplexity"],
  "pplx-7b-online": ["perplexity"],
  "pplx-70b-online": ["perplexity"],
  "meta/llama-2-70b-chat": ["replicate"],
  "mistralai/Mistral-7B-Instruct-v0.1": ["together"],
  "mistralai/Mixtral-8x22B": ["together"],
  "mistralai/Mixtral-8x22B-Instruct-v0.1": ["together"],
  "mistralai/mixtral-8x7b-32kseqlen": ["together"],
  "mistralai/Mixtral-8x7B-Instruct-v0.1": ["together"],
  "meta-llama/Llama-2-70b-chat-hf": ["together"],
  "meta-llama/Meta-Llama-3-70B": ["together"],
  "meta-llama/Llama-3-70b-chat-hf": ["together"],
  "meta-llama/Llama-3-8b-hf": ["together"],
  "meta-llama/Llama-3-8b-chat-hf": ["together"],
  "NousResearch/Nous-Hermes-2-Yi-34B": ["together"],
  "deepseek-ai/deepseek-coder-33b-instruct": ["together"],
  mistral: ["ollama"],
  "mistral-tiny": ["mistral"],
  "mistral-small": ["mistral"],
  "mistral-medium": ["mistral"],
  phi: ["ollama"],
  "llama3-8b-8192": ["groq"],
  "llama3-70b-8192": ["groq"],
  "llama2-70b-4096": ["groq"],
  "mixtral-8x7b-32768": ["groq"],
  "gemma-7b-it": ["groq"],
  "anthropic.claude-3-opus-20240229-v1:0": ["bedrock"],
  "anthropic.claude-3-haiku-20240307-v1:0": ["bedrock"],
  "anthropic.claude-3-sonnet-20240229-v1:0": ["bedrock"],
};

export function getModelEndpointTypes(model: string): ModelEndpointType[] {
  return (
    AvailableEndpointTypes[model] ||
    (AvailableModels[model] &&
      DefaultEndpointTypes[AvailableModels[model].format]) ||
    []
  );
}

export const AISecretTypes: { [keyName: string]: ModelEndpointType } = {
  OPENAI_API_KEY: "openai",
  ANTHROPIC_API_KEY: "anthropic",
  PERPLEXITY_API_KEY: "perplexity",
  REPLICATE_API_KEY: "replicate",
  TOGETHER_API_KEY: "together",
  GOOGLE_API_KEY: "google",
  MISTRAL_API_KEY: "mistral",
  OLLAMA_API_KEY: "ollama",
  GROQ_API_KEY: "groq",
};

export const EndpointProviderToBaseURL: {
  [name in ModelEndpointType]: string | null;
} = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  perplexity: "https://api.perplexity.ai",
  replicate: "https://openai-proxy.replicate.com/v1",
  together: "https://api.together.xyz/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  mistral: "https://api.mistral.ai/v1",
  ollama: "http://127.0.0.1:11434/v1",
  groq: "https://api.groq.com/openai/v1",
  bedrock: null,
  azure: null,
  js: null,
};

export function buildClassicChatPrompt(messages: Message[]) {
  return (
    messages
      .map(
        ({ content, role }) => `<|im_start|>${role}
${content}<|im_end|>`,
      )
      .join("\n") + "\n<|im_start|>assistant"
  );
}

export function translateParams(
  toProvider: ModelFormat,
  params: Record<string, string>,
): Record<string, unknown> {
  const translatedParams: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params || {})) {
    const safeValue = v ?? undefined; // Don't propagate "null" along
    const translatedKey = modelParamToModelParam[k as keyof ModelParams] as
      | keyof ModelParams
      | undefined
      | null;
    if (translatedKey === null) {
      continue;
    } else if (
      translatedKey !== undefined &&
      defaultModelParamSettings[toProvider][translatedKey] !== undefined
    ) {
      translatedParams[translatedKey] = safeValue;
    } else {
      translatedParams[k] = safeValue;
    }
  }

  return translatedParams;
}

export const anthropicSupportedMediaTypes = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

export const anthropicTextBlockSchema = z.object({
  type: z.literal("text").optional(),
  text: z.string().default(""),
});
export const anthropicImageBlockSchema = z.object({
  type: z.literal("image").optional(),
  source: z.object({
    type: z.enum(["base64"]).optional(),
    media_type: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]),
    data: z.string().default(""),
  }),
});
const anthropicContentBlockSchema = z.union([
  anthropicTextBlockSchema,
  anthropicImageBlockSchema,
]);
const anthropicContentBlocksSchema = z.array(anthropicContentBlockSchema);
const anthropicContentSchema = z.union([
  z.string().default(""),
  anthropicContentBlocksSchema,
]);

export type AnthropicImageBlock = z.infer<typeof anthropicImageBlockSchema>;
export type AnthropicContent = z.infer<typeof anthropicContentSchema>;
