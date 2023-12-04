import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { PrometheusRemoteWriteExporter } from "./exporter";
import { Resource } from "@opentelemetry/resources";
import { v4 as uuidv4 } from "uuid";
import opentelemetry from "@opentelemetry/api";

let metricsInitialized = false;
declare global {
  var metricReader: PrometheusRemoteWriteExporter | undefined;
}
export function safeInitMetrics(remoteWriteUrl: string) {
  if (metricsInitialized) {
    return;
  }

  globalThis.metricReader = new PrometheusRemoteWriteExporter({
    url: remoteWriteUrl,
  });

  const resource = Resource.default().merge(
    new Resource({
      job: "braintrust-proxy",
      instance: uuidv4(),
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
