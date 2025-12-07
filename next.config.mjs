/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: false,

  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },

  async redirects() {
    return [];
  },

  async rewrites() {
    return [
      {
        source: "/api/webhook",
        destination: "/api/webhook", // Prevent 307 redirect
      },
    ];
  },
};

export default nextConfig;
