import { describe, expect, it } from "vitest";
import { BillingEvent, proxyV1 } from "./proxy";

describe("proxy org selection", () => {
  it("rejects conflicting header and path org selectors before secret lookup", async () => {
    await expect(
      proxyV1({
        method: "POST",
        url: "/btorg/effective-org/chat/completions",
        proxyHeaders: {
          authorization: "Bearer test-token",
          "x-bt-org-name": "header-org",
        },
        body: JSON.stringify({
          model: "braintrust-native-model",
          messages: [{ role: "user", content: "hi" }],
        }),
        setHeader: () => {},
        setStatusCode: () => {},
        res: new WritableStream<Uint8Array>({ write() {} }),
        getApiSecrets: async () => {
          throw new Error("getApiSecrets should not be called");
        },
        cacheGet: async () => null,
        cachePut: async () => {},
        digest: async (message: string) => message,
      }),
    ).rejects.toThrow(/Conflicting organization selectors/);
  });

  it("forwards embedding prompt tokens to billing events", async () => {
    const billingEvents: BillingEvent[] = [];
    let resolveStreamClosed: () => void = () => {};
    const streamClosed = new Promise<void>((resolve) => {
      resolveStreamClosed = resolve;
    });

    await proxyV1({
      method: "POST",
      url: "/embeddings",
      proxyHeaders: {
        authorization: "Bearer test-token",
        "cache-control": "no-store",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: "hello",
      }),
      setHeader: () => {},
      setStatusCode: () => {},
      res: new WritableStream<Uint8Array>({
        write() {},
        close() {
          resolveStreamClosed();
        },
      }),
      getApiSecrets: async () => [
        {
          secret: "provider-token",
          type: "openai",
        },
      ],
      cacheGet: async () => null,
      cachePut: async () => {},
      digest: async (message: string) => message,
      customFetch: async () =>
        new Response(
          JSON.stringify({
            object: "list",
            data: [
              {
                object: "embedding",
                embedding: [0.1, 0.2, 0.3],
                index: 0,
              },
            ],
            model: "text-embedding-3-small",
            usage: {
              prompt_tokens: 7,
              total_tokens: 7,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      onBillingEvent: (event) => {
        billingEvents.push(event);
      },
    });

    await streamClosed;

    expect(billingEvents).toHaveLength(1);
    expect(billingEvents[0]).toMatchObject({
      event_name: "NativeInferenceTokenUsageEvent",
      auth_token: "test-token",
      model: "text-embedding-3-small",
      input_tokens: 7,
    });
    expect(billingEvents[0].output_tokens).toBeUndefined();
  });
});
