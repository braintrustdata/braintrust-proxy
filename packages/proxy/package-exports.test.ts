import { createRequire } from "node:module";
import { expect, it } from "vitest";

const requireFromProxy = createRequire(import.meta.url);

it.each(["types", "providers", "schema/translate"])(
  "does not export the %s subpath",
  (subpath) => {
    expect(() =>
      requireFromProxy.resolve(`@braintrust/proxy/${subpath}`),
    ).toThrow(
      expect.objectContaining({ code: "ERR_PACKAGE_PATH_NOT_EXPORTED" }),
    );
  },
);
