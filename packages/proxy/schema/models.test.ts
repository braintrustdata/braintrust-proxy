import { expect } from "vitest";
import { it } from "vitest";
import raw_models from "./model_list.json";
import { ModelSchema } from "./models";
import { z } from "zod";

it("parse model list", () => {
  const models = z.record(z.string(), z.unknown()).parse(raw_models);
  for (const [key, value] of Object.entries(models)) {
    const result = ModelSchema.safeParse(value);
    if (!result.success) {
      console.log("failed to parse ", key, result.error);
    }
    expect(result.success).toBe(true);
  }
});
