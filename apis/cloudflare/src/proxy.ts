import { EdgeProxyV1 } from "@braintrust/proxy/edge";

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
  const cache = await caches.open("apikey:cache");
  return EdgeProxyV1({
    getRelativeURL(request: Request): string {
      return new URL(request.url).pathname.slice(proxyV1Prefix.length);
    },
    cors: true,
    credentialsCache: {
      async get<T>(key: string): Promise<T | null> {
        const response = await cache.match(apiCacheKey(key));
        if (response) {
          return await response.json();
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
        const ret = await env.ai_proxy.get(key);
        if (ret) {
          return JSON.parse(ret);
        } else {
          return null;
        }
      },
      set: async (key, value, { ttl }: { ttl?: number }) => {
        await env.ai_proxy.put(key, JSON.stringify(value), {
          expirationTtl: ttl,
        });
      },
    },
    braintrustApiUrl: env.BRAINTRUST_API_URL,
  })(request, ctx);
}
