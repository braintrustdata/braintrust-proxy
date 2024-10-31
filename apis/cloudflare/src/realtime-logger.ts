import * as Braintrust from "braintrust/browser";
import { z } from "zod";
import { makeWavFile, makeMp3File } from "@braintrust/proxy/utils";
import { PcmAudioFormat, ProxyLoggingParam } from "@braintrust/proxy/schema";

// Type definitions adapted from:
// https://github.com/openai/openai-realtime-api-beta/blob/0126e4bfc19901598c3f20d0a4b32bb3e0bea376/lib/client.js
// https://platform.openai.com/docs/api-reference/realtime-client-events
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

// Added in_progress since it is seen from the service in practice and SDK.
const responseStatusSchema = z.enum([
  "completed",
  "cancelled",
  "failed",
  "incomplete",
  "in_progress",
]);

const inputTextContentSchema = z.object({
  type: z.literal("input_text"),
  text: z.string(),
});

const inputAudioContentSchema = z.object({
  type: z.literal("input_audio"),
  transcript: z.string().nullable(),
});

const textContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

// Add the `audio` case.
const audioContentSchema = z.object({
  type: z.literal("audio"),
  transcript: z.string(),
});

const messageContentSchema = z.discriminatedUnion("role", [
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
      z.discriminatedUnion("type", [textContentSchema, audioContentSchema]),
    ),
  }),
]);

const inputItemSchema = z.union([
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
  z
    .object({
      type: z.literal("message"),
    })
    .and(messageContentSchema),
  z.object({
    type: z.literal("audio"),
    transcript: z.string(),
  }),
]);

const outputItemSchema = inputItemSchema.and(
  z.object({
    id: z.string(),
    object: z.literal("realtime.item"),
    status: responseStatusSchema,
  }),
);

const baseResponseSchema = z.object({
  object: z.literal("realtime.response"),
  id: z.string(),
  status: responseStatusSchema,
  // Not used by this class.
  status_details: z.any(),
  usage: usageTypeSchema.nullable(),
});

const responseCreatedMessageSchema = baseMessageSchema.extend({
  type: z.literal("response.created"),
  response: baseResponseSchema.extend({
    // This array is empty when sent to from the server. Then the SDK mutates it
    // after the event is delivered:
    // https://github.com/openai/openai-realtime-api-beta/blob/0126e4bfc19901598c3f20d0a4b32bb3e0bea376/lib/conversation.js#L142-L159
    output: z.array(z.string().describe("Item IDs")),
  }),
});

const responseDoneMssageSchema = baseMessageSchema.extend({
  type: z.literal("response.done"),
  response: baseResponseSchema.extend({
    output: z.array(outputItemSchema),
  }),
});

const responseOutputItemAddedSchema = baseMessageSchema.extend({
  type: z.literal("response.output_item.added"),
  response_id: z.string(),
  output_index: z.number(),
  item: outputItemSchema,
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

const cancelResponseMessageSchema = baseMessageSchema.extend({
  type: z.literal("response.cancel"),
});

const functionCallBaseMessageSchema = baseMessageSchema.extend({
  output_index: z.number(),
  response_id: z.string(),
  item_id: z.string(),
  call_id: z.string(),
});

const functionCallDeltaMessageSchema = functionCallBaseMessageSchema.extend({
  type: z.literal("response.function_call_arguments.delta"),
  delta: z.string().describe("JSON fragment"),
});

const functionCallDoneMessageSchema = functionCallBaseMessageSchema.extend({
  type: z.literal("response.function_call_arguments.done"),
  name: z.string(),
  arguments: z.string().describe("JSON string"),
});

const conversationItemCreateMessageSchema = baseMessageSchema.extend({
  type: z.literal("conversation.item.create"),
  previous_item_id: z.string().nullish(),
  item: inputItemSchema,
});

const speechStartedMessageSchema = baseMessageSchema.extend({
  type: z.literal("input_audio_buffer.speech_started"),
  audio_start_ms: z.number(),
  item_id: z.string(),
});

const speechEndedMessageSchema = baseMessageSchema.extend({
  type: z.literal("input_audio_buffer.speech_stopped"),
  audio_end_ms: z.number(),
  item_id: z.string(),
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
    "response.output_item.done",
    "response.content_part.done",
    "response.content_part.added",
    "conversation.item.created",
    "input_audio_buffer.committed",
    "conversation.item.truncate",
    "conversation.item.truncated",
  ]),
});

