import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";
import { APISecretSchema } from "../../schema/secrets";
import { callProxyV1 } from "../../utils/tests";

it.each(
  [undefined, "", "Token"].flatMap((prefix) =>
    ["/chat/completions", "/responses"].flatMap((url) =>
      [false, true].map((redirect) => ({ prefix, url, redirect })),
    ),
  ),
)(
  "preserves credential bytes for $url with prefix $prefix and redirect=$redirect",
  async ({ prefix, url, redirect }) => {
    const key = "gate128-key+/=&<>\"'";
    const received: {
      key: string | undefined;
      authorization: string | undefined;
    }[] = [];
    let redirectedRequests = 0;
    const target = createServer((_request, response) => {
      redirectedRequests += 1;
      response.end("{}");
    });
    target.listen(0, "127.0.0.1");
    await once(target, "listening");
    const targetAddress = target.address();
    if (!targetAddress || typeof targetAddress === "string") {
      throw new Error("Missing redirect target address");
    }
    const server = createServer((request, response) => {
      received.push({
        key: request.headers.apikey?.toString(),
        authorization: request.headers.authorization,
      });
      if (redirect) {
        response.writeHead(307, {
          Location: `http://127.0.0.1:${targetAddress.port}/redirected`,
        });
        response.end();
        return;
      }
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
        api_key_header: "apikey",
        api_key_prefix: prefix,
      },
    });
    const metadataBefore = JSON.stringify(secret.metadata);
    try {
      const result = await callProxyV1({
        url,
        body:
          url === "/responses"
            ? { model: "gpt-5-mini", input: "hello" }
            : {
                model: "gpt-5-mini",
                messages: [{ role: "user", content: "hello" }],
              },
        getApiSecrets: async () => [secret],
        fetch: globalThis.fetch,
      });
      if (redirect) {
        expect(result.statusCode).toBe(307);
      }
      expect(redirectedRequests).toBe(0);
      expect(received).toEqual([
        { key: prefix ? `${prefix} ${key}` : key, authorization: undefined },
      ]);
      expect(JSON.stringify(secret.metadata)).toEqual(metadataBefore);
      expect(metadataBefore).not.toContain(key);
    } finally {
      await Promise.all(
        [server, target].map(async (server) => {
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        }),
      );
    }
  },
);
