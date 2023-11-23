import { createClient, RedisClientType } from "redis";

import { Env } from "./env";

let redisClient: RedisClientType | null = null;
export async function getRedis() {
  if (redisClient === null && Env.redisHost && Env.redisPort) {
    redisClient = createClient({
      socket: {
        host: Env.redisHost,
        port: Env.redisPort,
      },
    });
    await redisClient.connect();
  }
  return redisClient;
}