const openAiRealtimeMessageSchema = z.discriminatedUnion("type", [
  sessionMessageSchema,
  responseCreatedMessageSchema,
  responseDoneMssageSchema,
  responseOutputItemAddedSchema,
  clientAudioAppendMessageSchema,
  clientAudioCommitMessageSchema,
  audioDeltaMessageSchema,
  audioDoneMessageSchema,
  audioResponseTranscriptDoneMessageSchema,
  audioInputTranscriptDoneMessageSchema,
  cancelResponseMessageSchema,
  functionCallDeltaMessageSchema,
  functionCallDoneMessageSchema,
  conversationItemCreateMessageSchema,
  speechStartedMessageSchema,
  speechEndedMessageSchema,
  errorMessageSchema,
  unhandledMessageSchema,
]);

// The maximum audio buffer size after pushing.
const maxAudioBufferBytes = 50 * 1024 * 1024;
// When the buffer rolls over, the target size.
const targetAudioBufferBytes = 40 * 1024 * 1024; // 40 MB = about 10 minutes in base64.

/**
 * Helper class to accumulate and encode a single audio stream, which can then
 * be logged to Braintrust.
 */
class AudioBuffer {
  private inputCodec: PcmAudioFormat;
  private audioBuffers: ArrayBufferLike[];
  private totalByteLength: number;

  constructor({ inputCodec }: { inputCodec: PcmAudioFormat }) {
    this.inputCodec = inputCodec;
    this.audioBuffers = [];
    this.totalByteLength = 0;
  }

  push(base64AudioBuffer: string): void {
    const binaryAudioBuffer = Buffer.from(base64AudioBuffer, "base64").buffer;
    this.audioBuffers.push(binaryAudioBuffer);
    this.totalByteLength += binaryAudioBuffer.byteLength;

    // May run out of memory on Cloudflare Workers.
    if (this.totalByteLength > maxAudioBufferBytes) {
      console.warn(
        `Audio buffer reached trimming threshold at ${this.totalByteLength} bytes`,
      );
      let i = 0;
      for (
        ;
        i < this.audioBuffers.length &&
        this.totalByteLength > targetAudioBufferBytes;
        i++
      ) {
        this.totalByteLength -= this.audioBuffers[i].byteLength;
      }
      this.audioBuffers = this.audioBuffers.slice(i + 1);
      console.warn(`Trimmed audio buffer to ${this.totalByteLength} bytes`);
    }
  }

  get byteLength(): number {
    return this.totalByteLength;
  }

  encode(compress: boolean): [Blob, string] {
    if (compress && this.inputCodec.name !== "g711") {
      return [makeMp3File(this.inputCodec, 40, this.audioBuffers), "mp3"];
    } else {
      return [makeWavFile(this.inputCodec, this.audioBuffers), "wav"];
    }
  }
}

