import { describe, expect, it } from "vitest";

import { proxyV1ToAppRouteResponse } from "./appRouteProxy";

function createSettledTracker(promise: Promise<void>) {
  let settled = false;
  promise.finally(() => {
    settled = true;
  });
  return () => settled;
}

describe("proxyV1ToAppRouteResponse", () => {
  it("reassembles split application/json chunks", async () => {
    const { response, completed } = await proxyV1ToAppRouteResponse({
      method: "POST",
      url: "/chat/completions",
      proxyHeaders: {},
      body: "{}",
      getApiSecrets: async () => [],
      cacheGet: async () => null,
      cachePut: async () => {},
      digest: async (message) => message,
      proxyImpl: async ({ res, setHeader }) => {
        setHeader("content-type", "application/json");
        const writer = res.getWriter();
        await writer.write(new TextEncoder().encode('{"ok":'));
        await new Promise((resolve) => setTimeout(resolve, 20));
        await writer.write(new TextEncoder().encode('true,"parts":[1,2]}'));
        await writer.close();
      },
    });

    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({
      ok: true,
      parts: [1, 2],
    });
    await expect(completed).resolves.toBeUndefined();
  });

  it("streams split SSE frames for stream=true style responses", async () => {
    const { response, completed } = await proxyV1ToAppRouteResponse({
      method: "POST",
      url: "/chat/completions",
      proxyHeaders: {},
      body: '{"stream":true}',
      getApiSecrets: async () => [],
      cacheGet: async () => null,
      cachePut: async () => {},
      digest: async (message) => message,
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

    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toBe(
      'data: {"id":"chunk-1"}\n\ndata: [DONE]\n\n',
    );
    await expect(completed).resolves.toBeUndefined();
  });

  it("returns the app route response before a split JSON stream finishes", async () => {
    let releaseSecondChunk: () => void = () => {};
    const secondChunkReleased = new Promise<void>((resolve) => {
      releaseSecondChunk = resolve;
    });

    const result = await proxyV1ToAppRouteResponse({
      method: "POST",
      url: "/chat/completions",
      proxyHeaders: {},
      body: "{}",
      getApiSecrets: async () => [],
      cacheGet: async () => null,
      cachePut: async () => {},
      digest: async (message) => message,
      proxyImpl: async ({ res, setHeader }) => {
        setHeader("content-type", "application/json");
        const writer = res.getWriter();
        await writer.write(new TextEncoder().encode('{"ok":'));
        await secondChunkReleased;
        await writer.write(new TextEncoder().encode("true}"));
        await writer.close();
      },
    });

    const isCompletedSettled = createSettledTracker(result.completed);
    expect(isCompletedSettled()).toBe(false);

    const bodyPromise = result.response.text();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(isCompletedSettled()).toBe(false);

    releaseSecondChunk();
    expect(await bodyPromise).toBe('{"ok":true}');
    await expect(result.completed).resolves.toBeUndefined();
  });

  it("returns the app route response before a split SSE stream finishes", async () => {
    let releaseDoneFrame: () => void = () => {};
    const doneFrameReleased = new Promise<void>((resolve) => {
      releaseDoneFrame = resolve;
    });

    const result = await proxyV1ToAppRouteResponse({
      method: "POST",
      url: "/chat/completions",
      proxyHeaders: {},
      body: '{"stream":true}',
      getApiSecrets: async () => [],
      cacheGet: async () => null,
      cachePut: async () => {},
      digest: async (message) => message,
      proxyImpl: async ({ res, setHeader }) => {
        setHeader("content-type", "text/event-stream");
        const writer = res.getWriter();
        await writer.write(
          new TextEncoder().encode('data: {"id":"chunk-1"}\n\n'),
        );
        await doneFrameReleased;
        await writer.write(new TextEncoder().encode("data: [DONE]\n\n"));
        await writer.close();
      },
    });

    const isCompletedSettled = createSettledTracker(result.completed);
    expect(result.response.headers.get("content-type")).toBe(
      "text/event-stream",
    );
    expect(isCompletedSettled()).toBe(false);

    const reader = result.response.body?.getReader();
    if (!reader) {
      throw new Error("Expected response body reader");
    }

    const firstChunk = await reader.read();
    expect(new TextDecoder().decode(firstChunk.value)).toBe(
      'data: {"id":"chunk-1"}\n\n',
    );
    expect(firstChunk.done).toBe(false);
    expect(isCompletedSettled()).toBe(false);

    releaseDoneFrame();
    const secondChunk = await reader.read();
    expect(new TextDecoder().decode(secondChunk.value)).toBe(
      "data: [DONE]\n\n",
    );
    expect(secondChunk.done).toBe(false);

    const end = await reader.read();
    expect(end.done).toBe(true);
    await expect(result.completed).resolves.toBeUndefined();
  });
});
