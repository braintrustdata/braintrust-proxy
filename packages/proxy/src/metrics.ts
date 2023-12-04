import { MeterProvider, MetricReader } from "@opentelemetry/sdk-metrics";
import { Resource } from "@opentelemetry/resources";
import { v4 as uuidv4 } from "uuid";
import opentelemetry from "@opentelemetry/api";

let metricsInitialized = false;
declare global {
  var metricReader: MetricReader | undefined;
}
export function safeInitMetrics(
  metricReader: MetricReader,
  resourceLabels?: Record<string, string>
) {
  if (metricsInitialized) {
    return;
  }

  globalThis.metricReader = metricReader;

  // DEVNOTE: This means that each request will be its own instance, which will explode
  // timeseries cardinality in Prometheus. This is probably okay, unless we have a really significant
  // number of requests (10k+ per second, assuming we have around 20 metrics, according to
  // https://prometheus.io/docs/prometheus/1.8/storage/#settings-for-high-numbers-of-time-series)
  //
  // To solve this, we'll have to partially aggregate metrics,
  // e.g. in a durable worker or an aggregating push gateway (e.g. https://github.com/zapier/prom-aggregation-gateway).
  // Because the remote_write format collapses everything down to simple metrics, we can likely do this
  // in terms of the basic timeseries format.
  const resource = Resource.default().merge(
    new Resource({
      job: "braintrust-proxy",
      instance: uuidv4(),
      ...resourceLabels,
    })
  );

  const myServiceMeterProvider = new MeterProvider({
    resource,
  });
  myServiceMeterProvider.addMetricReader(globalThis.metricReader);

  // Set this MeterProvider to be global to the app being instrumented.
  opentelemetry.metrics.setGlobalMeterProvider(myServiceMeterProvider);

  metricsInitialized = true;
}

export function getMeter(scope: string) {
  return opentelemetry.metrics.getMeter("cloudflare-metrics");
}

export async function flushMetrics() {
  if (globalThis.metricReader !== undefined) {
    await globalThis.metricReader.forceFlush();
  }
}

// These are copied from prom-client
// https://github.com/siimon/prom-client/blob/master/lib/bucketGenerators.js
export function linearBuckets(start: number, width: number, count: number) {
  if (count < 1) {
    throw new Error("Linear buckets needs a positive count");
  }

  const buckets = new Array(count);
  buckets[0] = 0;
  for (let i = 1; i < count; i++) {
    buckets[i] = start + i * width;
  }
  return buckets;
}

export function exponentialBuckets(
  start: number,
  factor: number,
  count: number
) {
  if (start <= 0) {
    throw new Error("Exponential buckets needs a positive start");
  }
  if (count < 1) {
    throw new Error("Exponential buckets needs a positive count");
  }
  if (factor <= 1) {
    throw new Error("Exponential buckets needs a factor greater than 1");
  }
  const buckets = new Array(count);
  buckets[0] = 0;
  for (let i = 1; i < count; i++) {
    buckets[i] = start;
    start *= factor;
  }
  return buckets;
}

export function nowMs() {
  return performance?.now ? performance.now() : Date.now();
}
