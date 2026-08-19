import { withBotId } from "botid/next/config";
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

  async redirects() {
    return [];
  },

  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      ],
    }];
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

export default withBotId(nextConfig);
