import { describe, expect, test } from "vitest";
import { exactArrayBuffer } from "./array-buffer";

describe("exactArrayBuffer", () => {
  test("copies only the decoded Buffer view", () => {
    const encoded = Buffer.from([1, 2, 3]).toString("base64");
    const decoded = Buffer.from(encoded, "base64");

    expect(decoded.byteOffset).toBeGreaterThan(0);
    expect(decoded.buffer.byteLength).toBeGreaterThan(decoded.byteLength);

    const exact = exactArrayBuffer(decoded);

    expect(exact.byteLength).toBe(decoded.byteLength);
    expect(Array.from(new Uint8Array(exact))).toEqual([1, 2, 3]);
  });
});
