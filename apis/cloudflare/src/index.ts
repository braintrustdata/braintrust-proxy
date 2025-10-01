import {
  proxyV1Prefixes,
  handleProxyV1,
  handlePrometheusScrape,
  originWhitelist,
} from "./proxy";
import { getCorsHeaders } from "@braintrust/proxy/edge";
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
    console.log("URL =", url.pathname);
    if (["/", "/v1/proxy", "/v1/proxy/"].includes(url.pathname)) {
      return new Response("Hello world!", {
        status: 200,
        headers: getCorsHeaders(request, originWhitelist(env)),
      });
    }
    if (url.pathname === "/metrics") {
      return handlePrometheusScrape(request, env, ctx);
    }
    for (const prefix of proxyV1Prefixes) {
      if (url.pathname.startsWith(prefix)) {
        return handleProxyV1(request, prefix, env, ctx);
      }
    }
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  },
};
