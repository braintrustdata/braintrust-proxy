import { describe, expect, test } from "vitest";
import { pulseUrl } from "./env";

function makeEnv(vars: Partial<Env>): Env {
  return { BRAINTRUST_APP_URL: "https://www.braintrust.dev", ...vars } as Env;
}

describe("pulseUrl", () => {
  test("defaults to the app URL's /api/pulse", () => {
    expect(pulseUrl(makeEnv({}))).toBe("https://www.braintrust.dev/api/pulse");
  });

  test("uses PULSE_URL when set", () => {
    expect(
      pulseUrl(makeEnv({ PULSE_URL: "https://pulse.braintrust.dev" })),
    ).toBe("https://pulse.braintrust.dev");
  });

  test("ignores a trailing slash and an empty PULSE_URL", () => {
    expect(
      pulseUrl(makeEnv({ PULSE_URL: "https://pulse.braintrust.dev/" })),
    ).toBe("https://pulse.braintrust.dev");
    expect(pulseUrl(makeEnv({ PULSE_URL: "" }))).toBe(
      "https://www.braintrust.dev/api/pulse",
    );
  });
});
