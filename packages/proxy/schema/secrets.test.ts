import { expect, it } from "vitest";
import { VertexMetadataSchema } from "./secrets";

it("treats blank vertex location as unset", () => {
  const parsed = VertexMetadataSchema.parse({
    project: "my-project",
    location: "",
    authType: "access_token",
    api_base: "",
    supportsStreaming: true,
    excludeDefaultModels: false,
  });

  expect(parsed.location).toBeUndefined();
});
