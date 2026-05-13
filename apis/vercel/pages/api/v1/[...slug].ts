import dns from "node:dns";
import type { NextApiRequest, NextApiResponse } from "next";

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

import {
  proxyV1ToNodeResponse,
  readRawRequestBody,
} from "../../../lib/nodeProxy";

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

function normalizeHeaders(
  headers: NextApiRequest["headers"],
): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    normalized[name] = Array.isArray(value) ? value.join(",") : value;
  }

  return normalized;
}

function handleOptions(
  req: NextApiRequest,
  res: NextApiResponse,
  corsHeaders: Record<string, string>,
) {
  const accessControlRequestHeaders = normalizeHeaders(req.headers)[
    "access-control-request-headers"
  ];

  if (
    req.headers.origin !== undefined &&
    req.headers["access-control-request-method"] !== undefined &&
    accessControlRequestHeaders !== undefined
  ) {
    res.writeHead(200, {
      ...corsHeaders,
      "access-control-allow-headers": accessControlRequestHeaders,
    });
    res.end();
    return;
  }

  res.writeHead(200, {
    Allow: "GET, HEAD, POST, OPTIONS",
  });
  res.end();
}

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const requestId =
    (typeof req.headers["x-request-id"] === "string"
      ? req.headers["x-request-id"]
      : undefined) ?? Math.random().toString(36).slice(2, 10);
  const start = Date.now();
  const requestUrl = new URL(
    req.url ?? "/api/v1",
    `https://${req.headers.host ?? "localhost"}`,
  );
  const log = (msg: string, extra?: Record<string, unknown>) => {
    console.log(
      JSON.stringify({
        requestId,
        method: req.method,
        path: requestUrl.pathname,
        elapsedMs: Date.now() - start,
        msg,
        ...extra,
      }),
    );
  };

  log("route:start", {
    hasAuth: req.headers.authorization !== undefined,
    braintrustApiUrl: process.env.BRAINTRUST_APP_URL,
  });

  let corsHeaders = {};
  try {
    corsHeaders = getCorsHeaders(
      new Request(requestUrl.toString(), {
        headers: normalizeHeaders(req.headers),
        method: req.method,
      }),
      undefined,
    );
  } catch {
    res.status(403).send("Forbidden");
    return;
  }

  if (req.method === "OPTIONS") {
    handleOptions(req, res, corsHeaders);
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).setHeader("Content-Type", "text/plain");
    res.send("Method not allowed");
    return;
  }

  const method: "GET" | "POST" = req.method;
  const proxyHeaders = normalizeHeaders(req.headers);
  const relativeURL = `${requestUrl.pathname.replace(/^\/api\/v1/, "")}${requestUrl.search}`;
  const requestBody = method === "POST" ? await readRawRequestBody(req) : "";

  for (const [name, value] of Object.entries(corsHeaders)) {
    res.setHeader(name, value);
  }
  res.setHeader("x-request-id", requestId);

  const fetchApiSecrets = makeFetchApiSecrets({
    ctx: {
      waitUntil(promise) {
        void promise.catch((error) => {
          console.warn("Background task failed", error);
        });
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
    await proxyV1ToNodeResponse({
      method,
      url: relativeURL,
      proxyHeaders,
      body: requestBody,
      setHeader(name, value) {
        res.setHeader(name, value);
      },
      setStatusCode(code) {
        res.statusCode = code;
      },
      getApiSecrets: fetchApiSecrets,
      cacheGet: async (encryptionKey, key) => {
        return (await encryptedGet(KVCache, encryptionKey, key)) ?? null;
      },
      cachePut: async (encryptionKey, key, value, ttlSeconds) => {
        await encryptedPut(KVCache, encryptionKey, key, value, {
          ttl: ttlSeconds ?? 60 * 60 * 24 * 7,
        });
      },
      digest: digestMessage,
      getRes: () => res,
    });
    log("route:after-handler", { status: res.statusCode });
  } catch (error) {
    log("route:error", { error: String(error) });
    if (!res.headersSent) {
      res
        .status(500)
        .setHeader("Content-Type", "application/json")
        .json({
          error: error instanceof Error ? error.message : String(error),
          requestId,
        });
      return;
    }

    res.end();
  }
}
