import { z } from "zod";

export const CUSTOM_API_KEY_AUTH_CAPABILITY_HEADER =
  "x-bt-supports-custom-api-key-auth";

export const customApiKeyAuthFieldsSchema = z.object({
  auth_header: z.string().nullish(),
  auth_prefix: z.string().nullish(),
});

export function customApiKeyAuthSettings(
  metadata: Record<string, unknown> | null | undefined,
  providerType?: string | null,
): { header: string; prefix: string | undefined } | undefined {
  if (metadata?.auth_header == null && metadata?.auth_prefix == null) {
    return undefined;
  }
  const parsed = customApiKeyAuthFieldsSchema.safeParse(metadata);
  if (!parsed.success) {
    throw new Error("Authentication header and prefix must be strings");
  }
  const { auth_header: header, auth_prefix: prefix } = parsed.data;
  if (!header && !prefix) {
    return undefined;
  }
  if (!header || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header)) {
    throw new Error("Invalid authentication header name");
  }
  if (prefix && (!/^[\x20-\x7e]+$/.test(prefix) || prefix.trim() !== prefix)) {
    throw new Error("Invalid authentication prefix");
  }
  if (
    (providerType !== undefined && providerType !== "openai") ||
    typeof metadata?.api_base !== "string" ||
    !metadata.api_base ||
    (metadata.auth_type != null && metadata.auth_type !== "api_key")
  ) {
    throw new Error(
      "Custom authentication headers require an OpenAI-compatible endpoint with API-key authentication",
    );
  }
  const additionalHeaders = z
    .record(z.string())
    .nullish()
    .safeParse(metadata.additionalHeaders);
  if (!additionalHeaders.success) {
    throw new Error("Invalid additional headers");
  }
  const name = header.toLowerCase();
  if (
    Object.keys(additionalHeaders.data ?? {}).some(
      (key) =>
        key.toLowerCase() === name || key.toLowerCase() === "authorization",
    )
  ) {
    throw new Error(
      "Authentication headers must not also be configured in additional headers",
    );
  }
  return { header: name, prefix: prefix || undefined };
}

export function customApiKeyAuthHeader(
  metadata: Record<string, unknown> | null | undefined,
  providerType: string,
  secret: string | null,
): [string, string] | undefined {
  const settings = customApiKeyAuthSettings(metadata, providerType);
  if (!settings) {
    return undefined;
  }
  if (!secret || !/^[\x21-\x7e]+$/.test(secret)) {
    throw new Error(
      "Custom authentication requires a nonempty API key containing valid header characters",
    );
  }
  return [
    settings.header,
    settings.prefix ? `${settings.prefix} ${secret}` : secret,
  ];
}
