import { EdgeProxyV1 } from "@braintrust/proxy/edge";
import { NOOP_METER_PROVIDER, initMetrics } from "@braintrust/proxy";
import { PrometheusRemoteWriteExporter } from "@braintrust/proxy/prom";
import { PrometheusMetricAggregator } from "./metric-aggregator";

export const proxyV1Prefix = "/v1";

declare global {
  interface Env {
    ai_proxy: KVNamespace;
    BRAINTRUST_API_URL: string;
    // XXX REMOVE?
    PROMETHEUS_REMOTE_WRITE_URL?: string;
    PROMETHEUS_REMOTE_WRITE_USERNAME?: string;
    PROMETHEUS_REMOTE_WRITE_PASSWORD?: string;
  }
}

function apiCacheKey(key: string) {
  return `http://apikey.cache/${encodeURIComponent(key)}.jpg`;
}

export async function handleProxyV1(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  let meterProvider = undefined;
  if (env.PROMETHEUS_REMOTE_WRITE_URL !== undefined) {
    // XXX Need to override this so that we can use the new exporter.
    const metricShard = Math.floor(
      Math.random() * PrometheusMetricAggregator.numShards(env)
    );
    console.log("SHARD", metricShard);
    const aggregator = env.METRICS_AGGREGATOR.get(
      env.METRICS_AGGREGATOR.idFromName(metricShard.toString())
    );
    const metricAggURL = new URL(request.url);
    metricAggURL.pathname = "/push";

    meterProvider = initMetrics(
      new PrometheusRemoteWriteExporter({
        url: env.PROMETHEUS_REMOTE_WRITE_URL,
        auth: {
          username: env.PROMETHEUS_REMOTE_WRITE_USERNAME,
          password: env.PROMETHEUS_REMOTE_WRITE_PASSWORD,
        },
        writeFn: (resourceMetrics) =>
          aggregator.fetch(metricAggURL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(resourceMetrics),
          }),
      }),
      {
        platform: "cloudflare",
      }
    );
  }

  const meter = (meterProvider || NOOP_METER_PROVIDER).getMeter(
    "cloudflare-metrics"
  );

  const cacheGetLatency = meter.createHistogram("results_cache_get_latency");
  const cacheSetLatency = meter.createHistogram("results_cache_set_latency");

  const cache = await caches.open("apikey:cache");

  return await EdgeProxyV1({
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
          })
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
    braintrustApiUrl: env.BRAINTRUST_API_URL,
    meterProvider,
  })(request, ctx);
}

export async function handlePrometheusScrape(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  // Array from 0 ... numShards
  const shards = await Promise.all(
    Array.from(
      { length: PrometheusMetricAggregator.numShards(env) },
      async (_, i) => {
        const aggregator = env.METRICS_AGGREGATOR.get(
          env.METRICS_AGGREGATOR.idFromName(i.toString())
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
            }: ${await resp.text()}`
          );
        } else {
          return await resp.text();
        }
      }
    )
  );
  return new Response(shards.join("\n"), {
    headers: {
      "Content-Type": "text/plain",
    },
  });
}
