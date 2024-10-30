import { Mp3Bitrate, PcmAudioFormat } from "@schema";
import { Mp3Encoder } from "@breezystack/lamejs";

export function makeWavFile(format: PcmAudioFormat, buffers: string[]): Blob {
  if (
    format.name === "pcm" &&
    (format.byte_order !== "little" || format.bits_per_sample % 8 !== 0)
  ) {
    throw new Error(`Unsupported PCM format: ${JSON.stringify(format)}`);
  }

  const bitsPerSample = format.name === "pcm" ? format.bits_per_sample : 8;

  const data = (() => {
    const binary = base64ToArrayBuffer(buffers);
    if (
      (format.name === "pcm" && format.number_encoding === "int") ||
      format.name === "g711"
    ) {
      return binary;
    } else if (format.number_encoding === "float") {
      // TODO(kevin): This path is untested.
      // TODO(kevin): This should probably just result in a float WAV file.
      format = {
        ...format,
        number_encoding: "int",
        byte_order: "little",
        bits_per_sample: 16,
      };
      return floatTo16BitPCM(new Float32Array(binary));
    } else {
      throw new Error(
        `Unsupported input audio format ${JSON.stringify(format)}`,
      );
    }
  })();

  // http://soundfile.sapp.org/doc/WaveFormat/
  const output = [
    // Header.
    "RIFF",
    // Length.
    pack(
      1,
      4 + // "WAVE" length.
        (8 + 16) + // Chunk 1 length.
        (8 + data.byteLength), // Chunk 2 length.
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
    pack(1, data.byteLength), // Chunk length.
    data,
  ];

  return new Blob(output, { type: "audio/wav" });
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

function base64ToArrayBuffer(base64Strings: string[]) {
  // Compute the total length upfront so we allocate `bytes` once.
  const binaryStrings = base64Strings.map(atob);
  const len = binaryStrings.reduce((sum, s) => sum + s.length, 0);
  const bytes = new Uint8Array(len);
  let i = 0;
  binaryStrings.forEach((s) => {
    for (let j = 0; j < s.length; i++, j++) {
      bytes[i] = s.charCodeAt(j);
    }
  });
  return bytes;
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
  buffers: string[],
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

  const encoder = new Mp3Encoder(
    inputCodec.channels,
    inputCodec.sample_rate,
    bitrate,
  );

  const blobParts: ArrayBuffer[] = [];

  for (const base64Buffer of buffers) {
    const binary = base64ToArrayBuffer([base64Buffer]);
    const int16Buffer =
      inputCodec.number_encoding === "int"
        ? new Int16Array(binary.buffer)
        : floatTo16BitPCM(new Float32Array(binary));
    const encoded = encoder.encodeBuffer(int16Buffer);
    if (encoded.length) {
      blobParts.push(encoded);
    }
  }

  blobParts.push(encoder.flush());

  return new Blob(blobParts, { type: "audio/mpeg" });
}
