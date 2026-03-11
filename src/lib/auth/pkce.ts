import { createHash, randomBytes } from "node:crypto";

function toBase64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createPkcePair(): { state: string; verifier: string; challenge: string } {
  const state = toBase64Url(randomBytes(16));
  const verifier = toBase64Url(randomBytes(64));
  const challenge = toBase64Url(createHash("sha256").update(verifier).digest());

  return { state, verifier, challenge };
}
