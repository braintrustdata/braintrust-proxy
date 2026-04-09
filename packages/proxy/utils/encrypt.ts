import { z } from "zod";

let _issuedCryptoSubtleWarning = false;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const MAX_IMPORTED_KEY_CACHE_SIZE = 1024;
const importedEncryptionKeys = new Map<string, Promise<CryptoKey>>();

function issueCryptoSubtleWarning() {
  if (!_issuedCryptoSubtleWarning) {
    console.warn(
      "Crypto utils are not supported in this browser. Skipping any crypto-related functionality (such as realtime)",
    );
    _issuedCryptoSubtleWarning = true;
  }
}

function getSubtleCrypto() {
  return globalThis.crypto.subtle;
}

function hasBuffer(
  value: typeof globalThis,
): value is typeof globalThis & { Buffer: typeof Buffer } {
  return "Buffer" in value && typeof value.Buffer?.from === "function";
}

function trimImportedKeyCache() {
  while (importedEncryptionKeys.size > MAX_IMPORTED_KEY_CACHE_SIZE) {
    const oldestKey = importedEncryptionKeys.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    importedEncryptionKeys.delete(oldestKey);
  }
}

function base64ToBytes(base64: string): Uint8Array {
  if (hasBuffer(globalThis)) {
    return Uint8Array.from(globalThis.Buffer.from(base64, "base64"));
  }

  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function getImportedEncryptionKey(keyString: string): Promise<CryptoKey> {
  let importedKey = importedEncryptionKeys.get(keyString);
  if (!importedKey) {
    importedKey = getSubtleCrypto().importKey(
      "raw",
      base64ToBytes(keyString),
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    importedEncryptionKeys.set(keyString, importedKey);
    trimImportedKeyCache();
  }

  return importedKey;
}

export function isCryptoAvailable(): boolean {
  const ret = !!getSubtleCrypto();
  if (!ret) {
    issueCryptoSubtleWarning();
  }
  return ret;
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  return base64ToBytes(base64).buffer;
}

export function arrayBufferToBase64(buffer: ArrayBuffer | ArrayBufferView) {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  if (hasBuffer(globalThis)) {
    return globalThis.Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// https://github.com/mdn/dom-examples/blob/main/web-crypto/encrypt-decrypt/aes-gcm.js
export async function decryptMessage(
  keyString: string,
  iv: string,
  message: string,
): Promise<string | undefined> {
  if (!isCryptoAvailable()) return undefined;

  const decoded = await getSubtleCrypto().decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(iv),
    },
    await getImportedEncryptionKey(keyString),
    base64ToBytes(message),
  );

  return textDecoder.decode(decoded);
}

export const encryptedMessageSchema = z.strictObject({
  iv: z.string(),
  data: z.string(),
});
export type EncryptedMessage = z.infer<typeof encryptedMessageSchema>;

export async function encryptMessage(
  keyString: string,
  message: string,
): Promise<EncryptedMessage | undefined> {
  if (!isCryptoAvailable()) return undefined;

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const decoded = await getSubtleCrypto().encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    await getImportedEncryptionKey(keyString),
    textEncoder.encode(message),
  );

  return {
    iv: arrayBufferToBase64(iv),
    data: arrayBufferToBase64(decoded),
  };
}
