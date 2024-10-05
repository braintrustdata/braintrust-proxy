import {
  proxyV1Prefixes,
  handleProxyV1,
  handlePrometheusScrape,
  originWhitelist,
} from "./proxy";
import { getCorsHeaders } from "@braintrust/proxy/edge";
import { handleRealtimeProxy } from "./realtime";
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

    for (const prefix of proxyV1Prefixes) {
      if (url.pathname.startsWith(prefix)) {
        if (url.pathname === `${prefix}/realtime`) {
          return handleRealtimeProxy(request, prefix, env, ctx);
        }
        return handleProxyV1(request, prefix, env, ctx);
      }
    }
    if (url.pathname === "/metrics") {
      return handlePrometheusScrape(request, env, ctx);
    } else if (url.pathname === "/") {
      return new Response("Hello World!", {
        status: 200,
        headers: getCorsHeaders(request, originWhitelist(env)),
      });
    }

    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  },
};
