import { isEmpty } from "@lib/util";
import { z } from "zod";

export const rateLimitWindowSchema = z.enum(["minute", "hour", "day"]);
export const rateLimitSchema = z.object({
  resource_id: z.string(),
  limit: z.number(),
  window: rateLimitWindowSchema,
});
export type RateLimit = z.infer<typeof rateLimitSchema>;

export const rateLimitResponseSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ok"),
    remaining: z.number().optional(),
  }),
  z.object({
    type: z.literal("exceeded"),
    try_again_seconds: z.number(),
  }),
]);
export type RateLimitResponse = z.infer<typeof rateLimitResponseSchema>;

export function mergeRateLimitResponses(
  responses: RateLimitResponse[],
): RateLimitResponse {
  let ret: RateLimitResponse = { type: "ok" };
  for (const response of responses) {
    if (response.type === "ok") {
      if (ret.type !== "ok") {
        // Another rate limit has already kicked in
        continue;
      } else if (!isEmpty(response.remaining)) {
        ret.remaining = isEmpty(ret.remaining)
          ? response.remaining
          : Math.min(ret.remaining, response.remaining);
      }
    } else {
      if (ret.type === "ok") {
        ret = response;
      } else {
        ret.try_again_seconds = Math.max(
          ret.try_again_seconds,
          response.try_again_seconds,
        );
      }
    }
  }

  return ret;
}
