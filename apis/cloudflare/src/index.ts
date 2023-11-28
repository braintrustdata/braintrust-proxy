import { proxyV1Prefix, handleProxyV1 } from "./proxy";

// Export a default object containing event handlers
// eslint-disable-next-line import/no-anonymous-default-export
export default {
  // The fetch handler is invoked when this worker receives a HTTP(S) request
  // and should return a Response (optionally wrapped in a Promise)
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    // You'll find it helpful to parse the request.url string into a URL object. Learn more at https://developer.mozilla.org/en-US/docs/Web/API/URL
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
