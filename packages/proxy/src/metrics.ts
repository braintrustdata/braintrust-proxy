import {
  DataPoint,
  DataPointType,
  Histogram,
  MeterProvider,
  MetricData,
  MetricReader,
  ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import { hrTimeToMicroseconds } from "@opentelemetry/core";
import { HrTime } from "@opentelemetry/api";
import { PrometheusSerializer } from "./PrometheusSerializer";

export { NOOP_METER_PROVIDER } from "@opentelemetry/api/build/src/metrics/NoopMeterProvider";

export function initMetrics(metricReader: MetricReader) {
  const myServiceMeterProvider = new MeterProvider({
    readers: [metricReader],
  });
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

export async function aggregateMetrics(
  metrics: ResourceMetrics,
  cacheGet: (key: string) => Promise<MetricData | null>,
  cachePut: (key: string, value: MetricData) => void,
): Promise<void> {
  for (const scopeMetrics of metrics.scopeMetrics) {
    for (const metric of scopeMetrics.metrics) {
      for (let i = 0; i < metric.dataPoints.length; i++) {
        // NOTE: We should be able to batch these get operations
        // into sets of keys at most 128 in length
        const metricKey =
          "otel_metric_" +
          JSON.stringify({
            name: metric.descriptor.name,
            dataPointType: metric.dataPointType,
            labels: metric.dataPoints[i].attributes,
          });

        let existing = (await cacheGet(metricKey)) || {
          ...metric,
          dataPoints: [],
        };
        if (existing && existing.dataPointType !== metric.dataPointType) {
          throw new Error("Invalid data point (type mismatch)");
        }

        let newValue = undefined;
        switch (metric.dataPointType) {
          case DataPointType.SUM:
            newValue = coalesceFn(
              existing.dataPoints[0] as DataPoint<number>,
              metric.dataPoints[i],
              mergeCounters,
            );
            break;
          case DataPointType.GAUGE:
            newValue = coalesceFn(
              existing.dataPoints[0] as DataPoint<number>,
              metric.dataPoints[i],
              mergeGauges,
            );
            break;
          case DataPointType.HISTOGRAM:
            newValue = coalesceFn(
              existing.dataPoints[0] as DataPoint<Histogram>,
              metric.dataPoints[i],
              mergeHistograms,
            );
            break;
          case DataPointType.EXPONENTIAL_HISTOGRAM:
            throw new Error("Not Implemented: Exponential Histogram");
        }

        if (newValue !== undefined) {
          (existing as any).descriptor = metric.descriptor; // Update the descriptor in case the code changes it
          existing.dataPoints[0] = newValue;
          // See "Write buffer behavior" in https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/
          // The only reason to await this put is to apply backpressure, which should be unnecessary given the small # of metrics
          // we're aggregating over
          cachePut(metricKey, existing);
        }
      }
    }
  }
}

export function prometheusSerialize(metrics: ResourceMetrics): string {
  const serializer = new PrometheusSerializer("", false /*appendTimestamp*/);
  return serializer.serialize(metrics);
}

function mergeHistograms(
  base: DataPoint<Histogram>,
  delta: DataPoint<Histogram>,
): DataPoint<Histogram> {
  if (
    JSON.stringify(base.value.buckets.boundaries) !==
    JSON.stringify(delta.value.buckets.boundaries)
  ) {
    throw new Error(
      "Unsupported: merging histograms with different bucket boundaries",
    );
  }

  return {
    startTime: minHrTime(base.startTime, delta.startTime),
    endTime: maxHrTime(base.endTime, delta.endTime),
    attributes: { ...base.attributes } /* these are assumed to be the same */,
    value: {
      buckets: {
        boundaries: [...base.value.buckets.boundaries],
        counts: base.value.buckets.counts.map(
          (count, i) => count + delta.value.buckets.counts[i],
        ),
      },
      sum: (base.value.sum || 0) + (delta.value.sum || 0),
      count: base.value.count + delta.value.count,
      min: coalesceFn(base.value.max, delta.value.max, Math.min),
      max: coalesceFn(base.value.max, delta.value.max, Math.max),
    },
  };
}

function mergeGauges(
  base: DataPoint<number>,
  delta: DataPoint<number>,
): DataPoint<number> {
  const baseT = hrTimeToMicroseconds(base.endTime);
  const deltaT = hrTimeToMicroseconds(delta.endTime);
  return {
    startTime: deltaT >= baseT ? base.startTime : delta.startTime,
    endTime: maxHrTime(base.endTime, delta.endTime),
    attributes: { ...base.attributes } /* these are assumed to be the same */,
    value: deltaT >= baseT ? delta.value : base.value,
  };
}

function mergeCounters(
  base: DataPoint<number>,
  delta: DataPoint<number>,
): DataPoint<number> {
  return {
    startTime: minHrTime(base.startTime, delta.startTime),
    endTime: maxHrTime(base.endTime, delta.endTime),
    attributes: { ...base.attributes } /* these are assumed to be the same */,
    value: base.value + delta.value,
  };
}

function minHrTime(a: HrTime, b: HrTime): HrTime {
  const at = hrTimeToMicroseconds(a);
  const bt = hrTimeToMicroseconds(b);
  return at <= bt ? a : b;
}

function maxHrTime(a: HrTime, b: HrTime): HrTime {
  const at = hrTimeToMicroseconds(a);
  const bt = hrTimeToMicroseconds(b);
  return at >= bt ? a : b;
}

function coalesceFn<T>(
  a: T | undefined,
  b: T | undefined,
  coalesce: (a: T, b: T) => T,
): T | undefined {
  return a === undefined ? b : b === undefined ? a : coalesce(a, b);
}
