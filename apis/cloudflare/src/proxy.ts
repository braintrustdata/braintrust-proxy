import opentelemetry from "@opentelemetry/api";
import { MeterProvider } from "@opentelemetry/sdk-metrics";

import { EdgeProxyV1 } from "@braintrust/proxy/edge";
import { ConsoleMetricExporter } from "./exporter";
import { PeriodicExportingMetricReader } from "./periodic-reader";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";

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

const metricReader = new PeriodicExportingMetricReader({
  exporter: new ConsoleMetricExporter(),

  // Default is 60000ms (60 seconds). Set to 3 seconds for demonstrative purposes only.
  exportIntervalMillis: 60000,
});
let initialized = false;

export async function handleProxyV1(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  // Which of these things can happen outside of a request?
  if (!initialized) {
    const resource = Resource.default().merge(
      new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: "braintrust-proxy",
        job: "braintrust-proxy-cloudflare",
        // XXX change to uuid when we move to proxy package
        instance: `${Math.floor(Math.random() * 10000)}`,
      })
    );

    const myServiceMeterProvider = new MeterProvider({
      resource,
    });
    myServiceMeterProvider.addMetricReader(metricReader);

    // Set this MeterProvider to be global to the app being instrumented.
    opentelemetry.metrics.setGlobalMeterProvider(myServiceMeterProvider);

    initialized = true;
  }
  const myMeter = opentelemetry.metrics.getMeter("my-service-meter");
  const counter = myMeter.createCounter("events.counter");
  const histogram = myMeter.createHistogram("events.histogram");

  const cache = await caches.open("apikey:cache");

  try {
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
          const ret = await env.ai_proxy.get(key);
          if (ret) {
            counter.add(1, { foo: "a" });
            counter.add(1, { foo: "b" });
            histogram.record(10000 * Math.random());
            histogram.record(10000 * Math.random());
            histogram.record(10000 * Math.random());
            histogram.record(10000 * Math.random());
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
  } finally {
    await metricReader.forceFlush(); // XXX
    ctx.waitUntil(metricReader.forceFlush());
  }
}
