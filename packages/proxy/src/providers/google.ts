import type { ChatCompletionMessageParamType as Message } from "../generated_types";

import { finishReasonSchema } from "../../types/google";
import type {
  Content,
  ContentUnion,
  ContentListUnion,
  Part,
  FinishReason,
  GenerateContentConfig,
  GenerateContentParameters,
  GenerateContentResponse,
  GenerateContentResponseUsageMetadata,
  ThinkingConfig,
} from "../../types/google";
import type {
  OpenAIChatCompletion,
  OpenAIChatCompletionChoice,
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionCreateParams,
  OpenAICompletionUsage,
} from "../../types";
import { getBudgetMultiplier } from "../../utils";
import { cleanOpenAIParams } from "../../utils/openai";
import { v4 as uuidv4 } from "uuid";
import { getTimestampInSeconds, isEmpty } from "../util";
import { convertMediaToBase64 } from "./util";
import { openApiToJsonSchema as toJsonSchema } from "openapi-json-schema";
import $RefParser from "@apidevtools/json-schema-ref-parser";

async function makeGoogleMediaBlock(media: string): Promise<Part> {
  const { media_type: mimeType, data } = await convertMediaToBase64({
    media,
    allowedMediaTypes: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/heic",
      "image/heif",
      "video/mp4",
      "video/webm",
      "video/mpeg",
      "video/quicktime",
      "video/x-msvideo",
      "audio/mpeg",
      "audio/mp4",
      "audio/wav",
      "audio/webm",
      "application/pdf",
    ],
    maxMediaBytes: null,
  });

  return {
    inlineData: {
      mimeType,
      data,
    },
  };
}

export async function openAIContentToGoogleContent(
  content: Message["content"],
): Promise<Part[]> {
  if (typeof content === "string") {
    return [{ text: content }];
  }
  return Promise.all(
    content?.map(async (part) =>
      part.type === "text"
        ? { text: part.text }
        : await makeGoogleMediaBlock(part.image_url.url),
    ) ?? [],
  );
}

export async function openAIMessagesToGoogleMessages(
  messages: Message[],
): Promise<Content[]> {
  // First, do a basic mapping
  const content: Content[] = await Promise.all(
    messages.map(async (m) => {
      const reasoningParts =
        "reasoning" in m && m.reasoning
          ? m.reasoning.map((r) => ({ text: r.content, thought: true }))
          : [];

      const contentParts =
        m.role === "tool" ? [] : await openAIContentToGoogleContent(m.content);
      const toolCallParts: Part[] =
        m.role === "assistant"
          ? m.tool_calls?.map((t) => ({
              functionCall: {
                name: t.id,
                args: JSON.parse(t.function.arguments),
              },
            })) ?? []
          : [];
      const toolResponseParts: Part[] =
        m.role === "tool"
          ? [
              {
                functionResponse: {
                  name: m.tool_call_id,
                  response: {
                    name: m.tool_call_id,
                    content: m.content,
                  },
                },
              },
            ]
          : [];
      return {
        parts: [
          ...reasoningParts,
          ...contentParts,
          ...toolCallParts,
          ...toolResponseParts,
        ],
        role:
          m.role === "assistant"
            ? "model"
            : m.role === "tool"
              ? "user"
              : m.role,
      };
    }),
  );

  const flattenedContent: Content[] = [];
  for (let i = 0; i < content.length; i++) {
    const last = flattenedContent[flattenedContent.length - 1];
    if (last && last.role === content[i].role) {
      last.parts = [...(last.parts || []), ...(content[i].parts || [])];
    } else {
      flattenedContent.push(content[i]);
    }
  }

  // Finally, sort the messages so that:
  // 1. All images are up front
  // 2. The system prompt.
  // 3. Then all user messages' text parts
  // The EcmaScript spec requires the sort to be stable, so this is safe.
  const sortedContent: Content[] = flattenedContent.sort((a, b) => {
    const aFirst = a.parts?.[0];
    const bFirst = b.parts?.[0];

    if (aFirst?.inlineData && !bFirst?.inlineData) {
      return -1;
    } else if (bFirst?.inlineData && !aFirst?.inlineData) {
      return 1;
    }

    if (a.role === "system" && b.role !== "system") {
      return -1;
    } else if (b.role === "system" && a.role !== "system") {
      return 1;
    }

    return 0;
  });

  return sortedContent;
}

