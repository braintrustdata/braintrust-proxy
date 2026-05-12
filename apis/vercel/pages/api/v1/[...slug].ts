import { kv } from "@vercel/kv";
import { EdgeProxyV1, CacheSetOptions } from "@braintrust/proxy/edge";
import { Agent, setGlobalDispatcher } from "undici";

// On the Node runtime, fetch is implemented by undici, which pools sockets
// with HTTP keep-alive by default. Don't do that, since we want to be able
// to close the connection after each request and not have it held open by the keep-alive timer.
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

// Wrap the EdgeProxyV1 handler so we can properly wait for any background tasks to finish before closing the connection.
export default async function route(request: Request): Promise<Response> {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(
        promise.catch((error) => {
          console.warn("Background task failed", error);
        }),
      );
    },
  };

  const response = await handler(request, ctx);
  await Promise.allSettled(pending);
  response.headers.set("Connection", "close");
  return response;
}
