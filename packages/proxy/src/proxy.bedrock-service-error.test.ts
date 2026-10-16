import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BedrockRuntimeClient,
  ValidationException,
} from "@aws-sdk/client-bedrock-runtime";
import { proxyV1, CACHE_HEADER, CREDS_CACHE_HEADER } from "./proxy";
import { type APISecret } from "../schema";

const MALFORMED_MESSAGE =
  "The JSON object in the request body is malformed. Fix the syntax errors and retry your request.";

function bedrockSecret(
  customModels?: Record<string, { format: "converse"; flavor: "chat" }>,
): APISecret {
  return {
    id: "00000000-0000-0000-0000-0000000000b1",
    type: "bedrock",
    name: "my-bedrock",
    secret: "fake-secret-access-key",
    metadata: {
      region: "us-east-1",
      access_key: "fake-access-key-id",
      ...(customModels ? { customModels } : {}),
    },
  };
}

async function runProxy({
  model,
  secrets,
}: {
  model: string;
  secrets: APISecret[];
}): Promise<{ statusCode: number | undefined; body: string }> {
  let statusCode: number | undefined;
  const chunks: Uint8Array[] = [];
  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
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
    setStatusCode: (code) => {
      statusCode = code;
    },
    res: new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk);
      },
      close() {
        resolveClosed();
      },
    }),
    getApiSecrets: async () => secrets,
    cacheGet: async () => null,
    cachePut: async () => {},
    digest: async (message: string) => message,
  });
  await closed;
  return {
    statusCode,
    body: Buffer.concat(chunks).toString("utf8"),
  };
}

function mockBedrockSend(error: unknown) {
  return vi
    .spyOn(BedrockRuntimeClient.prototype, "send")
    .mockImplementation(async () => {
      throw error;
    });
}

describe("bedrock service errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns Bedrock's 4xx status and message for InvokeModel", async () => {
    const send = mockBedrockSend(
      new ValidationException({
        message: MALFORMED_MESSAGE,
        $metadata: { httpStatusCode: 400 },
      }),
    );

    const { statusCode, body } = await runProxy({
      model: "anthropic.claude-sonnet-4-6",
      secrets: [bedrockSecret()],
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(statusCode).toBe(400);
    expect(JSON.parse(body)).toEqual({ message: MALFORMED_MESSAGE });
  });

  it("returns Bedrock's 4xx status and message for Converse", async () => {
    mockBedrockSend(
      new ValidationException({
        message: MALFORMED_MESSAGE,
        $metadata: { httpStatusCode: 400 },
      }),
    );

    const { statusCode, body } = await runProxy({
      model: "custom-converse-model",
      secrets: [
        bedrockSecret({
          "custom-converse-model": { format: "converse", flavor: "chat" },
        }),
      ],
    });

    expect(statusCode).toBe(400);
    expect(JSON.parse(body)).toEqual({ message: MALFORMED_MESSAGE });
  });

  it("still throws errors that are not Bedrock service exceptions", async () => {
    mockBedrockSend(new Error("socket hang up"));

    await expect(
      runProxy({
        model: "anthropic.claude-sonnet-4-6",
        secrets: [bedrockSecret()],
      }),
    ).rejects.toThrow("socket hang up");
  });
});
