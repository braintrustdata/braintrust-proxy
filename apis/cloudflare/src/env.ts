declare global {
  interface Env {
    ai_proxy: KVNamespace;
    BRAINTRUST_APP_URL: string;
    DISABLE_METRICS?: boolean;
    PROMETHEUS_SCRAPE_USER?: string;
    PROMETHEUS_SCRAPE_PASSWORD?: string;
    WHITELISTED_ORIGINS?: string;
  }
}

export function braintrustAppUrl(env: Env) {
  return new URL(env.BRAINTRUST_APP_URL || "https://www.braintrust.dev");
}
