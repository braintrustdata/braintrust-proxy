import skott from "skott";
import { describe, expect, it } from "vitest";

describe("proxy/src", () => {
  it("no circ dependencies", async () => {
    const { useGraph } = await skott({
      entrypoint: `${__dirname}/index.ts`,
      tsConfigPath: `${__dirname}/../tsconfig.json`,
      dependencyTracking: {
        builtin: false,
        thirdParty: true,
        typeOnly: true,
      },
    });

    const { findCircularDependencies } = useGraph();

    expect(findCircularDependencies()).toEqual([]);
  });
});
