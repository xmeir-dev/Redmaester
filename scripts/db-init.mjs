import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

function resolveSqlitePath(databaseUrl) {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("SQLite DATABASE_URL values must use a file: URL.");
  }

  const rawPath = databaseUrl.slice("file:".length);
  if (!rawPath) {
    throw new Error("DATABASE_URL file path is empty.");
  }

  if (isAbsolute(rawPath)) {
    return rawPath;
  }

  return resolve(process.cwd(), rawPath);
}

function isSqliteUrl(databaseUrl) {
  return databaseUrl.startsWith("file:");
}

function isRemoteDatabaseUrl(databaseUrl) {
  if (isSqliteUrl(databaseUrl)) {
    return false;
  }

  try {
    const parsed = new URL(databaseUrl);
    return !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return true;
  }
}

function safeUnlink(path) {
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    ...options
  });
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (value.startsWith("\"") && value.endsWith("\"")) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv(join(process.cwd(), ".env.local"));
loadDotEnv(join(process.cwd(), ".env"));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set.");
}

const allowRemoteReset = (process.env.ALLOW_REMOTE_DB_INIT ?? "false").toLowerCase() === "true";
if (isRemoteDatabaseUrl(databaseUrl) && !allowRemoteReset) {
  throw new Error(
    "db:init refuses to reset a remote database. Point DATABASE_URL at a local database or rerun with ALLOW_REMOTE_DB_INIT=true if you explicitly want to wipe the configured remote database."
  );
}

const prismaEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl
};

let targetLabel = databaseUrl;
if (isSqliteUrl(databaseUrl)) {
  const dbPath = resolveSqlitePath(databaseUrl);
  mkdirSync(dirname(dbPath), { recursive: true });

  safeUnlink(dbPath);
  safeUnlink(`${dbPath}-journal`);
  targetLabel = dbPath;
}

run("npx", ["prisma", "db", "push", "--force-reset", "--skip-generate"], {
  stdio: "inherit",
  env: prismaEnv
});

const sql = run("npx", [
  "prisma",
  "migrate",
  "diff",
  "--from-empty",
  "--to-url",
  databaseUrl,
  "--script"
], {
  env: prismaEnv
});

writeFileSync(join(process.cwd(), "prisma/init.sql"), sql, "utf8");

run("npx", ["prisma", "generate"], { stdio: "inherit" });

console.log(`Database initialized at ${targetLabel}`);
