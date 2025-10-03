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
    entry: ["utils/index.ts"],
    format: ["cjs", "esm"],
    outDir: "utils/dist",
    dts: true,
  },
  {
    entry: ["types/index.ts"],
    format: ["cjs", "esm"],
    outDir: "types/dist",
    dts: true,
  },
  {
    entry: ["providers/index.ts"],
    format: ["cjs", "esm"],
    outDir: "providers/dist",
    dts: true,
  },
]);
