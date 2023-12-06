import {
  DataPoint,
  DataPointType,
  Histogram,
  MetricData,
  ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import { HrTime } from "@opentelemetry/api";
import { hrTimeToMicroseconds } from "@opentelemetry/core";
import { Resource } from "@opentelemetry/resources";
import { PrometheusSerializer } from "./PrometheusSerializer";

declare global {
  interface Env {
    METRICS_AGGREGATOR: DurableObjectNamespace;
    // The number of durable objects to use for metrics aggregation. Each shard (times the number
    // of other distinct sets of labels) works out to one Prometheus timeseries. Shards allow us to
    // essentially aggregate _across_ workers.
    METRICS_SHARDS?: number;
    // If a metric doesn't show up for this many seconds, it'll be deleted from the store. We detect
    // this at read time.
    METRICS_TTL?: number;
  }
}

export class PrometheusMetricAggregator {
  state: DurableObjectState;
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Only POST is supported", { status: 405 });
    }
    const url = new URL(request.url);
    if (url.pathname === "/push") {
      return await this.handlePush(request);
    } else if (url.pathname === "/metrics") {
      return await this.handlePromScrape(request);
    } else {
      return new Response("Not found", {
        status: 404,
      });
    }
  }

  async handlePush(request: Request): Promise<Response> {
    const metrics = (await request.json()) as ResourceMetrics;

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

          let existing = (await this.state.storage.get<MetricData>(
            metricKey,
          )) || {
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
              return new Response("Not Implemented: Exponential Histogram", {
                status: 501,
              });
          }

          if (newValue !== undefined) {
            (existing as any).descriptor = metric.descriptor; // Update the descriptor in case the code changes it
            existing.dataPoints[0] = newValue;
            // See "Write buffer behavior" in https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/
            // The only reason to await this put is to apply backpressure, which should be unnecessary given the small # of metrics
            // we're aggregating over
            this.state.storage.put(metricKey, existing);
          }
        }
      }
    }

    return new Response(null, { status: 204 });
  }

  async handlePromScrape(request: Request): Promise<Response> {
    const resource = Resource.default();
    resource.attributes["service"] = "braintrust-proxy-cloudflare";

    const metrics = await this.state.storage.list<MetricData>({
      prefix: "otel_metric_",
    });

    const resourceMetrics: ResourceMetrics = {
      resource,
      scopeMetrics: [
        {
          scope: {
            name: "cloudflare-metric-aggregator",
          },
          // metrics is a map. can you create a list of its values
          metrics: Array.from(metrics.values()).map((m) => ({
            ...m,
            dataPoints: m.dataPoints.map((dp) => ({
              ...dp,
              attributes: {
                ...dp.attributes,
                metric_shard: this.state.id.toString(),
              },
            })),
          })) as MetricData[],
        },
      ],
    };
    const serializer = new PrometheusSerializer("", true /*appendTimestamp*/);

    return new Response(serializer.serialize(resourceMetrics), {
      headers: {
        "Content-Type": "text/plain",
      },
      status: 200,
    });
  }

  static numShards(env: Env): number {
    return env.METRICS_SHARDS ?? 2;
  }

  static metricsTTL(env: Env): number {
    return env.METRICS_TTL ?? 24 * 7 * 3600;
  }
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
