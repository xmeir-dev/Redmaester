import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const isVercel = !!process.env.VERCEL;

const nextConfig: NextConfig = {
  // Keep dev and prod build artifacts separate so concurrent commands
  // (like `next build` while `next dev` is running) cannot corrupt each other.
  // On Vercel, use the default ".next" directory.
  distDir: isVercel ? ".next" : isDev ? ".next-dev" : ".next-prod",
  // viem's mnemonic helpers pull in @scure/bip39 -> @noble/hashes, which uses
  // a self-referencing "@noble/hashes/crypto" import that webpack's bundler
  // cannot statically resolve (it resolves to the wrong nested copy and the
  // production build fails with "crypto is not exported"). Keeping viem
  // external makes the server require() it at runtime instead of bundling it,
  // which is the documented fix for this class of package.
  serverExternalPackages: ["viem"]
};

export default nextConfig;
