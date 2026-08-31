import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'wad.nyc3.digitaloceanspaces.com',
      },
    ],
  },
  // Vercel deployment optimizations
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
