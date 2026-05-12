// Isolation test: does *any* response body reach the client on this
// deployment? No EdgeProxyV1, no streaming, no upstream call. Just a
// fixed JSON body. If this comes back empty, the problem is the
// deployment pipeline (Cloudflare in front, Vercel preview protection,
// the project's domain config), not our proxy code.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const body = JSON.stringify({
    test: "hello",
    at: new Date().toISOString(),
  });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-test": "true",
    },
  });
}

export async function POST(): Promise<Response> {
  return GET();
}