const finishReason = finishReasonSchema.Enum;

function translateFinishReason(
  reason?: FinishReason | null,
): OpenAIChatCompletionChoice["finish_reason"] | null {
  // "length" | "stop" | "tool_calls" | "content_filter" | "function_call"
  switch (reason) {
    case finishReason.MAX_TOKENS:
      return "length";
    case finishReason.SAFETY:
    case finishReason.PROHIBITED_CONTENT:
    case finishReason.SPII:
    case finishReason.BLOCKLIST:
      return "content_filter";
    case finishReason.STOP:
      return "stop";
    case finishReason.RECITATION:
    case finishReason.LANGUAGE:
    case finishReason.OTHER:
    case finishReason.FINISH_REASON_UNSPECIFIED:
    case finishReason.MALFORMED_FUNCTION_CALL:
      return "content_filter";
    case undefined:
    default:
      return null;
  }
  return null;
}

export function googleEventToOpenAIChatEvent(
  model: string,
  data: GenerateContentResponse,
): { event: OpenAIChatCompletionChunk | null; finished: boolean } {
  return {
    event: data.candidates
      ? (() => {
          const usage = geminiUsageToOpenAIUsage(data.usageMetadata);
          const chunk: OpenAIChatCompletionChunk = {
            id: uuidv4(),
            choices: (data.candidates || []).map((candidate) => {
              const firstThought = candidate.content?.parts?.find(
                (part) => part.text !== undefined && part.thought,
              );
              const firstText = candidate.content?.parts?.find(
                (part) => part.text !== undefined && !part.thought,
              );
              const toolCalls =
                candidate.content?.parts
                  ?.filter((part) => part.functionCall !== undefined)
                  .map((part, i) => ({
                    id: uuidv4(),
                    type: "function" as const,
                    function: {
                      name: part?.functionCall?.name,
                      arguments: JSON.stringify(part.functionCall?.args),
                    },
                    index: i,
                  })) || [];
              return {
                index: 0,
                delta: {
                  role: "assistant",
                  content: firstText?.text ?? "",
                  tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                  ...(firstThought && {
                    reasoning: {
                      id: uuidv4(),
                      content: firstThought.text,
                    },
                  }),
                },
                finish_reason:
                  toolCalls.length > 0
                    ? "tool_calls"
                    : translateFinishReason(candidate.finishReason),
              };
            }),
            created: getTimestampInSeconds(),
            model,
            object: "chat.completion.chunk" as const,
          } as OpenAIChatCompletionChunk;

          if (usage) {
            (chunk as any).usage = usage;
          }

          return chunk;
        })()
      : null,
    finished:
      data.candidates?.every(
        (candidate) => candidate.finishReason !== undefined,
      ) ?? false,
  };
}

const geminiUsageToOpenAIUsage = (
  usageMetadata?: GenerateContentResponseUsageMetadata | null,
): OpenAICompletionUsage | undefined => {
  if (!usageMetadata) {
    return undefined;
  }

  const thoughtsTokenCount = usageMetadata.thoughtsTokenCount;
  const cachedContentTokenCount = usageMetadata.cachedContentTokenCount;

  const usage: OpenAICompletionUsage = {
    prompt_tokens: usageMetadata.promptTokenCount || 0,
    completion_tokens: usageMetadata.candidatesTokenCount || 0,
    total_tokens: usageMetadata.totalTokenCount || 0,
  };

  if (thoughtsTokenCount) {
    usage.completion_tokens_details = { reasoning_tokens: thoughtsTokenCount };
  }

  if (cachedContentTokenCount) {
    usage.prompt_tokens_details = { cached_tokens: cachedContentTokenCount };
  }

  return usage;
};

