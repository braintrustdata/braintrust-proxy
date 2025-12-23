import { z } from "zod";

// Type definitions adapted from:
// https://github.com/openai/openai-realtime-api-beta/blob/0126e4bfc19901598c3f20d0a4b32bb3e0bea376/lib/client.js
// https://platform.openai.com/docs/api-reference/realtime-client-events
// Includes some modifications
// - Where the OpenAI implementation differs from their type spec.
// - Replace the fields we don't use with `z.unknown()` for more permissive parsing.
export const baseMessageSchema = z.object({
  event_id: z.string().optional(),
});

export const audioFormatTypeSchema = z.enum([
  "pcm16",
  "g711_ulaw",
  "g711_alaw",
]);
export type AudioFormatType = z.infer<typeof audioFormatTypeSchema>;

export const turnDetectionServerVadTypeSchema = z.object({
  type: z.literal("server_vad"),
  threshold: z.number().optional(),
  prefix_padding_ms: z.number().optional(),
  silence_duration_ms: z.number().optional(),
});

export const toolDefinitionTypeSchema = z.object({
  // TODO(kevin): Why does OpenAI mark this as optional?
  type: z.literal("function").optional(),
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()),
});

export const sessionResourceTypeSchema = z.object({
  model: z.string().optional(),
  modalities: z.array(z.string()).optional(),
  instructions: z.string().optional(),
  voice: z.string().optional(),
  input_audio_format: audioFormatTypeSchema.optional(),
  output_audio_format: audioFormatTypeSchema.optional(),
  input_audio_transcription: z
    .object({
      model: z.string(),
    })
    .nullish(),
  turn_detection: turnDetectionServerVadTypeSchema.nullish(),
  tools: z.array(toolDefinitionTypeSchema).optional(),
  tool_choice: z
    .union([
      z.object({ type: z.literal("function"), name: z.string() }),
      z.enum(["auto", "none", "required"]),
    ])
    .optional(),
  temperature: z.number().optional(),
  max_response_output_tokens: z.number().or(z.literal("inf")).optional(),
});

export const usageTypeSchema = z.object({
  total_tokens: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  input_token_details: z.object({
    cached_tokens: z.number(),
    text_tokens: z.number(),
    audio_tokens: z.number(),
  }),
  output_token_details: z.object({
    text_tokens: z.number(),
    audio_tokens: z.number(),
  }),
});

export const sessionMessageSchema = baseMessageSchema.extend({
  type: z.enum(["session.created", "session.updated"]),
  session: sessionResourceTypeSchema,
});

// Added in_progress since it is seen from the service in practice and SDK.
export const responseStatusSchema = z.enum([
  "completed",
  "cancelled",
  "failed",
  "incomplete",
  "in_progress",
]);

export const inputTextContentSchema = z.object({
  type: z.literal("input_text"),
  text: z.string(),
});

export const outputTextContentSchema = z.object({
  type: z.literal("output_text"),
  text: z.string(),
});

export const inputAudioContentSchema = z.object({
  type: z.literal("input_audio"),
  transcript: z.string().nullable().optional(),
});

export const outputAudioContentSchema = z.object({
  type: z.literal("output_audio"),
  transcript: z.string().nullable().optional(),
});

export const textContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

// Add the `audio` case.
export const audioContentSchema = z.object({
  type: z.literal("audio"),
  transcript: z.string().optional(),
});

export const messageContentSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("system"),
    content: z.array(inputTextContentSchema),
  }),
  z.object({
    role: z.literal("user"),
    content: z.array(
      z.discriminatedUnion("type", [
        inputTextContentSchema,
        inputAudioContentSchema,
      ]),
    ),
  }),
  z.object({
    role: z.literal("assistant"),
    content: z.array(
      z.discriminatedUnion("type", [
        textContentSchema,
        outputTextContentSchema,
        audioContentSchema,
        outputAudioContentSchema,
      ]),
    ),
  }),
]);

