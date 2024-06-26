function reloadEnv() {
  return {
    braintrustApiUrl:
      process.env.BRAINTRUST_APP_URL || "https://www.braintrust.dev",
    orgName: process.env.ORG_NAME || "*",
    redisHost: process.env.REDIS_HOST,
    redisPort: parseInt(process.env.REDIS_PORT || "6379"),
    redisUrl: process.env.REDIS_URL,
  };
}

export let Env = reloadEnv();
export function resetEnv() {
  Env = reloadEnv();
}
