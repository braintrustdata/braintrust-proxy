import { Writable, Readable } from "node:stream";
import * as crypto from "crypto";

// https://stackoverflow.com/questions/73308289/typescript-error-converting-a-native-fetch-body-webstream-to-a-node-stream
import type * as streamWeb from "node:stream/web";

import { proxyV1 } from "@braintrust/proxy";

import { getRedis } from "./cache";
import { lookupApiSecret } from "./login";

export async function nodeProxyV1({
  method,
  url,
  proxyHeaders,
  body,
  setHeader,
  setStatusCode,
  getRes,
}: {
  method: "GET" | "POST";
  url: string;
  proxyHeaders: any;
  body: any;
  setHeader: (name: string, value: string) => void;
  setStatusCode: (code: number) => void;
  getRes: () => Writable;
}): Promise<void> {
  // Unlike the Cloudflare worker API, which supports public access, this API
  // mandates authentication

  const cacheGet = async (encryptionKey: string, key: string) => {
    const redis = await getRedis();
    if (!redis) {
      return null;
    }
    return await redis.get(key);
  };
  const cachePut = async (
    encryptionKey: string,
    key: string,
    value: string,
    ttl_seconds?: number,
  ) => {
    const redis = await getRedis();
    if (!redis) {
      return;
    }
    redis.set(key, value, {
      // Cache it for a week if no ttl_seconds is provided
      EX: ttl_seconds ?? 60 * 60 * 24 * 7,
    });
  };

  let { readable, writable } = new TransformStream();

  // Note: we must resolve the proxy after forwarding the stream to `res`,
  // because the proxy promise resolves after its internal stream has finished
  // writing.
  const proxyPromise = proxyV1({
    method,
    url,
    proxyHeaders,
    body,
    setHeader,
    setStatusCode,
    res: writable,
    getApiSecrets: lookupApiSecret,
    checkRateLimit: async () => ({ type: "ok" }),
    cacheGet,
    cachePut,
    digest: async (message: string) => {
      return crypto.createHash("md5").update(message).digest("hex");
    },
  });

  const res = getRes();
  const readableNode = Readable.fromWeb(readable as streamWeb.ReadableStream);
  readableNode.pipe(res, { end: true });
  await proxyPromise;
}
