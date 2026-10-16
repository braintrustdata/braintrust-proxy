import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BedrockRuntimeClient,
  ValidationException,
} from "@aws-sdk/client-bedrock-runtime";
import { proxyV1, CACHE_HEADER, CREDS_CACHE_HEADER } from "./proxy";
import { type APISecret } from "../schema";

const bedrockSecret: APISecret = {
  id: "00000000-0000-0000-0000-0000000000b1",
  type: "bedrock",
  name: "my-bedrock",
  secret: "fake-secret-access-key",
  metadata: {
    region: "us-east-1",
    access_key: "fake-access-key-id",
    customModels: { "converse-model": { format: "converse", flavor: "chat" } },
  },
};

async function runProxy(model: string) {
  let statusCode: number | undefined;
  const chunks: Uint8Array[] = [];
  let onClose = () => {};
  const closed = new Promise<void>((resolve) => (onClose = resolve));
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
    }),
    setHeader: () => {},
    setStatusCode: (code) => {
      statusCode = code;
    },
    res: new WritableStream<Uint8Array>({
      write: (chunk) => void chunks.push(chunk),
      close: onClose,
    }),
    getApiSecrets: async () => [bedrockSecret],
    cacheGet: async () => null,
    cachePut: async () => {},
    digest: async (message: string) => message,
  });
  await closed;
  return { statusCode, body: Buffer.concat(chunks).toString("utf8") };
}

describe("bedrock service errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["InvokeModel", "anthropic.claude-sonnet-4-6"],
    ["Converse", "converse-model"],
  ])("returns Bedrock's status and message for %s", async (_, model) => {
    vi.spyOn(BedrockRuntimeClient.prototype, "send").mockRejectedValue(
      new ValidationException({
        message: "malformed",
        $metadata: { httpStatusCode: 400 },
      }),
    );

    const { statusCode, body } = await runProxy(model);

    expect(statusCode).toBe(400);
    expect(JSON.parse(body)).toEqual({ message: "malformed" });
  });

  it("still throws errors that are not Bedrock service exceptions", async () => {
    vi.spyOn(BedrockRuntimeClient.prototype, "send").mockRejectedValue(
      new Error("socket hang up"),
    );

    await expect(runProxy("anthropic.claude-sonnet-4-6")).rejects.toThrow(
      "socket hang up",
    );
  });
});
