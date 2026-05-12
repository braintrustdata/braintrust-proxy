import type { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { kv } from "@vercel/kv";

const ratelimit = new Ratelimit({
  redis: kv,
  // 5 requests from the same IP in 10 seconds
  limiter: Ratelimit.slidingWindow(1000, "10 s"),
});

export const config = {
  runtime: "edge",
};

let i = 0;
export default async function handler(request: NextRequest) {
  // You could alternatively limit based on user ID or similar
  const ip = request.ip ?? "127.0.0.1";
  /*
  let start = Date.now();
  const { limit, reset, remaining } = await ratelimit.limit(ip);
  let end = Date.now();
  console.log("Rate limit KV latency (ms):", end - start);
  */
  await kv.set("foo", `${i}`);
  i += 1;

  let start = Date.now();
  const foo = await kv.get("foo");
  let end = Date.now();
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