export const inputItemSchema = z.union([
  z.object({
    type: z.literal("function_call"),
    call_id: z.string(),
    name: z.string(),
    arguments: z.string(),
  }),
  z.object({
    type: z.literal("function_call_output"),
    call_id: z.string(),
    output: z.string().describe("JSON string"),
  }),
  z.object({ type: z.literal("message") }).and(messageContentSchema),
  z.object({
    type: z.literal("audio"),
    transcript: z.string(),
  }),
]);

export const outputItemSchema = inputItemSchema.and(
  z.object({
    id: z.string(),
    object: z.literal("realtime.item").optional(),
    status: responseStatusSchema,
  }),
);

export const baseResponseSchema = z.object({
  object: z.literal("realtime.response"),
  id: z.string(),
  status: responseStatusSchema,
  // Not used by this class.
  status_details: z.unknown(),
  usage: usageTypeSchema.nullable(),
});

export const responseCreatedMessageSchema = baseMessageSchema.extend({
  type: z.literal("response.created"),
  response: baseResponseSchema.extend({
    // This array is always empty when sent to from the server. The SDK mutates it
    // after the event is delivered:
    // https://github.com/openai/openai-realtime-api-beta/blob/0126e4bfc19901598c3f20d0a4b32bb3e0bea376/lib/conversation.js#L142-L159
    // This is why the console app shows the array as populated with item IDs.
    // Set this to unknown[] in case this is a bug, to avoid future breakages.
    // output: z.array(z.string().describe("Item IDs")),
    output: z.array(z.unknown()),
  }),
});

export const responseDoneMssageSchema = baseMessageSchema.extend({
  type: z.literal("response.done"),
  response: baseResponseSchema.extend({
    output: z.array(outputItemSchema),
  }),
});

export const responseOutputItemAddedSchema = baseMessageSchema.extend({
  type: z.literal("response.output_item.added"),
  response_id: z.string(),
  output_index: z.number(),
  item: z.object({
    id: z.string(),
    type: z.string(),
  }),
});

export const responseContentPartAddedSchema = baseMessageSchema.extend({
  type: z.literal("response.content_part.added"),
  response_id: z.string(),
  item_id: z.string(),
  output_index: z.number(),
  content_index: z.number(),
  part: z.object({
    type: z.enum(["text", "audio"]),
    text: z.string().optional(),
    audio: z.string().optional(),
    transcript: z.string().optional(),
  }),
});

export const responseContentPartDoneSchema = baseMessageSchema.extend({
  type: z.literal("response.content_part.done"),
  response_id: z.string(),
  item_id: z.string(),
  output_index: z.number(),
  content_index: z.number(),
  part: z.object({
    type: z.enum(["text", "audio"]),
    text: z.string().optional(),
    audio: z.string().optional(),
    transcript: z.string().optional(),
  }),
});

export const responseOutputItemDoneSchema = baseMessageSchema.extend({
  type: z.literal("response.output_item.done"),
  response_id: z.string(),
  output_index: z.number(),
  item: outputItemSchema,
});

export const conversationItemAddedSchema = baseMessageSchema.extend({
  type: z.literal("conversation.item.added"),
  previous_item_id: z.string().nullish(),
  item: outputItemSchema,
});

export const conversationItemDoneSchema = baseMessageSchema.extend({
  type: z.literal("conversation.item.done"),
  previous_item_id: z.string().nullish(),
  item: outputItemSchema,
});

export const audioBaseMessageSchema = baseMessageSchema.extend({
  item_id: z.string(),
  content_index: z.number(),
  output_index: z.number(),
  response_id: z.string(),
});

export const audioDoneMessageSchema = audioBaseMessageSchema.extend({
  type: z.literal("response.output_audio.done"),
});

export const audioResponseTranscriptDoneMessageSchema =
  audioBaseMessageSchema.extend({
    type: z.literal("response.output_audio_transcript.done"),
    transcript: z.string(),
  });

export const audioInputTranscriptDoneMessageSchema = baseMessageSchema.extend({
  type: z.literal("conversation.item.input_audio_transcription.completed"),
  item_id: z.string(),
  content_index: z.number(),
  transcript: z.string(),
});

