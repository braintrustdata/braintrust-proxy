export function exactArrayBuffer(bytes: Uint8Array): ArrayBufferLike {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}
