/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: false,
  redirects: async () => {
    return [];
  },
  async rewrites() {
    return [
      {
        source: "/api/webhook",
        destination: "/api/webhook", // prevent redirect loop
      },
    ];
  },
};

module.exports = nextConfig;
