import { DEFAULT_BRAINTRUST_APP_URL } from "@lib/constants";
import { flushMetrics } from "@lib/metrics";
import { proxyV1, SpanLogger, LogHistogramFn, BillingEvent } from "@lib/proxy";
import { isEmpty } from "@lib/util";
import { MeterProvider } from "@opentelemetry/sdk-metrics";

import { APISecret, APISecretSchema, getModelEndpointTypes } from "@schema";
import { verifyTempCredentials, isTempCredential } from "utils";
import {
  decryptMessage,
  EncryptedMessage,
  encryptMessage,
} from "utils/encrypt";

// FlushingHttpMetricExporter moved to cloudflare-specific code to avoid Edge Runtime issues

export interface EdgeContext {
  waitUntil(promise: Promise<any>): void;
}

export interface CacheSetOptions {
  ttl?: number;
}
export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: { ttl?: number }): Promise<void>;
}

export interface ProxyOpts {
  getRelativeURL(request: Request): string;
  cors?: boolean;
  credentialsCache?: Cache;
  completionsCache?: Cache;
  braintrustApiUrl?: string;
  meterProvider?: MeterProvider;
  logHistogram?: LogHistogramFn;
  whitelist?: (string | RegExp)[];
  spanLogger?: SpanLogger;
  billingOrgId?: string;
  onBillingEvent?: (event: BillingEvent) => void;
  spanId?: string;
  spanExport?: string;
  nativeInferenceSecretKey?: string;
  /**
   * When true, the upstream → response body runs in the background
   * and the function is kept alive via `ctx.waitUntil`.
   *
   * Leave unset on Cloudflare Workers as those already keep the event stream alive
   *
   * @default false
   */
  streamingViaWaitUntil?: boolean;
}

const defaultWhitelist: (string | RegExp)[] = [
  "https://www.braintrustdata.com",
  "https://www.braintrust.dev",
  new RegExp("https://.*-braintrustdata.vercel.app"),
  new RegExp("https://.*.preview.braintrust.dev"),
];

const baseCorsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET,OPTIONS,POST",
};

export function getCorsHeaders(
  request: Request,
  whitelist: (string | RegExp)[] | undefined,
) {
  whitelist = whitelist || defaultWhitelist;

  // If the host is not in the whitelist, return a 403.
  const origin = request.headers.get("Origin");
  if (
    origin &&
    !whitelist.some(
      (w) => w === origin || (w instanceof RegExp && w.test(origin)),
    )
  ) {
    throw new Error("Forbidden");
  }

  return origin
    ? {
        "access-control-allow-origin": origin,
        ...baseCorsHeaders,
      }
    : {};
}

// https://developers.cloudflare.com/workers/examples/cors-header-proxy/
async function handleOptions(
  request: Request,
  corsHeaders: Record<string, string>,
) {
  if (
    request.headers.get("Origin") !== null &&
    request.headers.get("Access-Control-Request-Method") !== null &&
    request.headers.get("Access-Control-Request-Headers") !== null
  ) {
    // Handle CORS preflight requests.
    return new Response(null, {
      headers: {
        ...corsHeaders,
        "access-control-allow-headers": request.headers.get(
          "Access-Control-Request-Headers",
        )!,
      },
    });
  } else {
    // Handle standard OPTIONS request.
    return new Response(null, {
      headers: {
        Allow: "GET, HEAD, POST, OPTIONS",
      },
    });
  }
}

