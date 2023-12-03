import * as SnappyJS from "snappyjs";
import * as prom from "./prom";

interface Sample {
  value: number;
  timestamp?: number;
}

interface Timeseries {
  // Labels for every sample
  labels: {
    // Key for sample, should end with _totals, etc, see https://prometheus.io/docs/practices/naming/
    __name__: string;
    // Optional properties, i.e. instance, job, service
    [key: string]: string;
  };
  // List of samples, timestamp is optional, will be set by pushTimeseries
  samples: Sample[];
}

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

const kv = (o: any) =>
  typeof o === "object"
    ? Object.entries(o).map((e) => ({
        name: e[0],
        value: e[1],
      }))
    : undefined;

const WriteRequest = prom.prometheus.WriteRequest;

/** Serializes JSON as protobuf buffer */
function serialize(payload: Record<string, any>) {
  const errMsg = WriteRequest.verify(payload);
  if (errMsg) {
    throw new Error(errMsg);
  }
  const buffer = WriteRequest.encode(payload).finish();
  return buffer;
}

/**
 * Sends metrics over HTTP(s)
 */
async function pushTimeseries(
  timeseries: Timeseries | Timeseries[],
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

/**
 * Sends metrics over HTTP(s)
 */
async function pushMetrics(
  metrics: Record<string, number>,
  options: Options
): Promise<Result> {
  return pushTimeseries(
    Object.entries(metrics).map((c) => ({
      labels: { __name__: c[0] },
      samples: [{ value: c[1] }],
    })),
    options
  );
}

module.exports = {
  serialize,
  pushTimeseries,
  pushMetrics,
};
