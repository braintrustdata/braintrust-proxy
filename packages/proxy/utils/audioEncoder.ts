import { Mp3Bitrate, PcmAudioFormat } from "@schema/audio";
import { Mp3Encoder } from "@breezystack/lamejs";

export function makeWavFile(
  format: PcmAudioFormat,
  buffers: ArrayBufferLike[],
): Blob {
  if (
    format.name === "pcm" &&
    (format.byte_order !== "little" || format.bits_per_sample % 8 !== 0)
  ) {
    throw new Error(`Unsupported PCM format: ${JSON.stringify(format)}`);
  }

  if (format.name === "pcm" && format.number_encoding === "float") {
    // TODO(kevin): This path is untested.
    // TODO(kevin): This should probably just result in a float WAV file.
    format = {
      ...format,
      number_encoding: "int",
      byte_order: "little",
      bits_per_sample: 16,
    };
    // TypeScript 5.9.3: Int16Array<ArrayBuffer> is compatible with ArrayBufferLike
    buffers = buffers.map((buffer) =>
      floatTo16BitPCM(new Float32Array(buffer)),
    ) as unknown as ArrayBufferLike[];
  }

  const dataLength = buffers.reduce((sum, b) => sum + b.byteLength, 0);

  const bitsPerSample = format.name === "pcm" ? format.bits_per_sample : 8;

  // http://soundfile.sapp.org/doc/WaveFormat/
  const blobParts = [
    // Header.
    "RIFF",
    // Length.
    pack(
      1,
      4 + // "WAVE" length.
        (8 + 16) + // Chunk 1 length.
        (8 + dataLength), // Chunk 2 length.
    ),
    "WAVE",
    // Chunk 1.
    "fmt ",
    pack(1, 16), // Chunk length.
    pack(0, wavFormatCode(format)), // Audio format (1 is linear quantization).
    pack(0, format.channels),
    pack(1, format.sample_rate),
    pack(1, (format.sample_rate * format.channels * bitsPerSample) / 8), // Byte rate.
    pack(0, (format.channels * bitsPerSample) / 8),
    pack(0, bitsPerSample),
    // Chunk 2.
    "data",
    pack(1, dataLength), // Chunk length.
    ...buffers,
  ];

  // TypeScript 5.9.3: BlobPart accepts ArrayBufferLike, but type checking is stricter
  return new Blob(blobParts as BlobPart[], { type: "audio/wav" });
}

function wavFormatCode(format: PcmAudioFormat) {
  const name = format.name; // Need local variable to pass type checker.
  switch (name) {
    case "pcm":
      return 0x0001;
    case "g711": {
      switch (format.algorithm) {
        case "a":
          return 0x0006;
        case "mu":
          return 0x0007;
        default:
          const x: never = format.algorithm;
          throw new Error(x);
      }
    }
    default:
      const x: never = name;
      throw new Error(x);
  }
}

/**
 * Pack a number into a byte array.
 * @param size Pass `0` for 16-bit output, or `1` for 32-bit output. Large
 * values will be truncated.
 * @param arg Integer to pack.
 * @returns Byte array with the integer.
 */
function pack(size: 0 | 1, arg: number) {
  return new Uint8Array(
    size === 0 ? [arg, arg >> 8] : [arg, arg >> 8, arg >> 16, arg >> 24],
  );
}

function floatTo16BitPCM(float32Array: Float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Int16Array(buffer);
}

export function makeMp3File(
  inputCodec: PcmAudioFormat,
  bitrate: Mp3Bitrate,
  buffers: ArrayBufferLike[],
): Blob {
  if (inputCodec.name !== "pcm") {
    throw new Error("Unsupported input codec");
  }
  if (
    inputCodec.bits_per_sample !== 16 ||
    inputCodec.byte_order !== "little" ||
    inputCodec.channels !== 1
  ) {
    throw new Error("Unsupported input encoding");
  }
  const minBitrate: Mp3Bitrate = 40;
  if (bitrate < minBitrate) {
    // Possible bug in lamejs that results in a silent file when bitrate <= 32.
    console.warn(`Adjusting bitrate ${bitrate} -> ${minBitrate}`);
    bitrate = minBitrate;
  }

  const encoder = new Mp3Encoder(
    inputCodec.channels,
    inputCodec.sample_rate,
    bitrate,
  );

  const blobParts: BlobPart[] = [];

  for (const buffer of buffers) {
    const int16Buffer =
      inputCodec.number_encoding === "int"
        ? new Int16Array(buffer)
        : floatTo16BitPCM(new Float32Array(buffer));
    const encoded = encoder.encodeBuffer(int16Buffer);
    if (encoded.length) {
      // TypeScript 5.9.3: Uint8Array<ArrayBufferLike> is compatible with BlobPart
      blobParts.push(encoded as BlobPart);
    }
  }

  // TypeScript 5.9.3: encoder.flush() returns Uint8Array<ArrayBufferLike> which is compatible with BlobPart
  blobParts.push(encoder.flush() as BlobPart);

  return new Blob(blobParts, { type: "audio/mpeg" });
}
