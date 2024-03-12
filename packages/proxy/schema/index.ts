import {
  ChatCompletionCreateParams,
  ChatCompletionMessage,
  ChatCompletionMessageToolCall,
} from "openai/resources";
import { z } from "zod";

export * from "./secrets";

export type PromptInputType = "completion" | "chat";

export type ModelFormat = "openai" | "anthropic" | "google" | "js";
export const ModelEndpointType = [
  "openai",
  "azure",
  "google",
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
}

export const roleSchema = z.enum([
  "system",
  "user",
  "assistant",
  "function",
  "tool",
  "model",
]);
export type Role = z.infer<typeof roleSchema>;

export const MessageTypes: { [name in ModelFormat]: Role[] } = {
  openai: ["system", "user", "assistant" /*, "function" */],
  anthropic: ["system", "user", "assistant"],
  google: ["user", "model"],
  js: ["system"],
};

export const functionCallSchema = z.object({
  name: z.string(),
  arguments: z.string(),
});

const toolCallSchema = z.object({
  id: z.string(),
  function: z.object({
    arguments: z.string(),
    name: z.string(),
  }),
  type: z.literal("function"),
});

export const messageSchema = z.object({
  content: z.string().default(""),
  role: roleSchema,
  name: z.string().optional(),
  function_call: z.union([z.string(), functionCallSchema]).optional(),
  tool_calls: z.array(toolCallSchema).optional(),
});

export type Message = z.infer<typeof messageSchema>;

export type FunctionDef = ChatCompletionCreateParams.Function;

export const MessageTypeToMessageType: {
  [messageType in Role]: Role | undefined;
} = {
  system: undefined,
  function: undefined,
  tool: undefined,
  user: "user",
  assistant: "assistant",
  model: "assistant",
};

interface BrainTrustModelParams {
  use_cache?: boolean;
}

// https://platform.openai.com/docs/api-reference/chat/create
export interface OpenAIModelParams {
  temperature: number;
  top_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  response_format?: null | { type: "json_object" };
  tool_choice?:
    | "auto"
    | "none"
    | { type: "function"; function: { name: string } };
}

// https://docs.anthropic.com/claude/reference/complete_post
interface AnthropicModelParams {
  max_tokens_to_sample: number;
  temperature: number;
  top_p?: number;
  top_k?: number;
}

export interface GoogleModelParams {
  temperature: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
}

interface JSCompletionParams {}

const braintrustModelParamsSchema = z.object({
  use_cache: z.boolean().optional(),
});

const openAIModelParamsSchema = z.object({
  temperature: z.number(),
  top_p: z.number().optional(),
  max_tokens: z.number().optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  response_format: z
    .union([z.literal(null), z.object({ type: z.literal("json_object") })])
    .optional(),
  tool_choice: z
    .union([
      z.literal("auto"),
      z.literal("none"),
      z.object({
        type: z.literal("function"),
        function: z.object({ name: z.string() }),
      }),
    ])
    .optional(),
});

const anthropicModelParamsSchema = z.object({
  max_tokens_to_sample: z.number(),
  temperature: z.number(),
  top_p: z.number().optional(),
  top_k: z.number().optional(),
});

const googleModelParamsSchema = z.object({
  temperature: z.number(),
  maxOutputTokens: z.number().optional(),
  topP: z.number().optional(),
  topK: z.number().optional(),
});

const jsCompletionParamsSchema = z.object({});
export const modelParamsSchema = braintrustModelParamsSchema.and(
  z.union([
    openAIModelParamsSchema,
    anthropicModelParamsSchema,
    googleModelParamsSchema,
    jsCompletionParamsSchema,
  ]),
);

export type ModelParams = z.infer<typeof modelParamsSchema>;