export function googleCompletionToOpenAICompletion(
  model: string,
  data: GenerateContentResponse,
): OpenAIChatCompletion {
  const usage = geminiUsageToOpenAIUsage(data.usageMetadata);
  const completion: OpenAIChatCompletion = {
    id: uuidv4(),
    choices: (data.candidates || []).map((candidate) => {
      const firstText = candidate.content?.parts?.find(
        (part) => part.text !== undefined && !part.thought,
      );
      const firstThought = candidate.content?.parts?.find(
        (part) => part.text !== undefined && part.thought,
      );
      const toolCalls =
        candidate.content?.parts
          ?.filter((part) => part.functionCall !== undefined)
          .map((part) => ({
            id: uuidv4(),
            type: "function" as const,
            function: {
              name: part?.functionCall?.name || "unknown",
              arguments: JSON.stringify(part?.functionCall?.args),
            },
          })) || [];
      return {
        logprobs: null,
        index: "index" in candidate ? candidate.index : 0,
        message: {
          role: "assistant",
          content: firstText?.text ?? "",
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          refusal: null,
          ...(firstThought && {
            reasoning: [{ id: uuidv4(), content: firstThought.text }],
          }),
        },
        finish_reason:
          toolCalls.length > 0
            ? "tool_calls"
            : translateFinishReason(candidate.finishReason) || "stop",
      };
    }),
    created: getTimestampInSeconds(),
    model,
    object: "chat.completion" as const,
  } as OpenAIChatCompletion;

  if (usage) {
    (completion as any).usage = usage;
  }

  return completion;
}

export const OpenAIParamsToGoogleParams: {
  [name: string]: string | null;
} = {
  temperature: "temperature",
  top_p: "topP",
  stop: "stopSequences",
  max_tokens: "maxOutputTokens",
  frequency_penalty: null,
  presence_penalty: null,
  tool_choice: null,
};

// because GenAI sdk doesn't provide a convenient API equivalent type
type GeminiGenerateContentParams = Omit<GenerateContentParameters, "config"> &
  Omit<
    GenerateContentConfig,
    | "httpOptions"
    | "abortSignal"
    | "routingConfig"
    | "modelSelectionConfig"
    | "labels"
  >;

export const openaiParamsToGeminiMessageParams = (
  openai: OpenAIChatCompletionCreateParams,
): GeminiGenerateContentParams => {
  const gemini: GeminiGenerateContentParams = {
    // TODO: we depend on translateParams to get us half way there
    ...(cleanOpenAIParams(openai) as any),
  };

  const maxTokens =
    openai.max_completion_tokens !== undefined ||
    openai.max_tokens !== undefined
      ? Math.max(openai.max_completion_tokens || 0, openai.max_tokens || 0) ||
        1024
      : undefined;

  gemini.maxOutputTokens = maxTokens;

  if (
    openai.reasoning_effort !== undefined ||
    openai.reasoning_budget !== undefined ||
    openai.reasoning_enabled !== undefined
  ) {
    gemini.thinkingConfig = getGeminiThinkingParams({
      ...openai,
      max_completion_tokens: maxTokens,
    });
  }

  return gemini;
};

const getGeminiThinkingParams = (
  openai: OpenAIChatCompletionCreateParams & {
    max_completion_tokens?: Required<number>;
  },
): ThinkingConfig => {
  if (openai.reasoning_enabled === false || openai.reasoning_budget === 0) {
    return {
      thinkingBudget: 0,
    };
  }

  return {
    includeThoughts: true,
    thinkingBudget: getThinkingBudget(openai),
  };
};

const getThinkingBudget = (
  openai: OpenAIChatCompletionCreateParams & {
    max_completion_tokens?: Required<number>;
  },
): number => {
  if (openai.reasoning_budget !== undefined) {
    return openai.reasoning_budget;
  }

  let budget = 1024;

  if (openai.reasoning_effort !== undefined) {
    budget = Math.floor(
      getBudgetMultiplier(openai.reasoning_effort || "low") *
        (openai.max_completion_tokens ?? 1024),
    );
  }

  return budget;
};

