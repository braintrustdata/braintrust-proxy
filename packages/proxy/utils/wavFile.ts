import { AudioCodec } from "@schema";

export function makeWavFile(codec: AudioCodec, buffers: string[]): Blob {
  if (
    codec.name === "pcm" &&
    (codec.byte_order !== "little" || codec.bits_per_sample % 8 !== 0)
  ) {
    throw new Error(`Unsupported audio format ${JSON.stringify(codec)}`);
  }

  const data = (() => {
    const binary = base64ToArrayBuffer(buffers);
    if (
      (codec.name === "pcm" && codec.number_encoding === "int") ||
      codec.name === "g711"
    ) {
      return binary;
    } else if (codec.number_encoding === "float") {
      // TODO(kevin): This path is untested.
      codec = {
        ...codec,
        number_encoding: "int",
        byte_order: "little",
        bits_per_sample: 16,
      };
      return floatTo16BitPCM(new Float32Array(binary));
    } else {
      throw new Error(
        `Unsupported input audio format ${JSON.stringify(codec)}`,
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
    pack(0, wavFormatCode(codec)), // Audio format (1 is linear quantization).
    pack(0, codec.channels),
    pack(1, codec.sample_rate),
    pack(1, (codec.sample_rate * codec.channels * codec.bits_per_sample) / 8), // Byte rate.
    pack(0, (codec.channels * codec.bits_per_sample) / 8),
    pack(0, codec.bits_per_sample),
    // Chunk 2.
    "data",
    pack(1, data.byteLength), // Chunk length.
    data,
  ];

  return new Blob(output, { type: "audio/wav" });
}

function wavFormatCode(codec: AudioCodec) {
  const name = codec.name; // Need local variable to pass type checker.
  switch (name) {
    case "pcm":
      return 0x0001;
    case "g711": {
      switch (codec.algorithm) {
        case "a":
          return 0x0006;
        case "mu":
          return 0x0007;
        default:
          const x: never = codec.algorithm;
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
 * @param size Pass `0` for 16-bit output, or `1` for 32-bit output. Large values will be truncated.
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
  return buffer;
}