export async function digestMessage(message: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function makeFetchApiSecrets({
  ctx,
  opts,
}: {
  ctx: EdgeContext;
  opts: ProxyOpts;
}) {
  return async (
    useCache: boolean,
    authToken: string,
    model: string | null,
    org_name?: string,
    project_id?: string,
  ): Promise<APISecret[]> => {
    // Project-level secrets are not supported on the edge proxy since they are
    // stored in the data plane
    if (project_id) {
      throw new Error(
        "Project-level AI provider secrets are not supported on the edge proxy. " +
          "Please use the hosted API proxy or remove the x-bt-project-id header.",
      );
    }

    // First try to decode & verify as JWT. We gate this on Braintrust JWT
    // format, not just any JWT, in case a future model provider uses JWT as
    // the auth token.
    if (opts.credentialsCache && isTempCredential(authToken)) {
      try {
        const { jwtPayload, credentialCacheValue } =
          await verifyTempCredentials({
            jwt: authToken,
            cacheGet: opts.credentialsCache.get,
          });

        // Overwrite parameters with those from JWT.
        authToken = credentialCacheValue.authToken;
        model = jwtPayload.bt.model || null;
        org_name = jwtPayload.bt.org_name || undefined;
        // Fall through to normal secrets lookup.
      } catch (error) {
        // Re-throw to filter out everything except `message`.
        console.error(error);
        throw new Error(error instanceof Error ? error.message : undefined);
      }
    }

    const cacheKey = await digestMessage(
      `${model}/${org_name ? org_name + ":" : ""}${authToken}`,
    );

    const response =
      useCache &&
      opts.credentialsCache &&
      (await encryptedGet(opts.credentialsCache, cacheKey, cacheKey));
    if (response) {
      console.log("API KEY CACHE HIT");
      return JSON.parse(response);
    } else {
      console.log("API KEY CACHE MISS");
    }

    let secrets: APISecret[] = [];
    let lookupFailed = false;
    // Only cache API keys for 60 seconds. This reduces the load on the database but ensures
    // that changes roll out quickly enough too.
    const ttl = 60;
    try {
      const response = await fetch(
        `${opts.braintrustApiUrl || DEFAULT_BRAINTRUST_APP_URL}/api/secret`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            org_name,
            mode: "full",
            ...(opts.nativeInferenceSecretKey
              ? { can_execute_native_inference: true }
              : {}),
          }),
        },
      );
      if (response.ok) {
        const responseJson: unknown = await response.json();
        if (
          isRecord(responseJson) &&
          responseJson.encrypted === true &&
          typeof responseJson.iv === "string" &&
          typeof responseJson.data === "string"
        ) {
          if (!opts.nativeInferenceSecretKey) {
            throw new Error(
              "Received encrypted response but NATIVE_INFERENCE_SECRET_KEY is not configured",
            );
          }
          const keys = opts.nativeInferenceSecretKey
            .split(",")
            .map((k) => k.trim())
            .filter((k) => k.length > 0);
          let decrypted: string | null | undefined = null;
          for (const key of keys) {
            const encryptionKey = await digestMessage(key);
            try {
              decrypted = await decryptMessage(
                encryptionKey,
                responseJson.iv,
                responseJson.data,
              );
              if (decrypted) break;
            } catch {}
          }
          if (!decrypted) {
            throw new Error(
              "Failed to decrypt native inference response (tried all keys)",
            );
          }
          const parsed: unknown = JSON.parse(decrypted);
          if (!Array.isArray(parsed)) {
            throw new Error("Decrypted response is not an array");
          }
          secrets = parsed.map((s: unknown) => APISecretSchema.parse(s));
        } else {
          if (!Array.isArray(responseJson)) {
            throw new Error("Response is not an array");
          }
          secrets = responseJson.map((s: unknown) => APISecretSchema.parse(s));
        }
      } else {
        const responseText = await response.text();
        if (response.status === 400) {
          throw new Error(
            `Failed to lookup api key: ${response.status}: ${responseText}`,
          );
        }
        lookupFailed = true;
        console.warn("Failed to lookup api key", responseText);
      }
    } catch (e) {
      if (
        e instanceof Error &&
        e.message.startsWith("Failed to lookup api key: 400:")
      ) {
        throw e;
      }
      lookupFailed = true;
      console.warn("Failed to lookup api key. Falling back to provided key", e);
    }

    if (lookupFailed) {
      const endpointTypes = !isEmpty(model) ? getModelEndpointTypes(model) : [];
      secrets.push({
        secret: authToken,
        type: endpointTypes[0] ?? "openai",
      });
    }

    // temp skip the cache for testing
    if (useCache && opts.credentialsCache && !lookupFailed) {
      ctx.waitUntil(
        encryptedPut(
          opts.credentialsCache,
          cacheKey,
          cacheKey,
          JSON.stringify(secrets),
          {
            ttl,
          },
        ),
      );
    }

    return secrets;
  };
}

