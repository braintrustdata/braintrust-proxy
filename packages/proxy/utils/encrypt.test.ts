import { describe, expect, test } from "vitest";
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  decryptMessage,
  encryptMessage,
} from "./encrypt";

describe("encrypt utils", () => {
  test("round trips encrypted messages", async () => {
    const key = arrayBufferToBase64(crypto.getRandomValues(new Uint8Array(32)));
    const plaintext = JSON.stringify({
      id: "7395de21-453a-4d5b-a8d0-03c08f0ec25d",
      message: "cache me",
    });

    const encrypted = await encryptMessage(key, plaintext);

    expect(encrypted).toBeDefined();
    if (!encrypted) {
      throw new Error("Expected encrypted payload");
    }
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.data).toBeTruthy();

    const decrypted = await decryptMessage(key, encrypted.iv, encrypted.data);

    expect(decrypted).toBe(plaintext);
  });

  test("preserves bytes through base64 conversion", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const encoded = arrayBufferToBase64(bytes);
    const decoded = new Uint8Array(base64ToArrayBuffer(encoded));

    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });
});
