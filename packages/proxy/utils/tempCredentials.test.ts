import { expect, test } from "vitest";
import { makeTempCredentialsJwt } from "./tempCredentials";

test("makeTempCredentialsJwt basic", () => {
  const result = makeTempCredentialsJwt({
    request: { model: "model", project_name: "project name", ttl_seconds: 100 },
    authToken: "auth token",
    orgName: "my org name",
  });

  console.log(result);
  console.log(result.jwt);
  console.log("length:", result.jwt.length);

  expect(result.jwt).toBeTruthy();
});
