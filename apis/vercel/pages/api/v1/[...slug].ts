import dns from "node:dns";
import { kv } from "@vercel/kv";
import { waitUntil } from "@vercel/functions";
import { EdgeProxyV1, CacheSetOptions } from "@braintrust/proxy/edge";
import { Agent, setGlobalDispatcher } from "undici";

dns.setDefaultResultOrder("ipv4first");

setGlobalDispatcher(
  new Agent({
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
  }),
);

const KVCache = {
  get: kv.get,
  set: async <T>(key: string, value: T, opts: CacheSetOptions) => {
    await kv.set(
      key,
      value,
      opts.ttl !== undefined
        ? {
            ex: opts.ttl,
          }
        : {},
    );
  },
};

const handler = EdgeProxyV1({
  getRelativeURL: (request) => {
    const url = new URL(request.url);
    const params = url.searchParams.getAll("slug");
    return "/" + params.join("/");
  },
  cors: true,
  credentialsCache: KVCache,
  completionsCache: KVCache,
  braintrustApiUrl: process.env.BRAINTRUST_APP_URL,
});

export default async function route(request: Request): Promise<Response> {
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      waitUntil(
        promise.catch((error) => {
          console.warn("Background task failed", error);
        }),
      );
    },
  };

  const response = await handler(request, ctx);
  response.headers.set("Connection", "close");
  return response;
}
