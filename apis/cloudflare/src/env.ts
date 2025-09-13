declare global {
  interface Env {
    ai_proxy: KVNamespace;
    BRAINTRUST_APP_URL: string;
    WHITELISTED_ORIGINS?: string;
    METRICS_LICENSE_KEY?: string;
  }
}

export function braintrustAppUrl(env: Env) {
  return new URL(env.BRAINTRUST_APP_URL || "https://www.braintrust.dev");
}
