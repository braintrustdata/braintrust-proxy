import tsconfigPaths from "vite-tsconfig-paths";

const config = {
  plugins: [tsconfigPaths()],
  test: {
    exclude: ["**/node_modules/**"],
    testTimeout: 15_000,
  },
};
export default config;
