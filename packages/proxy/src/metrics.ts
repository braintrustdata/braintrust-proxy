import { MeterProvider, MetricReader } from "@opentelemetry/sdk-metrics";
import { Resource } from "@opentelemetry/resources";

export { NOOP_METER_PROVIDER } from "@opentelemetry/api/build/src/metrics/NoopMeterProvider";

export function initMetrics(
  metricReader: MetricReader,
  resourceLabels?: Record<string, string>,
) {
  const resource = Resource.default().merge(
    new Resource({
      ...resourceLabels,
    }),
  );

  const myServiceMeterProvider = new MeterProvider({
    resource,
  });
  myServiceMeterProvider.addMetricReader(metricReader);
  return myServiceMeterProvider;
}

export async function flushMetrics(meterProvider: MeterProvider) {
  await meterProvider.forceFlush();
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
  count: number,
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
