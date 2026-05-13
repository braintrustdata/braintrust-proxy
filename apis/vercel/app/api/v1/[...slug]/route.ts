import dns from "node:dns";

import { after } from "next/server";

import {
  type CacheSetOptions,
  digestMessage,
  encryptedGet,
  encryptedPut,
  getCorsHeaders,
  makeFetchApiSecrets,
} from "@braintrust/proxy/edge";
import { kv } from "@vercel/kv";
import { Agent, setGlobalDispatcher } from "undici";

import { proxyV1ToAppRouteResponse } from "../../../../lib/appRouteProxy";

dns.setDefaultResultOrder("ipv4first");

setGlobalDispatcher(
  new Agent({
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
  }),
);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KVCache = {
  get: <T>(key: string) => kv.get<T>(key),
  set: async <T>(key: string, value: T, opts: CacheSetOptions) => {
    await kv.set(key, value, opts.ttl !== undefined ? { ex: opts.ttl } : {});
  },
};

function normalizeHeaders(headers: Headers): Record<string, string> {
  const normalized: Record<string, string> = {};

  headers.forEach((value, name) => {
    normalized[name] = value;
  });

  return normalized;
}

function handleOptions(request: Request, corsHeaders: Record<string, string>) {
  const accessControlRequestHeaders = request.headers.get(
    "access-control-request-headers",
  );

  if (
    request.headers.get("origin") !== null &&
    request.headers.get("access-control-request-method") !== null &&
    accessControlRequestHeaders !== null
  ) {
    return new Response(null, {
      status: 200,
      headers: {
        ...corsHeaders,
        "access-control-allow-headers": accessControlRequestHeaders,
      },
    });
  }

  return new Response(null, {
    status: 200,
    headers: {
      Allow: "GET, HEAD, POST, OPTIONS",
    },
  });
}

async function handleRequest(method: "GET" | "POST", request: Request) {
  const requestId =
    request.headers.get("x-request-id") ??
    Math.random().toString(36).slice(2, 10);
  const start = Date.now();
  const requestUrl = new URL(request.url);
  const log = (msg: string, extra?: Record<string, unknown>) => {
    console.log(
      JSON.stringify({
        requestId,
        method,
        path: requestUrl.pathname,
        elapsedMs: Date.now() - start,
        msg,
        ...extra,
      }),
    );
  };

  log("route:start", {
    hasAuth: request.headers.get("authorization") !== null,
    braintrustApiUrl: process.env.BRAINTRUST_APP_URL,
  });

  const backgroundTasks = new Set<Promise<unknown>>();
  const trackBackgroundTask = (promise: Promise<unknown>) => {
    backgroundTasks.add(promise);
    void promise.finally(() => {
      backgroundTasks.delete(promise);
    });
  };

  after(async () => {
    const tasks = [...backgroundTasks];
    const results = await Promise.allSettled(tasks);
    for (const result of results) {
      if (result.status === "rejected") {
        console.warn("Background task failed", result.reason);
      }
    }
  });

  let corsHeaders = {};
  try {
    corsHeaders = getCorsHeaders(request, undefined);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const proxyHeaders = normalizeHeaders(request.headers);
  const relativeURL = `${requestUrl.pathname.replace(/^\/api\/v1/, "")}${requestUrl.search}`;
  const requestBody = method === "POST" ? await request.text() : "";
  const initialHeaders = {
    ...corsHeaders,
    "x-request-id": requestId,
  };

  const fetchApiSecrets = makeFetchApiSecrets({
    ctx: {
      waitUntil(promise) {
        trackBackgroundTask(promise);
      },
    },
    opts: {
      getRelativeURL() {
        return relativeURL;
      },
      credentialsCache: KVCache,
      braintrustApiUrl: process.env.BRAINTRUST_APP_URL,
      nativeInferenceSecretKey: process.env.NATIVE_INFERENCE_SECRET_KEY,
    },
  });

  try {
    const { response, completed } = await proxyV1ToAppRouteResponse({
      method,
      url: relativeURL,
      proxyHeaders,
      body: requestBody,
      initialHeaders,
      getApiSecrets: fetchApiSecrets,
      cacheGet: async (encryptionKey, key) => {
        return (await encryptedGet(KVCache, encryptionKey, key)) ?? null;
      },
      cachePut: async (encryptionKey, key, value, ttlSeconds) => {
        const putPromise = encryptedPut(KVCache, encryptionKey, key, value, {
          ttl: ttlSeconds ?? 60 * 60 * 24 * 7,
        });
        trackBackgroundTask(putPromise);
        return putPromise;
      },
      digest: digestMessage,
    });

    after(async () => {
      try {
        await completed;
        log("route:stream-finished", { status: response.status });
      } catch (error) {
        log("route:stream-error", { error: String(error) });
      }
    });

    log("route:after-handler", { status: response.status });
    return response;
  } catch (error) {
    log("route:error", { error: String(error) });
    return Response.json(
      {
        error: error instanceof Error ? error.message : String(error),
        requestId,
      },
      {
        status: 500,
        headers: initialHeaders,
      },
    );
  }
}

export async function OPTIONS(request: Request) {
  let corsHeaders = {};
  try {
    corsHeaders = getCorsHeaders(request, undefined);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  return handleOptions(request, corsHeaders);
}

export async function GET(request: Request) {
  return handleRequest("GET", request);
}

export async function POST(request: Request) {
  return handleRequest("POST", request);
}
