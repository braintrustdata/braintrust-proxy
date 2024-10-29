import * as Braintrust from "braintrust/browser";
import { z } from "zod";
import { makeWavFile } from "@braintrust/proxy/utils";
import { AudioCodec } from "@braintrust/proxy/schema/dist";

// Type definitions adapted from:
// https://github.com/openai/openai-realtime-api-beta/blob/0126e4bfc19901598c3f20d0a4b32bb3e0bea376/lib/client.js
// Includes some modifications
// - Where the OpenAI implementation differs from their type spec.
// - Replace the fields we don't use with `z.any()` for more permissive parsing.
const baseMessageSchema = z.object({
  event_id: z.string(),
});

const audioFormatTypeSchema = z.enum(["pcm16", "g711_ulaw", "g711_alaw"]);
type AudioFormatType = z.infer<typeof audioFormatTypeSchema>;

const turnDetectionServerVadTypeSchema = z.object({
  type: z.literal("server_vad"),
  threshold: z.number().optional(),
  prefix_padding_ms: z.number().optional(),
  silence_duration_ms: z.number().optional(),
});

const toolDefinitionTypeSchema = z.object({
  // TODO(kevin): Why does OpenAI mark this as optional?
  type: z.literal("function").optional(),
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.any()),
});

const sessionResourceTypeSchema = z.object({
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

const incompleteResponseStatusTypeSchema = z.object({
  type: z.literal("incomplete"),
  reason: z.enum(["interruption", "max_output_tokens", "content_filter"]),
});

const failedResponseStatusTypeSchema = z.object({
  type: z.literal("failed"),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .nullable(),
});

const usageTypeSchema = z.object({
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

const sessionMessageSchema = baseMessageSchema.extend({
  type: z.enum(["session.created", "session.updated"]),
  session: sessionResourceTypeSchema,
});

const responseMessageSchema = baseMessageSchema.extend({
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
    // Not used by this class.
    output: z.array(z.record(z.any())),
    usage: usageTypeSchema.nullable(),
  }),
});

const audioBaseMessageSchema = baseMessageSchema.extend({
  item_id: z.string(),
  content_index: z.number(),
});

const audioDoneMessageSchema = audioBaseMessageSchema.extend({
  type: z.literal("response.audio.done"),
  output_index: z.number(),
  response_id: z.string(),
});

const audioResponseTranscriptDoneMessageSchema = audioBaseMessageSchema.extend({
  type: z.literal("response.audio_transcript.done"),
  output_index: z.number(),
  response_id: z.string(),
  transcript: z.string(),
});

const audioInputTranscriptDoneMessageSchema = audioBaseMessageSchema.extend({
  type: z.literal("conversation.item.input_audio_transcription.completed"),
  transcript: z.string(),
});

const audioDeltaMessageSchema = audioBaseMessageSchema.extend({
  type: z.enum(["response.audio.delta", "response.audio_transcript.delta"]),
  output_index: z.number(),
  response_id: z.string(),
  delta: z.string(),
});

const clientAudioAppendMessageSchema = baseMessageSchema.extend({
  type: z.literal("input_audio_buffer.append"),
  audio: z.string(),
});

const clientAudioCommitMessageSchema = baseMessageSchema.extend({
  type: z.literal("input_audio_buffer.commit"),
});

const errorMessageSchema = baseMessageSchema.extend({
  type: z.literal("error"),
  error: z.any(),
});

// Message types we know about, but do not wish to handle at this time.
const unhandledMessageSchema = baseMessageSchema.extend({
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
    "input_audio_buffer.committed",
    "response.function_call_arguments.delta",
    "response.function_call_arguments.done",
    "conversation.item.truncate",
    "conversation.item.truncated",
  ]),
});

const openAiRealtimeMessageSchema = z.discriminatedUnion("type", [
  sessionMessageSchema,
  responseMessageSchema,
  clientAudioAppendMessageSchema,
  clientAudioCommitMessageSchema,
  audioDeltaMessageSchema,
  audioDoneMessageSchema,
  audioResponseTranscriptDoneMessageSchema,
  audioInputTranscriptDoneMessageSchema,
  errorMessageSchema,
  unhandledMessageSchema,
]);

/**
 * Helper class to accumulate and encode a single audio stream, which can then
 * be logged to Braintrust.
 */
class AudioBuffer {
  private inputCodec: AudioCodec;
  private audioBuffers: string[];

  constructor({ inputCodec }: { inputCodec: AudioCodec }) {
    this.inputCodec = inputCodec;
    this.audioBuffers = [];
  }

  push(audioBufferBase64: string): void {
    this.audioBuffers.push(audioBufferBase64);
  }

  encode(): Blob {
    return makeWavFile(this.inputCodec, this.audioBuffers);
  }
}

