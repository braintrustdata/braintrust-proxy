// Isolation test #4: mirror proxyV1's exact pattern — fetch an upstream,
// pipeTo a TransformStream, return readable as Response body. NO
// Cache-Control header (mirrors what proxyV1 effectively does with
// Anthropic's headers). If this returns empty body, the issue is Cloudflare
// (or some intermediary) stripping bodies for this response shape.
export const dynamic = "force-dynamic";

async function handler(): Promise<Response> {
  const upstream = await fetch("https://api.github.com/repos/vercel/next.js", {
    headers: { "user-agent": "braintrust-proxy-test" },
  });
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  upstream.body!.pipeTo(writable).catch((err) => {
    console.error("test-proxy pipeTo failed", err);
  });

  return new Response(readable, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  });
}

export const GET = handler;
export const POST = handler;
