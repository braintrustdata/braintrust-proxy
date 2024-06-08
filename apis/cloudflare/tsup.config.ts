import { defineConfig } from "tsup";

// https://github.com/egoist/tsup/issues/840 discusses how there can
// be an infinite loop bug with --watch, and we work around that by
// calling build with --dts.
export default defineConfig([
  {
    entry: ["src/lib.ts"],
    format: ["esm"],
    outDir: "dist",
  },
]);
