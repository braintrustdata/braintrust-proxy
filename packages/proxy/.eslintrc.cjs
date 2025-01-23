module.exports = {
  extends: ["../../.eslintrc.json"],
  parser: "@typescript-eslint/parser",
  rules: {
    "@typescript-eslint/no-floating-promises": "error",
  },
  plugins: ["@typescript-eslint"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  // This is necessary because we're asking eslint to parse the files in this package,
  // and its tsconfig.json says to ignore these.
  ignorePatterns: ["**/*.test.ts", "**/dist/**", "vitest.config.js"],
};
