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
} from "jsonwebtoken";
import { isEmpty } from "@lib/util";

const JWT_ALGORITHM = "HS256";

export interface MakeTempCredentialResult {
  /**
   * A generated ID to identify the temporary credential request. The caller
   * uses this key for the credential cache.
   */
  credentialId: string;
  /**
   * The plaintext payload for the credential cache. The caller is expected to
   * encrypt this value and insert it into the credential cache.
   */
  cachePayloadPlaintext: TempCredentialsCacheValue;
  /**
   * The encryption key to be used for the credential cache. The caller should
   * not retain this value after it is used for insertion into the credential
   * cache.
   */
  cacheEncryptionKey: string;
  /**
   * The new temporary credential encoded as a JWT.
   */
  jwt: string;
}

/**
 * Generate a new temporary credential in the JWT format.
 *
 * @param param0
 * @param param0.request The temporary credential request to sign.
 * @param param0.authToken The user's Braintrust API key.
 * @param param0.orgName (Optional) The oranization name associated with the
 * Braintrust API key, to be used by the proxy at request time for looking up AI
 * provider keys.
 * @returns See {@link MakeTempCredentialResult}.
 */
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

/**
 * Generate a new temporary credential and insert it into the credential cache.
 *
 * @param param0
 * @param param0.authToken The user's Braintrust API key.
 * @param param0.body The credential request body after JSON decoding.
 * @param param0.orgName (Optional) The oranization name associated with the
 * Braintrust API key, to be used by the proxy at request time for looking up AI
 * provider keys.
 * @param param0.cachePut: Function to encrypt and insert into the credential
 * cache.
 * @returns
 */
export async function makeTempCredentials({
  authToken,
  body: rawBody,
  orgName,
  cachePut,
}: {
  authToken: string;
  body: unknown;
  orgName?: string;
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
 *
 * @throws uncaught exceptions from the `jsonwebtoken` library:
 * https://www.npmjs.com/package/jsonwebtoken?activeTab=readme#errors--codes
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
/**
 * Check whether the JWT has a valid signature and expiration, then use the
 * payload to retrieve and decrypt the cached user credential.
 *
 * @throws an exception if the credential is invalid for any reason. The
 * `message` does not contain sensitive information and can be safely returned
 * to the user.
 *
 * @param param0
 * @param param0.jwt The encoded JWT to check.
 * @param param0.cacheGet Function to get and decrypt from the credential cache.
 * @returns See {@link VerifyTempCredentialsResult}.
 */
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
  verifyJwtOnly({ jwt, credentialCacheValue });

  // At this point, the JWT signature has been verified. We can safely return
  // the previously decoded result.
  return { jwtPayload, credentialCacheValue };
}
