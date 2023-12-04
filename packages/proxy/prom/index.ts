import * as SnappyJS from "snappyjs";
import { prometheus } from "./prom";
import {
  DataPoint,
  DataPointType,
  Histogram,
  MetricData,
  ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import { hrTimeToMilliseconds } from "@opentelemetry/core";
import { Attributes } from "@opentelemetry/api";

interface Options {
  url: string;
  auth?: {
    username?: string;
    password?: string;
  };
  verbose?: boolean;
  timing?: boolean;
  timeout?: number;
  headers?: { [key: string]: string };
}

interface Result {
  // Status 200 OK
  status: number;
  statusText: string;
  errorMessage?: string;
}

// XXX Remove?
const kv = (o: any) =>
  typeof o === "object"
    ? Object.entries(o).map((e) => ({
        name: e[0],
        value: e[1],
      }))
    : undefined;

export function otelToWriteRequest(
  metrics: ResourceMetrics
): prometheus.IWriteRequest {
  // I don't think there's anything we can use from `ResourceMetrics` other than
  // the metrics themselves.
  const timeseries: prometheus.ITimeSeries[] = [];

  const resourceLabels = Object.fromEntries(
    serializeAttributes(metrics.resource.attributes)
  );
  if (
    resourceLabels.job === undefined ||
    resourceLabels.instance === undefined
  ) {
    throw new Error("Resource must have job and instance labels");
  }

  for (const scopeMetrics of metrics.scopeMetrics) {
    for (const metric of scopeMetrics.metrics) {
      timeseries.push(...parseMetric(metric, resourceLabels));
    }
  }

  return {
    timeseries,
  };
}

/**
 * Sends metrics over HTTP(s)
 */
async function pushMetrics(
  metrics: ResourceMetrics,
  options: Options
): Promise<Result> {
  const writeRequest = otelToWriteRequest(metrics);
  const buffer = prometheus.WriteRequest.encode(writeRequest).finish();

  return fetch(options.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/vnd.google.protobuf",
      ...(options.auth?.username && options.auth?.password
        ? {
            Authorization:
              "Basic " +
              btoa(options.auth.username + ":" + options.auth?.password),
          }
        : undefined),
      ...(options.headers || {}),
    },
    body: SnappyJS.compress(buffer),
    signal: options.timeout ? AbortSignal.timeout(options.timeout) : undefined,
  }).then(async (r: Response) => {
    const text = await r.text();

    return {
      status: r.status,
      statusText: r.statusText,
      errorMessage: r.status !== 200 ? text : undefined,
    };
  });
}

export type ResourceLabels = Record<string, string>;

// This implementation is based on the Python OTEL->remote_write code:
// https://github.com/open-telemetry/opentelemetry-python-contrib/blob/78874df5c210797d6d939b13de57539a584356c1/exporter/opentelemetry-exporter-prometheus-remote-write/src/opentelemetry/exporter/prometheus_remote_write/__init__.py
function parseMetric(
  metric: MetricData,
  resourceLabels: ResourceLabels
): prometheus.ITimeSeries[] {
  const name = metric.descriptor.unit
    ? `${metric.descriptor.name}_${metric.descriptor.unit}`
    : metric.descriptor.name;

  // First convert metrics into pairs of attriubutes and samples
  const data = [];
  switch (metric.dataPointType) {
    case DataPointType.SUM:
    case DataPointType.GAUGE:
      for (const dp of metric.dataPoints) {
        data.push(parseDataPoint(dp, name));
      }
      break;
    case DataPointType.HISTOGRAM:
      for (const dp of metric.dataPoints) {
        data.push(...parseHistogramDataPoint(dp, name));
      }
      break;
    case DataPointType.EXPONENTIAL_HISTOGRAM:
      throw new Error("Not implemented: Exponential Histogram");
  }

  // Then, group by attributes
  const sampleLabels: Record<string, [string, string][]> = {};
  const sampleSets: Record<string, prometheus.ISample[]> = {};

  for (const { attrs, sample } of data) {
    // This is not in the Python implementation but ensures that label order does
    // not affect equality.
    attrs.sort((a, b) => a[0].localeCompare(b[0]));

    const attrKey = JSON.stringify(attrs);
    if (sampleLabels[attrKey] === undefined) {
      sampleLabels[attrKey] = attrs;
    }
    sampleSets[attrKey] = (sampleSets[attrKey] || []).concat([sample]);
  }

  // Finally, convert to the Prometheus format
  const allTimeseries: prometheus.ITimeSeries[] = [];
  for (const [key, labelList] of Object.entries(sampleLabels)) {
    const samples = sampleSets[key] || [];
    allTimeseries.push({
      labels: labelList
        .concat(Object.entries(resourceLabels))
        .map(([name, value]) => ({ name, value })),
      samples,
    });
  }

  return allTimeseries;
}

function parseDataPoint(dp: DataPoint<number>, name: string) {
  const attrs = serializeAttributes(dp.attributes).concat([
    ["__name__", sanitizeString(name, "name")],
  ]);
  const sample = {
    value: dp.value,
    timestamp: hrTimeToMilliseconds(dp.endTime),
  };

  return { attrs, sample };
}

function parseHistogramDataPoint(dp: DataPoint<Histogram>, name: string) {
  const baseAttrs = serializeAttributes(dp.attributes);
  const timestamp = hrTimeToMilliseconds(dp.endTime);

  const handleBucket = (
    value: number,
    bound?: number | string,
    nameOverride?: string
  ) => {
    const attrs: [string, string][] = [
      ...baseAttrs,
      ["__name__", sanitizeString(nameOverride || name, "name")],
    ];
    if (bound !== undefined) {
      attrs.push(["le", `${bound}`]);
    }
    return { attrs, sample: { value, timestamp } };
  };

  const sampleAttrPairs = [];
  for (const [boundPos, bucket] of dp.value.buckets.boundaries.map((b, i) => [
    i,
    b,
  ])) {
    sampleAttrPairs.push(
      handleBucket(dp.value.buckets.counts[boundPos], bucket)
    );
  }

  // Add the last label for implicit +inf bucket
  sampleAttrPairs.push(handleBucket(dp.value.count, "+Inf"));

  // Lastly, add series for count & sum
  sampleAttrPairs.push(
    handleBucket(dp.value.sum || 0, undefined, `${name}_sum`)
  );
  sampleAttrPairs.push(
    handleBucket(dp.value.count, undefined, `${name}_count`)
  );

  return sampleAttrPairs;
}

function serializeAttributes(attrs?: Attributes): [string, string][] {
  return Object.entries(attrs || {})
    .filter(([_, value]) => value !== undefined)
    .map(([key, value]) => [key, `${value}`]);
}

function sanitizeString(string: string, type: "name" | "label") {
  if (type == "name") {
    // PROMETHEUS_NAME_REGEX = re.compile(r"^\d|[^\w:]")
    return string.replace(/^[0-9]|[^a-zA-Z0-9_:]/g, "_");
  } else if (type == "label") {
    // PROMETHEUS_LABEL_REGEX = re.compile(r"^\d|[^\w]")
    return string.replace(/^[0-9]|[^a-zA-Z0-9_]/g, "_");
  } else {
    throw new TypeError(`Unsupported string type: ${type}`);
  }
}
