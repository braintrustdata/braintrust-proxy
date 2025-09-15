// Auto-generated file (internal git SHA be4abfadd22d7196ff6356c7f3fb655aac3fc933) -- do not modify

import { z } from "zod";

export const AclObjectType = z.union([
  z.enum([
    "organization",
    "project",
    "experiment",
    "dataset",
    "prompt",
    "prompt_session",
    "group",
    "role",
    "org_member",
    "project_log",
    "org_project",
  ]),
  z.null(),
]);
export type AclObjectTypeType = z.infer<typeof AclObjectType>;
export const Permission = z.enum([
  "create",
  "read",
  "update",
  "delete",
  "create_acls",
  "read_acls",
  "update_acls",
  "delete_acls",
]);
export type PermissionType = z.infer<typeof Permission>;
export const Acl = z.object({
  id: z.string().uuid(),
  object_type: AclObjectType.and(z.string()),
  object_id: z.string().uuid(),
  user_id: z.union([z.string(), z.null()]).optional(),
  group_id: z.union([z.string(), z.null()]).optional(),
  permission: Permission.and(z.union([z.string(), z.null()])).optional(),
  restrict_object_type: AclObjectType.and(z.unknown()).optional(),
  role_id: z.union([z.string(), z.null()]).optional(),
  _object_org_id: z.string().uuid(),
  created: z.union([z.string(), z.null()]).optional(),
});
export type AclType = z.infer<typeof Acl>;
export const AISecret = z.object({
  id: z.string().uuid(),
  created: z.union([z.string(), z.null()]).optional(),
  updated_at: z.union([z.string(), z.null()]).optional(),
  org_id: z.string().uuid(),
  name: z.string(),
  type: z.union([z.string(), z.null()]).optional(),
  metadata: z
    .union([z.object({}).partial().passthrough(), z.null()])
    .optional(),
  preview_secret: z.union([z.string(), z.null()]).optional(),
});
export type AISecretType = z.infer<typeof AISecret>;
export const ResponseFormatJsonSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  schema: z
    .union([z.object({}).partial().passthrough(), z.string()])
    .optional(),
  strict: z.union([z.boolean(), z.null()]).optional(),
});
export type ResponseFormatJsonSchemaType = z.infer<
  typeof ResponseFormatJsonSchema
>;
export const ResponseFormatNullish = z.union([
  z.object({ type: z.literal("json_object") }),
  z.object({
    type: z.literal("json_schema"),
    json_schema: ResponseFormatJsonSchema,
  }),
  z.object({ type: z.literal("text") }),
  z.null(),
]);
export type ResponseFormatNullishType = z.infer<typeof ResponseFormatNullish>;
export const AnyModelParams = z.object({
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number(),
  max_completion_tokens: z.number().optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  response_format: ResponseFormatNullish.optional(),
  tool_choice: z
    .union([
      z.literal("auto"),
      z.literal("none"),
      z.literal("required"),
      z.object({
        type: z.literal("function"),
        function: z.object({ name: z.string() }),
      }),
    ])
    .optional(),
  function_call: z
    .union([
      z.literal("auto"),
      z.literal("none"),
      z.object({ name: z.string() }),
    ])
    .optional(),
  n: z.number().optional(),
  stop: z.array(z.string()).optional(),
  reasoning_effort: z.enum(["minimal", "low", "medium", "high"]).optional(),
  verbosity: z.enum(["low", "medium", "high"]).optional(),
  top_k: z.number().optional(),
  stop_sequences: z.array(z.string()).optional(),
  max_tokens_to_sample: z.number().optional(),
  maxOutputTokens: z.number().optional(),
  topP: z.number().optional(),
  topK: z.number().optional(),
  use_cache: z.boolean().optional(),
});
export type AnyModelParamsType = z.infer<typeof AnyModelParams>;
export const ApiKey = z.object({
  id: z.string().uuid(),
  created: z.union([z.string(), z.null()]).optional(),
  name: z.string(),
  preview_name: z.string(),
  user_id: z.union([z.string(), z.null()]).optional(),
  user_email: z.union([z.string(), z.null()]).optional(),
  user_given_name: z.union([z.string(), z.null()]).optional(),
  user_family_name: z.union([z.string(), z.null()]).optional(),
  org_id: z.union([z.string(), z.null()]).optional(),
});
export type ApiKeyType = z.infer<typeof ApiKey>;
export const AsyncScoringState = z.union([
  z.object({
    status: z.literal("enabled"),
    token: z.string(),
    function_ids: z.array(z.unknown()).min(1),
    skip_logging: z.union([z.boolean(), z.null()]).optional(),
  }),
  z.object({ status: z.literal("disabled") }),
  z.null(),
  z.null(),
]);
export type AsyncScoringStateType = z.infer<typeof AsyncScoringState>;
export const AsyncScoringControl = z.union([
  z.object({ kind: z.literal("score_update"), token: z.string() }),
  z.object({ kind: z.literal("state_override"), state: AsyncScoringState }),
  z.object({ kind: z.literal("state_force_reselect") }),
  z.object({ kind: z.literal("state_enabled_force_rescore") }),
]);
export type AsyncScoringControlType = z.infer<typeof AsyncScoringControl>;
export const BraintrustAttachmentReference = z.object({
  type: z.literal("braintrust_attachment"),
  filename: z.string().min(1),
  content_type: z.string().min(1),
  key: z.string().min(1),
});
export type BraintrustAttachmentReferenceType = z.infer<
  typeof BraintrustAttachmentReference
>;
export const ExternalAttachmentReference = z.object({
  type: z.literal("external_attachment"),
  filename: z.string().min(1),
  content_type: z.string().min(1),
  url: z.string().min(1),
});
export type ExternalAttachmentReferenceType = z.infer<
  typeof ExternalAttachmentReference
>;
export const AttachmentReference = z.discriminatedUnion("type", [
  BraintrustAttachmentReference,
  ExternalAttachmentReference,
]);
export type AttachmentReferenceType = z.infer<typeof AttachmentReference>;
export const UploadStatus = z.enum(["uploading", "done", "error"]);
export type UploadStatusType = z.infer<typeof UploadStatus>;
export const AttachmentStatus = z.object({
  upload_status: UploadStatus,
  error_message: z.string().optional(),
});
export type AttachmentStatusType = z.infer<typeof AttachmentStatus>;
export const BraintrustModelParams = z
  .object({ use_cache: z.boolean() })
  .partial();
