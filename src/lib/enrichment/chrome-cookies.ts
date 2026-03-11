import { execSync } from "child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { createDecipheriv, pbkdf2Sync } from "crypto";
import { homedir } from "os";
import { tmpdir } from "os";
import { join } from "path";

import { appConfig } from "@/lib/domain/config";

export type PlaywrightCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
};

// ─── Chromium-based browser discovery ────────────────────────────────

type BrowserInfo = {
  name: string;
  dataDir: string; // path under ~/Library/Application Support/
  keychainService: string; // macOS Keychain service name
};

const BROWSERS: BrowserInfo[] = [
  { name: "Arc", dataDir: "Arc/User Data", keychainService: "Arc Safe Storage" },
  { name: "Chrome", dataDir: "Google/Chrome", keychainService: "Chrome Safe Storage" },
  { name: "Brave", dataDir: "BraveSoftware/Brave-Browser", keychainService: "Brave Safe Storage" },
  { name: "Edge", dataDir: "Microsoft Edge", keychainService: "Microsoft Edge Safe Storage" },
  { name: "Chromium", dataDir: "Chromium", keychainService: "Chromium Safe Storage" },
  { name: "Vivaldi", dataDir: "Vivaldi", keychainService: "Vivaldi Safe Storage" },
  { name: "Opera", dataDir: "com.operasoftware.Opera", keychainService: "Opera Safe Storage" },
];

const COOKIE_CACHE_PATH = join(homedir(), ".redmaester", "x-cookies.json");

let memoryCachedCookies: PlaywrightCookie[] | null = null;

// ─── Profile discovery ───────────────────────────────────────────────

function findProfiles(browserDir: string): string[] {
  const profiles = ["Default"];
  try {
    const localState = JSON.parse(
      readFileSync(join(browserDir, "Local State"), "utf-8")
    ) as { profile?: { info_cache?: Record<string, unknown> } };
    const infoCache = localState?.profile?.info_cache;
    if (infoCache) {
      for (const name of Object.keys(infoCache)) {
        if (name !== "Default") profiles.push(name);
      }
    }
  } catch {
    // Local State missing or unreadable — just try Default
  }
  return profiles;
}

// ─── Decryption (macOS Chromium v10 format) ──────────────────────────

function getDecryptionKey(keychainService: string): Buffer | null {
  if (!appConfig.enableKeychainAccess) return null;

  try {
    // -w prints just the password to stdout, but some macOS configs silently deny it.
    // -g prints it to stderr as 'password: "..."'. Try -w first, fall back to -g.
    try {
      const password = execSync(
        `security find-generic-password -s "${keychainService}" -w`,
        { encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }
      ).trim();
      if (password) return pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
    } catch {
      // -w failed, try -g
    }

    const output = execSync(
      `security find-generic-password -s "${keychainService}" -g 2>&1`,
      { encoding: "utf-8", timeout: 10000 }
    );
    const match = output.match(/^password:\s*"(.+)"$/m);
    if (!match?.[1]) return null;
    return pbkdf2Sync(match[1], "saltysalt", 1003, 16, "sha1");
  } catch {
    return null;
  }
}

function decryptCookieValue(encrypted: Buffer, key: Buffer): string {
  if (encrypted.length <= 3) return "";

  const prefix = encrypted.slice(0, 3).toString("ascii");
  if (prefix !== "v10") return "";

  const data = encrypted.slice(3);
  const iv = Buffer.alloc(16, 0x20); // 16 space characters

  try {
    const decipher = createDecipheriv("aes-128-cbc", key, iv);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf-8");
  } catch {
    return "";
  }
}

// ─── SQLite extraction ───────────────────────────────────────────────

const SAMESITE_MAP: Record<string, "Strict" | "Lax" | "None"> = {
  "-1": "None",
  "0": "None",
  "1": "Lax",
  "2": "Strict",
};

const SEP = "\x1f"; // Unit Separator — won't appear in cookie data

