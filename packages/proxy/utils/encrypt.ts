import { z } from "zod";

let _issuedCryptoSubtleWarning = false;
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

export function isCryptoAvailable(): boolean {
  const ret = !!getSubtleCrypto();
  if (!ret) {
    issueCryptoSubtleWarning();
  }
  return ret;
}

export function base64ToArrayBuffer(base64: string) {
  var binaryString = atob(base64);
  var bytes = new Uint8Array(binaryString.length);
  for (var i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export function arrayBufferToBase64(buffer: ArrayBuffer) {
  var binary = "";
  var bytes = new Uint8Array(buffer);
  var len = bytes.byteLength;
  for (var i = 0; i < len; i++) {
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

  const key = await getSubtleCrypto().importKey(
    "raw",
    base64ToArrayBuffer(keyString),
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  const decoded = await getSubtleCrypto().decrypt(
    {
      name: "AES-GCM",
      iv: base64ToArrayBuffer(iv),
    },
    key,
    base64ToArrayBuffer(message),
  );

  return new TextDecoder().decode(decoded);
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

  const key = await getSubtleCrypto().importKey(
    "raw",
    base64ToArrayBuffer(keyString),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const decoded = await getSubtleCrypto().encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    new TextEncoder().encode(message),
  );

  return {
    // TypeScript 5.9.3: Uint8Array.buffer is ArrayBufferLike, need explicit conversion
    iv: arrayBufferToBase64(iv.buffer as ArrayBuffer),
    data: arrayBufferToBase64(decoded),
  };
}
