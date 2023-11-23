interface EnvParams {
  allowedOrigin: string;
  orgName?: string;
  redisHost?: string;
  redisPort?: number;
}

export const Env: EnvParams = {
  allowedOrigin: "https://www.braintrustdata.com",
  orgName: process.env.ORG_NAME,
  redisHost: process.env.REDIS_HOST,
  redisPort: parseInt(process.env.REDIS_PORT || "6379"),
};
