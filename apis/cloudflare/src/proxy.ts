import { EdgeProxyV1 } from "@braintrust/proxy/edge";
import { getMeter, safeInitMetrics } from "@braintrust/proxy";

export const proxyV1Prefix = "/v1";

declare global {
  interface Env {
    ai_proxy: KVNamespace;
    BRAINTRUST_API_URL: string;
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
  safeInitMetrics("http://localhost:9090/api/v1/write"); // XXX Move to edge proxy
  const myMeter = getMeter("cloudflare-metrics");

  const cacheHits = myMeter.createCounter("results_cache_hits");
  const cacheMisses = myMeter.createCounter("results_cache_misses");
  const cacheGetLatency = myMeter.createHistogram("results_cache_get_latency");
  const cacheSetLatency = myMeter.createHistogram("results_cache_set_latency");

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
          cacheHits.add(1);
          return JSON.parse(ret);
        } else {
          cacheMisses.add(1);
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
