import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  // Keep dev and prod build artifacts separate so concurrent commands
  // (like `next build` while `next dev` is running) cannot corrupt each other.
  distDir: isDev ? ".next-dev" : ".next-prod"
};

export default nextConfig;
