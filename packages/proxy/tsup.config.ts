import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dist",
    dts: true,
  },
  {
    entry: ["edge/index.ts"],
    format: ["cjs", "esm"],
    outDir: "edge/dist",
    dts: true,
  },
  {
    entry: ["schema/index.ts"],
    format: ["cjs", "esm"],
    outDir: "schema/dist",
    dts: true,
  },
  {
    entry: ["prom/index.ts"],
    format: ["cjs", "esm"],
    outDir: "prom/dist",
    dts: true,
  },
]);
