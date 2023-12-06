import { Writable, Readable } from "node:stream";
import * as crypto from "crypto";

// https://stackoverflow.com/questions/73308289/typescript-error-converting-a-native-fetch-body-webstream-to-a-node-stream
import type * as streamWeb from "node:stream/web";

import { CacheKeyOptions, proxyV1 } from "@braintrust/proxy";

import { getRedis } from "./cache";
import { lookupApiSecret } from "./login";

async function defaultCacheGet(_encryptionKey: string, key: string) {
  const redis = await getRedis();
  if (!redis) {
    return null;
  }
  return await redis.get(key);
}

async function defaultCachePut(
  _encryptionKey: string,
  key: string,
  value: string,
) {
  const redis = await getRedis();
  if (!redis) {
    return null;
  }
  redis.set(key, value, {
    // Cache it for a week
    EX: 60 * 60 * 24 * 7,
  });
}

export async function nodeProxyV1({
  method,
  url,
  proxyHeaders,
  body,
  setHeader,
  setStatusCode,
  getRes,
  cacheGet,
  cachePut,
  cacheKeyOptions,
}: {
  method: "GET" | "POST";
  url: string;
  proxyHeaders: any;
  body: any;
  setHeader: (name: string, value: string) => void;
  setStatusCode: (code: number) => void;
  getRes: () => Writable;
  cacheGet?: (encryptionKey: string, key: string) => Promise<string | null>;
  cachePut?: (encryptionKey: string, key: string, value: string) => void;
  cacheKeyOptions?: CacheKeyOptions;
}): Promise<void> {
  // Unlike the Cloudflare worker API, which supports public access, this API
  // mandates authentication

  let { readable, writable } = new TransformStream();

  await proxyV1({
    method,
    url,
    proxyHeaders,
    body,
    setHeader,
    setStatusCode,
    res: writable,
    getApiSecrets: lookupApiSecret,
    cacheGet: cacheGet ?? defaultCacheGet,
    cachePut: cachePut ?? defaultCachePut,
    digest: async (message: string) => {
      return crypto.createHash("md5").update(message).digest("hex");
    },
    cacheKeyOptions,
  });

  const res = getRes();
  const readableNode = Readable.fromWeb(readable as streamWeb.ReadableStream);
  readableNode.pipe(res, { end: true });
}
