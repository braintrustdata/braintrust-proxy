import { proxyV1Prefix, handleProxyV1, handlePrometheusScrape } from "./proxy";
export { PrometheusMetricAggregator } from "./metric-aggregator";

// The fetch handler is invoked when this worker receives a HTTP(S) request
// and should return a Response (optionally wrapped in a Promise)
// eslint-disable-next-line import/no-anonymous-default-export
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(proxyV1Prefix)) {
      return handleProxyV1(request, env, ctx);
    } else if (url.pathname === "/metrics") {
      return handlePrometheusScrape(request, env, ctx);
    } else if (url.pathname === "/") {
      return new Response("Hello World!", {
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,OPTIONS",
        },
      });
    }

    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  },
};
