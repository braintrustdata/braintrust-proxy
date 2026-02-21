import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFetchApiSecrets, type EdgeContext, type ProxyOpts } from "./index";

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
});
