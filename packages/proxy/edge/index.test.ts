import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeFetchApiSecrets,
  streamingResponseViaWaitUntil,
  type EdgeContext,
  type ProxyOpts,
} from "./index";

function createInMemoryCache() {
  const store = new Map<string, unknown>();
  let setCalls = 0;

  return {
    cache: {
      async get<T>(key: string): Promise<T | null> {
        return (store.get(key) as T | undefined) ?? null;
      },
      async set<T>(
        key: string,
        value: T,
        _options?: {
          ttl?: number;
        },
      ): Promise<void> {
        setCalls += 1;
        store.set(key, value);
      },
    },
    getSetCalls() {
      return setCalls;
    },
  };
}

describe("makeFetchApiSecrets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not cache fallback credentials when secret lookup fails", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response("unauthorized", {
        status: 401,
        statusText: "Unauthorized",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { cache, getSetCalls } = createInMemoryCache();
    const waitUntilPromises: Promise<unknown>[] = [];
    const ctx: EdgeContext = {
      waitUntil(promise) {
        waitUntilPromises.push(promise);
      },
    };
    const opts: ProxyOpts = {
      getRelativeURL() {
        return "/chat/completions";
      },
      credentialsCache: cache,
      braintrustApiUrl: "https://example.com",
    };
    const fetchApiSecrets = makeFetchApiSecrets({ ctx, opts });

    const first = await fetchApiSecrets(true, "bad-token", null);
    const second = await fetchApiSecrets(true, "bad-token", null);

    await Promise.all(waitUntilPromises);

    expect(first).toEqual([{ secret: "bad-token", type: "openai" }]);
    expect(second).toEqual([{ secret: "bad-token", type: "openai" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getSetCalls()).toBe(0);
  });

  it("accepts embedding custom models from control-plane secrets", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify([
          {
            secret: "provider-secret",
            type: "openai",
            metadata: {
              customModels: {
                "embedding-model": {
                  format: "openai",
                  flavor: "embedding",
                },
              },
            },
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { cache, getSetCalls } = createInMemoryCache();
    const waitUntilPromises: Promise<unknown>[] = [];
    const ctx: EdgeContext = {
      waitUntil(promise) {
        waitUntilPromises.push(promise);
      },
    };
    const opts: ProxyOpts = {
      getRelativeURL() {
        return "/embeddings";
      },
      credentialsCache: cache,
      braintrustApiUrl: "https://example.com",
    };
    const fetchApiSecrets = makeFetchApiSecrets({ ctx, opts });

    const secrets = await fetchApiSecrets(true, "org-token", "embedding-model");
    await Promise.all(waitUntilPromises);

    expect(secrets).toMatchObject([
      {
        secret: "provider-secret",
        type: "openai",
        metadata: {
          customModels: {
            "embedding-model": {
              format: "openai",
              flavor: "embedding",
            },
          },
        },
      },
    ]);
    expect(getSetCalls()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("parses control-plane secrets and caches successful lookups", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify([
          {
            secret: "provider-secret",
            type: "openai",
            metadata: {
              api_base: "https://api.openai.com",
              endpoint_path: "/v1/chat/completions",
            },
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { cache, getSetCalls } = createInMemoryCache();
    const waitUntilPromises: Promise<unknown>[] = [];
    const ctx: EdgeContext = {
      waitUntil(promise) {
        waitUntilPromises.push(promise);
      },
    };
    const opts: ProxyOpts = {
      getRelativeURL() {
        return "/chat/completions";
      },
      credentialsCache: cache,
      braintrustApiUrl: "https://example.com",
    };
    const fetchApiSecrets = makeFetchApiSecrets({ ctx, opts });

    const secrets = await fetchApiSecrets(true, "org-token", null);
    await Promise.all(waitUntilPromises);

    expect(secrets).toHaveLength(1);
    expect(secrets[0]).toMatchObject({
      secret: "provider-secret",
      type: "openai",
      metadata: {
        api_base: "https://api.openai.com",
        endpoint_path: "/v1/chat/completions",
      },
    });
    expect(getSetCalls()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("streamingResponseViaWaitUntil", () => {
  function setup() {
    const waitUntilPromises: Promise<unknown>[] = [];
    const ctx: EdgeContext = {
      waitUntil(promise) {
        waitUntilPromises.push(promise);
      },
    };
    const wrapWithMeter = (b: ReadableStream<Uint8Array>) => b;
    return { waitUntilPromises, ctx, wrapWithMeter };
  }

  it("waits for the first byte before returning Response", async () => {
    const { ctx, wrapWithMeter } = setup();
    const encoder = new TextEncoder();

    let returnedResponse = false;
    let firstWriteAt = -1;
    let responseAt = -1;
    let tick = 0;

    const runProxy = async (res: WritableStream<Uint8Array>) => {
      (async () => {
        await new Promise((r) => setTimeout(r, 20));
        const writer = res.getWriter();
        firstWriteAt = ++tick;
        await writer.write(encoder.encode("hello "));
        await writer.write(encoder.encode("world"));
        await writer.close();
      })();
    };

    const responsePromise = streamingResponseViaWaitUntil({
      ctx,
      wrapWithMeter,
      runProxy,
      getStatus: () => 200,
      getHeaders: () => ({ "content-type": "text/plain" }),
    }).then((r) => {
      responseAt = ++tick;
      returnedResponse = true;
      return r;
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(returnedResponse).toBe(false);

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(firstWriteAt).toBeGreaterThan(0);
    expect(responseAt).toBeGreaterThan(firstWriteAt);

    const text = await response.text();
    expect(text).toBe("hello world");
  });

  it("returns a 400 response when runProxy throws before writing", async () => {
    const { ctx, wrapWithMeter } = setup();

    const runProxy = async () => {
      throw new Error("boom");
    };

    const response = await streamingResponseViaWaitUntil({
      ctx,
      wrapWithMeter,
      runProxy,
      getStatus: () => 200,
      getHeaders: () => ({}),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("boom");
  });

  it("keeps the platform alive via ctx.waitUntil until the pipe drains", async () => {
    const { waitUntilPromises, ctx, wrapWithMeter } = setup();
    const encoder = new TextEncoder();
    let pipeFinished = false;

    const runProxy = async (res: WritableStream<Uint8Array>) => {
      (async () => {
        const writer = res.getWriter();
        await writer.write(encoder.encode("first"));
        await new Promise((r) => setTimeout(r, 30));
        await writer.write(encoder.encode("-second"));
        await writer.close();
        pipeFinished = true;
      })();
    };

    const response = await streamingResponseViaWaitUntil({
      ctx,
      wrapWithMeter,
      runProxy,
      getStatus: () => 200,
      getHeaders: () => ({}),
    });

    expect(pipeFinished).toBe(false);
    expect(waitUntilPromises.length).toBe(1);

    const text = await response.text();
    expect(text).toBe("first-second");

    await Promise.all(waitUntilPromises);
    await new Promise((r) => setTimeout(r, 0));
    expect(pipeFinished).toBe(true);
  });
});
