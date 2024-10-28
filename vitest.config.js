import tsconfigPaths from "vite-tsconfig-paths";

const config = {
  plugins: [tsconfigPaths()],
  test: {
    exclude: ["**/node_modules/**"],
  },
};
export default config;