export type BraintrustModelParamsType = z.infer<typeof BraintrustModelParams>;
export const CallEvent = z.union([
  z.object({
    id: z.string().optional(),
    data: z.string(),
    event: z.literal("text_delta"),
  }),
  z.object({
    id: z.string().optional(),
    data: z.string(),
    event: z.literal("reasoning_delta"),
  }),
  z.object({
    id: z.string().optional(),
    data: z.string(),
    event: z.literal("json_delta"),
  }),
  z.object({
    id: z.string().optional(),
    data: z.string(),
    event: z.literal("progress"),
  }),
  z.object({
    id: z.string().optional(),
    data: z.string(),
    event: z.literal("error"),
  }),
  z.object({
    id: z.string().optional(),
    data: z.string(),
    event: z.literal("console"),
  }),
  z.object({
    id: z.string().optional(),
    event: z.literal("start"),
    data: z.literal(""),
  }),
  z.object({
    id: z.string().optional(),
    event: z.literal("done"),
    data: z.literal(""),
  }),
]);
export type CallEventType = z.infer<typeof CallEvent>;
export const ChatCompletionContentPartTextWithTitle = z.object({
  text: z.string().default(""),
  type: z.literal("text"),
  cache_control: z.object({ type: z.literal("ephemeral") }).optional(),
});
export type ChatCompletionContentPartTextWithTitleType = z.infer<
  typeof ChatCompletionContentPartTextWithTitle
>;
export const ChatCompletionContentPartImageWithTitle = z.object({
  image_url: z.object({
    url: z.string(),
    detail: z
      .union([z.literal("auto"), z.literal("low"), z.literal("high")])
      .optional(),
  }),
  type: z.literal("image_url"),
});
export type ChatCompletionContentPartImageWithTitleType = z.infer<
  typeof ChatCompletionContentPartImageWithTitle
>;
export const ChatCompletionContentPart = z.union([
  ChatCompletionContentPartTextWithTitle,
  ChatCompletionContentPartImageWithTitle,
]);
export type ChatCompletionContentPartType = z.infer<
  typeof ChatCompletionContentPart
>;
export const ChatCompletionContentPartText = z.object({
  text: z.string().default(""),
  type: z.literal("text"),
  cache_control: z.object({ type: z.literal("ephemeral") }).optional(),
});
export type ChatCompletionContentPartTextType = z.infer<
  typeof ChatCompletionContentPartText
>;
export const ChatCompletionMessageToolCall = z.object({
  id: z.string(),
  function: z.object({ arguments: z.string(), name: z.string() }),
  type: z.literal("function"),
});
export type ChatCompletionMessageToolCallType = z.infer<
  typeof ChatCompletionMessageToolCall
>;
export const ChatCompletionMessageReasoning = z
  .object({ id: z.string(), content: z.string() })
  .partial();
export type ChatCompletionMessageReasoningType = z.infer<
  typeof ChatCompletionMessageReasoning
>;
export const ChatCompletionMessageParam = z.union([
  z.object({
    content: z.union([z.string(), z.array(ChatCompletionContentPartText)]),
    role: z.literal("system"),
    name: z.string().optional(),
  }),
  z.object({
    content: z.union([z.string(), z.array(ChatCompletionContentPart)]),
    role: z.literal("user"),
    name: z.string().optional(),
  }),
  z.object({
    role: z.literal("assistant"),
    content: z
      .union([z.string(), z.array(ChatCompletionContentPartText), z.null()])
      .optional(),
    function_call: z
      .object({ arguments: z.string(), name: z.string() })
      .optional(),
    name: z.string().optional(),
    tool_calls: z.array(ChatCompletionMessageToolCall).optional(),
    reasoning: z.array(ChatCompletionMessageReasoning).optional(),
  }),
  z.object({
    content: z.union([z.string(), z.array(ChatCompletionContentPartText)]),
    role: z.literal("tool"),
    tool_call_id: z.string().default(""),
  }),
  z.object({
    content: z.union([z.string(), z.null()]),
    name: z.string(),
    role: z.literal("function"),
  }),
  z.object({
    content: z.union([z.string(), z.array(ChatCompletionContentPartText)]),
    role: z.literal("developer"),
    name: z.string().optional(),
  }),
  z.object({
    role: z.literal("model"),
    content: z.union([z.string(), z.null()]).optional(),
  }),
]);
export type ChatCompletionMessageParamType = z.infer<
  typeof ChatCompletionMessageParam
>;
export const ChatCompletionOpenAIMessageParam = z.union([
  z.object({
    content: z.union([z.string(), z.array(ChatCompletionContentPartText)]),
    role: z.literal("system"),
    name: z.string().optional(),
  }),
  z.object({
    content: z.union([z.string(), z.array(ChatCompletionContentPart)]),
    role: z.literal("user"),
    name: z.string().optional(),
  }),
  z.object({
    role: z.literal("assistant"),
    content: z
      .union([z.string(), z.array(ChatCompletionContentPartText), z.null()])
      .optional(),
    function_call: z
      .object({ arguments: z.string(), name: z.string() })
      .optional(),
    name: z.string().optional(),
    tool_calls: z.array(ChatCompletionMessageToolCall).optional(),
    reasoning: z.array(ChatCompletionMessageReasoning).optional(),
  }),
  z.object({
    content: z.union([z.string(), z.array(ChatCompletionContentPartText)]),
    role: z.literal("tool"),
    tool_call_id: z.string().default(""),
  }),
  z.object({
    content: z.union([z.string(), z.null()]),
    name: z.string(),
    role: z.literal("function"),
  }),
  z.object({
    content: z.union([z.string(), z.array(ChatCompletionContentPartText)]),
    role: z.literal("developer"),
    name: z.string().optional(),
  }),
]);
export type ChatCompletionOpenAIMessageParamType = z.infer<
  typeof ChatCompletionOpenAIMessageParam