export const geminiParamsToOpenAIParams = async (
  params: GenerateContentParameters,
): Promise<OpenAIChatCompletionCreateParams> => {
  const thinkingBudget = params.config?.thinkingConfig?.thinkingBudget || 0;
  const tools = await geminiParamsToOpenAITools(params);

  // Map responseMimeType to response_format
  let responseFormat = undefined;
  if (params.config?.responseSchema) {
    // Use structured output if response schema is provided
    responseFormat = {
      type: "json_schema" as const,
      json_schema: {
        name: "response",
        schema: params.config.responseSchema as Record<string, unknown>,
        strict: true,
      },
    };
  } else if (params.config?.responseMimeType === "application/json") {
    responseFormat = { type: "json_object" as const };
  }

  // Map toolConfig to tool_choice
  let toolChoice:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } }
    | undefined = undefined;
  if (params.config?.toolConfig?.functionCallingConfig) {
    const mode = params.config.toolConfig.functionCallingConfig.mode;
    switch (mode) {
      case "AUTO":
        toolChoice = "auto" as const;
        break;
      case "ANY":
        toolChoice = "required" as const;
        break;
      case "NONE":
        toolChoice = "none" as const;
        break;
    }

    // Handle specific function names
    const allowedNames =
      params.config.toolConfig.functionCallingConfig.allowedFunctionNames;
    if (allowedNames && allowedNames.length === 1 && tools) {
      toolChoice = {
        type: "function" as const,
        function: { name: allowedNames[0] },
      };
    }
  }

  return {
    // model
    model: params.model,

    // contents
    messages: geminiParamsToOpenAIMessages(params),

    // config
    n: params.config?.candidateCount,
    top_p: params.config?.topP,
    max_completion_tokens: params.config?.maxOutputTokens,
    stop: params.config?.stopSequences,
    top_logprobs: params.config?.logprobs,
    temperature: params.config?.temperature,
    reasoning_enabled: thinkingBudget > 0,
    reasoning_budget: thinkingBudget,
    presence_penalty: params.config?.presencePenalty,
    frequency_penalty: params.config?.frequencyPenalty,
    seed: params.config?.seed,
    response_format: responseFormat,
    tools: tools,
    tool_choice: toolChoice,
    logprobs: params.config?.responseLogprobs,
  };
};

export const geminiParamsToOpenAIMessages = (
  params: GenerateContentParameters,
): OpenAIChatCompletionCreateParams["messages"] => {
  const messages: OpenAIChatCompletionCreateParams["messages"] = [];

  // Add system instruction if present
  if (params.config?.systemInstruction) {
    const systemContent = convertContentToString(
      params.config.systemInstruction,
    );
    if (systemContent) {
      messages.push({
        role: "system",
        content: systemContent,
      });
    }
  }

  // Convert contents to messages
  const contents = normalizeContents(params.contents);
  for (const content of contents) {
    const message = convertGeminiContentToOpenAIMessage(content);
    if (message) {
      messages.push(message);
    }
  }

  return messages;
};

