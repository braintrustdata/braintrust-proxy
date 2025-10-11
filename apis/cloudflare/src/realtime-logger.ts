import * as Braintrust from "braintrust";
import { makeWavFile, makeMp3File } from "@braintrust/proxy/utils";
import {
  openAiRealtimeMessageSchema,
  PcmAudioFormat,
  ProxyLoggingParam,
} from "@braintrust/proxy/schema";
import { Cache as EdgeCache } from "@braintrust/proxy/edge";
import { cachedLogin } from "./tracing";

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
  private baseTimeMs: number;
  private readonly bytesPerSample: number;

  constructor({ inputCodec }: { inputCodec: PcmAudioFormat }) {
    this.inputCodec = inputCodec;
    this.audioBuffers = [];
    this.totalByteLength = 0;
    this.baseTimeMs = 0;
    this.bytesPerSample =
      this.inputCodec.name === "pcm" ? this.inputCodec.bits_per_sample / 8 : 1;
  }

  push(base64AudioBuffer: string): void {
    const binaryAudioBuffer = Buffer.from(base64AudioBuffer, "base64").buffer;
    this.audioBuffers.push(binaryAudioBuffer);
    this.totalByteLength += binaryAudioBuffer.byteLength;

    // May run out of memory on Cloudflare Workers.
    if (this.totalByteLength > maxAudioBufferBytes) {
      let i = 0;
      let trimmedBytes = 0;
      while (
        i < this.audioBuffers.length &&
        this.totalByteLength > targetAudioBufferBytes
      ) {
        this.totalByteLength -= this.audioBuffers[i].byteLength;
        trimmedBytes += this.audioBuffers[i].byteLength;
        i++;
      }
      this.audioBuffers = this.audioBuffers.slice(i + 1);
      this.baseTimeMs +=
        (trimmedBytes / (this.bytesPerSample * this.inputCodec.sample_rate)) *
        1000;
      console.warn(
        `Trimmed ${trimmedBytes} bytes from audio buffer; now ${this.totalByteLength} bytes total`,
      );
    }
  }

  trimStart(startTimeMs: number) {
    let startByteIndex = this.timestampToByteIndex(startTimeMs);

    let i = 0;
    while (
      i < this.audioBuffers.length &&
      startByteIndex > this.audioBuffers[i].byteLength
    ) {
      startByteIndex -= this.audioBuffers[i].byteLength;
      i++;
    }
    this.audioBuffers = this.audioBuffers.slice(i + 1);

    if (this.audioBuffers.length) {
      this.audioBuffers[0] = this.audioBuffers[0]?.slice(startByteIndex);
    }

    this.baseTimeMs = startTimeMs;
  }

  get byteLength(): number {
    return this.totalByteLength;
  }

  encode(compress: boolean, endTimeMs?: number): [Blob, string] {
    let slicedBuffers = this.audioBuffers;
    let totalByteLength = this.totalByteLength;
    if (endTimeMs) {
      let endByteIndex = this.timestampToByteIndex(endTimeMs);
      let i = this.audioBuffers.length - 1;
      while (i >= 0 && endByteIndex > totalByteLength) {
        totalByteLength -= this.audioBuffers[i].byteLength;
        i--;
      }
      slicedBuffers = this.audioBuffers.slice(0, i + 1);
      if (slicedBuffers.length) {
        const end = slicedBuffers.length - 1;
        slicedBuffers[end] = slicedBuffers[end].slice(
          0,
          totalByteLength - endByteIndex + 1,
        );
      }
    }

    if (compress && this.inputCodec.name !== "g711") {
      return [makeMp3File(this.inputCodec, 40, slicedBuffers), "mp3"];
    } else {
      return [makeWavFile(this.inputCodec, slicedBuffers), "wav"];
    }
  }

  private timestampToByteIndex(timestampMs: number): number {
    return (
      Math.round(
        ((timestampMs - this.baseTimeMs) / 1000) * this.inputCodec.sample_rate,
      ) * this.bytesPerSample
    );
  }
}

type AudioFormatType = "pcm16" | "g711_ulaw" | "g711_alaw";

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
  private turnDetectionEnabled: boolean = false;

  constructor({
    state,
    parent,
    compressAudio,
  }: {
    state: Braintrust.BraintrustState;
    parent: string;
    compressAudio: boolean;
  }) {
    this.rootSpan = Braintrust.startSpan({
      name: "Realtime session",
      type: "task",
      state,
      parent,
    });
    this.serverAudioBuffer = new Map();
    this.serverSpans = new Map();
    this.toolSpans = new Map();
    this.compressAudio = compressAudio;
  }

  public static async make({
    apiKey,
    orgName,
    appUrl,
    cache,
    loggingParams,
  }: {
    apiKey: string;
    orgName?: string;
    appUrl: string;
    cache: EdgeCache;
    loggingParams: ProxyLoggingParam;
  }): Promise<OpenAiRealtimeLogger | undefined> {
    const state = await cachedLogin({
      appUrl,
      apiKey,
      orgName,
      cache,
    });
    return new OpenAiRealtimeLogger({
      state,
      parent: loggingParams.parent,
      compressAudio: loggingParams.compress_audio ?? false,
    });
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
      this.turnDetectionEnabled = !!message.session.turn_detection;
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
    } else if (message.type === "input_audio_buffer.speech_started") {
      if (!this.clientAudioBuffer) {
        throw new Error();
      }
      this.clientAudioBuffer.trimStart(message.audio_start_ms);
    } else if (message.type === "input_audio_buffer.speech_stopped") {
      if (!this.clientAudioBuffer || !this.clientSpan) {
        throw new Error();
      }
      this.closeAudio(
        this.clientAudioBuffer,
        this.clientSpan,
        "input",
        message.audio_end_ms,
      );
      // Do not reset the audio buffer in VAD mode so that we can keep the start time.
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
    endTimeMs?: number,
  ) {
    const [audioFile, fileExt] = buffer.encode(this.compressAudio, endTimeMs);
    span.log({
      // TODO: join input/output to the same span.
      [fieldName]: {
        audio: new Braintrust.Attachment({
          data: audioFile,
          filename: `audio.${fileExt}`,
          contentType: audioFile.type,
          state: this.rootSpan.state(),
        }),
      },
    });
  }

  /**
   * Close all pending spans.
   */
  public async close() {
    // Pending client audio buffer is allowed in VAD mode.
    if (this.turnDetectionEnabled) {
      this.clientAudioBuffer = undefined;
    }

    // Check if there is a pending audio buffers.
    if (this.serverAudioBuffer.size || this.clientAudioBuffer) {
      console.warn(
        `Closing with ${this.serverAudioBuffer.size} pending server + ${
          this.clientAudioBuffer ? 1 : 0
        } pending client audio buffers`,
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
