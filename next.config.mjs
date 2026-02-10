/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: false,

  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },

  // ⭐️ Required in Next 16 for serverless bundling
  serverExternalPackages: ["@supabase/supabase-js"],

  // ⭐️ Required because Next 16 uses Turbopack by default
  turbopack: {},

  // ⭐️ CRITICAL: Fixes Vercel serverless function crashing before handler loads
  outputFileTracingRoot: __dirname,

  async redirects() {
    return [];
  },

  async rewrites() {
    return [
      {
        source: "/api/webhook",
        destination: "/api/webhook",
      },
    ];
  },
};

export default nextConfig;
