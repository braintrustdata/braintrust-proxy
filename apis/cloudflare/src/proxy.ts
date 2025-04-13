import {
  EdgeProxyV1,
  FlushingExporter,
  ProxyOpts,
  makeFetchApiSecrets,
  encryptedGet,
} from "@braintrust/proxy/edge";
import {
  NOOP_METER_PROVIDER,
  ORG_NAME_HEADER,
  SpanLogger,
  initMetrics,
  isObject,
  parseAuthHeader,
} from "@braintrust/proxy";
import { PrometheusMetricAggregator } from "./metric-aggregator";
import { handleRealtimeProxy } from "./realtime";
import { braintrustAppUrl } from "./env";
import {
  Attachment,
  BraintrustState,
  loginToState,
  Span,
  startSpan,
} from "braintrust";
import {
  BT_PARENT,
  isArray,
  SpanComponentsV3,
  SpanObjectTypeV3,
} from "@braintrust/core";
import { base64ToArrayBuffer } from "@braintrust/proxy/utils";

export const proxyV1Prefixes = ["/v1/proxy", "/v1"];

function apiCacheKey(key: string) {
  return `http://apikey.cache/${encodeURIComponent(key)}.jpg`;
}

export function originWhitelist(env: Env) {
  return env.WHITELISTED_ORIGINS && env.WHITELISTED_ORIGINS.length > 0
    ? env.WHITELISTED_ORIGINS.split(",")
        .map((x) => x.trim())
        .filter((x) => x)
    : undefined;
}

export async function handleProxyV1(
  request: Request,
  proxyV1Prefix: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  let meterProvider = undefined;
  if (!env.DISABLE_METRICS) {
    const metricShard = Math.floor(
      Math.random() * PrometheusMetricAggregator.numShards(env),
    );
    const aggregator = env.METRICS_AGGREGATOR.get(
      env.METRICS_AGGREGATOR.idFromName(metricShard.toString()),
    );
    const metricAggURL = new URL(request.url);
    metricAggURL.pathname = "/push";

    meterProvider = initMetrics(
      new FlushingExporter((resourceMetrics) =>
        aggregator.fetch(metricAggURL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(resourceMetrics),
        }),
      ),
    );
  }

  const meter = (meterProvider || NOOP_METER_PROVIDER).getMeter(
    "cloudflare-metrics",
  );

  const whitelist = originWhitelist(env);

  const cacheGetLatency = meter.createHistogram("results_cache_get_latency");
  const cacheSetLatency = meter.createHistogram("results_cache_set_latency");

  const cache = await caches.open("apikey:cache");

  let spanLogger: SpanLogger | undefined;
  let span: Span | undefined;
  const parentHeader = request.headers.get(BT_PARENT);
  if (parentHeader) {
    const parent = resolveParentHeader(parentHeader);
    span = startSpan({
      state: await loginToState({
        apiKey:
          parseAuthHeader({
            authorization: request.headers.get("authorization") ?? undefined,
          }) ?? undefined,
        // If the app URL is explicitly set to an env var, it's meant to override
        // the origin.
        appUrl: braintrustAppUrl(env).toString(),
        orgName: request.headers.get(ORG_NAME_HEADER) ?? undefined,
        noExitFlush: true,
      }),
      type: "llm",
      name: "LLM",
      parent: parent.toStr(),
    });
    spanLogger = makeProxySpanLogger(span, ctx.waitUntil.bind(ctx));
  }

  const opts: ProxyOpts = {
    getRelativeURL(request: Request): string {
      return new URL(request.url).pathname.slice(proxyV1Prefix.length);
    },
    cors: true,
    credentialsCache: {
      async get<T>(key: string): Promise<T | null> {
        const response = await cache.match(apiCacheKey(key));
        if (response) {
          return (await response.json()) as T;
        } else {
          return null;
        }
      },
      async set<T>(key: string, value: T, { ttl }: { ttl?: number }) {
        await cache.put(
          apiCacheKey(key),
          new Response(JSON.stringify(value), {
            headers: {
              "Cache-Control": `public${ttl ? `, max-age=${ttl}}` : ""}`,
            },
          }),
        );
      },
    },
    completionsCache: {
      get: async (key) => {
        const start = performance.now();
        const ret = await env.ai_proxy.get(key);
        const end = performance.now();
        cacheGetLatency.record(end - start);
        if (ret) {
          return JSON.parse(ret);
        } else {
          return null;
        }
      },
      set: async (key, value, { ttl }: { ttl?: number }) => {
        const start = performance.now();
        await env.ai_proxy.put(key, JSON.stringify(value), {
          expirationTtl: ttl,
        });
        const end = performance.now();
        cacheSetLatency.record(end - start);
      },
    },
    braintrustApiUrl: braintrustAppUrl(env).toString(),
    meterProvider,
    whitelist,
    spanLogger,
  };

  const url = new URL(request.url);
  if (url.pathname === `${proxyV1Prefix}/realtime`) {
    return await handleRealtimeProxy({
      request,
      env,
      ctx,
      cacheGet: async (encryptionKey: string, key: string) => {
        if (!opts.completionsCache) {
          return null;
        }
        return (
          (await encryptedGet(opts.completionsCache, encryptionKey, key)) ??
          null
        );
      },
      getApiSecrets: makeFetchApiSecrets({ ctx, opts }),
    });
  }

  return EdgeProxyV1(opts)(request, ctx);
}

