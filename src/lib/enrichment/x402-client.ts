import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const WALLET_PATH = join(homedir(), ".x402scan-mcp", "wallet.json");

let cachedFetch: typeof fetch | null = null;

function loadPrivateKey(): `0x${string}` | null {
  try {
    const raw = readFileSync(WALLET_PATH, "utf-8");
    const wallet = JSON.parse(raw) as { privateKey?: string };
    const key = wallet.privateKey;
    if (!key) return null;
    return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
  } catch {
    return null;
  }
}

export function getX402Fetch(): typeof fetch | null {
  if (cachedFetch) return cachedFetch;

  const privateKey = loadPrivateKey();
  if (!privateKey) return null;

  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: base, transport: http() });
  const signer = toClientEvmSigner(account, publicClient);

  const client = new x402Client();
  registerExactEvmScheme(client, { signer });

  cachedFetch = wrapFetchWithPayment(fetch, client);
  return cachedFetch;
}
