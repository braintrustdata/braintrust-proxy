import { Ratelimit } from "@upstash/ratelimit";
import { ipAddress } from "@vercel/functions";
import { kv } from "@vercel/kv";

const ratelimit = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(1000, "10 s"),
});

let i = 0;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = ipAddress(request) ?? "127.0.0.1";
  void ip;
  void ratelimit;

  await kv.set("foo", `${i}`);
  i += 1;

  const start = Date.now();
  const foo = await kv.get("foo");
  const end = Date.now();
  console.log("Get ", foo, " KV latency (ms):", end - start);

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "X-RateLimit-Limit": "0",
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": "0",
    },
  });
}