export const audioDeltaMessageSchema = audioBaseMessageSchema.extend({
  type: z.enum([
    "response.output_audio.delta",
    "response.output_audio_transcript.delta",
  ]),
  delta: z.string(),
});

export const clientAudioAppendMessageSchema = baseMessageSchema.extend({
  type: z.literal("input_audio_buffer.append"),
  audio: z.string(),
});

export const clientAudioCommitMessageSchema = baseMessageSchema.extend({
  type: z.literal("input_audio_buffer.commit"),
});

export const cancelResponseMessageSchema = baseMessageSchema.extend({
  type: z.literal("response.cancel"),
});

export const functionCallBaseMessageSchema = baseMessageSchema.extend({
  output_index: z.number(),
  response_id: z.string(),
  item_id: z.string(),
  call_id: z.string(),
});

export const functionCallDeltaMessageSchema =
  functionCallBaseMessageSchema.extend({
    type: z.literal("response.function_call_arguments.delta"),
    delta: z.string().describe("JSON fragment"),
  });

export const functionCallDoneMessageSchema =
  functionCallBaseMessageSchema.extend({
    type: z.literal("response.function_call_arguments.done"),
    name: z.string(),
    arguments: z.string().describe("JSON string"),
  });

export const conversationItemCreateMessageSchema = baseMessageSchema.extend({
  type: z.literal("conversation.item.create"),
  previous_item_id: z.string().nullish(),
  item: inputItemSchema,
});

export const speechStartedMessageSchema = baseMessageSchema.extend({
  type: z.literal("input_audio_buffer.speech_started"),
  audio_start_ms: z.number(),
  item_id: z.string(),
});

export const speechEndedMessageSchema = baseMessageSchema.extend({
  type: z.literal("input_audio_buffer.speech_stopped"),
  audio_end_ms: z.number(),
  item_id: z.string(),
});

export const errorMessageSchema = baseMessageSchema.extend({
  type: z.literal("error"),
  error: z.unknown(),
});

export const responseTextDeltaSchema = baseMessageSchema.extend({
  type: z.literal("response.output_text.delta"),
  response_id: z.string(),
  item_id: z.string(),
  output_index: z.number(),
  content_index: z.number(),
  delta: z.string(),
});

export const responseTextDoneSchema = baseMessageSchema.extend({
  type: z.literal("response.output_text.done"),
  response_id: z.string(),
  item_id: z.string(),
  output_index: z.number(),
  content_index: z.number(),
  text: z.string(),
});

/** Message types we know about, but do not wish to handle at this time. */
export const unhandledMessageSchema = baseMessageSchema.extend({
  type: z.enum([
    "session.update",
    "rate_limits.updated",
    "response.create",
    "conversation.item.created",
    "input_audio_buffer.committed",
    "input_audio_buffer.cleared",
    "conversation.item.truncate",
    "conversation.item.truncated",
    "conversation.item.deleted",
    "input_audio_buffer.timeout_triggered",
    "conversation.item.input_audio_transcription.delta",
    "conversation.item.input_audio_transcription.failed",
    "conversation.item.input_audio_transcription.segment",
  ]),
});

export const openAiRealtimeMessageSchema = z.discriminatedUnion("type", [
  sessionMessageSchema,
  responseCreatedMessageSchema,
  responseDoneMssageSchema,
  responseOutputItemAddedSchema,
  responseOutputItemDoneSchema,
  responseContentPartAddedSchema,
  responseContentPartDoneSchema,
  conversationItemAddedSchema,
  conversationItemDoneSchema,
  clientAudioAppendMessageSchema,
  clientAudioCommitMessageSchema,
  audioDeltaMessageSchema,
  audioDoneMessageSchema,
  audioResponseTranscriptDoneMessageSchema,
  audioInputTranscriptDoneMessageSchema,
  responseTextDeltaSchema,
  responseTextDoneSchema,
  cancelResponseMessageSchema,
  functionCallDeltaMessageSchema,
  functionCallDoneMessageSchema,
  conversationItemCreateMessageSchema,
  speechStartedMessageSchema,
  speechEndedMessageSchema,
  errorMessageSchema,
  unhandledMessageSchema,
]);
