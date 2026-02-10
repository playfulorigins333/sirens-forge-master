/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: false,

  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
    // ⭐️ CRITICAL: ensure serverless functions bundle our server libs
    serverComponentsExternalPackages: ["@supabase/supabase-js"],
  },

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

  webpack: (config) => {
    // ⭐️ CRITICAL: bundle local server libraries used by /api/generate
    config.externals = config.externals || [];
    config.externals.push({
      "@/lib/generation/lora-resolver": "commonjs @/lib/generation/lora-resolver",
      "@/lib/comfy/buildWorkflow": "commonjs @/lib/comfy/buildWorkflow",
    });
    return config;
  },
};

export default nextConfig;
