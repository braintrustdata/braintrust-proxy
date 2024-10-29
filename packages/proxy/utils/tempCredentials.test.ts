import { expect, test } from "vitest";
import {
  isTempCredential,
  makeTempCredentialsJwt,
  verifyTempCredentials,
  verifyJwtOnly,
  makeTempCredentials,
} from "./tempCredentials";
import {
  sign as jwtSign,
  verify as jwtVerify,
  decode as jwtDecode,
} from "jsonwebtoken";
import { base64ToArrayBuffer } from "./encrypt";
import {
  tempCredentialJwtPayloadSchema,
  TempCredentialsCacheValue,
} from "@schema";

test("isTempCredential", () => {
  expect(isTempCredential("")).toStrictEqual(false);
  expect(isTempCredential("not a jwt")).toStrictEqual(false);
  expect(isTempCredential("foo.bar.baz")).toStrictEqual(false);

  // Generated by https://jwt.io/ with empty object payload.
  const jwtEmptyPayload =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.Et9HFtf9R3GEMA0IICOfFMVXY7kkTX1wr4qCyhIf58U";
  expect(isTempCredential(jwtEmptyPayload)).toStrictEqual(false);

  // Payload contains { iss: "other" }.
  const jwtWithOtherIss =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJvdGhlciIsImlhdCI6MTUxNjIzOTAyMn0.AEa0ufe56lGXsudWgXkGQFgCHASl01lgg9QOOOxVDrk";
  expect(isTempCredential(jwtWithOtherIss)).toStrictEqual(false);

  // Payload contains { iss: "braintrust_proxy" }.
  const jwtWithBraintrustIss =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJicmFpbnRydXN0X3Byb3h5IiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.hpplNcSv9qiWEpk_vKXSWZWnXBjiFy4F6phxdKUG30s";
  expect(isTempCredential(jwtWithBraintrustIss)).toStrictEqual(true);

  // Payload contains { aud: "braintrust_proxy" }.
  const jwtWithBraintrustAud =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJicmFpbnRydXN0X3Byb3h5IiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.nrmMZvokcpywnPvDRhgG635FTY_bBzkYpswafWqogTs";
  expect(isTempCredential(jwtWithBraintrustAud)).toStrictEqual(true);
});

