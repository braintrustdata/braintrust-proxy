import { type BillingEvent } from "@braintrust/proxy";

const DEFAULT_BILLING_TELEMETRY_URL =
  "https://api.braintrust.dev/billing/telemetry/ingest";

function buildPayloadEvent(event: BillingEvent) {
  if (!event.org_id) {
    console.warn("billing event skipped: missing org_id");
    return null;
  }
  if (!event.model) {
    console.warn("billing event skipped: missing model");
    return null;
  }
  if (!event.resolved_model) {
    console.warn("billing event skipped: missing resolved_model");
    return null;
  }
  const hasTokenUsageData =
    event.input_tokens !== undefined ||
    event.output_tokens !== undefined ||
    event.cached_input_tokens !== undefined ||
    event.cache_write_input_tokens !== undefined;
  if (!hasTokenUsageData) {
    console.warn("billing event skipped: missing token usage");
    return null;
  }
  const requestId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  return {
    event_name: "NativeInferenceTokenUsageEvent",
    external_customer_id: event.org_id,
    timestamp,
    idempotency_key: requestId,
    properties: {
      model: event.model,
      resolved_model: event.resolved_model,
      org_id: event.org_id,
      input_tokens: event.input_tokens,
      output_tokens: event.output_tokens,
      cached_input_tokens: event.cached_input_tokens,
      cache_write_input_tokens: event.cache_write_input_tokens,
    },
  };
}

export async function sendBillingTelemetryEvent({
  telemetryUrl,
  event,
}: {
  telemetryUrl?: string;
  event: BillingEvent;
}): Promise<void> {
  try {
    const payloadEvent = buildPayloadEvent(event);
    if (!payloadEvent) {
      return;
    }

    const destination = telemetryUrl || DEFAULT_BILLING_TELEMETRY_URL;
    const response = await fetch(destination, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${event.auth_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        events: [payloadEvent],
      }),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      console.warn(
        `billing event failed: ${response.status} ${response.statusText} ${responseBody}`,
      );
    }
  } catch (error) {
    console.warn("billing event threw an error", error);
  }
}
