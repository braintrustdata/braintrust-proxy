// Isolation test #3: mirrors EdgeProxyV1's exact pattern — a
// TransformStream where bytes are written to `writable` from a background
// task while `readable` is returned as the Response body. No upstream
// fetch, just synthetic writes.
//
// If this returns "hello world": the TransformStream + background-write
// pattern works on Vercel Node, and the issue is somewhere deeper inside
// EdgeProxyV1 / proxyV1 (interaction with the upstream fetch).
// If empty: this exact pattern (which EdgeProxyV1 uses) doesn't work on
// Vercel Node — we need a different response-construction approach.
export const dynamic = "force-dynamic";

async function handler(): Promise<Response> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Fire-and-forget background writes — same shape as proxyV1's
  // stream.pipeTo(res).catch(...)
  (async () => {
    try {
      await writer.write(encoder.encode("hello "));
      await writer.write(encoder.encode("world"));
      await writer.close();
    } catch (err) {
      console.error("transform write error", err);
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      "content-type": "text/plain",
      "x-test": "transform",
    },
  });
}

export const GET = handler;
export const POST = handler;
