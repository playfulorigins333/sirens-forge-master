/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: false,

  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },

  // ⭐ CRITICAL: bundle Node deps into serverless functions
  serverExternalPackages: [
    "@supabase/supabase-js",
    "@supabase/ssr",
  ],

  // ⭐ CRITICAL: silence Turbopack + webpack conflict
  turbopack: {},

  // ⭐ CRITICAL: force standalone output for Vercel functions
  output: "standalone",

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
