import { expect, test } from "vitest";
import { isTempCredential, makeTempCredentialsJwt } from "./tempCredentials";
import {
  sign as jwtSign,
  verify as jwtVerify,
  // decode as jwtDecode,
  // JwtPayload,
} from "jsonwebtoken";
import { base64ToArrayBuffer } from "./encrypt";
import { tempCredentialJwtPayloadSchema } from "@schema";

test("isTempCredential", () => {
  expect(isTempCredential("foo")).toStrictEqual(false);
  expect(isTempCredential("foo.bar.baz")).toStrictEqual(false);

  expect(isTempCredential(jwtSign({}, "secret"))).toStrictEqual(false);
  expect(isTempCredential(jwtSign({ iss: "other" }, "secret"))).toStrictEqual(
    false,
  );
  expect(
    isTempCredential(jwtSign({ iss: "braintrust_proxy" }, "secret")),
  ).toStrictEqual(true);
  expect(
    isTempCredential(jwtSign({ aud: "braintrust_proxy" }, "secret")),
  ).toStrictEqual(true);
});

test("makeTempCredentialsJwt", () => {
  const result = makeTempCredentialsJwt({
    request: { model: "model", project_name: "project name", ttl_seconds: 100 },
    authToken: "auth token",
    orgName: "my org name",
  });

  console.log(result);
  console.log(result.jwt);
  console.log("length:", result.jwt.length);

  const rawPayload = jwtVerify(result.jwt, "auth token", { complete: false });
  expect(rawPayload).toBeTruthy();
  expect(rawPayload).toBeTypeOf("object");

  // Example:
  // {
  //   "aud": "braintrust_proxy",
  //   "bt": {
  //     "model": "model",
  //     "org_name": "my org name",
  //     "proj_name": "project name",
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
  expect(payload.bt.proj_name).toStrictEqual("project name");
  expect(payload.bt.secret).toStrictEqual(result.cacheEncryptionKey);
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

test("verifyTempCredentials", () => {
  expect(true).toBeTruthy();
});
