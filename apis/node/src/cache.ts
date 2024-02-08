import { createClient, RedisClientType } from "redis";

import { Env } from "./env";

let redisClient: RedisClientType | null = null;
export async function getRedis() {
  if (redisClient === null && ((Env.redisHost && Env.redisPort) || Env.redisUrl)) {
    if (Env.redisUrl) {
        redisClient = createClient({
            url: Env.redisUrl,
        });
    } else {
      redisClient = createClient({
        socket: {
          host: Env.redisHost,
          port: Env.redisPort,
        },
      });
    }
    await redisClient.connect();
  }
  return redisClient;
}