export async function handlePrometheusScrape(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (env.DISABLE_METRICS) {
    return new Response("Metrics disabled", { status: 403 });
  }
  if (
    env.PROMETHEUS_SCRAPE_USER !== undefined ||
    env.PROMETHEUS_SCRAPE_PASSWORD !== undefined
  ) {
    const unauthorized = new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Braintrust Proxy Metrics"',
      },
    });

    const auth = request.headers.get("Authorization");
    if (!auth || auth.indexOf("Basic ") !== 0) {
      return unauthorized;
    }

    const userPass = atob(auth.slice("Basic ".length)).split(":");
    if (
      userPass[0] !== env.PROMETHEUS_SCRAPE_USER ||
      userPass[1] !== env.PROMETHEUS_SCRAPE_PASSWORD
    ) {
      return unauthorized;
    }
  }
  // Array from 0 ... numShards
  const shards = await Promise.all(
    Array.from(
      { length: PrometheusMetricAggregator.numShards(env) },
      async (_, i) => {
        const aggregator = env.METRICS_AGGREGATOR.get(
          env.METRICS_AGGREGATOR.idFromName(i.toString()),
        );
        const url = new URL(request.url);
        url.pathname = "/metrics";
        const resp = await aggregator.fetch(url, {
          method: "POST",
        });
        if (resp.status !== 200) {
          throw new Error(
            `Unexpected status code ${resp.status} ${
              resp.statusText
            }: ${await resp.text()}`,
          );
        } else {
          return await resp.text();
        }
      },
    ),
  );
  return new Response(shards.join("\n"), {
    headers: {
      "Content-Type": "text/plain",
    },
  });
}

export function makeProxySpanLogger(
  span: Span,
  waitUntil: (promise: Promise<any>) => void,
): SpanLogger {
  return {
    log: (args) => {
      span.log(replacePayloadWithAttachments(args, span.state()));
      waitUntil(span.flush());
    },
    end: span.end.bind(span),
    setName(name) {
      span.setAttributes({ name });
    },
    reportProgress() {
      return;
    },
  };
}
export function replacePayloadWithAttachments<T>(
  data: T,
  state: BraintrustState | undefined,
): T {
  return replacePayloadWithAttachmentsInner(data, state) as T;
}

function replacePayloadWithAttachmentsInner(
  data: unknown,
  state: BraintrustState | undefined,
): unknown {
  if (isArray(data)) {
    return data.map((item) => replacePayloadWithAttachmentsInner(item, state));
  } else if (isObject(data)) {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        replacePayloadWithAttachmentsInner(value, state),
      ]),
    );
  } else if (typeof data === "string") {
    if (isBase64Image(data)) {
      const { mimeType, data: arrayBuffer } = getBase64Parts(data);
      const filename = `file.${mimeType.split("/")[1]}`;
      return new Attachment({
        data: arrayBuffer,
        contentType: mimeType,
        filename,
        state,
      });
    } else {
      return data;
    }
  } else {
    return data;
  }
}

const base64ImagePattern =
  /^data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/]+={0,2}$/;
export function isBase64Image(s: string): boolean {
  // Avoid unnecessary (slower) pattern matching
  if (!s.startsWith("data:")) {
    return false;
  }

  return base64ImagePattern.test(s);
}
// Being as specific as possible about allowable characters and avoiding greedy matching
// helps avoid catastrophic backtracking: https://github.com/braintrustdata/braintrust/pull/4831
const base64ContentTypePattern =
  /^data:([a-zA-Z0-9]+\/[a-zA-Z0-9+.-]+);base64,/;
export function getBase64Parts(s: string): {
  mimeType: string;
  data: ArrayBuffer;
} {
  const parts = s.match(base64ContentTypePattern);
  if (!parts) {
    throw new Error("Invalid base64 image");
  }
  const mimeType = parts[1];
  const data = s.slice(`data:${mimeType};base64,`.length);
  return { mimeType, data: base64ToArrayBuffer(data) };
}

// XXX delete this once the new core version is live
const EXPERIMENT_ID_PREFIX = "experiment_id:";
const PROJECT_ID_PREFIX = "project_id:";
const PROJECT_NAME_PREFIX = "project_name:";
const PLAYGROUND_ID_PREFIX = "playground_id:";

export function resolveParentHeader(header: string): SpanComponentsV3 {
  if (header.startsWith(EXPERIMENT_ID_PREFIX)) {
    return new SpanComponentsV3({
      object_type: SpanObjectTypeV3.EXPERIMENT,
      object_id: header.substring(EXPERIMENT_ID_PREFIX.length),
    });
  } else if (header.startsWith(PROJECT_ID_PREFIX)) {
    return new SpanComponentsV3({
      object_type: SpanObjectTypeV3.PROJECT_LOGS,
      object_id: header.substring(PROJECT_ID_PREFIX.length),
    });
  } else if (header.startsWith(PLAYGROUND_ID_PREFIX)) {
    return new SpanComponentsV3({
      object_type: SpanObjectTypeV3.PLAYGROUND_LOGS,
      object_id: header.substring(PLAYGROUND_ID_PREFIX.length),
    });
  } else if (header.startsWith(PROJECT_NAME_PREFIX)) {
    const projectName = header.substring(PROJECT_NAME_PREFIX.length);
    return new SpanComponentsV3({
      object_type: SpanObjectTypeV3.PROJECT_LOGS,
      compute_object_metadata_args: {
        project_name: projectName,
      },
    });
  }

  return SpanComponentsV3.fromStr(header);
}