// Metric logging functions are now created in the calling layer (e.g., Cloudflare proxy)

// readable highWaterMark is generous so the producer can prime the stream
// before any reader is attached — Response(readable) is only constructed
// after the first write, so without buffering `baseWriter.write` would
// deadlock waiting for a consumer.
export async function streamingResponseViaWaitUntil({
  ctx,
  wrapWithMeter,
  runProxy,
  getStatus,
  getHeaders,
}: {
  ctx: EdgeContext;
  wrapWithMeter: (
    body: ReadableStream<Uint8Array>,
  ) => ReadableStream<Uint8Array>;
  runProxy: (res: WritableStream<Uint8Array>) => Promise<void>;
  getStatus: () => number;
  getHeaders: () => Record<string, string>;
}): Promise<Response> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>(
    {},
    { highWaterMark: 1 },
    { highWaterMark: 64 },
  );

  let signalReady: () => void = () => {};
  const headersReady = new Promise<void>((resolve) => {
    signalReady = resolve;
  });

  let signalPipeComplete: () => void = () => {};
  const pipeComplete = new Promise<void>((resolve) => {
    signalPipeComplete = resolve;
  });

  let writeCount = 0;
  let totalBytes = 0;
  let closed = false;
  let aborted = false;

  const baseWriter = writable.getWriter();
  const wrappedWritable = new WritableStream<Uint8Array>({
    async write(chunk) {
      writeCount += 1;
      totalBytes += chunk.byteLength;
      await baseWriter.write(chunk);
      console.log(
        `streamingResponseViaWaitUntil write #${writeCount} bytes=${chunk.byteLength} total=${totalBytes}`,
      );
      signalReady();
    },
    async close() {
      closed = true;
      console.log(
        `streamingResponseViaWaitUntil close writes=${writeCount} total=${totalBytes}`,
      );
      await baseWriter.close();
      signalReady();
      signalPipeComplete();
    },
    async abort(reason) {
      aborted = true;
      console.error(
        `streamingResponseViaWaitUntil abort writes=${writeCount} total=${totalBytes} reason=${reason}`,
      );
      await baseWriter.abort(reason);
      signalReady();
      signalPipeComplete();
    },
  });

  let proxyError: unknown = undefined;
  const proxyPromise = runProxy(wrappedWritable)
    .then(() => {
      console.log(
        `streamingResponseViaWaitUntil runProxy resolved writes=${writeCount} total=${totalBytes} closed=${closed} aborted=${aborted}`,
      );
    })
    .catch((e) => {
      console.error(
        `streamingResponseViaWaitUntil runProxy threw writes=${writeCount} total=${totalBytes} closed=${closed} aborted=${aborted}`,
        e,
      );
      proxyError = e;
      signalReady();
      baseWriter.abort(e).catch(() => {});
      signalPipeComplete();
    });

  ctx.waitUntil(
    Promise.all([proxyPromise, pipeComplete]).then(() => {
      console.log(
        `streamingResponseViaWaitUntil waitUntil settled writes=${writeCount} total=${totalBytes} closed=${closed} aborted=${aborted}`,
      );
    }),
  );

  await headersReady;
  if (proxyError !== undefined) {
    return new Response(`${proxyError}`, {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
  }

  console.log(
    `streamingResponseViaWaitUntil returning Response status=${getStatus()} writes=${writeCount} total=${totalBytes}`,
  );

  return new Response(wrapWithMeter(readable), {
    status: getStatus(),
    headers: getHeaders(),
  });
}

export function EdgeProxyV1(opts: ProxyOpts) {
  return async (request: Request, ctx: EdgeContext) => {
    let corsHeaders = {};
    try {
      if (opts.cors) {
        corsHeaders = getCorsHeaders(request, opts.whitelist);
      }
    } catch (e) {
      return new Response("Forbidden", { status: 403 });
    }

    if (request.method === "OPTIONS" && opts.cors) {
      return handleOptions(request, corsHeaders);
    }
    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { "Content-Type": "text/plain" },
      });
    }
    const method: "GET" | "POST" = request.method;

    const relativeURL = opts.getRelativeURL(request);

    // Create an identity TransformStream (a.k.a. a pipe).
    // The readable side will become our new response body.
    const { readable, writable } = new TransformStream();

    let status = 200;

    const headers: Record<string, string> = opts.cors ? corsHeaders : {};

    const setStatus = (code: number) => {
      status = code;
    };
    const setHeader = (name: string, value: string) => {
      headers[name] = value;
    };

    const proxyHeaders: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      proxyHeaders[name] = value;
    });

    const cacheGet = async (encryptionKey: string, key: string) => {
      if (opts.completionsCache) {
        return (
          (await encryptedGet(opts.completionsCache, encryptionKey, key)) ??
          null
        );
      } else {
        return null;
      }
    };

    const fetchApiSecrets = makeFetchApiSecrets({ ctx, opts });

    // Set span headers if available
    if (opts.spanId) {
      setHeader("x-bt-span-id", opts.spanId);
    }
    if (opts.spanExport) {
      setHeader("x-bt-span-export", opts.spanExport);
    }

    const cachePut = async (
      encryptionKey: string,
      key: string,
      value: string,
      ttl_seconds?: number,
    ): Promise<void> => {
      if (opts.completionsCache) {
        const ret = encryptedPut(
          opts.completionsCache,
          encryptionKey,
          key,
          value,
          {
            // 1 week if not specified
            ttl: ttl_seconds ?? 60 * 60 * 24 * 7,
          },
        );
        ctx.waitUntil(ret);
        return ret;
      }
    };

    const requestBody = await request.text();
    const proxyV1Args = {
      method,
      url: relativeURL,
      proxyHeaders,
      body: requestBody,
      setHeader,
      setStatusCode: setStatus,
      getApiSecrets: fetchApiSecrets,
      cacheGet,
      cachePut,
      digest: digestMessage,
      logHistogram: opts.logHistogram,
      spanLogger: opts.spanLogger,
      billingOrgId: opts.billingOrgId,
      onBillingEvent: opts.onBillingEvent,
    };

    const meterProvider = opts.meterProvider;
    const wrapWithMeter = (body: ReadableStream<Uint8Array>) =>
      meterProvider
        ? body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              flush() {
                ctx.waitUntil(flushMetrics(meterProvider));
              },
            }),
          )
        : body;

    if (opts.streamingViaWaitUntil) {
      return streamingResponseViaWaitUntil({
        ctx,
        wrapWithMeter,
        runProxy: (res) => proxyV1({ ...proxyV1Args, res }),
        getStatus: () => status,
        getHeaders: () => headers,
      });
    }

    // Default path: await proxyV1 to completion before returning.
    try {
      await proxyV1({
        ...proxyV1Args,
        res: writable,
      });
    } catch (e) {
      // log error to vercel
      console.error("EdgeProxyV1 request failed", e);
      return new Response(`${e}`, {
        status: 400,
        headers: { "Content-Type": "text/plain" },
      });
    }

    return new Response(wrapWithMeter(readable), {
      status,
      headers,
    });
  };
}

// We rely on the fact that Upstash will automatically serialize and deserialize things for us
export async function encryptedGet(
  cache: Cache,
  encryptionKey: string,
  key: string,
) {
  const message = await cache.get<EncryptedMessage>(key);
  if (isEmpty(message)) {
    return null;
  }

  return await decryptMessage(encryptionKey, message.iv, message.data);
}

export async function encryptedPut(
  cache: Cache,
  encryptionKey: string,
  key: string,
  value: string,
  options?: { ttl?: number },
) {
  options = options || {};

  const encryptedValue = await encryptMessage(encryptionKey, value);
  await cache.set(key, encryptedValue, options);
}
