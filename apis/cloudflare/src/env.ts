declare global {
  interface Env {
    ai_proxy: KVNamespace;
    BRAINTRUST_APP_URL: string;
    WHITELISTED_ORIGINS?: string;
    METRICS_LICENSE_KEY?: string;
    PULSE_URL?: string;
    BILLING_TELEMETRY_URL?: string;
    NATIVE_INFERENCE_SECRET_KEY?: string;
  }
}

export function pulseUrl(env: Env) {
  return (env.PULSE_URL || `${env.BRAINTRUST_APP_URL}/api/pulse`).replace(
    /\/+$/,
    "",
  );
}

export function braintrustAppUrl(env: Env) {
  return new URL(env.BRAINTRUST_APP_URL || "https://www.braintrust.dev");
}
