import { MetricData, ResourceMetrics } from "@opentelemetry/sdk-metrics";
import { Resource } from "@opentelemetry/resources";
import { PrometheusSerializer } from "@braintrust/proxy/src/PrometheusSerializer";
import { aggregateMetrics, prometheusSerialize } from "@braintrust/proxy";

declare global {
  interface Env {
    METRICS_AGGREGATOR: DurableObjectNamespace;
    // The number of durable objects to use for metrics aggregation. Each shard (times the number
    // of other distinct sets of labels) works out to one Prometheus timeseries. Shards allow us to
    // essentially aggregate _across_ workers.
    METRICS_SHARDS?: number;
    // TODO: If a metric doesn't show up for this many seconds, it'll be deleted from the store. We detect
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
    try {
      await aggregateMetrics(
        metrics,
        async (key: string) =>
          (await this.state.storage.get<MetricData>(key)) || null,
        (key: string, value: MetricData) => this.state.storage.put(key, value),
      );
    } catch (e) {
      console.error("Error aggregating metrics", e);
      return new Response("Error aggregating metrics", { status: 500 });
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

    return new Response(prometheusSerialize(resourceMetrics), {
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
