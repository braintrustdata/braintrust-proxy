const path = require("path");

const workspaceRoot = path.join(__dirname, "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
  transpilePackages: ["@braintrust/proxy", "@vercel/examples-ui"],
  typescript: {
    ignoreBuildErrors: true,
  },
};

module.exports = nextConfig;
