import { z } from "zod";
import type {
  AnyModelParam,
  Message,
  MessageRole,
  ModelParams,
} from "@braintrust/core/typespecs";
import { AvailableModels, ModelFormat } from "./models";

export * from "./secrets";
export * from "./models";
export {
  pcmAudioFormatSchema,
  type PcmAudioFormat,
  mp3BitrateSchema,
  type Mp3Bitrate,
} from "./audio";
export * from "./openai-realtime";

export const ModelEndpointType = [
  "openai",
  "azure",
  "google",
  "bedrock",
  "perplexity",
  "replicate",
  "anthropic",
  "together",
  "lepton",
  "fireworks",
  "cerebras",
  "mistral",
  "ollama",
  "groq",
  "xAI",
  "js",
] as const;
export type ModelEndpointType = (typeof ModelEndpointType)[number];

export const MessageTypeToMessageType: {
  [messageType in MessageRole]: MessageRole | undefined;
} = {
  system: "system",
  function: undefined,
  tool: "tool",
  user: "user",
  assistant: "assistant",
  model: "assistant",
};

export const modelParamToModelParam: {
  [name: string]: keyof AnyModelParam | null;
} = {
  temperature: "temperature",
  top_p: "top_p",
  top_k: "top_k",
  max_tokens: "max_tokens",
  max_tokens_to_sample: null,
  use_cache: "use_cache",
  maxOutputTokens: "max_tokens",
  topP: "top_p",
  topK: "top_k",
  presence_penalty: null,
  frequency_penalty: null,
  user: null,
  function_call: null,
  n: null,
  logprobs: null,
  stream_options: null,
  parallel_tool_calls: null,
  response_format: null,
};

export const sliderSpecs: {
  // min, max, step, required
  [name: string]: [number, number, number, boolean];
} = {
  temperature: [0, 1, 0.01, false],
  top_p: [0, 1, 0.01, false],
  topP: [0, 1, 0.01, false],
  max_tokens: [1, 10240, 1, false],
  maxOutputTokens: [1, 10240, 1, true],
  frequency_penalty: [0, 1, 0.01, false],
  presence_penalty: [0, 1, 0.01, false],
  top_k: [1, 100, 1, true],
  topK: [1, 100, 1, true],
};

// These values resemble the default values in OpenAI's playground and Anthropic's docs.
// Even though some of them are not set, it's useful for the "greyed out" placeholders.
export const defaultModelParamSettings: {
  [name in ModelFormat]: ModelParams;
} = {
  openai: {
    temperature: undefined,
    max_tokens: undefined,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    response_format: null,
    use_cache: true,
  },
  anthropic: {
    temperature: undefined,
    max_tokens: undefined,
    top_p: 0.7,
    top_k: 5,
    use_cache: true,
  },
  google: {
    temperature: undefined,
    maxOutputTokens: undefined,
    topP: 0.7,
    topK: 5,
    use_cache: true,
  },
  js: {},
  window: {
    temperature: undefined,
    topK: 5,
  },
};

export const modelProviderHasTools: {
  [name in ModelFormat]: boolean;
} = {
  openai: true,
  anthropic: true,
  google: false,
  js: false,
  window: false,
};

export const DefaultEndpointTypes: {
  [name in ModelFormat]: ModelEndpointType[];
} = {
  openai: ["openai", "azure"],
  anthropic: ["anthropic"],
  google: ["google"],
  js: ["js"],
  window: ["js"],
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
  "mistralai/Mixtral-8x7B-Instruct-v0.1-json": ["together"],
  "meta-llama/Llama-2-70b-chat-hf": ["together"],
  "meta-llama/Meta-Llama-3-70B": ["together"],
  "meta-llama/Llama-3-70b-chat-hf": ["together"],
  "meta-llama/Llama-3-8b-hf": ["together"],
  "meta-llama/Llama-3-8b-chat-hf": ["together"],
  "meta-llama/Llama-3.2-3B-Instruct-Turbo": ["together"],
  "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo": ["together"],
  "meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo": ["together"],
  "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo": ["together"],
  "meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo": ["together"],
  "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo": ["together"],
  "NousResearch/Nous-Hermes-2-Yi-34B": ["together"],
  "deepseek-ai/deepseek-coder-33b-instruct": ["together"],
  "meta-llama/Llama-3.3-70B-Instruct-Turbo": ["together"],
  "mistral-large-latest": ["mistral"],
  "open-mistral-nemo": ["mistral"],
  "codestral-latest": ["mistral"],
  "open-mixtral-8x22b": ["mistral"],
  "open-codestral-mamba": ["mistral"],
  "mistral-tiny": ["mistral"],
  "mistral-small": ["mistral"],
  "mistral-medium": ["mistral"],
  "pixtral-12b-2409": ["mistral"],
  mistral: ["ollama"],
  phi: ["ollama"],
  "llama-3.1-8b-instant": ["groq"],
  "llama-3.1-70b-versatile": ["groq"],
  "llama-3.1-405b-reasoning": ["groq"],
  "llama3-8b-8192": ["groq"],
  "llama3-70b-8192": ["groq"],
  "llama2-70b-4096": ["groq"],
  "mixtral-8x7b-32768": ["groq"],
  "gemma-7b-it": ["groq"],
  "llama3-1-405b": ["lepton"],
  "llama3-1-70b": ["lepton"],
  "llama3-1-8b": ["lepton"],
  "llama3.1-8b": ["cerebras"],
  "llama3.1-70b": ["cerebras"],
  "accounts/fireworks/models/llama-v3p2-3b-instruct": ["fireworks"],
  "accounts/fireworks/models/llama-v3p1-8b-instruct": ["fireworks"],
  "accounts/fireworks/models/llama-v3p2-11b-vision-instruct": ["fireworks"],
  "accounts/fireworks/models/llama-v3p1-70b-instruct": ["fireworks"],
  "accounts/fireworks/models/llama-v3p2-90b-vision-instruct": ["fireworks"],
  "accounts/fireworks/models/llama-v3p1-405b-instruct": ["fireworks"],
  "anthropic.claude-3-5-sonnet-20241022-v2:0": ["bedrock"],
  "anthropic.claude-3-opus-20240229-v1:0": ["bedrock"],
  "anthropic.claude-3-haiku-20240307-v1:0": ["bedrock"],
  "anthropic.claude-3-sonnet-20240229-v1:0": ["bedrock"],
  "anthropic.claude-3-5-sonnet-20240620-v1:0": ["bedrock"],
  "amazon.nova-pro-v1:0": ["bedrock"],
  "amazon.nova-lite-v1:0": ["bedrock"],
  "amazon.nova-micro-v1:0": ["bedrock"],
  "grok-beta": ["xAI"],
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
  LEPTON_API_KEY: "lepton",
  FIREWORKS_API_KEY: "fireworks",
  GOOGLE_API_KEY: "google",
  MISTRAL_API_KEY: "mistral",
  OLLAMA_API_KEY: "ollama",
  GROQ_API_KEY: "groq",
  CEREBRAS_API_KEY: "cerebras",
  XAI_API_KEY: "xAI",
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
  lepton: "https://<model>.lepton.run/api/v1/", // As far as I can tell, this works for all models
  fireworks: "https://api.fireworks.ai/inference/v1",
  cerebras: "https://api.cerebras.ai/v1",
  xAI: "https://api.x.ai/v1",
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
  params: Record<string, unknown>,
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
