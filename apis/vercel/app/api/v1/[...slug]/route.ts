import dns from "node:dns";

import { after } from "next/server";

import { ProxyBadRequestError } from "@braintrust/proxy";
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

const DNS_RESULT_ORDER = "ipv4first";
const REQUEST_ID_HEADER = "x-request-id";
const ACCESS_CONTROL_REQUEST_HEADERS_HEADER = "access-control-request-headers";
const ACCESS_CONTROL_ALLOW_HEADERS_HEADER = "access-control-allow-headers";
const ALLOW_METHODS_HEADER_VALUE = "GET, HEAD, POST, OPTIONS";
const FORBIDDEN_RESPONSE_TEXT = "Forbidden";
const INTERNAL_SERVER_ERROR_TEXT = "Internal server error";
const API_V1_PATH_PREFIX = /^\/api\/v1/;
const DEFAULT_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
const KEEP_ALIVE_TIMEOUT_MS = 1;

dns.setDefaultResultOrder(DNS_RESULT_ORDER);

setGlobalDispatcher(
  new Agent({
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    keepAliveMaxTimeout: KEEP_ALIVE_TIMEOUT_MS,
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
    ACCESS_CONTROL_REQUEST_HEADERS_HEADER,
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
        [ACCESS_CONTROL_ALLOW_HEADERS_HEADER]: accessControlRequestHeaders,
      },
    });
  }

  return new Response(null, {
    status: 200,
    headers: {
      Allow: ALLOW_METHODS_HEADER_VALUE,
    },
  });
}

async function handleRequest(method: "GET" | "POST", request: Request) {
  const requestId = crypto.randomUUID();
  const requestUrl = new URL(request.url);

  const backgroundTasks: Promise<unknown>[] = [];
  const trackBackgroundTask = (promise: Promise<unknown>) => {
    backgroundTasks.push(promise);
  };

  after(async () => {
    await Promise.allSettled(backgroundTasks);
  });

  let corsHeaders = {};
  try {
    corsHeaders = getCorsHeaders(request, undefined);
  } catch {
    return new Response(FORBIDDEN_RESPONSE_TEXT, { status: 403 });
  }

  const proxyHeaders = normalizeHeaders(request.headers);
  const relativeURL = `${requestUrl.pathname.replace(API_V1_PATH_PREFIX, "")}${requestUrl.search}`;
  const requestBody = method === "POST" ? await request.text() : "";
  const initialHeaders = {
    ...corsHeaders,
    [REQUEST_ID_HEADER]: requestId,
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
    const proxyResult = await proxyV1ToAppRouteResponse({
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
          ttl: ttlSeconds ?? DEFAULT_CACHE_TTL_SECONDS,
        });
        trackBackgroundTask(putPromise);
        return putPromise;
      },
      digest: digestMessage,
    });
    return proxyResult.response;
  } catch (error) {
    return Response.json(
      {
        error: INTERNAL_SERVER_ERROR_TEXT,
        requestId,
      },
      {
        status: error instanceof ProxyBadRequestError ? 400 : 500,
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
    return new Response(FORBIDDEN_RESPONSE_TEXT, { status: 403 });
  }

  return handleOptions(request, corsHeaders);
}

export async function GET(request: Request) {
  return handleRequest("GET", request);
}

export async function POST(request: Request) {
  return handleRequest("POST", request);
}
