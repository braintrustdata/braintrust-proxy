import {
  EdgeProxyV1,
  FlushingExporter,
  ProxyOpts,
  makeFetchApiSecrets,
  encryptedGet,
} from "@braintrust/proxy/edge";
import { NOOP_METER_PROVIDER, initMetrics } from "@braintrust/proxy";
import { PrometheusMetricAggregator } from "./metric-aggregator";
import { handleRealtimeProxy } from "./realtime";

export const proxyV1Prefixes = ["/v1/proxy", "/v1"];

declare global {
  interface Env {
    ai_proxy: KVNamespace;
    BRAINTRUST_APP_URL: string;
    DISABLE_METRICS?: boolean;
    PROMETHEUS_SCRAPE_USER?: string;
    PROMETHEUS_SCRAPE_PASSWORD?: string;
    WHITELISTED_ORIGINS?: string;
  }
}

function apiCacheKey(key: string) {
  return `http://apikey.cache/${encodeURIComponent(key)}.jpg`;
}

export function braintrustAppUrl(env: Env) {
  return new URL(env.BRAINTRUST_APP_URL || "https://www.braintrust.dev");
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
  let meterProvider = undefined;
  if (!env.DISABLE_METRICS) {
    const metricShard = Math.floor(
      Math.random() * PrometheusMetricAggregator.numShards(env),
    );
    const aggregator = env.METRICS_AGGREGATOR.get(
      env.METRICS_AGGREGATOR.idFromName(metricShard.toString()),
    );
    const metricAggURL = new URL(request.url);
    metricAggURL.pathname = "/push";

    meterProvider = initMetrics(
      new FlushingExporter((resourceMetrics) =>
        aggregator.fetch(metricAggURL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(resourceMetrics),
        }),
      ),
    );
  }

  const meter = (meterProvider || NOOP_METER_PROVIDER).getMeter(
    "cloudflare-metrics",
  );

  const whitelist = originWhitelist(env);

  const cacheGetLatency = meter.createHistogram("results_cache_get_latency");
  const cacheSetLatency = meter.createHistogram("results_cache_set_latency");

  const cache = await caches.open("apikey:cache");

  const opts: ProxyOpts = {
    getRelativeURL(request: Request): string {
      return new URL(request.url).pathname.slice(proxyV1Prefix.length);
    },
    cors: true,
    credentialsCache: {
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
    },
    completionsCache: {
      get: async (key) => {
        const start = performance.now();
        const ret = await env.ai_proxy.get(key);
        const end = performance.now();
        cacheGetLatency.record(end - start);
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
        cacheSetLatency.record(end - start);
      },
    },
    braintrustApiUrl: braintrustAppUrl(env).toString(),
    meterProvider,
    whitelist,
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

export async function handlePrometheusScrape(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (env.DISABLE_METRICS) {
    return new Response("Metrics disabled", { status: 403 });
  }
  if (
    env.PROMETHEUS_SCRAPE_USER !== undefined ||
    env.PROMETHEUS_SCRAPE_PASSWORD !== undefined
  ) {
    const unauthorized = new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Braintrust Proxy Metrics"',
      },
    });

    const auth = request.headers.get("Authorization");
    if (!auth || auth.indexOf("Basic ") !== 0) {
      return unauthorized;
    }

    const userPass = atob(auth.slice("Basic ".length)).split(":");
    if (
      userPass[0] !== env.PROMETHEUS_SCRAPE_USER ||
      userPass[1] !== env.PROMETHEUS_SCRAPE_PASSWORD
    ) {
      return unauthorized;
    }
  }
  // Array from 0 ... numShards
  const shards = await Promise.all(
    Array.from(
      { length: PrometheusMetricAggregator.numShards(env) },
      async (_, i) => {
        const aggregator = env.METRICS_AGGREGATOR.get(
          env.METRICS_AGGREGATOR.idFromName(i.toString()),
        );
        const url = new URL(request.url);
        url.pathname = "/metrics";
        const resp = await aggregator.fetch(url, {
          method: "POST",
        });
        if (resp.status !== 200) {
          throw new Error(
            `Unexpected status code ${resp.status} ${
              resp.statusText
            }: ${await resp.text()}`,
          );
        } else {
          return await resp.text();
        }
      },
    ),
  );
  return new Response(shards.join("\n"), {
    headers: {
      "Content-Type": "text/plain",
    },
  });
}