>;
export const ChatCompletionTool = z.object({
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.object({}).partial().passthrough().optional(),
  }),
  type: z.literal("function"),
});
export type ChatCompletionToolType = z.infer<typeof ChatCompletionTool>;
export const CodeBundle = z.object({
  runtime_context: z.object({
    runtime: z.enum(["node", "python"]),
    version: z.string(),
  }),
  location: z.union([
    z.object({
      type: z.literal("experiment"),
      eval_name: z.string(),
      position: z.union([
        z.object({ type: z.literal("task") }),
        z.object({ type: z.literal("scorer"), index: z.number().int().gte(0) }),
      ]),
    }),
    z.object({ type: z.literal("function"), index: z.number().int().gte(0) }),
  ]),
  bundle_id: z.string(),
  preview: z.union([z.string(), z.null()]).optional(),
});
export type CodeBundleType = z.infer<typeof CodeBundle>;
export const Dataset = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  name: z.string(),
  description: z.union([z.string(), z.null()]).optional(),
  created: z.union([z.string(), z.null()]).optional(),
  deleted_at: z.union([z.string(), z.null()]).optional(),
  user_id: z.union([z.string(), z.null()]).optional(),
  metadata: z
    .union([z.object({}).partial().passthrough(), z.null()])
    .optional(),
});
export type DatasetType = z.infer<typeof Dataset>;
export const ObjectReferenceNullish = z.union([
  z.object({
    object_type: z.enum([
      "project_logs",
      "experiment",
      "dataset",
      "prompt",
      "function",
      "prompt_session",
    ]),
    object_id: z.string().uuid(),
    id: z.string(),
    _xact_id: z.union([z.string(), z.null()]).optional(),
    created: z.union([z.string(), z.null()]).optional(),
  }),
  z.null(),
]);
export type ObjectReferenceNullishType = z.infer<typeof ObjectReferenceNullish>;
export const DatasetEvent = z.object({
  id: z.string(),
  _xact_id: z.string(),
  created: z.string().datetime({ offset: true }),
  _pagination_key: z.union([z.string(), z.null()]).optional(),
  project_id: z.string().uuid(),
  dataset_id: z.string().uuid(),
  input: z.unknown().optional(),
  expected: z.unknown().optional(),
  metadata: z
    .union([
      z
        .object({ model: z.union([z.string(), z.null()]) })
        .partial()
        .passthrough(),
      z.null(),
    ])
    .optional(),
  tags: z.union([z.array(z.string()), z.null()]).optional(),
  span_id: z.string(),
  root_span_id: z.string(),
  is_root: z.union([z.boolean(), z.null()]).optional(),
  origin: ObjectReferenceNullish.optional(),
});
export type DatasetEventType = z.infer<typeof DatasetEvent>;
export const EnvVar = z.object({
  id: z.string().uuid(),
  object_type: z.enum(["organization", "project", "function"]),
  object_id: z.string().uuid(),
  name: z.string(),
  created: z.union([z.string(), z.null()]).optional(),
  used: z.union([z.string(), z.null()]).optional(),
});
export type EnvVarType = z.infer<typeof EnvVar>;
export const RepoInfo = z.union([
  z
    .object({
      commit: z.union([z.string(), z.null()]),
      branch: z.union([z.string(), z.null()]),
      tag: z.union([z.string(), z.null()]),
      dirty: z.union([z.boolean(), z.null()]),
      author_name: z.union([z.string(), z.null()]),
      author_email: z.union([z.string(), z.null()]),
      commit_message: z.union([z.string(), z.null()]),
      commit_time: z.union([z.string(), z.null()]),
      git_diff: z.union([z.string(), z.null()]),
    })
    .partial(),
  z.null(),
]);
export type RepoInfoType = z.infer<typeof RepoInfo>;
export const Experiment = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  name: z.string(),
  description: z.union([z.string(), z.null()]).optional(),
  created: z.union([z.string(), z.null()]).optional(),
  repo_info: RepoInfo.optional(),
  commit: z.union([z.string(), z.null()]).optional(),
  base_exp_id: z.union([z.string(), z.null()]).optional(),
  deleted_at: z.union([z.string(), z.null()]).optional(),
  dataset_id: z.union([z.string(), z.null()]).optional(),
  dataset_version: z.union([z.string(), z.null()]).optional(),
  public: z.boolean(),
  user_id: z.union([z.string(), z.null()]).optional(),
  metadata: z
    .union([z.object({}).partial().passthrough(), z.null()])
    .optional(),
  tags: z.union([z.array(z.string()), z.null()]).optional(),
});
export type ExperimentType = z.infer<typeof Experiment>;
export const SpanType = z.union([
  z.enum(["llm", "score", "function", "eval", "task", "tool"]),
  z.null(),
]);
export type SpanTypeType = z.infer<typeof SpanType>;
export const SpanAttributes = z.union([
  z
    .object({ name: z.union([z.string(), z.null()]), type: SpanType })
    .partial()
    .passthrough(),
  z.null(),
]);
export type SpanAttributesType = z.infer<typeof SpanAttributes>;
export const ExperimentEvent = z.object({
  id: z.string(),
  _xact_id: z.string(),
  created: z.string().datetime({ offset: true }),
  _pagination_key: z.union([z.string(), z.null()]).optional(),
  project_id: z.string().uuid(),
  experiment_id: z.string().uuid(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  expected: z.unknown().optional(),
  error: z.unknown().optional(),
  scores: z
    .union([z.record(z.string(), z.union([z.number(), z.null()])), z.null()])
    .optional(),
  metadata: z
    .union([
      z
        .object({ model: z.union([z.string(), z.null()]) })
        .partial()
        .passthrough(),
      z.null(),
    ])
    .optional(),
  tags: z.union([z.array(z.string()), z.null()]).optional(),
  metrics: z.union([z.record(z.string(), z.number()), z.null()]).optional(),
  context: z
    .union([
      z
        .object({
          caller_functionname: z.union([z.string(), z.null()]),
          caller_filename: z.union([z.string(), z.null()]),
          caller_lineno: z.union([z.number(), z.null()]),
        })
        .partial()
        .passthrough(),
      z.null(),
    ])
    .optional(),
  span_id: z.string(),
  span_parents: z.union([z.array(z.string()), z.null()]).optional(),
  root_span_id: z.string(),
  span_attributes: SpanAttributes.optional(),
  is_root: z.union([z.boolean(), z.null()]).optional(),
  origin: ObjectReferenceNullish.optional(),
});
export type ExperimentEventType = z.infer<typeof ExperimentEvent>;
export const ExtendedSavedFunctionId = z.union([
  z.object({ type: z.literal("function"), id: z.string() }),
  z.object({ type: z.literal("global"), name: z.string() }),
  z.object({
    type: z.literal("slug"),
    project_id: z.string(),
    slug: z.string(),
  }),
]);
export type ExtendedSavedFunctionIdType = z.infer<
  typeof ExtendedSavedFunctionId
>;
export const PromptBlockDataNullish = z.union([
  z.object({ type: z.literal("completion"), content: z.string() }),
  z.object({
    type: z.literal("chat"),
    messages: z.array(ChatCompletionMessageParam),
    tools: z.string().optional(),
  }),
  z.null(),
]);
export type PromptBlockDataNullishType = z.infer<typeof PromptBlockDataNullish>;
export const ModelParams = z.union([
  z
    .object({
      use_cache: z.boolean(),
      temperature: z.number(),
      top_p: z.number(),
      max_tokens: z.number(),
      max_completion_tokens: z.number(),
      frequency_penalty: z.number(),
      presence_penalty: z.number(),
      response_format: ResponseFormatNullish,
      tool_choice: z.union([
        z.literal("auto"),
        z.literal("none"),
        z.literal("required"),
        z.object({
          type: z.literal("function"),
          function: z.object({ name: z.string() }),
        }),
      ]),
      function_call: z.union([
        z.literal("auto"),
        z.literal("none"),
        z.object({ name: z.string() }),
      ]),
      n: z.number(),
      stop: z.array(z.string()),
      reasoning_effort: z.enum(["minimal", "low", "medium", "high"]),
      verbosity: z.enum(["low", "medium", "high"]),
    })
    .partial()
    .passthrough(),
  z
    .object({
      use_cache: z.boolean().optional(),
      max_tokens: z.number(),
      temperature: z.number(),
      top_p: z.number().optional(),
      top_k: z.number().optional(),
      stop_sequences: z.array(z.string()).optional(),
      max_tokens_to_sample: z.number().optional(),
    })
    .passthrough(),
  z
    .object({
      use_cache: z.boolean(),
      temperature: z.number(),
      maxOutputTokens: z.number(),
      topP: z.number(),
      topK: z.number(),
    })
    .partial()
    .passthrough(),
  z
    .object({
      use_cache: z.boolean(),
      temperature: z.number(),
      topK: z.number(),
    })
    .partial()
    .passthrough(),
  z.object({ use_cache: z.boolean() }).partial().passthrough(),
]);
export type ModelParamsType = z.infer<typeof ModelParams>;
export const PromptOptionsNullish = z.union([
  z
    .object({ model: z.string(), params: ModelParams, position: z.string() })
    .partial(),
  z.null(),
]);
export type PromptOptionsNullishType = z.infer<typeof PromptOptionsNullish>;
export const PromptParserNullish = z.union([
  z.object({
    type: z.literal("llm_classifier"),
    use_cot: z.boolean(),
    choice_scores: z.record(z.string(), z.number().gte(0).lte(1)),
  }),
  z.null(),
]);
export type PromptParserNullishType = z.infer<typeof PromptParserNullish>;
export const SavedFunctionId = z.union([
  z.object({ type: z.literal("function"), id: z.string() }),
  z.object({ type: z.literal("global"), name: z.string() }),
]);
export type SavedFunctionIdType = z.infer<typeof SavedFunctionId>;
export const PromptDataNullish = z.union([
  z
    .object({
      prompt: PromptBlockDataNullish,
      options: PromptOptionsNullish,
      parser: PromptParserNullish,
      tool_functions: z.union([z.array(SavedFunctionId), z.null()]),
      origin: z.union([
        z
          .object({
            prompt_id: z.string(),
            project_id: z.string(),
            prompt_version: z.string(),
          })
          .partial(),
        z.null(),
      ]),
    })
    .partial(),
  z.null(),
]);
export type PromptDataNullishType = z.infer<typeof PromptDataNullish>;
export const FunctionTypeEnumNullish = z.union([
  z.enum(["llm", "scorer", "task", "tool"]),
  z.null(),
]);
export type FunctionTypeEnumNullishType = z.infer<
  typeof FunctionTypeEnumNullish
>;
export const FunctionIdRef = z.object({}).partial().passthrough();
export type FunctionIdRefType = z.infer<typeof FunctionIdRef>;
export const PromptBlockData = z.union([
  z.object({ type: z.literal("completion"), content: z.string() }),
  z.object({
    type: z.literal("chat"),
    messages: z.array(ChatCompletionMessageParam),
    tools: z.string().optional(),
  }),
]);
export type PromptBlockDataType = z.infer<typeof PromptBlockData>;
export const GraphNode = z.union([
  z.object({
    description: z.union([z.string(), z.null()]).optional(),
    position: z
      .union([z.object({ x: z.number(), y: z.number() }), z.null()])
      .optional(),
    type: z.literal("function"),
    function: FunctionIdRef,
  }),
  z.object({
    description: z.union([z.string(), z.null()]).optional(),
    position: z
      .union([z.object({ x: z.number(), y: z.number() }), z.null()])
      .optional(),
    type: z.literal("input"),
  }),
  z.object({
    description: z.union([z.string(), z.null()]).optional(),
    position: z
      .union([z.object({ x: z.number(), y: z.number() }), z.null()])
      .optional(),
    type: z.literal("output"),
  }),
  z.object({
    description: z.union([z.string(), z.null()]).optional(),
    position: z
      .union([z.object({ x: z.number(), y: z.number() }), z.null()])
      .optional(),
    type: z.literal("literal"),
    value: z.unknown().optional(),
  }),
  z.object({
    description: z.union([z.string(), z.null()]).optional(),
    position: z
      .union([z.object({ x: z.number(), y: z.number() }), z.null()])
      .optional(),
    type: z.literal("btql"),
    expr: z.string(),
  }),
  z.object({
    description: z.union([z.string(), z.null()]).optional(),
    position: z
      .union([z.object({ x: z.number(), y: z.number() }), z.null()])
      .optional(),
    type: z.literal("gate"),
    condition: z.union([z.string(), z.null()]).optional(),
  }),
  z.object({
    description: z.union([z.string(), z.null()]).optional(),
    position: z
      .union([z.object({ x: z.number(), y: z.number() }), z.null()])
      .optional(),
    type: z.literal("aggregator"),
  }),
  z.object({
    description: z.union([z.string(), z.null()]).optional(),
    position: z
      .union([z.object({ x: z.number(), y: z.number() }), z.null()])
      .optional(),
    type: z.literal("prompt_template"),
    prompt: PromptBlockData,
  }),
]);
export type GraphNodeType = z.infer<typeof GraphNode>;
export const GraphEdge = z.object({
  source: z.object({ node: z.string().max(1024), variable: z.string() }),
  target: z.object({ node: z.string().max(1024), variable: z.string() }),
  purpose: z.enum(["control", "data", "messages"]),
});
export type GraphEdgeType = z.infer<typeof GraphEdge>;
export const GraphData = z.object({
  type: z.literal("graph"),
  nodes: z.record(z.string(), GraphNode),
  edges: z.record(z.string(), GraphEdge),
});
export type GraphDataType = z.infer<typeof GraphData>;
export const FunctionData = z.union([
  z.object({ type: z.literal("prompt") }),
  z.object({
    type: z.literal("code"),
    data: z.union([
      z.object({ type: z.literal("bundle") }).and(CodeBundle),
      z.object({
        type: z.literal("inline"),
        runtime_context: z.object({
          runtime: z.enum(["node", "python"]),
          version: z.string(),
        }),
        code: z.string(),
      }),
    ]),
  }),
  GraphData,
  z.object({
    type: z.literal("remote_eval"),
    endpoint: z.string(),
    eval_name: z.string(),
    parameters: z.object({}).partial().passthrough(),
  }),
  z.object({ type: z.literal("global"), name: z.string() }),
]);
export type FunctionDataType = z.infer<typeof FunctionData>;
export const Function = z.object({
  id: z.string().uuid(),
  _xact_id: z.string(),
  project_id: z.string().uuid(),
  log_id: z.literal("p"),
  org_id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.union([z.string(), z.null()]).optional(),
  created: z.union([z.string(), z.null()]).optional(),
  prompt_data: PromptDataNullish.optional(),
  tags: z.union([z.array(z.string()), z.null()]).optional(),
  metadata: z
    .union([z.object({}).partial().passthrough(), z.null()])
    .optional(),
  function_type: FunctionTypeEnumNullish.optional(),
  function_data: FunctionData,
  origin: z
    .union([
      z.object({
        object_type: AclObjectType.and(z.string()),
        object_id: z.string().uuid(),
        internal: z.union([z.boolean(), z.null()]).optional(),
      }),
      z.null(),
    ])
    .optional(),
  function_schema: z
    .union([
      z.object({ parameters: z.unknown(), returns: z.unknown() }).partial(),
      z.null(),
    ])
    .optional(),
});
export type FunctionType = z.infer<typeof Function>;
export const FunctionFormat = z.enum(["llm", "code", "global", "graph"]);
export type FunctionFormatType = z.infer<typeof FunctionFormat>;
export const PromptData = z
  .object({
    prompt: PromptBlockDataNullish,
    options: PromptOptionsNullish,
    parser: PromptParserNullish,
    tool_functions: z.union([z.array(SavedFunctionId), z.null()]),
    origin: z.union([
      z
        .object({
          prompt_id: z.string(),
          project_id: z.string(),
          prompt_version: z.string(),
        })
        .partial(),
      z.null(),
    ]),
  })
  .partial();
export type PromptDataType = z.infer<typeof PromptData>;
export const FunctionTypeEnum = z.enum(["llm", "scorer", "task", "tool"]);
export type FunctionTypeEnumType = z.infer<typeof FunctionTypeEnum>;
export const FunctionId = z.union([
  z.object({ function_id: z.string(), version: z.string().optional() }),
  z.object({
    project_name: z.string(),
    slug: z.string(),
    version: z.string().optional(),
  }),
  z.object({ global_function: z.string() }),
  z.object({
    prompt_session_id: z.string(),
    prompt_session_function_id: z.string(),
    version: z.string().optional(),
  }),
  z.object({
    inline_context: z.object({
      runtime: z.enum(["node", "python"]),
      version: z.string(),
    }),
    code: z.string(),
    name: z.union([z.string(), z.null()]).optional(),
  }),
  z.object({
    inline_prompt: PromptData.optional(),
    inline_function: z.object({}).partial().passthrough(),
    function_type: FunctionTypeEnum.optional(),
    name: z.union([z.string(), z.null()]).optional(),
  }),
  z.object({
    inline_prompt: PromptData,
    function_type: FunctionTypeEnum.optional(),
    name: z.union([z.string(), z.null()]).optional(),
  }),
]);
export type FunctionIdType = z.infer<typeof FunctionId>;
export const FunctionObjectType = z.enum([
  "prompt",
  "tool",
  "scorer",
  "task",
  "agent",
]);
export type FunctionObjectTypeType = z.infer<typeof FunctionObjectType>;
export const FunctionOutputType = z.enum(["completion", "score", "any"]);
export type FunctionOutputTypeType = z.infer<typeof FunctionOutputType>;
export const GitMetadataSettings = z.object({
  collect: z.enum(["all", "none", "some"]),
  fields: z
    .array(
      z.enum([
        "commit",
        "branch",
        "tag",
        "dirty",
        "author_name",
        "author_email",
        "commit_message",
        "commit_time",
        "git_diff",
      ]),
    )
    .optional(),
});
export type GitMetadataSettingsType = z.infer<typeof GitMetadataSettings>;
export const Group = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  user_id: z.union([z.string(), z.null()]).optional(),
  created: z.union([z.string(), z.null()]).optional(),
  name: z.string(),
  description: z.union([z.string(), z.null()]).optional(),
  deleted_at: z.union([z.string(), z.null()]).optional(),
  member_users: z.union([z.array(z.string().uuid()), z.null()]).optional(),
  member_groups: z.union([z.array(z.string().uuid()), z.null()]).optional(),
});
export type GroupType = z.infer<typeof Group>;
export const IfExists = z.enum(["error", "ignore", "replace"]);
export type IfExistsType = z.infer<typeof IfExists>;
export const InvokeParent = z.union([
  z.object({
    object_type: z.enum(["project_logs", "experiment", "playground_logs"]),
    object_id: z.string(),
    row_ids: z
      .union([
        z.object({
          id: z.string(),
          span_id: z.string(),
          root_span_id: z.string(),
        }),
        z.null(),
      ])
      .optional(),
    propagated_event: z
      .union([z.object({}).partial().passthrough(), z.null()])
      .optional(),
  }),
  z.string(),
]);
export type InvokeParentType = z.infer<typeof InvokeParent>;
export const StreamingMode = z.union([z.enum(["auto", "parallel"]), z.null()]);
export type StreamingModeType = z.infer<typeof StreamingMode>;
export const InvokeFunction = FunctionId.and(
  z
    .object({
      input: z.unknown(),
      expected: z.unknown(),
      metadata: z.union([z.object({}).partial().passthrough(), z.null()]),
      tags: z.union([z.array(z.string()), z.null()]),
      messages: z.array(ChatCompletionMessageParam),
      parent: InvokeParent,
      stream: z.union([z.boolean(), z.null()]),
      mode: StreamingMode,
      strict: z.union([z.boolean(), z.null()]),
    })
    .partial(),
);
export type InvokeFunctionType = z.infer<typeof InvokeFunction>;
export const MessageRole = z.enum([
  "system",
  "user",
  "assistant",
  "function",
  "tool",
  "model",
  "developer",
]);
export type MessageRoleType = z.infer<typeof MessageRole>;
export const ObjectReference = z.object({
  object_type: z.enum([
    "project_logs",
    "experiment",
    "dataset",
    "prompt",
    "function",
    "prompt_session",
  ]),
  object_id: z.string().uuid(),
  id: z.string(),
  _xact_id: z.union([z.string(), z.null()]).optional(),
  created: z.union([z.string(), z.null()]).optional(),
});
export type ObjectReferenceType = z.infer<typeof ObjectReference>;
export const OnlineScoreConfig = z.union([
  z.object({
    sampling_rate: z.number().gte(0).lte(1),
    scorers: z.array(SavedFunctionId),
    btql_filter: z.union([z.string(), z.null()]).optional(),
    apply_to_root_span: z.union([z.boolean(), z.null()]).optional(),
    apply_to_span_names: z.union([z.array(z.string()), z.null()]).optional(),
    skip_logging: z.union([z.boolean(), z.null()]).optional(),
  }),
  z.null(),
]);
export type OnlineScoreConfigType = z.infer<typeof OnlineScoreConfig>;
export const Organization = z.object({
  id: z.string().uuid(),
  name: z.string(),
  api_url: z.union([z.string(), z.null()]).optional(),
  is_universal_api: z.union([z.boolean(), z.null()]).optional(),
  proxy_url: z.union([z.string(), z.null()]).optional(),
  realtime_url: z.union([z.string(), z.null()]).optional(),
  created: z.union([z.string(), z.null()]).optional(),
});
export type OrganizationType = z.infer<typeof Organization>;
export const ProjectSettings = z.union([
  z
    .object({
      comparison_key: z.union([z.string(), z.null()]),
      baseline_experiment_id: z.union([z.string(), z.null()]),
      spanFieldOrder: z.union([
        z.array(
          z.object({
            object_type: z.string(),
            column_id: z.string(),
            position: z.string(),
            layout: z
              .union([z.literal("full"), z.literal("two_column"), z.null()])
              .optional(),
          }),
        ),
        z.null(),
      ]),
      remote_eval_sources: z.union([
        z.array(
          z.object({
            url: z.string(),
            name: z.string(),
            description: z.union([z.string(), z.null()]).optional(),
          }),
        ),
        z.null(),
      ]),
    })
    .partial(),
  z.null(),
]);
export type ProjectSettingsType = z.infer<typeof ProjectSettings>;
export const Project = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  name: z.string(),
  created: z.union([z.string(), z.null()]).optional(),
  deleted_at: z.union([z.string(), z.null()]).optional(),
  user_id: z.union([z.string(), z.null()]).optional(),
  settings: ProjectSettings.optional(),
});
export type ProjectType = z.infer<typeof Project>;
export const RetentionObjectType = z.enum([
  "project_logs",
  "experiment",
  "dataset",
]);
export type RetentionObjectTypeType = z.infer<typeof RetentionObjectType>;
export const ProjectAutomation = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  user_id: z.union([z.string(), z.null()]).optional(),
  created: z.union([z.string(), z.null()]).optional(),
  name: z.string(),
  description: z.union([z.string(), z.null()]).optional(),
  config: z.union([
    z.object({
      event_type: z.literal("logs"),
      btql_filter: z.string(),
      interval_seconds: z.number().gte(1).lte(2592000),
      action: z.object({ type: z.literal("webhook"), url: z.string() }),
    }),
    z.object({
      event_type: z.literal("btql_export"),
      export_definition: z.union([
        z.object({ type: z.literal("log_traces") }),
        z.object({ type: z.literal("log_spans") }),
        z.object({ type: z.literal("btql_query"), btql_query: z.string() }),
      ]),
      export_path: z.string(),
      format: z.enum(["jsonl", "parquet"]),
      interval_seconds: z.number().gte(1).lte(2592000),
      credentials: z.object({
        type: z.literal("aws_iam"),
        role_arn: z.string(),
        external_id: z.string(),
      }),
      batch_size: z.union([z.number(), z.null()]).optional(),
    }),
    z.object({
      event_type: z.literal("retention"),
      object_type: RetentionObjectType,
      retention_days: z.number().gte(0),
    }),
  ]),
});
export type ProjectAutomationType = z.infer<typeof ProjectAutomation>;
export const ProjectLogsEvent = z.object({
  id: z.string(),
  _xact_id: z.string(),
  _pagination_key: z.union([z.string(), z.null()]).optional(),
  created: z.string().datetime({ offset: true }),
  org_id: z.string().uuid(),
  project_id: z.string().uuid(),
  log_id: z.literal("g"),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  expected: z.unknown().optional(),
  error: z.unknown().optional(),
  scores: z
    .union([z.record(z.string(), z.union([z.number(), z.null()])), z.null()])
    .optional(),
  metadata: z
    .union([
      z
        .object({ model: z.union([z.string(), z.null()]) })
        .partial()
        .passthrough(),
      z.null(),
    ])
    .optional(),
  tags: z.union([z.array(z.string()), z.null()]).optional(),
  metrics: z.union([z.record(z.string(), z.number()), z.null()]).optional(),
  context: z
    .union([
      z
        .object({
          caller_functionname: z.union([z.string(), z.null()]),
          caller_filename: z.union([z.string(), z.null()]),
          caller_lineno: z.union([z.number(), z.null()]),
        })
        .partial()
        .passthrough(),
      z.null(),
    ])
    .optional(),
  span_id: z.string(),
  span_parents: z.union([z.array(z.string()), z.null()]).optional(),
  root_span_id: z.string(),
  is_root: z.union([z.boolean(), z.null()]).optional(),
  span_attributes: SpanAttributes.optional(),
  origin: ObjectReferenceNullish.optional(),
});
export type ProjectLogsEventType = z.infer<typeof ProjectLogsEvent>;
export const ProjectScoreType = z.enum([
  "slider",
  "categorical",
  "weighted",
  "minimum",
  "maximum",
  "online",
  "free-form",
]);
export type ProjectScoreTypeType = z.infer<typeof ProjectScoreType>;
export const ProjectScoreCategory = z.object({
  name: z.string(),
  value: z.number(),
});
export type ProjectScoreCategoryType = z.infer<typeof ProjectScoreCategory>;
export const ProjectScoreCategories = z.union([
  z.array(ProjectScoreCategory),
  z.record(z.string(), z.number()),
  z.array(z.string()),
  z.null(),
]);
export type ProjectScoreCategoriesType = z.infer<typeof ProjectScoreCategories>;
export const ProjectScoreConfig = z.union([
  z
    .object({
      multi_select: z.union([z.boolean(), z.null()]),
      destination: z.union([z.string(), z.null()]),
      online: OnlineScoreConfig,
    })
    .partial(),
  z.null(),
]);
export type ProjectScoreConfigType = z.infer<typeof ProjectScoreConfig>;
export const ProjectScore = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  user_id: z.string().uuid(),
  created: z.union([z.string(), z.null()]).optional(),
  name: z.string(),
  description: z.union([z.string(), z.null()]).optional(),
  score_type: ProjectScoreType,
  categories: ProjectScoreCategories.optional(),
  config: ProjectScoreConfig.optional(),
  position: z.union([z.string(), z.null()]).optional(),
});
export type ProjectScoreType = z.infer<typeof ProjectScore>;
export const ProjectTag = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  user_id: z.string().uuid(),
  created: z.union([z.string(), z.null()]).optional(),
  name: z.string(),
  description: z.union([z.string(), z.null()]).optional(),
  color: z.union([z.string(), z.null()]).optional(),
  position: z.union([z.string(), z.null()]).optional(),
});
export type ProjectTagType = z.infer<typeof ProjectTag>;
export const Prompt = z.object({
  id: z.string().uuid(),
  _xact_id: z.string(),
  project_id: z.string().uuid(),
  log_id: z.literal("p"),
  org_id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.union([z.string(), z.null()]).optional(),
  created: z.union([z.string(), z.null()]).optional(),
  prompt_data: PromptDataNullish.optional(),
  tags: z.union([z.array(z.string()), z.null()]).optional(),
  metadata: z
    .union([z.object({}).partial().passthrough(), z.null()])
    .optional(),
  function_type: FunctionTypeEnumNullish.optional(),
});
export type PromptType = z.infer<typeof Prompt>;
export const PromptOptions = z
  .object({ model: z.string(), params: ModelParams, position: z.string() })
  .partial();
