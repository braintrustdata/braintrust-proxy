import dns from "node:dns";

import { proxyV1 } from "@braintrust/proxy";
import {
  type CacheSetOptions,
  digestMessage,
  encryptedGet,
  encryptedPut,
  getCorsHeaders,
  makeFetchApiSecrets,
} from "@braintrust/proxy/edge";
import { waitUntil } from "@vercel/functions";
import { kv } from "@vercel/kv";
import { Agent, setGlobalDispatcher } from "undici";

import { nodeStreamingResponseViaPassThrough } from "../../../../lib/nodeProxy";

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

function safeWaitUntil(promise: Promise<unknown>) {
  waitUntil(
    promise.catch((error) => {
      console.warn("Background task failed", error);
    }),
  );
}

function handleOptions(
  request: Request,
  corsHeaders: Record<string, string>,
): Response {
  if (
    request.headers.get("Origin") !== null &&
    request.headers.get("Access-Control-Request-Method") !== null &&
    request.headers.get("Access-Control-Request-Headers") !== null
  ) {
    return new Response(null, {
      headers: {
        ...corsHeaders,
        "access-control-allow-headers":
          request.headers.get("Access-Control-Request-Headers") ?? "",
      },
    });
  }

  return new Response(null, {
    headers: {
      Allow: "GET, HEAD, POST, OPTIONS",
    },
  });
}

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

  let corsHeaders = {};
  try {
    corsHeaders = getCorsHeaders(request, undefined);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  if (request.method === "OPTIONS") {
    return handleOptions(request, corsHeaders);
  }

  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const method: "GET" | "POST" = request.method;
  const relativeURL = new URL(request.url).pathname.replace(/^\/api\/v1/, "");
  const requestBody = await request.text();

  let status = 200;
  const headers: Record<string, string> = {
    ...corsHeaders,
    "x-request-id": requestId,
  };

  const setStatusCode = (code: number) => {
    status = code;
  };

  const setHeader = (name: string, value: string) => {
    headers[name] = value;
  };

  const proxyHeaders: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    proxyHeaders[name] = value;
  });

  const fetchApiSecrets = makeFetchApiSecrets({
    ctx: { waitUntil: safeWaitUntil },
    opts: {
      getRelativeURL() {
        return relativeURL;
      },
      credentialsCache: KVCache,
      braintrustApiUrl: process.env.BRAINTRUST_APP_URL,
      nativeInferenceSecretKey: process.env.NATIVE_INFERENCE_SECRET_KEY,
    },
  });

  const cacheGet = async (encryptionKey: string, key: string) => {
    return (await encryptedGet(KVCache, encryptionKey, key)) ?? null;
  };

  const cachePut = async (
    encryptionKey: string,
    key: string,
    value: string,
    ttlSeconds?: number,
  ) => {
    const promise = encryptedPut(KVCache, encryptionKey, key, value, {
      ttl: ttlSeconds ?? 60 * 60 * 24 * 7,
    });
    safeWaitUntil(promise);
    await promise;
  };

  try {
    const response = await nodeStreamingResponseViaPassThrough({
      waitUntil: safeWaitUntil,
      runProxy: (res) =>
        proxyV1({
          method,
          url: relativeURL,
          proxyHeaders,
          body: requestBody,
          setHeader,
          setStatusCode,
          res,
          getApiSecrets: fetchApiSecrets,
          cacheGet,
          cachePut,
          digest: digestMessage,
        }),
      getStatus: () => status,
      getHeaders: () => headers,
    });
    log("route:after-handler", { status: response.status });
    return response;
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
export const runtime = "nodejs";
