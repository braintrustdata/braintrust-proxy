import { describe, it, expect } from "vitest";
import { proxyV1, CACHE_HEADER, CREDS_CACHE_HEADER } from "./proxy";
import { type APISecret } from "../schema";

const bedrockSecret: APISecret = {
  id: "00000000-0000-0000-0000-0000000000b1",
  type: "bedrock",
  name: "my-bedrock",
  secret: "fake-secret-access-key",
  metadata: { region: "us-east-1", access_key: "fake-access-key-id" },
};

const openaiSecret: APISecret = {
  id: "00000000-0000-0000-0000-0000000000a1",
  type: "openai",
  name: "my-openai",
  secret: "sk-fake-openai-key",
  metadata: {},
};

function fakeOpenAIResponse(): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function runProxy({
  model,
  secrets,
  customFetch,
}: {
  model: string;
  secrets: APISecret[];
  customFetch: (
    url: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
}): Promise<void> {
  await proxyV1({
    method: "POST",
    url: "/chat/completions",
    proxyHeaders: {
      authorization: "Bearer test-token",
      [CACHE_HEADER]: "never",
      [CREDS_CACHE_HEADER]: "never",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    }),
    setHeader: () => {},
    setStatusCode: () => {},
    res: new WritableStream<Uint8Array>({ write() {} }),
    getApiSecrets: async () => secrets,
    cacheGet: async () => null,
    cachePut: async () => {},
    digest: async (message: string) => message,
    customFetch: customFetch as typeof globalThis.fetch,
  });
}

describe("bedrock secret skipped for openai-format models (#18324)", () => {
  it("uses a compatible secret instead of hard-failing when bedrock is a candidate", async () => {
    // Run repeatedly: fetchModelLoop picks a random starting secret, so without
    // the skip this would intermittently route to the bedrock secret and throw
    // "Bedrock does not support OpenAI format".
    for (let attempt = 0; attempt < 25; attempt++) {
      const fetched: string[] = [];
      const customFetch = async (url: RequestInfo | URL) => {
        fetched.push(url.toString());
        return fakeOpenAIResponse();
      };

      await runProxy({
        model: "gpt-4o",
        secrets: [bedrockSecret, openaiSecret],
        customFetch,
      });

      expect(fetched).toHaveLength(1);
      expect(fetched[0]).toContain("openai.com");
    }
  });

  it("returns a clear no-keys error (not the bedrock format error) when only bedrock is configured", async () => {
    await expect(
      runProxy({
        model: "gpt-4o",
        secrets: [bedrockSecret],
        customFetch: async () => {
          throw new Error("customFetch should not be called");
        },
      }),
    ).rejects.toThrow(/No API keys found/);
  });

  it("still routes anthropic-format models to a bedrock secret (no over-skipping)", async () => {
    // The bedrock secret must remain eligible for claude (anthropic format),
    // which Bedrock can serve. With fake creds the AWS SDK call fails, but the
    // failure must NOT be our "No API keys found" skip path.
    await expect(
      runProxy({
        model: "claude-3-5-sonnet-20240620",
        secrets: [bedrockSecret],
        customFetch: async () => fakeOpenAIResponse(),
      }),
    ).rejects.not.toThrow(/No API keys found/);
  });
});
