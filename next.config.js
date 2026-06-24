/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // Include sql.js WASM binary in Vercel serverless function bundles
  outputFileTracingIncludes: {
    '/api/**': ['./node_modules/sql.js/dist/**'],
  },
};

module.exports = nextConfig;
