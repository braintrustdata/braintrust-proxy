import { z } from "zod";
import type {
  AnyModelParamsType as AnyModelParam,
  ChatCompletionMessageParamType as Message,
  MessageRoleType as MessageRole,
  ModelParamsType as ModelParams,
} from "../src/generated_types";
import {
  ModelFormat,
  ModelEndpointType,
  type ModelName,
  ModelSpec,
  getAvailableModels,
} from "./models";
import { openaiParamsToAnthropicMesssageParams } from "@lib/providers/anthropic";
import { OpenAIChatCompletionCreateParams } from "@types";
import { openaiParamsToGeminiMessageParams } from "@lib/providers/google";

export * from "./secrets";
export * from "./models";
export {
  pcmAudioFormatSchema,
  type PcmAudioFormat,
  mp3BitrateSchema,
  type Mp3Bitrate,
} from "./audio";
export * from "./openai-realtime";

export {
  isImageMediaType,
  isTextBasedMediaType,
  isMediaTypeSupported,
  getSupportedMediaTypes,
  ModelFormatMediaTypes,
  ModelMediaTypeOverrides,
  type TextBasedTextType,
  type ImageMediaType,
} from "./media-types";

export const MessageTypeToMessageType: {
  [messageType in MessageRole]: MessageRole | undefined;
} = {
  system: "system",
  developer: "system",
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
  reasoning_effort: "reasoning_effort",
  reasoning_enabled: "reasoning_enabled",
  reasoning_budget: "reasoning_budget",
  verbosity: "verbosity",
  stop: null,
};

const paramMappers: Partial<
  Record<
    ModelFormat,
    (
      params: OpenAIChatCompletionCreateParams,
      modelSpec?: ModelSpec | null,
    ) => object
  >
> = {
  anthropic: openaiParamsToAnthropicMesssageParams,
  google: openaiParamsToGeminiMessageParams,
};

export const sliderSpecs: {
  // min, max, step, required
  [name: string]: [number, number, number, boolean];
} = {
  temperature: [0, 2, 0.01, false],
  top_p: [0, 1, 0.01, false],
  topP: [0, 1, 0.01, false],
  max_tokens: [1, 32768, 1, false],
  maxOutputTokens: [1, 32768, 1, true],
  frequency_penalty: [0, 1, 0.01, false],
  presence_penalty: [0, 1, 0.01, false],
  top_k: [1, 100, 1, false],
  topK: [1, 100, 1, false],
};

// Format-specific slider specification overrides
const formatSpecificSliderSpecs: {
  [format in ModelFormat]?: {
    [paramName: string]: [number, number, number, boolean];
  };
} = {
  anthropic: {
    temperature: [0, 1, 0.01, false],
  },
  converse: {
    temperature: [0, 1, 0.01, false],
  },
};

/**
 * Get slider specifications for a parameter, with format-specific overrides
 * @param format - The model format (openai, anthropic, google, etc.)
 * @param paramName - The parameter name (temperature, max_tokens, etc.)
 * @returns Slider spec as [min, max, step, required] or undefined if not found
 */
export function getSliderSpecs(
  format: ModelFormat,
  paramName: string,
): [number, number, number, boolean] | undefined {
  const formatOverrides = formatSpecificSliderSpecs[format];
  if (formatOverrides && formatOverrides[paramName]) {
    return formatOverrides[paramName];
  }

  return sliderSpecs[paramName];
}

// These values resemble the default values in OpenAI's playground and Anthropic's docs.
// Even though some of them are not set, it's useful for the "greyed out" placeholders.
export const defaultModelParamSettings: {
  [name in ModelFormat]: ModelParams;
} = {
  openai: {
    temperature: undefined,
    max_tokens: undefined,
    top_p: undefined,
    frequency_penalty: 0,
    presence_penalty: 0,
    response_format: null,
    stop: undefined,
    use_cache: true,
    reasoning_effort: "medium",
    verbosity: "medium",
  },
  anthropic: {
    temperature: undefined,
    max_tokens: undefined,
    top_p: undefined,
    top_k: undefined,
    use_cache: true,
    reasoning_enabled: false,
    reasoning_budget: undefined,
    verbosity: undefined,
  },
  google: {
    temperature: undefined,
    maxOutputTokens: undefined,
    topP: undefined,
    topK: undefined,
    use_cache: true,
    reasoning_enabled: false,
    reasoning_budget: undefined,
    verbosity: undefined,
  },
  js: {},
  window: {
    temperature: undefined,
    topK: 5,
  },
  converse: {
    temperature: undefined,
    max_tokens: undefined,
    top_p: undefined,
    use_cache: true,
  },
};

