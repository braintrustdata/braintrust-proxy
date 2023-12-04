import * as SnappyJS from "snappyjs";
import * as prom from "./prom";
import {
  DataPoint,
  DataPointType,
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
  proto?: string;
  labels?: { [key: string]: string };
  timeout?: number;
  console?: Console;
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

// XXX Remove?
const WriteRequest = prom.prometheus.WriteRequest;

// XXX Remove?
/** Serializes JSON as protobuf buffer */
function serialize(payload: Record<string, any>) {
  const errMsg = WriteRequest.verify(payload);
  if (errMsg) {
    throw new Error(errMsg);
  }
  const buffer = WriteRequest.encode(payload).finish();
  return buffer;
}

export function otelToWriteRequest(
  metrics: ResourceMetrics
): prom.prometheus.IWriteRequest {
  // I don't think there's anything we can use from `ResourceMetrics` other than
  // the metrics themselves.
  const timeseries: prom.prometheus.ITimeSeries[] = [];
  const metadata: prom.prometheus.IMetricMetadata[] = [];

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
      switch (metric.dataPointType) {
        case DataPointType.SUM:
          for (const dp of metric.dataPoints) {
          }
          break;
        case DataPointType.GAUGE:
          break;
        case DataPointType.HISTOGRAM:
          break;
        case DataPointType.EXPONENTIAL_HISTOGRAM:
          throw new Error("Not implemented: Exponential Histogram");
          break;
      }
    }
  }

  return {
    timeseries,
    metadata,
  };
}

/**
 * Sends metrics over HTTP(s)
 */
async function pushMetrics(
  metrics: ResourceMetrics,
  options: Options
): Promise<Result> {
  // Brush up a little
  timeseries = !Array.isArray(timeseries) ? [timeseries] : timeseries;

  // Nothing to do
  if (timeseries.length === 0) {
    return {
      status: 200,
      statusText: "OK",
    };
  }

  const start1 = Date.now();
  const writeRequest = {
    timeseries: timeseries.map((t) => ({
      labels: Array.isArray(t.labels)
        ? [t.labels, ...(kv(options.labels) || [])]
        : kv({
            ...options.labels,
            ...t.labels,
          }),
      samples: t.samples.map((s) => ({
        value: s.value,
        timestamp: s.timestamp ? s.timestamp : Date.now(),
      })),
    })),
  };
  const buffer = serialize(writeRequest);

  const logger = options.console || console;

  const start2 = Date.now();
  if (options.timing) {
    logger.info("Serialized in", start2 - start1, "ms");
  }

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

    if (options.verbose && r.status != 200) {
      logger.warn(
        "Failed to send write request, error",
        r.status + " " + r.statusText + " " + text,
        writeRequest
      );
    } else if (options.verbose && !options.timing) {
      logger.info(
        "Write request sent",
        r.status + " " + r.statusText + " " + text,
        writeRequest
      );
    } else if (options.verbose && options.timing) {
      logger.info(
        "Write request sent",
        r.status + " " + r.statusText + " in",
        Date.now() - start2,
        "ms",
        writeRequest
      );
    }

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
function parseMetric(metric: MetricData, resourceLabels: ResourceLabels) {
  const timeseries: prom.prometheus.ITimeSeries[] = [];
  const metadata: prom.prometheus.IMetricMetadata[] = [];

  const name = metric.descriptor.unit
    ? `${metric.descriptor.name}_${metric.descriptor.unit}`
    : metric.descriptor.name;

  const sampleLabels: Record<string, [string, string][]> = {};
  const sampleSets: Record<string, prom.prometheus.ISample[]> = {};
  switch (metric.dataPointType) {
    case DataPointType.SUM:
    case DataPointType.GAUGE:
      for (const dp of metric.dataPoints) {
        const { attrs, sample } = parseDataPoint(dp, name);
        const attrKey = JSON.stringify(attrs);
        if (sampleLabels[attrKey] === undefined) {
          sampleLabels[attrKey] = attrs;
        }
        sampleSets[attrKey] = (sampleSets[attrKey] || []).concat([sample]);
      }
      break;
    case DataPointType.HISTOGRAM:
      break;
    case DataPointType.EXPONENTIAL_HISTOGRAM:
      throw new Error("Not implemented: Exponential Histogram");
      break;
  }
}

function serializeAttributes(attrs?: Attributes): [string, string][] {
  return Object.entries(attrs || {})
    .filter(([_, value]) => value !== undefined)
    .map(([key, value]) => [key, `${value}`]);
}

function parseDataPoint(dp: DataPoint<number>, name: string) {
  const attrs = serializeAttributes(dp.attributes).concat([
    ["__name__", sanitizeString(name, "name")],
  ]);

  // This is not in the Python implementation but ensures that label order does
  // not affect equality.
  attrs.sort((a, b) => a[0].localeCompare(b[0]));

  const sample = new prom.prometheus.Sample({
    value: dp.value,
    timestamp: hrTimeToMilliseconds(dp.endTime),
  });

  return { attrs, sample };
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