function openAiToPcmAudioFormat(audioFormat: AudioFormatType): PcmAudioFormat {
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
        sample_rate: 8000,
      };
    case "g711_alaw":
      return {
        ...common,
        name: "g711",
        algorithm: "a",
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
  private toolSpans: Map<string, Braintrust.Span>;
  private inputAudioFormat?: PcmAudioFormat;
  private outputAudioFormat?: PcmAudioFormat;
  private compressAudio: boolean;

  constructor({
    apiKey,
    appUrl,
    loggingParams,
  }: {
    apiKey: string;
    appUrl: string;
    loggingParams: ProxyLoggingParam;
  }) {
    const btLogger = Braintrust.initLogger({
      state: new Braintrust.BraintrustState({}),
      apiKey,
      appUrl,
      projectName: loggingParams.project_name,
      asyncFlush: true,
      setCurrent: false,
    });

    this.rootSpan = btLogger.startSpan({
      name: "Realtime session",
      type: "task",
    });
    this.serverAudioBuffer = new Map();
    this.serverSpans = new Map();
    this.toolSpans = new Map();
    this.compressAudio = loggingParams.compress_audio;
  }

  handleMessageClient(rawMessage: unknown) {
    const parsed = openAiRealtimeMessageSchema.safeParse(rawMessage);
    if (!parsed.success) {
      console.warn(
        "Unknown message:\n",
        JSON.stringify(rawMessage, null, 2),
        "\nSchema errors:\n",
        parsed.error.message,
      );
      return;
    }
    const message = parsed.data;
    if (message.type === "input_audio_buffer.append") {
      // Lazy create span.
      if (!this.clientSpan) {
        this.clientSpan = this.rootSpan.startSpan({
          name: "user",
          type: "llm",
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
      if (!this.clientAudioBuffer || !this.clientSpan) {
        throw new Error();
      }
      this.closeAudio(this.clientAudioBuffer, this.clientSpan, "input");
      this.clientAudioBuffer = undefined;
    } else if (message.type === "conversation.item.create") {
      if (message.item.type === "function_call_output") {
        const span = this.toolSpans.get(message.item.call_id);
        if (!span) {
          throw new Error(`Invalid function call ID: ${message.item.call_id}`);
        }
        let parsedOutput: unknown = message.item.output;
        try {
          parsedOutput = JSON.parse(message.item.output);
        } catch {}
        span.log({ output: parsedOutput });
        span.close();
        this.toolSpans.delete(message.item.call_id);
      }
    }
  }

  handleMessageServer(rawMessage: unknown) {
    const parsed = openAiRealtimeMessageSchema.safeParse(rawMessage);
    if (!parsed.success) {
      console.warn(
        "Unknown message:\n",
        JSON.stringify(rawMessage, null, 2),
        "\nSchema errors:\n",
        parsed.error.message,
      );
      return;
    }
    const message = parsed.data;
    if (
      message.type === "session.created" ||
      message.type === "session.updated"
    ) {
      this.rootSpan.log({
        metadata: {
          // Consider disabling merging.
          openai_realtime_session: message.session,
        },
      });
      // Assume the audio codec cannot change during the session.
      if (!this.inputAudioFormat && message.session.input_audio_format) {
        this.inputAudioFormat = openAiToPcmAudioFormat(
          message.session.input_audio_format,
        );
      }
      if (!this.outputAudioFormat && message.session.output_audio_format) {
        this.outputAudioFormat = openAiToPcmAudioFormat(
          message.session.output_audio_format,
        );
      }
    } else if (message.type === "response.output_item.added") {
      const itemId = message.item.id;
      if (
        message.item.type === "message" &&
        message.item.role === "assistant"
      ) {
        if (!this.outputAudioFormat) {
          throw new Error("Messages may have been received out of order.");
        }
        this.serverAudioBuffer.set(
          itemId,
          new AudioBuffer({ inputCodec: this.outputAudioFormat }),
        );
      }
      this.serverSpans.set(
        itemId,
        this.rootSpan.startSpan({ event: { id: itemId } }),
      );
    } else if (message.type === "response.audio.delta") {
      const id = message.item_id;
      const audioBuffer = this.serverAudioBuffer.get(id);
      if (!audioBuffer) {
        throw new Error(
          `Invalid response ID: ${message.response_id}, item ID: ${id}`,
        );
      }
      audioBuffer.push(message.delta);
    } else if (message.type === "response.audio.done") {
      const itemId = message.item_id;
      const audioBuffer = this.serverAudioBuffer.get(itemId);
      const span = this.serverSpans.get(itemId);
      if (!audioBuffer || !span) {
        throw new Error(
          `Invalid response ID: ${message.response_id}, item ID: ${itemId}`,
        );
      }
      this.closeAudio(audioBuffer, span, "output");
      this.serverAudioBuffer.delete(itemId);
    } else if (
      message.type === "conversation.item.input_audio_transcription.completed"
    ) {
      this.clientSpan?.log({
        input: { transcript: message.transcript },
      });
      // The transcript can never come before we finish logging audio.
      this.clientSpan?.close();
      this.clientSpan = undefined;
    } else if (message.type === "response.done") {
      if (message.response.output.length === 0) {
        console.warn(`Response ID ${message.response.id} had no items`);
      }

      for (const item of message.response.output) {
        const itemId = item.id;
        const span = this.serverSpans.get(itemId);
        if (!span) {
          throw new Error(
            `Invalid response ID: ${message.response.id}, item ID: ${itemId}`,
          );
        }

        if (message.response.usage) {
          span.log({ metadata: { usage: message.response.usage } });
        }

        const itemType = item.type; // Defined for TypeScript narrowing.
        if (itemType === "message") {
          span.log({ output: { content: item.content } });
          span.setAttributes({ name: item.role, type: "llm" });

          span.close();
        } else if (itemType === "function_call") {
          let args: unknown = item.arguments;
          try {
            args = JSON.parse(item.arguments);
          } catch {}

          span.log({ input: { name: item.name, arguments: args } });
          span.setAttributes({ name: "function", type: "function" });

          // Wait for function call output before closing the span.
          this.toolSpans.set(item.call_id, span);
        } else if (itemType === "function_call_output") {
        } else if (itemType === "audio") {
        } else {
          const x: never = itemType;
          console.error(`Unhandled item type ${x}`);
        }

        this.serverSpans.delete(itemId);
      }
    }
  }

  private closeAudio(
    buffer: AudioBuffer,
    span: Braintrust.Span,
    fieldName: "input" | "output",
  ) {
    const [audioFile, fileExt] = buffer.encode(this.compressAudio);
    span.log({
      // TODO: join input/output to the same span.
      [fieldName]: {
        audio: new Braintrust.Attachment({
          data: audioFile,
          filename: `audio.${fileExt}`,
          contentType: audioFile.type,
          state: this.rootSpan.state,
        }),
      },
    });
  }

  /**
   * Close all pending spans.
   */
  public async close() {
    // Check if there is a pending audio buffers.
    if (this.serverAudioBuffer.size || this.clientAudioBuffer) {
      console.warn(
        `Closing with ${this.serverAudioBuffer.size} pending server + ${this.clientAudioBuffer ? 1 : 0} pending client audio buffers`,
      );
    }

    if (this.clientAudioBuffer && this.clientSpan) {
      this.closeAudio(this.clientAudioBuffer, this.clientSpan, "input");
      this.clientAudioBuffer = undefined;
    }
    for (const [responseId, audioBuffer] of this.serverAudioBuffer) {
      const span = this.serverSpans.get(responseId);
      if (!span) {
        continue;
      }
      this.closeAudio(audioBuffer, span, "output");
    }
    this.serverAudioBuffer.clear();

    this.clientSpan?.close();
    this.clientSpan = undefined;

    for (const span of this.serverSpans.values()) {
      span.close();
    }
    this.serverSpans.clear();

    for (const span of this.toolSpans.values()) {
      span.close();
    }
    this.toolSpans.clear();

    const rootSpan = this.rootSpan;
    this.rootSpan = Braintrust.NOOP_SPAN;

    rootSpan.close();
    await rootSpan.flush();
  }
}
