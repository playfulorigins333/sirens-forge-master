/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    appDir: true,
  },
  images: {
    domains: ['cdn.sirensforge.vip'],
  },
};
module.exports = nextConfig;