export const geminiParamsToOpenAITools = async (
  params: GenerateContentParameters,
): Promise<OpenAIChatCompletionCreateParams["tools"]> => {
  const tools: OpenAIChatCompletionCreateParams["tools"] = [];

  // Convert function declarations from tools
  if (params.config?.tools) {
    const toolsList = Array.isArray(params.config.tools)
      ? params.config.tools
      : [params.config.tools];

    for (const tool of toolsList) {
      if (tool.functionDeclarations) {
        for (const funcDecl of tool.functionDeclarations) {
          // Skip functions without names as they're required by OpenAI
          if (!funcDecl.name) continue;

          let parameters = {};
          if (!isEmpty(funcDecl.parameters)) {
            parameters = await fromOpenAPIToJSONSchema(funcDecl.parameters);
          } else if (!isEmpty(funcDecl.parametersJsonSchema)) {
            parameters = funcDecl.parametersJsonSchema;
          }

          tools.push({
            type: "function",
            function: {
              name: funcDecl.name,
              description: funcDecl.description ?? undefined,
              parameters,
            },
          });
        }
      }
      // Note: Other tool types like retrieval, codeExecution, etc. are not directly mappable to OpenAI
    }
  }

  // Handle response schema as a structured output tool if present
  if (params.config?.responseSchema) {
    const schema =
      typeof params.config.responseSchema === "object"
        ? params.config.responseSchema
        : undefined;

    if (schema) {
      tools.push({
        type: "function",
        function: {
          name: "structured_output",
          description: "Structured output response",
          parameters: await fromOpenAPIToJSONSchema(schema),
        },
      });
    }
  }

  return tools.length > 0 ? tools : undefined;
};

export const fromOpenAPIToJSONSchema = async (schema: any): Promise<any> => {
  try {
    // First, resolve any $ref references in the schema
    let resolvedSchema = schema;

    if (schema && typeof schema === "object") {
      try {
        // Dereference the schema to resolve $ref and $defs
        resolvedSchema = await $RefParser.dereference(structuredClone(schema), {
          resolve: { http: false, file: false },
        });

        // Remove x-$defs if present as it's not valid for Gemini
        if ("x-$defs" in resolvedSchema) {
          delete resolvedSchema["x-$defs"];
        }
        // Remove $defs after dereferencing as they're no longer needed
        if ("$defs" in resolvedSchema) {
          delete resolvedSchema["$defs"];
        }
      } catch (refError) {
        // If ref resolution fails, continue with original schema
        console.warn("Failed to dereference schema:", refError);
      }
    }

    // Normalize the schema
    const normalizedSchema = normalizeOpenAISchema(resolvedSchema);

    // Try to convert from OpenAPI to JSON Schema
    try {
      const result = toJsonSchema(normalizedSchema);
      // Remove the $schema field that toJsonSchema adds
      if (result && typeof result === "object" && "$schema" in result) {
        const { $schema, ...rest } = result;
        return rest;
      }
      return result;
    } catch {
      // If conversion fails, return the normalized schema
      return normalizedSchema;
    }
  } catch {
    return schema;
  }
};

