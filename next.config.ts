import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "ffmpeg-static", "better-sqlite3"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
