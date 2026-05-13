import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { proxyV1ToNodeResponse } from "./nodeProxy";

describe("proxyV1ToNodeResponse", () => {
  it("reassembles split application/json chunks", async () => {
    const headers = new Map<string, string>();
    let statusCode = 200;
    const res = new PassThrough();
    const bodyChunks: Buffer[] = [];

    res.on("data", (chunk: Buffer) => {
      bodyChunks.push(chunk);
    });

    await proxyV1ToNodeResponse({
      method: "POST",
      url: "/chat/completions",
      proxyHeaders: {},
      body: "{}",
      setHeader(name, value) {
        headers.set(name, value);
      },
      setStatusCode(code) {
        statusCode = code;
      },
      getApiSecrets: async () => [],
      cacheGet: async () => null,
      cachePut: async () => {},
      digest: async (message) => message,
      getRes: () => res,
      proxyImpl: async ({ res, setHeader }) => {
        setHeader("content-type", "application/json");
        const writer = res.getWriter();
        await writer.write(new TextEncoder().encode('{"ok":'));
        await new Promise((resolve) => setTimeout(resolve, 20));
        await writer.write(new TextEncoder().encode('true,"parts":[1,2]}'));
        await writer.close();
      },
    });

    expect(statusCode).toBe(200);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(Buffer.concat(bodyChunks).toString("utf8"))).toEqual({
      ok: true,
      parts: [1, 2],
    });
  });

  it("streams split SSE frames for stream=true style responses", async () => {
    const headers = new Map<string, string>();
    const res = new PassThrough();
    const bodyChunks: Buffer[] = [];

    res.on("data", (chunk: Buffer) => {
      bodyChunks.push(chunk);
    });

    await proxyV1ToNodeResponse({
      method: "POST",
      url: "/chat/completions",
      proxyHeaders: {},
      body: '{"stream":true}',
      setHeader(name, value) {
        headers.set(name, value);
      },
      setStatusCode() {},
      getApiSecrets: async () => [],
      cacheGet: async () => null,
      cachePut: async () => {},
      digest: async (message) => message,
      getRes: () => res,
      proxyImpl: async ({ res, setHeader }) => {
        setHeader("content-type", "text/event-stream");
        const writer = res.getWriter();
        await writer.write(new TextEncoder().encode('data: {"id":"chunk-1"'));
        await new Promise((resolve) => setTimeout(resolve, 20));
        await writer.write(new TextEncoder().encode("}\n\n"));
        await new Promise((resolve) => setTimeout(resolve, 20));
        await writer.write(new TextEncoder().encode("data: [DONE]\n\n"));
        await writer.close();
      },
    });

    expect(headers.get("content-type")).toBe("text/event-stream");
    expect(Buffer.concat(bodyChunks).toString("utf8")).toBe(
      'data: {"id":"chunk-1"}\n\ndata: [DONE]\n\n',
    );
  });
});
