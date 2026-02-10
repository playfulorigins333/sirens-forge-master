import { dirname } from "path";
import { fileURLToPath } from "url";

/** ESM replacement for __dirname */
const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: false,

  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },

  // Required for Supabase in serverless
  serverExternalPackages: ["@supabase/supabase-js"],

  // Required because Next 16 uses Turbopack
  turbopack: {},

  // 🔥 CRITICAL: fixes Vercel function crash before handler executes
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
