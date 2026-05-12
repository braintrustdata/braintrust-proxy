// Same as /test-proxy but with `Cache-Control: no-cache, no-transform`,
// matching Vercel's canonical streaming-proxy example. If this returns a
// body and /test-proxy returns empty, Cloudflare is transforming/dropping
// the body and `no-transform` fixes it.
export const dynamic = "force-dynamic";

async function handler(): Promise<Response> {
  const upstream = await fetch("https://api.github.com/repos/vercel/next.js", {
    headers: { "user-agent": "braintrust-proxy-test" },
  });
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  upstream.body!.pipeTo(writable).catch((err) => {
    console.error("test-proxy-notransform pipeTo failed", err);
  });

  return new Response(readable, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-cache, no-transform",
    },
  });
}

export const GET = handler;
export const POST = handler;
