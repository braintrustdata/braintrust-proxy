import { EdgeProxyV1 } from "@braintrust/proxy/edge";
import { getMeter, safeInitMetrics } from "@braintrust/proxy";
import { PrometheusRemoteWriteExporter } from "@braintrust/proxy/prom";

export const proxyV1Prefix = "/v1";

declare global {
  interface Env {
    ai_proxy: KVNamespace;
    BRAINTRUST_API_URL: string;
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
  if (env.PROMETHEUS_REMOTE_WRITE_URL !== undefined) {
    safeInitMetrics(
      new PrometheusRemoteWriteExporter({
        url: env.PROMETHEUS_REMOTE_WRITE_URL,
        auth: {
          username: env.PROMETHEUS_REMOTE_WRITE_USERNAME,
          password: env.PROMETHEUS_REMOTE_WRITE_PASSWORD,
        },
      }),
      {
        platform: "cloudflare",
      }
    );
  }

  const meter = getMeter("cloudflare-metrics");

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
  })(request, ctx);
}