export const modelProviderHasTools: {
  [name in ModelFormat]: boolean;
} = {
  openai: true,
  anthropic: true,
  google: true,
  js: false,
  window: false,
  converse: true,
};

export const modelProviderHasReasoning: {
  [name in ModelFormat]?: RegExp;
} = {
  openai: /^(o[1-4])|(gpt-5)/i,
  anthropic: /^claude-3\.7/i,
  google: /gemini-2.0-flash$|gemini-2.5/i,
  js: undefined,
  window: undefined,
  converse: undefined,
};

export const DefaultEndpointTypes: {
  [name in ModelFormat]: ModelEndpointType[];
} = {
  openai: ["openai", "azure"],
  anthropic: ["anthropic"],
  google: ["google"],
  js: ["js"],
  window: ["js"],
  converse: ["bedrock"],
};

export const AvailableEndpointTypes: { [name: string]: ModelEndpointType[] } = {
  "gpt-35-turbo": ["azure"],
  "gpt-35-turbo-16k": ["azure"],
  sonar: ["perplexity"],
  "sonar-pro": ["perplexity"],
  "sonar-reasoning": ["perplexity"],
  "sonar-reasoning-pro": ["perplexity"],
  "r1-1776": ["perplexity"],
  "meta/llama-2-70b-chat": ["replicate"],
  "mistralai/Mistral-7B-Instruct-v0.1": ["together"],
  "mistralai/Mixtral-8x22B": ["together"],
  "mistralai/Mixtral-8x22B-Instruct-v0.1": ["together"],
  "mistralai/mixtral-8x7b-32kseqlen": ["together"],
  "mistralai/Mixtral-8x7B-Instruct-v0.1": ["together"],
  "mistralai/Mixtral-8x7B-Instruct-v0.1-json": ["together"],
  "mistralai/Mistral-Small-24B-Instruct-2501": ["together"],
  "mistralai/Mistral-7B-Instruct-v0.3": ["together"],
  "mistralai/Mistral-7B-Instruct-v0.2": ["together"],
  "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8": ["together"],
  "meta-llama/Llama-4-Scout-17B-16E-Instruct": ["together"],
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
  "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free": ["together"],
  "meta-llama/Llama-Vision-Free": ["together"],
  "meta-llama/Meta-Llama-3-70B-Instruct-Turbo": ["together"],
  "meta-llama/Meta-Llama-3-70B-Instruct-Lite": ["together"],
  "meta-llama/Meta-Llama-3-8B-Instruct-Turbo": ["together"],
  "meta-llama/Meta-Llama-3-8B-Instruct-Lite": ["together"],
  "deepseek-ai/DeepSeek-V3": ["together"],
  "deepseek-ai/DeepSeek-R1": ["together"],
  "deepseek-ai/DeepSeek-R1-Distill-Llama-70B": ["together"],
  "deepseek-ai/DeepSeek-R1-Distill-Llama-70B-Free": ["together"],
  "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B": ["together"],
  "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B": ["together"],
  "deepseek-ai/deepseek-llm-67b-chat": ["together"],
  "Qwen/Qwen2.5-72B-Instruct-Turbo": ["together"],
  "Qwen/Qwen2.5-7B-Instruct-Turbo": ["together"],
  "Qwen/Qwen2.5-Coder-32B-Instruct": ["together"],
  "Qwen/QwQ-32B-Preview": ["together"],
  "Qwen/QwQ-32B": ["together"],
  "Qwen/Qwen2-VL-72B-Instruct": ["together"],
  "Qwen/Qwen2-72B-Instruct": ["together"],
  "google/gemma-2-27b-it": ["together"],
  "google/gemma-2-9b-it": ["together"],
  "google/gemma-2b-it": ["together"],
  "nvidia/Llama-3.1-Nemotron-70B-Instruct-HF": ["together"],
  "microsoft/WizardLM-2-8x22B": ["together"],
  "databricks/dbrx-instruct": ["together"],
  "NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO": ["together"],
  "Gryphe/MythoMax-L2-13b": ["together"],
  "Gryphe/MythoMax-L2-13b-Lite": ["together"],
  "magistral-medium-latest": ["mistral"],
  "magistral-medium-2506": ["mistral"],
  "magistral-small-latest": ["mistral"],
  "magistral-small-2506": ["mistral"],
  "devstral-small-latest": ["mistral"],
  "devstral-small-2507": ["mistral"],
  "mistral-large-latest": ["mistral"],
  "open-mistral-nemo": ["mistral"],
  "codestral-latest": ["mistral"],
  "open-mixtral-8x22b": ["mistral"],
  "open-codestral-mamba": ["mistral"],
  "mistral-saba-latest": ["mistral"],
  "mistral-saba-2502": ["mistral"],
  "mistral-tiny": ["mistral"],
  "mistral-small": ["mistral"],
  "mistral-medium": ["mistral"],
  "pixtral-12b-2409": ["mistral"],
  "mistral-large-2411": ["mistral"],
  "pixtral-large-latest": ["mistral"],
  "mistral-medium-latest": ["mistral"],
  "mistral-medium-2505": ["mistral"],
  "pixtral-large-2411": ["mistral", "vertex"],
  "mistral-small-latest": ["mistral"],
  "mistral-small-2501": ["mistral"],
  "codestral-2501": ["mistral"],
  "ministral-8b-latest": ["mistral"],
  "ministral-8b-2410": ["mistral"],
  "ministral-3b-latest": ["mistral"],
  "ministral-3b-2410": ["mistral"],
  "open-mistral-nemo-2407": ["mistral"],
  mistral: ["ollama"],
  phi: ["ollama"],
  "meta-llama/llama-4-maverick-17b-128e-instruct": ["groq"],
  "meta-llama/llama-4-scout-17b-16e-instruct": ["groq"],
  "llama-3.3-70b-versatile": ["groq"],
  "llama-3.1-8b-instant": ["groq"],
  "llama-3.1-70b-versatile": ["groq"],
  "llama-3.1-405b-reasoning": ["groq"],
  "llama3-8b-8192": ["groq"],
  "llama3-70b-8192": ["groq"],
  "llama2-70b-4096": ["groq"],
  "mistral-saba-24b": ["groq"],
  "mixtral-8x7b-32768": ["groq"],
  "gemma-7b-it": ["groq"],
  "deepseek-r1-distill-llama-70b": ["groq", "cerebras"],
  "gemma2-9b-it": ["groq"],
  "llama-3.3-70b-specdec": ["groq"],
  "llama-3.2-90b-vision-preview": ["groq"],
  "llama-3.2-11b-vision-preview": ["groq"],
  "llama-3.2-3b-preview": ["groq"],
  "llama-3.2-1b-preview": ["groq"],
  "llama-guard-3-8b": ["groq"],
  "deepseek-r1-distill-llama-70b-specdec": ["groq"],
  "deepseek-r1-distill-qwen-32b": ["groq"],
  "qwen/qwen3-32b": ["groq"],
  "moonshotai/kimi-k2-instruct-0905": ["groq"],
  "qwen-2.5-32b": ["groq"],
  "qwen-2.5-coder-32b": ["groq"],
  "qwen-qwq-32b": ["groq"],
  "llama3-3-70b": ["lepton"],
  "llama3-2-3b": ["lepton"],
  "llama3-2-1b": ["lepton"],
  "llama3-1-70b": ["lepton"],
  "llama3-1-8b": ["lepton"],
  "llama3-70b": ["lepton"],
  "llama3-8b": ["lepton"],
  "mistral-7b": ["lepton"],
  "mixtral-8x7b": ["lepton"],
  "wizardlm-2-7b": ["lepton"],
  "wizardlm-2-8x22b": ["lepton"],
  "nous-hermes-llama2-13b": ["lepton"],
  "dolphin-mixtral-8x7b": ["lepton"],
  "llama-4-scout-17b-16e-instruct": ["cerebras"],
  "llama3.1-8b": ["cerebras"],
  "llama3.3-70b": ["cerebras"],
  "accounts/fireworks/models/llama4-maverick-instruct-basic": ["fireworks"],
  "accounts/fireworks/models/llama4-scout-instruct-basic": ["fireworks"],
  "accounts/fireworks/models/llama-v3p3-70b-instruct": ["fireworks"],
  "accounts/fireworks/models/llama-v3p2-3b-instruct": ["fireworks"],
  "accounts/fireworks/models/llama-v3p1-8b-instruct": ["fireworks"],
  "accounts/fireworks/models/llama-v3p2-11b-vision-instruct": ["fireworks"],
  "accounts/fireworks/models/llama-v3p1-70b-instruct": ["fireworks"],
  "accounts/fireworks/models/llama-v3p2-90b-vision-instruct": ["fireworks"],
  "accounts/fireworks/models/llama-v3p1-405b-instruct": ["fireworks"],
  "accounts/fireworks/models/qwen2p5-coder-32b-instruct": ["fireworks"],
  "accounts/fireworks/models/mixtral-8x22b-instruct": ["fireworks"],
  "accounts/fireworks/models/deepseek-v3": ["fireworks"],
  "accounts/fireworks/models/deepseek-v3-0324": ["fireworks"],
  "accounts/fireworks/models/deepseek-r1": ["fireworks"],
  "accounts/fireworks/models/deepseek-r1-basic": ["fireworks"],
  "accounts/fireworks/models/llama-v3p1-405b-instruct-long": ["fireworks"],
  "accounts/fireworks/models/qwen2p5-72b-instruct": ["fireworks"],
  "accounts/fireworks/models/qwen-qwq-32b-preview": ["fireworks"],
  "accounts/fireworks/models/qwq-32b": ["fireworks"],
  "accounts/fireworks/models/qwen2-vl-72b-instruct": ["fireworks"],
  "accounts/fireworks/models/qwen3-coder-480b-a35b-instruct": ["fireworks"],
  "accounts/fireworks/models/qwen3-235b-a22b": ["fireworks"],
  "accounts/fireworks/models/qwen3-30b-a3b": ["fireworks"],
  "accounts/fireworks/models/deepseek-v3p2": ["fireworks"],
  "accounts/fireworks/models/kimi-k2-thinking": ["fireworks"],
  "accounts/fireworks/models/mistral-small-24b-instruct-2501": ["fireworks"],
  "accounts/fireworks/models/mixtral-8x7b-instruct": ["fireworks"],
  "accounts/fireworks/models/phi-3-vision-128k-instruct": ["fireworks"],
  "anthropic.claude-sonnet-4-5-20250929-v1:0": ["bedrock"],
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0": ["bedrock"],
  "anthropic.claude-sonnet-4-20250514-v1:0": ["bedrock"],
  "us.anthropic.claude-sonnet-4-20250514-v1:0": ["bedrock"],
  "anthropic.claude-3-7-sonnet-20250219-v1:0": ["bedrock"],
  "us.anthropic.claude-3-7-sonnet-20250219-v1:0": ["bedrock"],
  "anthropic.claude-haiku-4-5-20251001-v1:0": ["bedrock"],
  "us.anthropic.claude-haiku-4-5-20251001-v1:0": ["bedrock"],
  "anthropic.claude-3-5-haiku-20241022-v1:0": ["bedrock"],
  "us.anthropic.claude-3-5-haiku-20241022-v1:0": ["bedrock"],
  "anthropic.claude-3-5-sonnet-20241022-v2:0": ["bedrock"],
  "us.anthropic.claude-3-5-sonnet-20241022-v2:0": ["bedrock"],
  "apac.anthropic.claude-3-5-sonnet-20241022-v2:0": ["bedrock"],
  "anthropic.claude-3-5-sonnet-20240620-v1:0": ["bedrock"],
  "us.anthropic.claude-3-5-sonnet-20240620-v1:0": ["bedrock"],
  "apac.anthropic.claude-3-5-sonnet-20240620-v1:0": ["bedrock"],
  "eu.anthropic.claude-3-5-sonnet-20240620-v1:0": ["bedrock"],
  "anthropic.claude-opus-4-20250514-v1:0": ["bedrock"],
  "us.anthropic.claude-opus-4-20250514-v1:0": ["bedrock"],
  "anthropic.claude-3-opus-20240229-v1:0": ["bedrock"],
  "us.anthropic.claude-3-opus-20240229-v1:0": ["bedrock"],
  "anthropic.claude-3-sonnet-20240229-v1:0": ["bedrock"],
  "us.anthropic.claude-3-sonnet-20240229-v1:0": ["bedrock"],
  "apac.anthropic.claude-3-sonnet-20240229-v1:0": ["bedrock"],
  "eu.anthropic.claude-3-sonnet-20240229-v1:0": ["bedrock"],
  "anthropic.claude-3-haiku-20240307-v1:0": ["bedrock"],
  "us.anthropic.claude-3-haiku-20240307-v1:0": ["bedrock"],
  "apac.anthropic.claude-3-haiku-20240307-v1:0": ["bedrock"],
  "eu.anthropic.claude-3-haiku-20240307-v1:0": ["bedrock"],
  "anthropic.claude-opus-4-5-20251101-v1:0": ["bedrock"],
  "us.anthropic.claude-opus-4-5-20251101-v1:0": ["bedrock"],
  "anthropic.claude-opus-4-1-20250805-v1:0": ["bedrock"],
  "us.anthropic.claude-opus-4-1-20250805-v1:0": ["bedrock"],
  "amazon.nova-pro-v1:0": ["bedrock"],
  "amazon.nova-lite-v1:0": ["bedrock"],
  "amazon.nova-micro-v1:0": ["bedrock"],
  "grok-4-1-fast": ["xAI"],
  "grok-4-1-fast-reasoning": ["xAI"],
  "grok-4-1-fast-reasoning-latest": ["xAI"],
  "grok-4-1-fast-non-reasoning": ["xAI"],
  "grok-4-1-fast-non-reasoning-latest": ["xAI"],
  "grok-4-fast-reasoning": ["xAI"],
  "grok-4-fast-reasoning-latest": ["xAI"],
  "grok-4-fast-non-reasoning": ["xAI"],
  "grok-4-fast-non-reasoning-latest": ["xAI"],
  "grok-4": ["xAI"],
  "grok-4-latest": ["xAI"],
  "grok-4-0709": ["xAI"],
  "grok-2-vision": ["xAI"],
  "grok-2-vision-latest": ["xAI"],
  "grok-2-vision-1212": ["xAI"],
  "grok-2": ["xAI"],
  "grok-2-latest": ["xAI"],
  "grok-2-1212": ["xAI"],
  "grok-vision-beta": ["xAI"],
  "grok-beta": ["xAI"],
  "fireworks-ai-4.1b-to-16b": ["fireworks"],
  "fireworks-ai-56b-to-176b": ["fireworks"],
  "fireworks-ai-above-16b": ["fireworks"],
  "fireworks-ai-default": ["fireworks"],
  "fireworks-ai-embedding-150m-to-350m": ["fireworks"],
  "fireworks-ai-embedding-up-to-150m": ["fireworks"],
  "fireworks-ai-moe-up-to-56b": ["fireworks"],
  "fireworks-ai-up-to-4b": ["fireworks"],
  "fireworks_ai/WhereIsAI/UAE-Large-V1": ["fireworks"],
  "fireworks_ai/accounts/fireworks/models/deepseek-coder-v2-instruct": [
    "fireworks",
  ],
  "fireworks_ai/accounts/fireworks/models/deepseek-r1": ["fireworks"],
  "fireworks_ai/accounts/fireworks/models/deepseek-r1-0528": ["fireworks"],
  "fireworks_ai/accounts/fireworks/models/deepseek-r1-basic": ["fireworks"],
  "fireworks_ai/accounts/fireworks/models/deepseek-v3": ["fireworks"],
  "fireworks_ai/accounts/fireworks/models/deepseek-v3-0324": ["fireworks"],
  "fireworks_ai/accounts/fireworks/models/deepseek-v3p1": ["fireworks"],
  "fireworks_ai/accounts/fireworks/models/firefunction-v2": ["fireworks"],
  "fireworks_ai/accounts/fireworks/models/glm-4p5": ["fireworks"],
  "fireworks_ai/accounts/fireworks/models/glm-4p5-air": ["fireworks"],
  "fireworks_ai/accounts/fireworks/models/gpt-oss-120b": ["fireworks"],
  "fireworks_ai/accounts/fireworks/models/gpt-oss-20b": ["fireworks"],
  "accounts/fireworks/models/kimi-k2p5": ["fireworks"],
  "fireworks_ai/accounts/fireworks/models/kimi-k2-instruct": ["fireworks"],
  "fireworks_ai/accounts/fireworks/models/llama-v3p1-405b-instruct": [
    "fireworks",
  ],
  "fireworks_ai/accounts/fireworks/models/llama-v3p1-8b-instruct": [
    "fireworks",
  ],
  "fireworks_ai/accounts/fireworks/models/llama-v3p2-11b-vision-instruct": [
    "fireworks",
  ],
  "fireworks_ai/accounts/fireworks/models/llama-v3p2-1b-instruct": [
    "fireworks",
  ],
  "fireworks_ai/accounts/fireworks/models/llama-v3p2-3b-instruct": [
    "fireworks",
  ],
  "fireworks_ai/accounts/fireworks/models/llama-v3p2-90b-vision-instruct": [
    "fireworks",
  ],
  "fireworks_ai/accounts/fireworks/models/llama4-maverick-instruct-basic": [
    "fireworks",
  ],
  "fireworks_ai/accounts/fireworks/models/llama4-scout-instruct-basic": [
    "fireworks",
  ],
  "fireworks_ai/accounts/fireworks/models/mixtral-8x22b-instruct-hf": [
    "fireworks",
  ],
  "fireworks_ai/accounts/fireworks/models/qwen2-72b-instruct": ["fireworks"],
  "fireworks_ai/accounts/fireworks/models/qwen2p5-coder-32b-instruct": [
    "fireworks",
  ],
  "fireworks_ai/accounts/fireworks/models/yi-large": ["fireworks"],
  "fireworks_ai/nomic-ai/nomic-embed-text-v1": ["fireworks"],
  "fireworks_ai/nomic-ai/nomic-embed-text-v1.5": ["fireworks"],
  "fireworks_ai/thenlper/gte-base": ["fireworks"],
  "fireworks_ai/thenlper/gte-large": ["fireworks"],
  "grok-3": ["xAI"],
  "grok-3-latest": ["xAI"],
  "grok-3-beta": ["xAI"],
  "grok-3-fast-beta": ["xAI"],
  "grok-3-fast-latest": ["xAI"],
  "grok-3-mini": ["xAI"],
  "grok-3-mini-latest": ["xAI"],
  "grok-3-mini-fast": ["xAI"],
  "grok-3-mini-fast-latest": ["xAI"],
  "grok-3-mini-beta": ["xAI"],
  "grok-3-mini-fast-beta": ["xAI"],
  "grok-code-fast-1": ["xAI"],
  "grok-code-fast": ["xAI"],
  "grok-code-fast-1-0825": ["xAI"],
  "gemini-3-pro-image-preview": ["google"],
  "gemini-3-flash-preview": ["google"],
  "publishers/google/models/gemini-3-pro-preview": ["vertex"],
  "publishers/google/models/gemini-3-flash-preview": ["vertex"],
  "publishers/google/models/gemini-3-pro-image-preview": ["vertex"],
  "publishers/google/models/gemini-2.5-pro": ["vertex"],
  "publishers/google/models/gemini-2.5-pro-preview-05-06": ["vertex"],
  "publishers/google/models/gemini-2.5-pro-preview-03-25": ["vertex"],
  "publishers/google/models/gemini-2.5-pro-exp-03-25": ["vertex"],
  "publishers/google/models/gemini-2.5-flash": ["vertex"],
  "publishers/google/models/gemini-2.5-flash-preview-05-20": ["vertex"],
  "publishers/google/models/gemini-2.5-flash-preview-04-17": ["vertex"],
  "publishers/google/models/gemini-2.5-flash-lite": ["vertex"],
  "publishers/google/models/gemini-2.5-flash-lite-preview-06-17": ["vertex"],
  "publishers/google/models/gemini-2.0-flash-thinking-exp-01-21": ["vertex"],
  "publishers/google/models/gemini-2.0-flash": ["vertex"],
  "publishers/google/models/gemini-2.0-flash-001": ["vertex"],
  "publishers/google/models/gemini-2.0-flash-lite": ["vertex"],
  "publishers/google/models/gemini-2.0-flash-lite-001": ["vertex"],
  "publishers/google/models/gemini-2.0-flash-lite-preview-02-05": ["vertex"],
  "publishers/google/models/gemini-1.5-pro": ["vertex"],
  "publishers/google/models/gemini-1.5-pro-002": ["vertex"],
  "publishers/google/models/gemini-1.5-pro-001": ["vertex"],
  "publishers/google/models/gemini-1.5-flash": ["vertex"],
  "publishers/google/models/gemini-1.5-flash-002": ["vertex"],
  "publishers/google/models/gemini-1.5-flash-001": ["vertex"],
  "publishers/google/models/gemini-1.0-pro-vision": ["vertex"],
  "publishers/google/models/gemini-1.0-pro-vision-001": ["vertex"],
  "publishers/google/models/gemini-1.0-pro": ["vertex"],
  "publishers/google/models/gemini-1.0-pro-002": ["vertex"],
  "publishers/google/models/gemini-1.0-pro-001": ["vertex"],
  "publishers/meta/models/llama-3.3-70b-instruct-maas": ["vertex"],
  "publishers/meta/models/llama-3.2-90b-vision-instruct-maas": ["vertex"],
  "publishers/meta/models/llama-3.1-401b-instruct-maas": ["vertex"],
  "publishers/meta/models/llama-3.1-70b-instruct-maas": ["vertex"],
  "publishers/meta/models/llama-3.1-8b-instruct-maas": ["vertex"],
  "publishers/mistralai/models/mistral-large-2411": ["vertex"],
  "publishers/mistralai/models/mistral-nemo": ["vertex"],
  "publishers/mistralai/models/codestral-2501": ["vertex"],
  "publishers/anthropic/models/claude-sonnet-4-5": ["vertex"],
  "publishers/anthropic/models/claude-sonnet-4-5@20250929": ["vertex"],
  "publishers/anthropic/models/claude-sonnet-4": ["vertex"],
  "publishers/anthropic/models/claude-sonnet-4@20250514": ["vertex"],
  "publishers/anthropic/models/claude-3-7-sonnet": ["vertex"],
  "publishers/anthropic/models/claude-3-7-sonnet@20250219": ["vertex"],
  "publishers/anthropic/models/claude-haiku-4-5": ["vertex"],
  "publishers/anthropic/models/claude-haiku-4-5@20251001": ["vertex"],
  "publishers/anthropic/models/claude-3-5-haiku": ["vertex"],
  "publishers/anthropic/models/claude-3-5-haiku@20241022": ["vertex"],
  "publishers/anthropic/models/claude-3-5-sonnet-v2": ["vertex"],
  "publishers/anthropic/models/claude-3-5-sonnet-v2@20241022": ["vertex"],
  "publishers/anthropic/models/claude-3-5-sonnet": ["vertex"],
  "publishers/anthropic/models/claude-3-5-sonnet@20240620": ["vertex"],
  "publishers/anthropic/models/claude-opus-4-5@20251101": ["vertex"],
  "publishers/anthropic/models/claude-opus-4-1@20250805": ["vertex"],
  "publishers/anthropic/models/claude-opus-4": ["vertex"],
  "publishers/anthropic/models/claude-opus-4@20250514": ["vertex"],
  "publishers/anthropic/models/claude-3-opus": ["vertex"],
  "publishers/anthropic/models/claude-3-opus@20240229": ["vertex"],
  "publishers/anthropic/models/claude-3-haiku": ["vertex"],
  "publishers/anthropic/models/claude-3-haiku@20240307": ["vertex"],
  "databricks-claude-3-7-sonnet": ["databricks"],
  "databricks-meta-llama-3-3-70b-instruct": ["databricks"],
  "databricks-meta-llama-3-1-405b-instruct": ["databricks"],
  "databricks-meta-llama-3-1-8b-instruct": ["databricks"],
  "openai/gpt-oss-120b": ["together", "groq", "baseten"],
  "openai/gpt-oss-20b": ["groq"], // NOTE: We use groq pricing for this and Together pricing for the 120B model
  "accounts/fireworks/models/gpt-oss-120b": ["fireworks"],
  "accounts/fireworks/models/gpt-oss-20b": ["fireworks"],
  "gpt-oss-120b": ["cerebras"],
  "Qwen3-Coder-480B-A35B-Instruct": ["baseten"],
  "moonshotai/Kimi-K2-Instruct": ["baseten"],
  "deepseek-ai/DeepSeek-V3-0324": ["baseten"],
};

