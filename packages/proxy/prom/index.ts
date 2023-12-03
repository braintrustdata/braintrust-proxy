import * as SnappyJS from "snappyjs";
import * as protobuf from "protobufjs";
import * as prom from "./prom";

const __holder = {
  type: null,
};

const kv = (o: any) =>
  typeof o === "object"
    ? Object.entries(o).map((e) => ({
        name: e[0],
        value: e[1],
      }))
    : undefined;

/** Loads protocol definition, cache it */
async function loadProto(options) {
  if (__holder.root) {
    return __holder.type;
  }

  if (options?.proto) {
    const root = await protobuf.load(options?.proto);
    if (options?.verbose) {
      console.info("Loaded protocol definitions", options?.proto, root);
    }
    const WriteRequest = root.lookupType("prometheus.WriteRequest");
    __holder.type = WriteRequest;
    return WriteRequest;
  }

  return prom.prometheus.WriteRequest;
}

/** Serializes JSON as protobuf buffer */
async function serialize(payload, options) {
  const type = await loadProto(options);
  const errMsg = type.verify(payload);
  if (errMsg) {
    throw new Error(errMsg);
  }
  const buffer = type.encode(payload).finish();
  return buffer;
}

/**
 * Sends metrics over HTTP(s)
 *
 * @param {import("./types").Timeseries | import("./types").Timeseries[]} timeseries
 * @param {import("./types").Options} options
 * @return {Promise<import("./types").Result>}
 */
async function pushTimeseries(timeseries, options) {
  const orig = timeseries;
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
        ? [t.labels, ...(kv(options?.labels) || [])]
        : kv({
            ...options?.labels,
            ...t.labels,
          }),
      samples: t.samples.map((s) => ({
        value: s.value,
        timestamp: s.timestamp ? s.timestamp : Date.now(),
      })),
    })),
  };
  const buffer = await serialize(writeRequest, options?.proto);

  const logger = options?.console || console;

  const start2 = Date.now();
  if (options?.timing) {
    logger.info("Serialized in", start2 - start1, "ms");
  }

  if (options?.url) {
    /** @type import("./types").MinimalFetch */
    let fetch = options.fetch || require("node-fetch").default;
    return fetch(options?.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.google.protobuf",
        ...(options?.auth?.username && options?.auth?.password
          ? {
              Authorization:
                "Basic " +
                btoa(options?.auth.username + ":" + options?.auth?.password),
            }
          : undefined),
        ...(options.headers || {}),
      },
      body: SnappyJS.compress(buffer),
      timeout: options.timeout,
    }).then(async (r) => {
      const text = await r.text();

      if (options?.verbose && r.status != 200) {
        logger.warn(
          "Failed to send write request, error",
          r.status + " " + r.statusText + " " + text,
          writeRequest
        );
      } else if (options?.verbose && !options?.timing) {
        logger.info(
          "Write request sent",
          r.status + " " + r.statusText + " " + text,
          writeRequest
        );
      } else if (options?.verbose && options?.timing) {
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
  } else {
    return {
      status: 400,
      statusText: "Bad request",
      errorMessage: "No endpoint configured",
    };
  }
}

/**
 * Sends metrics over HTTP(s)
 *
 * @param {Record<string,number>} metrics
 * @param {import("./types").Options=} options
 * @return {Promise<import("./types").Result>}
 */
async function pushMetrics(metrics, options) {
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
  loadProto,
  pushTimeseries,
  pushMetrics,
};
