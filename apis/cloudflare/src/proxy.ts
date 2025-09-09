import {
  EdgeProxyV1,
  ProxyOpts,
  makeFetchApiSecrets,
  encryptedGet,
} from "@braintrust/proxy/edge";
import { FlushingHttpMetricExporter } from "./exporter";
import { SpanLogger, initMetrics, flushMetrics } from "@braintrust/proxy";
import { handleRealtimeProxy } from "./realtime";
import { braintrustAppUrl } from "./env";
import { Span, startSpan } from "braintrust";
import { BT_PARENT, resolveParentHeader } from "@braintrust/core";
import { cachedLogin, makeProxySpanLogger } from "./tracing";
import { MeterProvider } from "@opentelemetry/sdk-metrics";

export const proxyV1Prefixes = ["/v1/proxy", "/v1"];

function apiCacheKey(key: string) {
  return `http://apikey.cache/${encodeURIComponent(key)}.jpg`;
}

export function originWhitelist(env: Env) {
  return env.WHITELISTED_ORIGINS && env.WHITELISTED_ORIGINS.length > 0
    ? env.WHITELISTED_ORIGINS.split(",")
        .map((x) => x.trim())
        .filter((x) => x)
    : undefined;
}

export async function handleProxyV1(
  request: Request,
  proxyV1Prefix: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  let meterProvider: MeterProvider | undefined;

  if (env.METRICS_LICENSE_KEY) {
    console.log("Initializing metrics");
    meterProvider = initMetrics(
      new FlushingHttpMetricExporter(
        `${env.BRAINTRUST_APP_URL}/api/pulse/otel/v1/metrics`,
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.METRICS_LICENSE_KEY}`,
        },
      ),
      {
        service: "cfproxy",
      },
    );
  }

  const whitelist = originWhitelist(env);

  const cache = await caches.open("apikey:cache");

  const credentialsCache = {
    async get<T>(key: string): Promise<T | null> {
      const response = await cache.match(apiCacheKey(key));
      if (response) {
        return (await response.json()) as T;
      } else {
        return null;
      }
    },
    async set<T>(key: string, value: T, { ttl }: { ttl?: number }) {
      await cache.put(
        apiCacheKey(key),
        new Response(JSON.stringify(value), {
          headers: {
            "Cache-Control": `public${ttl ? `, max-age=${ttl}}` : ""}`,
          },
        }),
      );
    },
  };

  let spanLogger: SpanLogger | undefined;
  let span: Span | undefined;
  const parentHeader = request.headers.get(BT_PARENT);
  if (parentHeader) {
    let parent;
    try {
      parent = resolveParentHeader(parentHeader);
    } catch (e) {
      return new Response(
        `Invalid parent header '${parentHeader}': ${
          e instanceof Error ? e.message : String(e)
        }`,
        { status: 400 },
      );
    }
    span = startSpan({
      state: await cachedLogin({
        appUrl: braintrustAppUrl(env).toString(),
        headers: request.headers,
        cache: credentialsCache,
      }),
      type: "llm",
      name: "LLM",
      parent: parent.toStr(),
    });
    spanLogger = makeProxySpanLogger(span, ctx.waitUntil.bind(ctx));
  }

  const opts: ProxyOpts = {
    getRelativeURL(request: Request): string {
      return new URL(request.url).pathname.slice(proxyV1Prefix.length);
    },
    cors: true,
    credentialsCache,
    completionsCache: {
      get: async (key) => {
        const start = performance.now();
        const ret = await env.ai_proxy.get(key);
        const end = performance.now();
        // Cache latency will be logged in edge layer
        if (ret) {
          return JSON.parse(ret);
        } else {
          return null;
        }
      },
      set: async (key, value, { ttl }: { ttl?: number }) => {
        const start = performance.now();
        await env.ai_proxy.put(key, JSON.stringify(value), {
          expirationTtl: ttl,
        });
        const end = performance.now();
        // Cache latency will be logged in edge layer
      },
    },
    braintrustApiUrl: braintrustAppUrl(env).toString(),
    meterProvider, // Used to create metric functions in edge layer
    whitelist,
    spanLogger,
  };

  const url = new URL(request.url);
  if (url.pathname === `${proxyV1Prefix}/realtime`) {
    return await handleRealtimeProxy({
      request,
      env,
      ctx,
      cacheGet: async (encryptionKey: string, key: string) => {
        if (!opts.completionsCache) {
          return null;
        }
        return (
          (await encryptedGet(opts.completionsCache, encryptionKey, key)) ??
          null
        );
      },
      getApiSecrets: makeFetchApiSecrets({ ctx, opts }),
    });
  }

  return EdgeProxyV1(opts)(request, ctx);
}
