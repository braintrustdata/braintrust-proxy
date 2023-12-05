import { prometheus } from "@braintrust/proxy/prom/dist";

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
      return new Response("NOT IMPLEMENTED", { status: 501 });
    } else {
      return new Response("Not found", {
        status: 404,
      });
    }
  }

  async handlePush(request: Request): Promise<Response> {
    const data = (await request.json()) as prometheus.IWriteRequest;
    // NOTE: We should be able to batch these get operations
    // into sets of keys at most 128 in length
    const writes = [];
    for (let { labels, samples } of data.timeseries || []) {
      labels = (labels || []).filter(
        (label) => label.name !== "instance" && label.name !== "job"
      );
      if (!samples || samples.length !== 1) {
        return new Response(
          `Invalid sample (length must be 1, was ${(samples || []).length}`,
          { status: 400 }
        );
      }
      const labelKey = JSON.stringify(labels);
      const sample = samples[0];

      const key = `metric/${labelKey}`;
      let existing = await this.state.storage.get<prometheus.ITimeSeries>(key);
      if (existing === undefined) {
        existing = {
          labels,
          samples,
        };
      } else {
        const existingSample = existing.samples![0];
        if (sample.timestamp) {
          existingSample.timestamp = Math.max(
            sample.timestamp,
            existingSample.timestamp || 0
          );
        }
        // Accumulate all values. Note: this works for histograms and counters, but
        // not for gauges.
        if (sample.value) {
          existingSample.value = (existingSample.value || 0) + sample.value;
        }
      }

      writes.push(this.state.storage.put(key, existing));
    }
    await Promise.all(writes);
    return new Response(null, { status: 204 });
  }

  static numShards(env: Env): number {
    return env.METRICS_SHARDS ?? 2;
  }

  static metricsTTL(env: Env): number {
    return env.METRICS_TTL ?? 24 * 7 * 3600;
  }
}