function extractFromProfile(profileDir: string, key: Buffer): PlaywrightCookie[] | null {
  const cookieDb = join(profileDir, "Cookies");
  if (!existsSync(cookieDb)) return null;

  const tmpDir = mkdtempSync(join(tmpdir(), "redmaester-cookies-"));
  const tmpDb = join(tmpDir, "Cookies");

  try {
    copyFileSync(cookieDb, tmpDb);
    for (const suffix of ["-wal", "-journal", "-shm"]) {
      const src = cookieDb + suffix;
      if (existsSync(src)) copyFileSync(src, tmpDb + suffix);
    }

    const query =
      "SELECT host_key, name, hex(encrypted_value), path, expires_utc, is_httponly, is_secure, samesite " +
      "FROM cookies WHERE host_key LIKE '%.x.com' OR host_key LIKE '%.twitter.com' " +
      "OR host_key = 'x.com' OR host_key = 'twitter.com' " +
      "OR host_key = '.x.com' OR host_key = '.twitter.com';";

    const output = execSync(
      `sqlite3 -separator '${SEP}' "${tmpDb}" "${query}"`,
      { encoding: "utf-8", timeout: 5000 }
    );

    if (!output.trim()) return null;

    const cookies: PlaywrightCookie[] = [];

    for (const line of output.trim().split("\n")) {
      const parts = line.split(SEP);
      if (parts.length < 8) continue;

      const [hostKey, name, hexValue, path, expiresUtc, isHttpOnly, isSecure, sameSite] = parts;

      const value = decryptCookieValue(Buffer.from(hexValue, "hex"), key);
      if (!value) continue;

      // Chrome expires_utc: microseconds since 1601-01-01 → Unix seconds
      const chromeEpoch = BigInt(expiresUtc);
      const unixTimestamp =
        chromeEpoch > 0n
          ? Number((chromeEpoch - 11644473600000000n) / 1000000n)
          : -1;

      cookies.push({
        name,
        value,
        domain: hostKey,
        path: path || "/",
        expires: unixTimestamp,
        httpOnly: isHttpOnly === "1",
        secure: isSecure === "1",
        sameSite: SAMESITE_MAP[sameSite] || "None",
      });
    }

    // Must have auth_token to be useful
    if (!cookies.some((c) => c.name === "auth_token")) return null;
    return cookies;
  } catch {
    return null;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function extractFromBrowsers(): PlaywrightCookie[] | null {
  const appSupport = join(homedir(), "Library/Application Support");

  for (const browser of BROWSERS) {
    const browserDir = join(appSupport, browser.dataDir);
    if (!existsSync(browserDir)) continue;

    const key = getDecryptionKey(browser.keychainService);
    if (!key) continue;

    for (const profile of findProfiles(browserDir)) {
      const cookies = extractFromProfile(join(browserDir, profile), key);
      if (cookies) return cookies;
    }
  }

  return null;
}

// ─── Cache management ────────────────────────────────────────────────

function loadCachedCookies(): PlaywrightCookie[] | null {
  if (memoryCachedCookies) return memoryCachedCookies;

  if (!existsSync(COOKIE_CACHE_PATH)) return null;
  try {
    const cookies = JSON.parse(
      readFileSync(COOKIE_CACHE_PATH, "utf-8")
    ) as PlaywrightCookie[];

    const authToken = cookies.find((c) => c.name === "auth_token");
    if (!authToken) return null;
    if (authToken.expires > 0 && authToken.expires < Date.now() / 1000) return null;

    memoryCachedCookies = cookies;
    return cookies;
  } catch {
    return null;
  }
}

function saveCookiesToCache(cookies: PlaywrightCookie[]): void {
  try {
    mkdirSync(join(homedir(), ".redmaester"), { recursive: true });
    writeFileSync(COOKIE_CACHE_PATH, JSON.stringify(cookies, null, 2));
  } catch {
    // Non-critical
  }
}

// ─── Public API ──────────────────────────────────────────────────────

export async function getXCookies(): Promise<PlaywrightCookie[] | null> {
  const cached = loadCachedCookies();
  if (cached) return cached;

  const extracted = extractFromBrowsers();
  if (extracted) {
    memoryCachedCookies = extracted;
    saveCookiesToCache(extracted);
    return extracted;
  }

  return null;
}

export function invalidateCookieCache(): void {
  memoryCachedCookies = null;
  try {
    if (existsSync(COOKIE_CACHE_PATH)) rmSync(COOKIE_CACHE_PATH);
  } catch {
    // Non-critical
  }
}
