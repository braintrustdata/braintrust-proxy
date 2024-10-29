import * as Braintrust from "braintrust/browser";
import { z } from "zod";

// Type definitions copied from:
// https://github.com/openai/openai-realtime-api-beta/blob/0126e4bfc19901598c3f20d0a4b32bb3e0bea376/lib/client.js
const baseMessageSchema = z.object({
  event_id: z.string(),
});

export const audioFormatTypeSchema = z.enum([
  "pcm16",
  "g711_ulaw",
  "g711_alaw",
]);

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
  parameters: z.record(z.any()),
});

export const sessionResourceTypeSchema = z.object({
  model: z.string().optional(),
  modalities: z.array(z.string()).optional(),
  instructions: z.string().optional(),
  voice: z.enum(["alloy", "shimmer", "echo"]).optional(),
  input_audio_format: audioFormatTypeSchema.optional(),
  output_audio_format: audioFormatTypeSchema.optional(),
  input_audio_transcription: z
    .object({
      model: z.enum(["whisper-1"]),
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
  max_response_output_tokens: z
    .union([z.number(), z.literal("inf")])
    .optional(),
});

export const incompleteResponseStatusTypeSchema = z.object({
  type: z.literal("incomplete"),
  reason: z.enum(["interruption", "max_output_tokens", "content_filter"]),
});

export const failedResponseStatusTypeSchema = z.object({
  type: z.literal("failed"),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .nullable(),
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

export const responseMessageSchema = baseMessageSchema.extend({
  type: z.enum(["response.created", "response.done"]),
  // Annoyingly similar to ResponseResourceType.
  response: z.object({
    // This member is not present in ResponseResourceType,
    object: z.literal("realtime.response"),
    id: z.string(),
    status: z.enum([
      "in_progress",
      "completed",
      "incomplete",
      "cancelled",
      "failed",
    ]),
    status_details: z
      .union([
        incompleteResponseStatusTypeSchema,
        failedResponseStatusTypeSchema,
      ])
      .nullable(),
    // TODO(kevin): Add proper schema.
    output: z.array(z.record(z.any())),
    usage: usageTypeSchema.nullable(),
  }),
});

export const audioBaseMessageSchema = baseMessageSchema.extend({
  response_id: z.string(),
  item_id: z.string(),
  output_index: z.number(),
  content_index: z.number(),
});

export const audioDoneMessageSchema = audioBaseMessageSchema.extend({
  type: z.literal("response.audio.done"),
});

export const audioTranscriptDoneMessageSchema = audioBaseMessageSchema.extend({
  type: z.enum([
    "response.audio_transcript.done",
    "conversation.item.input_audio_transcription.completed",
  ]),
  transcript: z.string(),
});

export const audioDeltaMessageSchema = audioBaseMessageSchema.extend({
  type: z.enum(["response.audio.delta", "response.audio_transcript.delta"]),
  delta: z.string(),
});

export const clientAudioAppendMessageSchema = baseMessageSchema.extend({
  type: z.literal("input_audio_buffer.append"),
  audio: z.string(),
});

export const clientAudioCommitMessageSchema = baseMessageSchema.extend({
  type: z.literal("input_audio_buffer.commit"),
});

// Message types we know about, but do not wish to handle at this time.
export const unhandledMessageSchema = baseMessageSchema.extend({
  type: z.enum([
    "session.update",
    "rate_limits.updated",
    "response.create",
    "response.output_item.added",
    "response.output_item.done",
    "response.content_part.done",
    "response.content_part.added",
    "conversation.item.create",
    "conversation.item.created",
  ]),
});

export const openAiRealtimeMessageSchema = z.discriminatedUnion("type", [
  sessionMessageSchema,
  responseMessageSchema,
  clientAudioAppendMessageSchema,
  clientAudioCommitMessageSchema,
  audioDeltaMessageSchema,
  audioDoneMessageSchema,
  audioTranscriptDoneMessageSchema,
  unhandledMessageSchema,
]);

export type OpenAiRealtimeMessage = z.infer<typeof openAiRealtimeMessageSchema>;

export class BraintrustRealtimeLogger {
  rootSpan: Braintrust.Span;
  clientAudioBuffer: string[];
  clientSpan: Braintrust.Span | undefined;
  serverAudioBuffer: Map<string, string[]>;
  serverSpans: Map<string, Braintrust.Span>;
  inputAudioFormat: string | undefined;
  outputAudioFormat: string | undefined;

  constructor({
    apiKey,
    appUrl,
    projectName,
  }: {
    apiKey: string | undefined;
    appUrl: string | undefined;
    projectName: string | undefined;
  }) {
    const btLogger =
      apiKey && projectName
        ? Braintrust.initLogger({
            state: new Braintrust.BraintrustState({}),
            apiKey,
            appUrl,
            projectName,
            asyncFlush: true,
            setCurrent: false,
          })
        : Braintrust.NOOP_SPAN;

    this.rootSpan = btLogger.startSpan({
      name: "Realtime session",
      type: "task",
    });
    this.clientAudioBuffer = [];
    this.serverAudioBuffer = new Map();
    this.serverSpans = new Map();
  }

  public handleMessageClient(rawMessage: unknown) {
    // TODO(kevin): Error handling.
    const parsed = openAiRealtimeMessageSchema.safeParse(rawMessage);
    if (!parsed.success) {
      return;
    }
    const message = parsed.data;
    if (message.type === "input_audio_buffer.append") {
      // Lazy create span.
      if (!this.clientSpan) {
        this.clientSpan = this.rootSpan.startSpan({
          name: "user", // Assume client to server direction is always user.
        });
      }
      this.clientAudioBuffer.push(message.audio);
      return;
    } else if (message.type === "input_audio_buffer.commit") {
      this.clientSpan?.log({
        metadata: {
          input_audio: this.clientAudioBuffer,
          input_audio_format: this.inputAudioFormat,
        },
      });
      this.clientAudioBuffer = [];
      // Defer closing until we get transcript.
      // this.clientAudioSpan?.close();
    }
    return;
  }

  public handleMessageServer(rawMessage: unknown) {
    const parsed = openAiRealtimeMessageSchema.safeParse(rawMessage);
    if (!parsed.success) {
      return;
    }
    const message = parsed.data;
    if (message.type === "session.created") {
      this.rootSpan.log({
        metadata: {
          openai_realtime_session: message.session,
        },
      });
      this.inputAudioFormat =
        this.inputAudioFormat || message.session.input_audio_format;
      this.outputAudioFormat =
        this.outputAudioFormat || message.session.output_audio_format;
    } else if (message.type === "response.created") {
      // This might be excessively paranoid.
      // In practice we seem to only get one response_id streaming at a time even though the schema allows multiple.
      this.serverAudioBuffer.set(message.response.id, []);
      this.serverSpans.set(
        message.response.id,
        this.rootSpan.startSpan({
          name: "assistant",
          event: {
            id: message.response.id,
          },
        }),
      );
    } else if (message.type === "response.audio.delta") {
      this.serverAudioBuffer.get(message.response_id)!.push(message.delta);
    } else if (message.type === "response.audio.done") {
      const buf = this.serverAudioBuffer.get(message.response_id);
      const span = this.serverSpans.get(message.response_id);
      if (span) {
        span.log({
          // TODO: join input/output to the same span.
          metadata: {
            output_audio: buf,
            output_audio_format: this.outputAudioFormat,
          },
        });
      }
      this.serverAudioBuffer.delete(message.response_id);
    } else if (message.type === "response.audio_transcript.done") {
      const span = this.serverSpans.get(message.response_id);
      if (span) {
        span.log({ output: message.transcript });
        // Assume the transcript always comes after the audio.
        span.close();
      }
      this.serverSpans.delete(message.response_id);
    } else if (
      message.type === "conversation.item.input_audio_transcription.completed"
    ) {
      this.clientSpan?.log({
        input: message.transcript,
      });
      // The transcript can never come before we finish logging audio.
      this.clientSpan?.close();
      this.clientSpan = undefined;
    }
  }

  /**
   * Close all pending spans.
   */
  public async close() {
    // TODO check if there is a pending audio buffer.
    for (const span of this.serverSpans.values()) {
      span.close();
    }
    this.clientSpan?.close();
    this.rootSpan.close();
    await this.rootSpan.flush();
  }
}
