import {
  CredentialsRequest,
  credentialsRequestSchema,
  TempCredentialJwtPayload,
  tempCredentialJwtPayloadSchema,
  TempCredentialsCacheValue,
  tempCredentialsCacheValueSchema,
} from "../schema";
import { v4 as uuidv4 } from "uuid";
import { arrayBufferToBase64 } from "./encrypt";
import {
  sign as jwtSign,
  verify as jwtVerify,
  decode as jwtDecode,
  JwtPayload,
} from "jsonwebtoken";
import { isEmpty } from "@lib/util";

const JWT_ALGORITHM = "HS256";

export interface MakeTempCredentialResult {
  // The key for the cache.
  credentialId: string;
  // The caller is expected to encrypt the cache payload with the cacheEncryptionKey.
  cachePayloadPlaintext: TempCredentialsCacheValue;
  cacheEncryptionKey: string;
  // The JWT to return to the caller.
  jwt: string;
}
export function makeTempCredentialsJwt({
  request,
  authToken,
  orgName,
}: {
  request: CredentialsRequest;
  authToken: string;
  orgName?: string;
}): MakeTempCredentialResult {
  const credentialId = `bt_tmp:${uuidv4()}`;

  // Generate 256-bit key since our cache uses AES-256.
  const keyLengthBytes = 256 / 8;
  const cacheEncryptionKey = arrayBufferToBase64(
    crypto.getRandomValues(new Uint8Array(keyLengthBytes)),
  );

  // The partial payload is missing timestamps (`iat`, `exp`). They will be
  // populated at signing time with the `mutatePayload` option.
  const jwtPayload: Partial<TempCredentialJwtPayload> = {
    iss: "braintrust_proxy",
    aud: "braintrust_proxy",
    jti: credentialId,
    bt: {
      org_name: orgName,
      model: request.model,
      secret: cacheEncryptionKey,
    },
  };
  const jwt = jwtSign(jwtPayload, authToken, {
    expiresIn: request.ttl_seconds,
    mutatePayload: true,
    algorithm: JWT_ALGORITHM,
  });

  if (!tempCredentialJwtPayloadSchema.safeParse(jwtPayload).success) {
    // This should not happen.
    throw new Error("JWT payload didn't pass schema check after signing");
  }

  return {
    credentialId,
    cachePayloadPlaintext: { authToken },
    cacheEncryptionKey,
    jwt,
  };
}

export async function makeTempCredentials({
  authToken,
  body: rawBody,
  orgName,
  cachePut,
}: {
  authToken: string;
  body: unknown;
  orgName: string | undefined;
  cachePut: (
    encryptionKey: string,
    key: string,
    value: string,
    ttl_seconds?: number,
  ) => Promise<void>;
}) {
  const body = credentialsRequestSchema.safeParse(rawBody);
  if (!body.success) {
    throw new Error(body.error.message);
  }

  const { credentialId, cachePayloadPlaintext, cacheEncryptionKey, jwt } =
    makeTempCredentialsJwt({ request: body.data, authToken, orgName });

  const { ttl_seconds } = body.data;

  await cachePut(
    cacheEncryptionKey,
    credentialId,
    JSON.stringify(cachePayloadPlaintext),
    ttl_seconds,
  );

  return jwt;
}

/**
 * Check whether the JWT appears to be a Braintrust temporary credential. This
 * function only checks for a syntactically valid JWT with a Braintrust `iss`
 * or `aud` field.
 *
 * In case this function returns some false positives when sniffing whether a
 * token is a Braintrust temp credential, this does not affect confidentiality
 * or integrity. However, we still want to be precise so we can show the proper
 * error message in case there are multiple token types using JWT.
 *
 * @param jwt The encoded JWT to check.
 * @returns True if the `jwt` satisfies the checks.
 */
export function isTempCredential(jwt: string): boolean {
  const looseJwtPayloadSchema = tempCredentialJwtPayloadSchema
    .pick({ iss: true })
    .or(tempCredentialJwtPayloadSchema.pick({ aud: true }));
  return looseJwtPayloadSchema.safeParse(
    jwtDecode(jwt, { complete: false, json: true }),
  ).success;
}

/**
 * Throws if the jwt has an invalid signature or is expired. Does not verify
 * Braintrust payload.
 */
export function verifyJwtOnly({
  jwt,
  credentialCacheValue,
}: {
  jwt: string;
  credentialCacheValue: TempCredentialsCacheValue;
}): void {
  jwtVerify(jwt, credentialCacheValue.authToken, {
    algorithms: [JWT_ALGORITHM],
  });
}

export interface VerifyTempCredentialsResult {
  jwtPayload: TempCredentialJwtPayload;
  credentialCacheValue: TempCredentialsCacheValue;
}
export async function verifyTempCredentials({
  jwt,
  cacheGet,
}: {
  jwt: string;
  cacheGet: (encryptionKey: string, key: string) => Promise<string | null>;
}): Promise<VerifyTempCredentialsResult> {
  // Decode, but do not verify, just to get the ID and encryption key.
  const jwtPayloadRaw = jwtDecode(jwt, { complete: false, json: true });
  if (isEmpty(jwtPayloadRaw)) {
    throw new Error("Could not parse JWT format");
  }

  // Safe to show exception message to the client because they already know the
  // request contents.
  const jwtPayload = tempCredentialJwtPayloadSchema.parse(jwtPayloadRaw);

  let credentialCacheValue: TempCredentialsCacheValue | undefined;
  try {
    const cacheValueString = await cacheGet(
      jwtPayload.bt.secret,
      jwtPayload.jti,
    );
    if (!cacheValueString) {
      throw new Error("expired");
    }
    credentialCacheValue = tempCredentialsCacheValueSchema.parse(
      JSON.parse(cacheValueString),
    );
  } catch (error) {
    // Hide error detail to avoid accidentally disclosing Braintrust auth token.
    if (error instanceof Error && error.message !== "expired") {
      console.error(
        "Credential cache error:",
        error.stack || "stack trace not available",
      );
    }
    throw new Error("Could not access credential cache");
  }

  // Safe to show exception message to the client.
  // https://www.npmjs.com/package/jsonwebtoken?activeTab=readme#errors--codes
  verifyJwtOnly({ jwt, credentialCacheValue });

  // At this point, the JWT signature has been verified. We can safely return
  // the previously decoded result.
  return { jwtPayload, credentialCacheValue };
}
