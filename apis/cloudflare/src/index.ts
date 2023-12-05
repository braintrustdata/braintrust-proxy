import { ResolveConfigFn, instrument } from "@microlabs/otel-cf-workers";
import { proxyV1Prefix, handleProxyV1 } from "./proxy";
export { PrometheusMetricAggregator } from "./metric-aggregator";

// The fetch handler is invoked when this worker receives a HTTP(S) request
// and should return a Response (optionally wrapped in a Promise)
const handler = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(proxyV1Prefix)) {
      return handleProxyV1(request, env, ctx);
    }

    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  },
};

const config: ResolveConfigFn = (env: Env, _trigger) => {
  return {
    exporter: {
      url: "http://localhost:4318/v1/traces",
    },
    service: { name: "greetings" },
  };
};

export default instrument(handler, config);
