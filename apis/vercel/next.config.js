const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: path.join(__dirname, "../../.."),
  turbopack: {
    root: path.join(__dirname, "../../.."),
  },
  transpilePackages: ["@braintrust/proxy", "@vercel/examples-ui"],
  typescript: {
    ignoreBuildErrors: true,
  },
};

module.exports = nextConfig;