export function getModelEndpointTypes(model: string): ModelEndpointType[] {
  return (
    AvailableEndpointTypes[model] ||
    (getAvailableModels()[model] &&
      DefaultEndpointTypes[getAvailableModels()[model].format]) ||
    []
  );
}

export const AISecretTypes: { [keyName: string]: ModelEndpointType } = {
  OPENAI_API_KEY: "openai",
  ANTHROPIC_API_KEY: "anthropic",
  GEMINI_API_KEY: "google",
  MISTRAL_API_KEY: "mistral",
  TOGETHER_API_KEY: "together",
  FIREWORKS_API_KEY: "fireworks",
  PERPLEXITY_API_KEY: "perplexity",
  XAI_API_KEY: "xAI",
  GROQ_API_KEY: "groq",
  LEPTON_API_KEY: "lepton",
  CEREBRAS_API_KEY: "cerebras",
  REPLICATE_API_KEY: "replicate",
  BASETEN_API_KEY: "baseten",
};

export const CloudSecretTypes: { [keyName: string]: ModelEndpointType } = {
  AWS_DEFAULT_CREDENTIALS: "bedrock",
  GOOGLE_DEFAULT_CREDENTIALS: "vertex",
  AZURE_DEFAULT_CREDENTIALS: "azure",
  DATABRICKS_DEFAULT_CREDENTIALS: "databricks",
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
  baseten: "https://inference.baseten.co/v1",
  cerebras: "https://api.cerebras.ai/v1",
  xAI: "https://api.x.ai/v1",
  bedrock: null,
  vertex: null,
  azure: null,
  databricks: null,
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
  modelSpec?: ModelSpec | null,
): Record<string, unknown> {
  let translatedParams: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(params || {})) {
    const safeValue = v ?? undefined; // Don't propagate "null" along
    const translatedKey = modelParamToModelParam[k as keyof ModelParams] as
      | keyof ModelParams
      | undefined
      | null;

    if (translatedKey === null) {
      continue;
    }

    const hasDefaultParam =
      translatedKey !== undefined &&
      Object.prototype.hasOwnProperty.call(
        defaultModelParamSettings[toProvider] ?? {},
        translatedKey,
      );

    translatedParams[hasDefaultParam ? translatedKey : k] = safeValue;
  }

  // ideally we should short circuit and just have a master mapper but this avoids scope
  // for now
  const mapper = paramMappers[toProvider];
  if (mapper) {
    translatedParams = mapper(
      translatedParams as unknown as OpenAIChatCompletionCreateParams,
      modelSpec,
    ) as unknown as Record<string, unknown>;
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