export type PromptOptionsType = z.infer<typeof PromptOptions>;
export const PromptSessionEvent = z.object({
  id: z.string(),
  _xact_id: z.string(),
  created: z.string().datetime({ offset: true }),
  _pagination_key: z.union([z.string(), z.null()]).optional(),
  project_id: z.string().uuid(),
  prompt_session_id: z.string().uuid(),
  prompt_session_data: z.unknown().optional(),
  prompt_data: z.unknown().optional(),
  function_data: z.unknown().optional(),
  function_type: FunctionTypeEnumNullish.optional(),
  object_data: z.unknown().optional(),
  completion: z.unknown().optional(),
  tags: z.union([z.array(z.string()), z.null()]).optional(),
});
export type PromptSessionEventType = z.infer<typeof PromptSessionEvent>;
export const ResponseFormat = z.union([
  z.object({ type: z.literal("json_object") }),
  z.object({
    type: z.literal("json_schema"),
    json_schema: ResponseFormatJsonSchema,
  }),
  z.object({ type: z.literal("text") }),
]);
export type ResponseFormatType = z.infer<typeof ResponseFormat>;
export const Role = z.object({
  id: z.string().uuid(),
  org_id: z.union([z.string(), z.null()]).optional(),
  user_id: z.union([z.string(), z.null()]).optional(),
  created: z.union([z.string(), z.null()]).optional(),
  name: z.string(),
  description: z.union([z.string(), z.null()]).optional(),
  deleted_at: z.union([z.string(), z.null()]).optional(),
  member_permissions: z
    .union([
      z.array(
        z.object({
          permission: Permission,
          restrict_object_type: AclObjectType.optional(),
        }),
      ),
      z.null(),
    ])
    .optional(),
  member_roles: z.union([z.array(z.string().uuid()), z.null()]).optional(),
});
export type RoleType = z.infer<typeof Role>;
export const RunEval = z.object({
  project_id: z.string(),
  data: z.union([
    z.object({
      dataset_id: z.string(),
      _internal_btql: z
        .union([z.object({}).partial().passthrough(), z.null()])
        .optional(),
    }),
    z.object({
      project_name: z.string(),
      dataset_name: z.string(),
      _internal_btql: z
        .union([z.object({}).partial().passthrough(), z.null()])
        .optional(),
    }),
    z.object({ data: z.array(z.unknown()) }),
  ]),
  task: FunctionId.and(z.unknown()),
  scores: z.array(FunctionId),
  experiment_name: z.string().optional(),
  metadata: z.object({}).partial().passthrough().optional(),
  parent: InvokeParent.and(z.unknown()).optional(),
  stream: z.boolean().optional(),
  trial_count: z.union([z.number(), z.null()]).optional(),
  is_public: z.union([z.boolean(), z.null()]).optional(),
  timeout: z.union([z.number(), z.null()]).optional(),
  max_concurrency: z.union([z.number(), z.null()]).optional().default(10),
  base_experiment_name: z.union([z.string(), z.null()]).optional(),
  base_experiment_id: z.union([z.string(), z.null()]).optional(),
  git_metadata_settings: GitMetadataSettings.and(
    z.union([z.object({}).partial(), z.null()]),
  ).optional(),
  repo_info: RepoInfo.and(z.unknown()).optional(),
  strict: z.union([z.boolean(), z.null()]).optional(),
  stop_token: z.union([z.string(), z.null()]).optional(),
  extra_messages: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type RunEvalType = z.infer<typeof RunEval>;
export const ServiceToken = z.object({
  id: z.string().uuid(),
  created: z.union([z.string(), z.null()]).optional(),
  name: z.string(),
  preview_name: z.string(),
  service_account_id: z.union([z.string(), z.null()]).optional(),
  service_account_email: z.union([z.string(), z.null()]).optional(),
  service_account_name: z.union([z.string(), z.null()]).optional(),
  org_id: z.union([z.string(), z.null()]).optional(),
});
export type ServiceTokenType = z.infer<typeof ServiceToken>;
export const SpanIFrame = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  user_id: z.union([z.string(), z.null()]).optional(),
  created: z.union([z.string(), z.null()]).optional(),
  deleted_at: z.union([z.string(), z.null()]).optional(),
  name: z.string(),
  description: z.union([z.string(), z.null()]).optional(),
  url: z.string(),
  post_message: z.union([z.boolean(), z.null()]).optional(),
});
export type SpanIFrameType = z.infer<typeof SpanIFrame>;
export const SSEConsoleEventData = z.object({
  stream: z.enum(["stderr", "stdout"]),
  message: z.string(),
});
export type SSEConsoleEventDataType = z.infer<typeof SSEConsoleEventData>;
export const SSEProgressEventData = z.object({
  id: z.string(),
  object_type: FunctionObjectType,
  origin: ObjectReferenceNullish.and(z.unknown()).optional(),
  format: FunctionFormat,
  output_type: FunctionOutputType,
  name: z.string(),
  event: z.enum([
    "reasoning_delta",
    "text_delta",
    "json_delta",
    "error",
    "console",
    "start",
    "done",
    "progress",
  ]),
  data: z.string(),
});
export type SSEProgressEventDataType = z.infer<typeof SSEProgressEventData>;
export const ToolFunctionDefinition = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.object({}).partial().passthrough().optional(),
    strict: z.union([z.boolean(), z.null()]).optional(),
  }),
});
export type ToolFunctionDefinitionType = z.infer<typeof ToolFunctionDefinition>;
export const User = z.object({
  id: z.string().uuid(),
  given_name: z.union([z.string(), z.null()]).optional(),
  family_name: z.union([z.string(), z.null()]).optional(),
  email: z.union([z.string(), z.null()]).optional(),
  avatar_url: z.union([z.string(), z.null()]).optional(),
  created: z.union([z.string(), z.null()]).optional(),
});
export type UserType = z.infer<typeof User>;
export const ViewDataSearch = z.union([
  z
    .object({
      filter: z.union([z.array(z.unknown()), z.null()]),
      tag: z.union([z.array(z.unknown()), z.null()]),
      match: z.union([z.array(z.unknown()), z.null()]),
      sort: z.union([z.array(z.unknown()), z.null()]),
    })
    .partial(),
  z.null(),
]);
export type ViewDataSearchType = z.infer<typeof ViewDataSearch>;
export const ViewData = z.union([
  z.object({ search: ViewDataSearch, custom_charts: z.unknown() }).partial(),
  z.null(),
]);
export type ViewDataType = z.infer<typeof ViewData>;
export const ViewOptions = z.union([
  z.object({
    viewType: z.literal("monitor"),
    options: z
      .object({
        spanType: z.union([z.enum(["range", "frame"]), z.null()]),
        rangeValue: z.union([z.string(), z.null()]),
        frameStart: z.union([z.string(), z.null()]),
        frameEnd: z.union([z.string(), z.null()]),
        tzUTC: z.union([z.boolean(), z.null()]),
        chartVisibility: z.union([z.record(z.string(), z.boolean()), z.null()]),
        projectId: z.union([z.string(), z.null()]),
        type: z.union([z.enum(["project", "experiment"]), z.null()]),
        groupBy: z.union([z.string(), z.null()]),
      })
      .partial(),
  }),
  z
    .object({
      columnVisibility: z.union([z.record(z.string(), z.boolean()), z.null()]),
      columnOrder: z.union([z.array(z.string()), z.null()]),
      columnSizing: z.union([z.record(z.string(), z.number()), z.null()]),
      grouping: z.union([z.string(), z.null()]),
      rowHeight: z.union([z.string(), z.null()]),
      tallGroupRows: z.union([z.boolean(), z.null()]),
      layout: z.union([z.string(), z.null()]),
      chartHeight: z.union([z.number(), z.null()]),
      excludedMeasures: z.union([
        z.array(
          z.object({
            type: z.enum(["none", "score", "metric", "metadata"]),
            value: z.string(),
          }),
        ),
        z.null(),
      ]),
      yMetric: z.union([
        z.object({
          type: z.enum(["none", "score", "metric", "metadata"]),
          value: z.string(),
        }),
        z.null(),
      ]),
      xAxis: z.union([
        z.object({
          type: z.enum(["none", "score", "metric", "metadata"]),
          value: z.string(),
        }),
        z.null(),
      ]),
      symbolGrouping: z.union([
        z.object({
          type: z.enum(["none", "score", "metric", "metadata"]),
          value: z.string(),
        }),
        z.null(),
      ]),
      xAxisAggregation: z.union([z.string(), z.null()]),
      chartAnnotations: z.union([
        z.array(z.object({ id: z.string(), text: z.string() })),
        z.null(),
      ]),
      timeRangeFilter: z.union([
        z.string(),
        z.object({ from: z.string(), to: z.string() }),
        z.null(),
      ]),
    })
    .partial(),
  z.null(),
]);
export type ViewOptionsType = z.infer<typeof ViewOptions>;
export const View = z.object({
  id: z.string().uuid(),
  object_type: AclObjectType.and(z.string()),
  object_id: z.string().uuid(),
  view_type: z.enum([
    "projects",
    "experiments",
    "experiment",
    "playgrounds",
    "playground",
    "datasets",
    "dataset",
    "prompts",
    "tools",
    "scorers",
    "logs",
    "agents",
    "monitor",
  ]),
  name: z.string(),
  created: z.union([z.string(), z.null()]).optional(),
  view_data: ViewData.optional(),
  options: ViewOptions.optional(),
  user_id: z.union([z.string(), z.null()]).optional(),
  deleted_at: z.union([z.string(), z.null()]).optional(),
});
export type ViewType = z.infer<typeof View>;
