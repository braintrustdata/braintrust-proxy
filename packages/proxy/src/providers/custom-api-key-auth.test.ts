import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";
import { APISecretSchema } from "../../schema/secrets";
import { callProxyV1 } from "../../utils/tests";

it.each([undefined, "", "Token"])(
  "sends the encrypted provider key in a custom auth header with prefix %s",
  async (prefix) => {
    const key = "gate128-key+/=&<>\"'";
    const received: {
      key: string | undefined;
      authorization: string | undefined;
    }[] = [];
    const server = createServer((request, response) => {
      received.push({
        key: request.headers.apikey?.toString(),
        authorization: request.headers.authorization,
      });
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          id: "custom-auth",
          object: "chat.completion",
          created: 0,
          model: "gpt-5-mini",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
        }),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Missing test server address");
    }
    const secret = APISecretSchema.parse({
      type: "openai",
      name: "custom-auth",
      secret: key,
      metadata: {
        api_base: `http://127.0.0.1:${address.port}/v1`,
        auth_header: "apikey",
        auth_prefix: prefix,
      },
    });
    const metadataBefore = JSON.stringify(secret.metadata);
    try {
      await callProxyV1({
        body: {
          model: "gpt-5-mini",
          messages: [{ role: "user", content: "hello" }],
        },
        getApiSecrets: async () => [secret],
        fetch: globalThis.fetch,
      });
      expect(received).toEqual([
        { key: prefix ? `${prefix} ${key}` : key, authorization: undefined },
      ]);
      expect(JSON.stringify(secret.metadata)).toEqual(metadataBefore);
      expect(metadataBefore).not.toContain(key);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