test("makeTempCredentialsJwt signing", () => {
  const result = makeTempCredentialsJwt({
    request: { model: "model", ttl_seconds: 100 },
    authToken: "auth token",
    orgName: "my org name",
  });

  // Some HTTP servers have a header size limit.
  expect(result.jwt.length).toBeLessThan(2000);

  // Throws if JWT signature verification fails.
  const rawPayload = jwtVerify(result.jwt, "auth token", { complete: false });

  expect(rawPayload).toBeTruthy();
  expect(rawPayload).toBeTypeOf("object");

  // Example:
  // {
  //   "aud": "braintrust_proxy",
  //   "bt": {
  //     "model": "model",
  //     "org_name": "my org name",
  //     "secret": "nCCxgkBoyy/zyOJlikuHILBMoK78bHFosEzy03SjJF0=",
  //   },
  //   "exp": 1729928077,
  //   "iat": 1729927977,
  //   "iss": "braintrust_proxy",
  //   "jti": "bt_tmp:331278af-937c-4f97-9d42-42c83631001a",
  // }
  const payload = tempCredentialJwtPayloadSchema.parse(rawPayload);

  expect(payload.bt.model).toStrictEqual("model");
  expect(payload.bt.org_name).toStrictEqual("my org name");

  expect(payload.bt.secret).not.toHaveLength(0);
  expect(payload.bt.secret).toStrictEqual(result.cacheEncryptionKey);

  expect(payload.jti).not.toHaveLength(0);
  expect(payload.jti).toStrictEqual(result.credentialId);

  expect(payload.exp - payload.iat).toStrictEqual(100);

  expect(base64ToArrayBuffer(result.cacheEncryptionKey).byteLength).toEqual(
    256 / 8,
  );

  expect(result.cachePayloadPlaintext).toEqual({ authToken: "auth token" });
  expect(result.credentialId).toMatch(
    /^bt_tmp:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
});

test("makeTempCredentialsJwt no secret reuse", () => {
  const args = {
    request: { model: "model", ttl_seconds: 100 },
    authToken: "auth token",
    orgName: "my org name",
  };
  const result1 = makeTempCredentialsJwt({ ...args });
  const result2 = makeTempCredentialsJwt({ ...args });

  expect(result1.credentialId).not.toStrictEqual(result2.credentialId);
  expect(result1.cacheEncryptionKey).not.toStrictEqual(
    result2.cacheEncryptionKey,
  );

  const raw1 = jwtDecode(result1.jwt, { complete: false, json: true });
  const raw2 = jwtDecode(result2.jwt, { complete: false, json: true });

  const payload1 = tempCredentialJwtPayloadSchema.parse(raw1);
  const payload2 = tempCredentialJwtPayloadSchema.parse(raw2);

  expect(payload1.bt.secret).not.toStrictEqual(payload2.bt.secret);
  expect(payload1.jti).not.toStrictEqual(payload2.jti);
});

test("makeTempCredentials no wrapping other temp credential", async () => {
  const result = makeTempCredentialsJwt({
    request: { model: "model", ttl_seconds: 100 },
    authToken: "auth token",
    orgName: "my org name",
  });

  // Use the previous temp credential JWT to issue another one.
  await expect(
    makeTempCredentials({
      authToken: result.jwt,
      body: {
        model: null,
        ttl_seconds: 200,
      },
      cachePut: async () => undefined,
    }),
  ).rejects.toThrow();
});

test("verifyJwtOnly basic", () => {
  const credentialCacheValue: TempCredentialsCacheValue = {
    authToken: "auth token",
  };

  expect(() =>
    verifyJwtOnly({ jwt: "not a jwt", credentialCacheValue }),
  ).toThrow("jwt malformed");

  expect(() => verifyJwtOnly({ jwt: "a.b.c", credentialCacheValue })).toThrow(
    "invalid token",
  );
});

test("verifyTempCredentials wrong payload type", async () => {
  const cacheGet = async () => `{ "authToken": "auth token" }`;

  // Object that does not conform to schema.
  const jwtWrongSchema = jwtSign({ wrong: "schema" }, "auth token", {
    algorithm: "HS256",
  });
  await expect(
    verifyTempCredentials({ jwt: jwtWrongSchema, cacheGet }),
  ).rejects.toThrow("invalid_literal");

  // Non object.
  const jwtWrongType = jwtSign("not an object", "auth token", {
    algorithm: "HS256",
  });
  await expect(
    verifyTempCredentials({ jwt: jwtWrongType, cacheGet }),
  ).rejects.toThrow("not valid JSON");
});

test("verifyTempCredentials signature verification", async () => {
  const {
    jwt,
    cacheEncryptionKey,
    credentialId,
    cachePayloadPlaintext: credentialCacheValue,
  } = makeTempCredentialsJwt({
    request: { model: "model", ttl_seconds: 100 },
    authToken: "auth token",
    orgName: "my org name",
  });

  // Valid JWT.
  expect(() => verifyJwtOnly({ jwt, credentialCacheValue })).not.toThrow();

  // Valid JWT, valid cache.
  const cacheGet = async (
    encryptionKey: string,
    key: string,
  ): Promise<string | null> =>
    encryptionKey === cacheEncryptionKey && key === credentialId
      ? JSON.stringify(credentialCacheValue)
      : null;

  await expect(verifyTempCredentials({ jwt, cacheGet })).resolves.toEqual({
    jwtPayload: jwtDecode(jwt, { complete: false, json: true }),
    credentialCacheValue,
  });

  // Valid JWT, failed cache call.
  const badCacheGet = async () => null;
  await expect(
    verifyTempCredentials({ jwt, cacheGet: badCacheGet }),
  ).rejects.toThrow();

  // Incorrect signature, nonnull cache response.
  const wrongSecretCacheGet = async () => `{ "authToken": "wrong auth token" }`;
  await expect(
    verifyTempCredentials({ jwt, cacheGet: wrongSecretCacheGet }),
  ).rejects.toThrow("invalid signature");

  // Correct signature, incorrect scheme.
  const jwtPayloadRaw = jwtDecode(jwt, { complete: false, json: true });
  if (!jwtPayloadRaw) {
    throw new Error("This should not happen");
  }
  const jwtWrongAlgorithm = jwtSign(jwtPayloadRaw, "auth token", {
    algorithm: "HS512",
  });
  await expect(
    verifyTempCredentials({ jwt: jwtWrongAlgorithm, cacheGet }),
  ).rejects.toThrow("invalid algorithm");
});

test("verifyTempCredentials expiration", async () => {
  const { jwt, cachePayloadPlaintext: credentialCacheValue } =
    makeTempCredentialsJwt({
      request: { ttl_seconds: 0 },
      authToken: "auth token",
    });

  // Make sure the token is truly expired.
  // Probably not the best practice in a unit test.
  await new Promise((r) => setTimeout(r, 1000));

  const cacheGet = async () => JSON.stringify(credentialCacheValue);
  await expect(verifyTempCredentials({ jwt, cacheGet })).rejects.toThrow(
    "jwt expired",
  );
});
