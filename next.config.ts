import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Channel thumbnails come from YouTube's image hosts.
    remotePatterns: [
      { protocol: "https", hostname: "**.ggpht.com" },
      { protocol: "https", hostname: "**.googleusercontent.com" },
      { protocol: "https", hostname: "www.gstatic.com" },
    ],
  },
};

export default nextConfig;
