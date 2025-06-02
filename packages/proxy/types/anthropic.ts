import { z } from "zod";

const cacheControlSchema = z.object({
  type: z.enum(["ephemeral"]),
});

const anthropicBase64ImageSourceSchema = z.object({
  type: z.literal("base64"),
  media_type: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]),
  data: z.string(),
});

const anthropicUrlImageSourceSchema = z.object({
  type: z.literal("url"),
  url: z.string(),
});

const anthropicFileSourceSchema = z.object({
  type: z.literal("file"),
  file_id: z.string(),
});

export const anthropicContentPartImageSchema = z.object({
  type: z.literal("image"),
  source: z.union([
    anthropicBase64ImageSourceSchema,
    anthropicUrlImageSourceSchema,
    anthropicFileSourceSchema,
  ]),
  cache_control: cacheControlSchema.optional(),
});

const anthropicContentPartTextSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  cache_control: cacheControlSchema.optional(),
});

const anthropicToolUseContentPartSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.any()),
  cache_control: cacheControlSchema.optional(),
});

const anthropicServerToolUseContentPartSchema = z.object({
  type: z.literal("server_tool_use"),
  id: z.string(),
  name: z.enum(["web_search", "code_execution"]),
  input: z.record(z.any()),
  cache_control: cacheControlSchema.optional(),
});

const anthropicWebSearchToolResultErrorSchema = z.object({
  type: z.literal("web_search_tool_result_error"),
  errorCode: z.enum([
    "invalid_tool_input",
    "unavailable",
    "max_uses_exceeded",
    "too_many_requests",
    "query_too_long",
  ]),
});

const anthropicWebSearchToolResultSuccessSchema = z.object({
  type: z.literal("web_search_result"),
  url: z.string(),
  page_age: z.number().nullish(),
  title: z.string(),
  encrypted_content: z.string(),
});

const anthropicWebSearchToolResultContentPartSchema = z.object({
  type: z.literal("web_search_tool_result"),
  tool_use_id: z.string(),
  content: z.union([
    anthropicWebSearchToolResultErrorSchema,
    z.array(anthropicWebSearchToolResultSuccessSchema),
  ]),
  cache_control: cacheControlSchema.nullish(),
});

const anthropicCodeExecutionToolResultErrorSchema = z.object({
  type: z.literal("code_execution_tool_result_error"),
  errorCode: z.enum([
    "invalid_tool_input",
    "unavailable",
    "too_many_requests",
    "query_too_long",
  ]),
});

const anthropicCodeExecutionToolResultSuccessSchema = z.object({
  type: z.literal("code_execution_result"),
  return_code: z.number(),
  stderr: z.string(),
  stdout: z.string(),
  content: z.array(
    z.object({
      type: z.literal("code_execution_output"),
      file_id: z.string(),
    })
  ),
});

const anthropicCodeExecutionToolResultContentPartSchema = z.object({
  type: z.literal("code_execution_tool_result"),
  tool_use_id: z.string(),
  content: z.union([
    anthropicCodeExecutionToolResultErrorSchema,
    anthropicCodeExecutionToolResultSuccessSchema,
  ]),
  cache_control: cacheControlSchema.nullish(),
});

const anthropicMCPToolUseContentPartSchema = z.object({
  type: z.literal("mcp_tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.any()),
  server_name: z.string(),
  cache_control: cacheControlSchema.nullish(),
});

const anthropicMCPToolResultContentPartSchema = z.object({
  type: z.literal("mcp_tool_result"),
  tool_use_id: z.string(),
  is_error: z.boolean(),
  content: z.union([
    z.string(),
    z.array(
      z.object({
        type: z.literal("text"),
        text: z.string(),
        // This is a simplification of the strict citation schema
        citations: z.array(z.record(z.any())).nullish(),
        cache_control: cacheControlSchema.nullish(),
      })
    ),
  ]),
  cache_control: cacheControlSchema.nullish(),
});

const anthropicTextImageContentBlockSchema = z.union([
  z.string(),
  z.array(
    z.union([anthropicContentPartTextSchema, anthropicContentPartImageSchema])
  ),
]);

const anthropicToolResultContentPartSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: anthropicTextImageContentBlockSchema.optional(),
  is_error: z.boolean().optional(),
  cache_control: cacheControlSchema.nullish(),
});

const anthropicPDFSchema = z.object({
  media_type: z.literal("application/pdf"),
  data: z.string(),
  type: z.literal("base64"),
});

const anthropicPlainTextSchema = z.object({
  media_type: z.literal("text/plain"),
  data: z.string(),
  type: z.literal("text"),
});

const anthropicURLPDFSchema = z.object({
  url: z.string(),
  type: z.literal("url"),
});

const anthropicDocumentContentPartSchema = z.object({
  type: z.literal("document"),
  source: z.union([
    anthropicPDFSchema,
    anthropicPlainTextSchema,
    anthropicURLPDFSchema,
    anthropicTextImageContentBlockSchema,
    anthropicFileSourceSchema,
  ]),
  citations: z
    .object({
      enabled: z.boolean().optional(),
    })
    .optional(),
  context: z.string().nullish(),
  title: z.string().nullish(),
  cache_control: cacheControlSchema.nullish(),
});

const anthropicThinkingContentPartSchema = z.object({
  type: z.literal("thinking"),
  thinking: z.string(),
  signature: z.string(),
});

const anthropicRedactedThinkingContentPartSchema = z.object({
  type: z.literal("redacted_thinking"),
  data: z.string(),
});

const anthropicContainerUploadContentPartSchema = z.object({
  type: z.literal("container_upload"),
  file_id: z.string(),
  cache_control: cacheControlSchema.nullish(),
});

export const anthropicContentPartSchema = z.union([
  anthropicContentPartTextSchema,
  anthropicContentPartImageSchema,
  anthropicToolUseContentPartSchema,
  anthropicToolResultContentPartSchema,
  anthropicServerToolUseContentPartSchema,
  anthropicWebSearchToolResultContentPartSchema,
  anthropicCodeExecutionToolResultContentPartSchema,
  anthropicMCPToolUseContentPartSchema,
  anthropicMCPToolResultContentPartSchema,
  anthropicDocumentContentPartSchema,
  anthropicThinkingContentPartSchema,
  anthropicRedactedThinkingContentPartSchema,
  anthropicContainerUploadContentPartSchema,
]);

// System blocks are provided as a separate parameter to the Anthropic client, rather than in the messages parameter.
// However, we include it as an input on LLM spans created by the anthropic wrapper, so we need to support it here.
export const anthropicMessageParamSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.union([z.string(), z.array(anthropicContentPartSchema)]),
});

export type AnthropicContentPart = z.infer<typeof anthropicContentPartSchema>;
export type AnthropicMessageParam = z.infer<typeof anthropicMessageParamSchema>;
