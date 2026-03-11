import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const isVercel = !!process.env.VERCEL;

const nextConfig: NextConfig = {
  // Keep dev and prod build artifacts separate so concurrent commands
  // (like `next build` while `next dev` is running) cannot corrupt each other.
  // On Vercel, use the default ".next" directory.
  distDir: isVercel ? ".next" : isDev ? ".next-dev" : ".next-prod"
};

export default nextConfig;