// defensive coding here. we want to guard against unexpected values
export function normalizeOpenAISchema(schema: any): any {
  if (schema === null || schema === undefined) {
    return undefined;
  }

  if (Array.isArray(schema)) {
    return schema
      .map(normalizeOpenAISchema)
      .filter((item) => item !== undefined);
  }

  if (typeof schema !== "object") {
    return schema;
  }

  const result: any = {};

  for (const [key, value] of Object.entries(schema)) {
    // types undefined/null values are unusual
    if ((value ?? null) === null) {
      continue;
    }

    // types are enum and must be lower case
    if (key === "type" && typeof value === "string") {
      result[key] = value.toLowerCase();
    } else if (typeof value === "object") {
      const processed = normalizeOpenAISchema(value);
      if (
        processed !== undefined &&
        !(
          typeof processed === "object" &&
          !Array.isArray(processed) &&
          Object.keys(processed).length === 0
        )
      ) {
        result[key] = processed;
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

// Helper function to normalize contents into an array of Content objects
const normalizeContents = (contents: ContentListUnion): Content[] => {
  // Handle single Content object
  if (isContent(contents)) {
    return [contents];
  }

  // Handle array of Content objects
  if (Array.isArray(contents)) {
    // Check if array contains only Parts (no Content objects)
    const hasContentObjects = contents.some((item) => isContent(item));

    if (!hasContentObjects) {
      // All items are Parts or strings - group them into a single user message
      const parts: Part[] = [];
      for (const item of contents) {
        if (isPart(item)) {
          parts.push(item);
        } else if (typeof item === "string") {
          parts.push({ text: item });
        }
      }
      if (parts.length > 0) {
        return [{ role: "user", parts }];
      }
      return [];
    }

    // Mix of Content objects and Parts - handle individually
    const result: Content[] = [];
    for (const item of contents) {
      if (isContent(item)) {
        result.push(item);
      } else if (isPart(item)) {
        // Convert Part to Content with user role
        result.push({
          role: "user",
          parts: [item],
        });
      } else if (typeof item === "string") {
        // Convert string to Content with user role
        result.push({
          role: "user",
          parts: [{ text: item }],
        });
      }
    }
    return result;
  }

  // Handle single Part or string
  if (isPart(contents) || typeof contents === "string") {
    return [
      {
        role: "user",
        parts: isPart(contents) ? [contents] : [{ text: contents }],
      },
    ];
  }

  return [];
};

// Helper function to check if an object is a Content
const isContent = (obj: any): obj is Content => {
  return obj && typeof obj === "object" && "parts" in obj;
};

// Helper function to check if an object is a Part
const isPart = (obj: any): obj is Part => {
  return (
    obj &&
    typeof obj === "object" &&
    ("text" in obj ||
      "functionCall" in obj ||
      "function_call" in obj ||
      "functionResponse" in obj ||
      "function_response" in obj ||
      "inlineData" in obj ||
      "inline_data" in obj ||
      "fileData" in obj ||
      "file_data" in obj ||
      "executableCode" in obj ||
      "executable_code" in obj ||
      "codeExecutionResult" in obj ||
      "code_execution_result" in obj ||
      "image_url" in obj ||
      "imageUrl" in obj) // Support hybrid format with OpenAI-style image_url and imageUrl
  );
};

// Convert Gemini Content to OpenAI message
const convertGeminiContentToOpenAIMessage = (content: Content): any | null => {
  // Handle function responses as tool messages first
  if (content.parts) {
    const part = content.parts.find((p) => p.functionResponse);
    if (part?.functionResponse) {
      return {
        role: "tool",
        tool_call_id:
          part.functionResponse.id || part.functionResponse.name || "unknown",
        content: JSON.stringify(part.functionResponse.response || {}),
      };
    }
  }

  const role = mapGeminiRoleToOpenAI(content.role);

  // Handle function calls for assistant messages before checking content
  if (role === "assistant" && content.parts) {
    const toolCalls = extractToolCalls(content.parts);
    if (toolCalls.length > 0) {
      const messageContent = convertPartsToMessageContent(content.parts);
      return {
        role: "assistant",
        content: typeof messageContent === "string" ? messageContent : null,
        tool_calls: toolCalls,
      };
    }
  }

  const messageContent = convertPartsToMessageContent(content.parts);

  if (!messageContent) {
    return null;
  }

  return {
    role: role,
    content: messageContent,
  };
};

// Map Gemini role to OpenAI role
const mapGeminiRoleToOpenAI = (
  geminiRole?: string | null,
): "system" | "user" | "assistant" | "tool" => {
  if (!geminiRole) return "user";

  switch (geminiRole.toLowerCase()) {
    case "model":
      return "assistant";
    case "user":
      return "user";
    case "system":
      return "system";
    case "function":
    case "tool":
      return "tool";
    default:
      return "user";
  }
};

// Convert Gemini parts to OpenAI message content
const convertPartsToMessageContent = (
  parts?: Part[] | null,
): string | Array<any> | null => {
  if (!parts || parts.length === 0) {
    return null;
  }

  const contentParts: any[] = [];
  let hasComplexContent = false;

  for (const part of parts) {
    if (part.text) {
      contentParts.push({
        type: "text",
        text: part.text,
      });
    } else if (part.inlineData || (part as any).inline_data) {
      hasComplexContent = true;
      const inlineData = part.inlineData || (part as any).inline_data;
      const data = inlineData.data;
      const mimeType = inlineData.mimeType || inlineData.mime_type;

      // Check if data is already an object (e.g., Attachment reference)
      if (typeof data === "object" && data !== null) {
        // Check if this is a Braintrust attachment reference
        // and ensure it uses snake_case keys (not camelCase)
        let attachmentRef = data;
        if (
          (data as any).type === "braintrust_attachment" ||
          (data as any).type === "external_attachment"
        ) {
          // Convert camelCase keys back to snake_case for attachment references
          attachmentRef = {
            type: (data as any).type,
            filename: (data as any).filename,
            content_type:
              (data as any).contentType || (data as any).content_type,
            key: (data as any).key,
            ...((data as any).type === "external_attachment" &&
            (data as any).url
              ? { url: (data as any).url }
              : {}),
          };
        }
        contentParts.push({
          type: "image_url",
          image_url: {
            url: attachmentRef,
          },
        });
      } else if (typeof data === "string") {
        // Handle different mime types
        if (mimeType?.startsWith("audio/")) {
          contentParts.push({
            type: "input_audio",
            input_audio: {
              data: data,
              format: mimeType.split("/")[1] || "wav",
            },
          });
        } else if (
          mimeType?.startsWith("image/") ||
          mimeType?.startsWith("application/")
        ) {
          // Handle images and documents (e.g., PDFs)
          // Check if it's already a data URL
          if (data.startsWith("data:")) {
            contentParts.push({
              type: "image_url",
              image_url: {
                url: data,
              },
            });
          } else {
            // It's a raw base64 string, create the data URL
            contentParts.push({
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${data}`,
              },
            });
          }
        }
      } else {
        // Unexpected data type - log a warning and skip
        console.warn(
          `Unexpected data type for inlineData.data: ${typeof data}`,
          data,
        );
      }
    } else if (part.fileData) {
      hasComplexContent = true;
      // Handle file references
      if (part.fileData.mimeType?.startsWith("image/")) {
        contentParts.push({
          type: "image_url",
          image_url: {
            url: part.fileData.fileUri || "",
          },
        });
      }
    } else if (part.executableCode) {
      contentParts.push({
        type: "text",
        text: `\`\`\`${part.executableCode.language || ""}\n${
          part.executableCode.code
        }\n\`\`\``,
      });
    } else if (part.codeExecutionResult) {
      contentParts.push({
        type: "text",
        text: `Execution Result (${part.codeExecutionResult.outcome}):\n${
          part.codeExecutionResult.output || ""
        }`,
      });
    }
  }

  // Return simple string if only text content
  if (
    !hasComplexContent &&
    contentParts.length === 1 &&
    contentParts[0].type === "text"
  ) {
    return contentParts[0].text;
  }

  return contentParts.length > 0 ? contentParts : null;
};

// Extract tool calls from parts
const extractToolCalls = (parts: Part[]): any[] => {
  const toolCalls: any[] = [];

  for (const part of parts) {
    if (part.functionCall) {
      toolCalls.push({
        // Use function name as ID when no ID is provided for consistency with function responses
        id: part.functionCall.id || part.functionCall.name,
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {}),
        },
      });
    }
  }

  return toolCalls;
};

// Convert ContentUnion to string for system instruction
const convertContentToString = (content: ContentUnion): string | null => {
  if (typeof content === "string") {
    return content;
  }

  if (isContent(content)) {
    return convertPartsToString(content.parts);
  }

  if (Array.isArray(content)) {
    const strings: string[] = [];
    for (const item of content) {
      if (typeof item === "string") {
        strings.push(item);
      } else if (isPart(item) && item.text) {
        strings.push(item.text);
      }
    }
    return strings.length > 0 ? strings.join("\n") : null;
  }

  if (isPart(content) && content.text) {
    return content.text;
  }

  return null;
};

// Convert parts array to string
const convertPartsToString = (parts?: Part[] | null): string | null => {
  if (!parts || parts.length === 0) {
    return null;
  }

  const textParts: string[] = [];
  for (const part of parts) {
    if (part.text) {
      textParts.push(part.text);
    }
  }

  return textParts.length > 0 ? textParts.join("\n") : null;
};
