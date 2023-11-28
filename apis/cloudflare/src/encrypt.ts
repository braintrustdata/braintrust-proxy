function base64ToArrayBuffer(base64: string) {
  var binaryString = atob(base64);
  var bytes = new Uint8Array(binaryString.length);
  for (var i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// https://github.com/mdn/dom-examples/blob/main/web-crypto/encrypt-decrypt/aes-gcm.js
export async function decryptMessage(
  keyString: string,
  iv: string,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToArrayBuffer(keyString),
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  const decoded = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToArrayBuffer(iv),
    },
    key,
    base64ToArrayBuffer(message),
  );

  return new TextDecoder().decode(decoded);
}

export interface EncryptedMessage {
  iv: string;
  data: string;
}

export async function encryptMessage(
  keyString: string,
  message: string,
): Promise<EncryptedMessage> {
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToArrayBuffer(keyString),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const decoded = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    new TextEncoder().encode(message),
  );

  return {
    iv: btoa(String.fromCharCode(...new Uint8Array(iv))),
    data: btoa(String.fromCharCode(...new Uint8Array(decoded))),
  };
}
