import { describe, expect, it } from "vitest";

import { nodeStreamingResponseViaPassThrough } from "./nodeProxy";

describe("nodeStreamingResponseViaPassThrough", () => {
  it("returns application/json bodies", async () => {
    const encoder = new TextEncoder();

    const response = await nodeStreamingResponseViaPassThrough({
      runProxy: async (res) => {
        const writer = res.getWriter();
        await writer.write(encoder.encode(JSON.stringify({ ok: true })));
        await writer.close();
      },
      getStatus: () => 200,
      getHeaders: () => ({ "content-type": "application/json" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("streams multiple chunks through a node PassThrough body", async () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const waitUntilPromises: Promise<unknown>[] = [];
    let returnedResponse = false;

    const responsePromise = nodeStreamingResponseViaPassThrough({
      runProxy: async (res) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const writer = res.getWriter();
        await writer.write(encoder.encode("data: first\n\n"));
        await new Promise((resolve) => setTimeout(resolve, 20));
        await writer.write(encoder.encode("data: second\n\n"));
        await writer.close();
      },
      getStatus: () => 200,
      getHeaders: () => ({ "content-type": "text/event-stream" }),
      waitUntil(promise) {
        waitUntilPromises.push(promise);
      },
    }).then((response) => {
      returnedResponse = true;
      return response;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(returnedResponse).toBe(false);

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected response body");
    }

    const first = await reader.read();
    const second = await reader.read();
    const third = await reader.read();

    expect(decoder.decode(first.value)).toBe("data: first\n\n");
    expect(decoder.decode(second.value)).toBe("data: second\n\n");
    expect(third.done).toBe(true);
    expect(waitUntilPromises).toHaveLength(1);
    await expect(Promise.all(waitUntilPromises)).resolves.toBeDefined();
  });
});