function openAiAudioFormatToAudioCodec(
  audioFormat: AudioFormatType,
): AudioCodec {
  const common = {
    byte_order: "little",
    number_encoding: "int",
    channels: 1,
  } as const;
  // https://platform.openai.com/docs/guides/realtime/audio-formats
  switch (audioFormat) {
    case "pcm16":
      return {
        ...common,
        name: "pcm",
        bits_per_sample: 16,
        sample_rate: 24000,
      };
    case "g711_ulaw":
      return {
        ...common,
        name: "g711",
        algorithm: "mu",
        bits_per_sample: 8,
        sample_rate: 8000,
      };
    case "g711_alaw":
      return {
        ...common,
        name: "g711",
        algorithm: "a",
        bits_per_sample: 8,
        sample_rate: 8000,
      };
    default:
      const x: never = audioFormat;
      throw new Error(`Unknown audio format ${JSON.stringify(x)}`);
  }
}

/**
 * A stateful class that processes a stream of OpenAI Realtime API messages and
 * logs to Braintrust, if needed.
 */
export class OpenAiRealtimeLogger {
  private rootSpan: Braintrust.Span;
  private clientAudioBuffer?: AudioBuffer;
  private clientSpan?: Braintrust.Span;
  private serverAudioBuffer: Map<string, AudioBuffer>;
  private serverSpans: Map<string, Braintrust.Span>;
  private inputAudioFormat?: AudioCodec;
  private outputAudioFormat?: AudioCodec;

  constructor({
    apiKey,
    appUrl,
    projectName,
  }: {
    apiKey?: string;
    appUrl?: string;
    projectName?: string;
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
    this.serverAudioBuffer = new Map();
    this.serverSpans = new Map();
  }

  public handleMessageClient(rawMessage: unknown) {
    const parsed = openAiRealtimeMessageSchema.safeParse(rawMessage);
    if (!parsed.success) {
      console.warn("Unknown message:", rawMessage);
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
      if (!this.clientAudioBuffer) {
        if (!this.inputAudioFormat) {
          throw new Error("Messages may have been received out of order.");
        }
        this.clientAudioBuffer = new AudioBuffer({
          inputCodec: this.inputAudioFormat,
        });
      }
      this.clientAudioBuffer.push(message.audio);
    } else if (message.type === "input_audio_buffer.commit") {
      if (!this.clientAudioBuffer) {
        throw new Error();
      }
      const audioFile = this.clientAudioBuffer.encode();
      this.clientAudioBuffer = undefined;
      this.clientSpan?.log({
        input: {
          audio: new Braintrust.Attachment({
            data: audioFile,
            filename: "audio.wav",
            contentType: audioFile.type,
            state: this.rootSpan.state,
          }),
        },
      });
    }
  }

  public handleMessageServer(rawMessage: unknown) {
    const parsed = openAiRealtimeMessageSchema.safeParse(rawMessage);
    if (!parsed.success) {
      console.warn("Unknown message:", rawMessage);
      return;
    }
    const message = parsed.data;
    if (message.type === "session.created") {
      this.rootSpan.log({
        metadata: {
          openai_realtime_session: message.session,
        },
      });
      if (!this.inputAudioFormat && message.session.input_audio_format) {
        this.inputAudioFormat = openAiAudioFormatToAudioCodec(
          message.session.input_audio_format,
        );
      }
      if (!this.outputAudioFormat && message.session.output_audio_format) {
        this.outputAudioFormat = openAiAudioFormatToAudioCodec(
          message.session.output_audio_format,
        );
      }
    } else if (message.type === "response.created") {
      if (!this.outputAudioFormat) {
        throw new Error("Messages may have been received out of order.");
      }
      // This might be excessively paranoid.
      // In practice we seem to only get one response_id streaming at a time
      // even though the schema allows multiple.
      this.serverAudioBuffer.set(
        message.response.id,
        new AudioBuffer({ inputCodec: this.outputAudioFormat }),
      );
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
      if (!buf || !span) {
        throw new Error("Invalid response_id");
      }
      const audioFile = buf.encode();
      span.log({
        // TODO: join input/output to the same span.
        output: {
          audio: new Braintrust.Attachment({
            data: audioFile,
            filename: "audio.wav",
            contentType: audioFile.type,
            state: this.rootSpan.state,
          }),
        },
      });
      this.serverAudioBuffer.delete(message.response_id);
    } else if (message.type === "response.audio_transcript.done") {
      const span = this.serverSpans.get(message.response_id);
      if (span) {
        span.log({ output: { transcript: message.transcript } });
        // Assume the transcript always comes after the audio.
        span.close();
      }
      this.serverSpans.delete(message.response_id);
    } else if (
      message.type === "conversation.item.input_audio_transcription.completed"
    ) {
      this.clientSpan?.log({
        input: {
          transcript: message.transcript,
        },
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
    // for (const [responseId, audioBuffer] of this.serverAudioBuffer) {
    //   const span = this.serverSpans.get(responseId);
    //   if (!span) {
    //     continue;
    //   }
    //   span.log({

    //   })
    // }
    if (this.serverAudioBuffer.size || this.clientAudioBuffer) {
      console.warn(
        `Closing with ${this.serverAudioBuffer.size} pending server + ${this.clientAudioBuffer ? 1 : 0} pending client audio buffers`,
      );
    }
    for (const span of this.serverSpans.values()) {
      span.close();
    }
    this.clientSpan?.close();
    this.rootSpan.close();
    await this.rootSpan.flush();
  }
}
