import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

function resolveSqlitePath(databaseUrl) {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("DATABASE_URL must use sqlite file: URL for db:init script.");
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

loadDotEnv(join(process.cwd(), ".env"));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set.");
}

const dbPath = resolveSqlitePath(databaseUrl);
mkdirSync(dirname(dbPath), { recursive: true });

safeUnlink(dbPath);
safeUnlink(`${dbPath}-journal`);

const sql = run("npx", [
  "prisma",
  "migrate",
  "diff",
  "--from-empty",
  "--to-schema-datamodel",
  "prisma/schema.prisma",
  "--script"
]);

writeFileSync(join(process.cwd(), "prisma/init.sql"), sql, "utf8");

run("npx", ["prisma", "db", "execute", "--file", "prisma/init.sql", "--url", databaseUrl], {
  stdio: "inherit"
});
run("npx", ["prisma", "generate"], { stdio: "inherit" });

console.log(`Database initialized at ${dbPath}`);
