import { kv } from "@vercel/kv";

let i = 0;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await kv.set("foo", `${i}`);
  i += 1;

  await kv.get("foo");

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "X-RateLimit-Limit": "0",
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": "0",
    },
  });
}
