/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['ai-proxy'],
  typescript: {
    ignoreBuildErrors: true
  },
  eslint: {
    ignoreDuringBuilds: true
  }
}
 
module.exports = nextConfig;
