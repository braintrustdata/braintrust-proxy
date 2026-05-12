// Isolation test #2: does `new Response(readableStream, ...)` deliver a
// body on this deployment? Constructs a simple ReadableStream that
// enqueues two chunks then closes — no TransformStream, no background
// writers, no waitUntil.
//
// If this returns "hello world": ReadableStream Response bodies are fine.
// If empty: this Vercel Node deployment can't deliver streaming responses.
export const dynamic = "force-dynamic";

async function handler(): Promise<Response> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("hello "));
      controller.enqueue(encoder.encode("world"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/plain",
      "x-test": "stream",
    },
  });
}

export const GET = handler;
export const POST = handler;
