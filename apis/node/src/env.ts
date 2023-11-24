interface EnvParams {
  braintrustApiUrl: string;
  orgName?: string;
  redisHost?: string;
  redisPort?: number;
}

function reloadEnv() {
  return {
    braintrustApiUrl:
      process.env.BRAINTRUST_API_URL || "https://www.braintrustdata.com",
    orgName: process.env.ORG_NAME || "*",
    redisHost: process.env.REDIS_HOST,
    redisPort: parseInt(process.env.REDIS_PORT || "6379"),
  };
}

export let Env = reloadEnv();
export function resetEnv() {
  Env = reloadEnv();
}
