import { describe, expect, it } from "vitest";
import { proxyV1 } from "./proxy";

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
});