export const defaultModelParams: { [name in ModelFormat]: ModelParams } = {
  openai: {
    temperature: 0,
    max_tokens: 1024,
    use_cache: true,
  },
  anthropic: {
    temperature: 0,
    max_tokens_to_sample: 1024,
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
  [name in keyof (OpenAIModelParams &
    AnthropicModelParams &
    GoogleModelParams &
    BrainTrustModelParams)]:
    | keyof (OpenAIModelParams & AnthropicModelParams & BrainTrustModelParams)
    | undefined;
} = {
  temperature: "temperature",
  top_p: "top_p",
  max_tokens: "max_tokens",
  max_tokens_to_sample: "max_tokens",
  use_cache: "use_cache",
  maxOutputTokens: "max_tokens",
  topP: "top_p",
  topK: "top_k",
};

export const sliderSpecs: {
  // min, max, step, required
  [name: string]: [number, number, number, boolean];
} = {
  temperature: [0, 1, 0.01, false],
  top_p: [0, 1, 0.01, false],
  max_tokens: [1, 10240, 1, false],
  max_tokens_to_sample: [1, 10240, 1, true],
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
  "gpt-3.5-turbo": { format: "openai", flavor: "chat" },
  "gpt-35-turbo": { format: "openai", flavor: "chat" },
  "gpt-3.5-turbo-0125": { format: "openai", flavor: "chat" },
  "gpt-3.5-turbo-1106": { format: "openai", flavor: "chat" },
  "gpt-3.5-turbo-16k": { format: "openai", flavor: "chat" },
  "gpt-35-turbo-16k": { format: "openai", flavor: "chat" },
  "gpt-4": { format: "openai", flavor: "chat" },
  "gpt-4-32k": { format: "openai", flavor: "chat" },
  "gpt-4-turbo-preview": { format: "openai", flavor: "chat" },
  "gpt-4-0125-preview": { format: "openai", flavor: "chat" },
  "gpt-4-1106-preview": { format: "openai", flavor: "chat" },
  "gpt-3.5-turbo-0613": { format: "openai", flavor: "chat" },
  "gpt-3.5-turbo-16k-0613": { format: "openai", flavor: "chat" },
  "gpt-3.5-turbo-0301": { format: "openai", flavor: "chat" },
  "gpt-4-0613": { format: "openai", flavor: "chat" },
  "gpt-4-32k-0613": { format: "openai", flavor: "chat" },
  "gpt-4-0314": { format: "openai", flavor: "chat" },
  "gpt-4-32k-0314": { format: "openai", flavor: "chat" },
  "gpt-3.5-turbo-instruct": { format: "openai", flavor: "completion" },
  "gpt-3.5-turbo-instruct-0914": { format: "openai", flavor: "completion" },
  "text-davinci-003": { format: "openai", flavor: "completion" },
  "claude-2": { format: "anthropic", flavor: "chat" },
  "claude-instant-1": { format: "anthropic", flavor: "chat" },
  "claude-2.0": { format: "anthropic", flavor: "chat" },
  "claude-2.1": { format: "anthropic", flavor: "chat" },
  "claude-instant-1.2": { format: "anthropic", flavor: "chat" },
  "claude-3-opus-20240229": { format: "anthropic", flavor: "chat" },
  "claude-3-sonnet-20240229": { format: "anthropic", flavor: "chat" },
  "meta/llama-2-70b-chat": { format: "openai", flavor: "chat" },
  "llama-2-70b-chat": { format: "openai", flavor: "chat" },
  "llama-2-13b-chat": { format: "openai", flavor: "chat" },
  "llama2-70b-4096": { format: "openai", flavor: "chat" },
  "codellama-34b-instruct": { format: "openai", flavor: "chat" },
  "mistral-7b-instruct": { format: "openai", flavor: "chat" },
  "mixtral-8x7b-instruct": { format: "openai", flavor: "chat" },
  "mixtral-8x7b-32768": { format: "openai", flavor: "chat" },
  "gemma-7b-it": { format: "openai", flavor: "chat" },
  "mistralai/Mistral-7B-Instruct-v0.1": { format: "openai", flavor: "chat" },
  "mistralai/mixtral-8x7b-32kseqlen": {
    format: "openai",
    flavor: "completion",
  },
  "mistralai/Mixtral-8x7B-Instruct-v0.1": {
    format: "openai",
    flavor: "chat",
  },
  "meta-llama/Llama-2-70b-chat-hf": {
    format: "openai",
    flavor: "chat",
  },
  "NousResearch/Nous-Hermes-2-Yi-34B": {
    format: "openai",
    flavor: "chat",
  },
  "deepseek-ai/deepseek-coder-33b-instruct": {
    format: "openai",
    flavor: "chat",
  },
  mistral: { format: "openai", flavor: "chat" },
  "mistral-tiny": { format: "openai", flavor: "chat" },
  "mistral-small": { format: "openai", flavor: "chat" },
  "mistral-medium": { format: "openai", flavor: "chat" },
  "openhermes-2-mistral-7b": { format: "openai", flavor: "chat" },
  "openhermes-2.5-mistral-7b": { format: "openai", flavor: "chat" },
  "pplx-7b-chat": { format: "openai", flavor: "chat" },
  "pplx-70b-chat": { format: "openai", flavor: "chat" },
  "pplx-7b-online": { format: "openai", flavor: "chat" },
  "pplx-70b-online": { format: "openai", flavor: "chat" },
  phi: { format: "openai", flavor: "chat" },
  "gemini-pro": { format: "google", flavor: "chat" },
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
  "codellama-34b-instruct": ["perplexity"],
  "mistral-7b-instruct": ["perplexity"],
  "mixtral-8x7b-instruct": ["perplexity"],
  "openhermes-2-mistral-7b": ["perplexity"],
  "openhermes-2.5-mistral-7b": ["perplexity"],
  "pplx-7b-chat": ["perplexity"],
  "pplx-70b-chat": ["perplexity"],
  "pplx-7b-online": ["perplexity"],
  "pplx-70b-online": ["perplexity"],
  "meta/llama-2-70b-chat": ["replicate"],
  "mistralai/Mistral-7B-Instruct-v0.1": ["together"],
  "mistralai/mixtral-8x7b-32kseqlen": ["together"],
  "mistralai/Mixtral-8x7B-Instruct-v0.1": ["together"],
  "meta-llama/Llama-2-70b-chat-hf": ["together"],
  "NousResearch/Nous-Hermes-2-Yi-34B": ["together"],
  "deepseek-ai/deepseek-coder-33b-instruct": ["together"],
  mistral: ["ollama"],
  "mistral-tiny": ["mistral"],
  "mistral-small": ["mistral"],
  "mistral-medium": ["mistral"],
  phi: ["ollama"],
  "llama2-70b-4096": ["groq"],
  "mixtral-8x7b-32768": ["groq"],
  "gemma-7b-it": ["groq"],
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
    const translatedKey = modelParamToModelParam[k as keyof ModelParams] as
      | keyof ModelParams
      | undefined;
    if (
      translatedKey !== undefined &&
      defaultModelParamSettings[toProvider][translatedKey] !== undefined
    ) {
      translatedParams[translatedKey] = v;
    } else {
      translatedParams[k] = v;
    }
  }
  return translatedParams;
}
