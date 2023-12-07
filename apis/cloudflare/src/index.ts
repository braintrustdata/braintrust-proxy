import { proxyV1Prefix, handleProxyV1, handlePrometheusScrape } from "./proxy";
export { PrometheusMetricAggregator } from "./metric-aggregator";

// The fetch handler is invoked when this worker receives a HTTP(S) request
// and should return a Response (optionally wrapped in a Promise)
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(proxyV1Prefix)) {
      return handleProxyV1(request, env, ctx);
    } else if (url.pathname === "/metrics") {
      return handlePrometheusScrape(request, env, ctx);
    }

    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  },
};
