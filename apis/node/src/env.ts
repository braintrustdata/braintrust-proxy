function reloadEnv() {
  return {
    braintrustApiUrl:
      process.env.BRAINTRUST_API_URL || "https://www.braintrustdata.com",
    orgName: process.env.ORG_NAME || "*",
    redisHost: process.env.REDIS_HOST,
    redisPort: parseInt(process.env.REDIS_PORT || "6379"),
    localCachePath: process.env.BRAINTRUST_PROXY_LOCAL_CACHE_PATH || "",
  };
}

export let Env = reloadEnv();
export function resetEnv() {
  Env = reloadEnv();
}
