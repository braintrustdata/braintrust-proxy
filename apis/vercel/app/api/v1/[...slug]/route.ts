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
  get: <T>(key: string) => kv.get<T>(key),
  set: async <T>(key: string, value: T, opts: CacheSetOptions) => {
    await kv.set(key, value, opts.ttl !== undefined ? { ex: opts.ttl } : {});
  },
};

const proxyHandler = EdgeProxyV1({
  getRelativeURL: (request) => {
    // App Router route is /api/v1/[...slug] — strip the prefix to get
    // the upstream path (e.g. "/chat/completions").
    const url = new URL(request.url);
    return url.pathname.replace(/^\/api\/v1/, "");
  },
  cors: true,
  credentialsCache: KVCache,
  completionsCache: KVCache,
  braintrustApiUrl: process.env.BRAINTRUST_APP_URL,
});

const ctx = {
  waitUntil(promise: Promise<unknown>) {
    waitUntil(
      promise.catch((error) => {
        console.warn("Background task failed", error);
      }),
    );
  },
};

async function proxy(request: Request): Promise<Response> {
  const requestId =
    request.headers.get("x-request-id") ??
    Math.random().toString(36).slice(2, 10);
  const start = Date.now();
  const log = (msg: string, extra?: Record<string, unknown>) => {
    console.log(
      JSON.stringify({
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        elapsedMs: Date.now() - start,
        msg,
        ...extra,
      }),
    );
  };

  log("route:start", {
    hasAuth: request.headers.has("authorization"),
    braintrustApiUrl: process.env.BRAINTRUST_APP_URL,
  });

  try {
    const response = await proxyHandler(request, ctx);
    log("route:after-handler", { status: response.status });
    response.headers.set("x-request-id", requestId);

    if (!response.body) {
      return response;
    }
    const buffered = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = response.body!.getReader();
        let totalBytes = 0;
        let chunkCount = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            chunkCount += 1;
            controller.enqueue(value);
          }
          controller.close();
          log("route:body-complete", { totalBytes, chunkCount });
        } catch (err) {
          log("route:body-error", { error: String(err), totalBytes });
          controller.error(err);
        }
      },
    });
    return new Response(buffered, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    log("route:error", { error: String(error) });
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        requestId,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId,
        },
      },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const OPTIONS = proxy;

export const dynamic = "force-dynamic";
