import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const LOCAL_DIR = resolve(ROOT, ".redmaester-local");
const DATA_DIR = join(LOCAL_DIR, "postgres");
const LOG_FILE = join(LOCAL_DIR, "postgres.log");
const ENV_FILE = resolve(ROOT, ".env.local");
const DB_NAME = process.env.REDMAESTER_LOCAL_DB_NAME ?? "redmaester_dev";
const PG_PORT = process.env.REDMAESTER_LOCAL_DB_PORT ?? "54329";
const PG_HOST = "127.0.0.1";
const PG_USER = "postgres";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
}

function resolveBinDir() {
  if (process.env.PG_BIN_DIR) {
    return process.env.PG_BIN_DIR;
  }

  const prefix = run("brew", ["--prefix", "postgresql@16"]).trim();
  return join(prefix, "bin");
}

const BIN_DIR = resolveBinDir();

function bin(name) {
  return join(BIN_DIR, name);
}

function ensureLocalDir() {
  mkdirSync(LOCAL_DIR, { recursive: true });
}

function envWithPath() {
  return {
    ...process.env,
    PATH: `${BIN_DIR}:${process.env.PATH ?? ""}`,
  };
}

function isInitialized() {
  return existsSync(join(DATA_DIR, "PG_VERSION"));
}

function isRunning() {
  const result = spawnSync(bin("pg_isready"), ["-h", PG_HOST, "-p", PG_PORT], {
    env: envWithPath(),
    stdio: "pipe",
    encoding: "utf8",
  });
  return result.status === 0;
}

function initCluster() {
  ensureLocalDir();
  if (isInitialized()) {
    return;
  }

  run(
    bin("initdb"),
    ["-D", DATA_DIR, "--auth=trust", "--username", PG_USER, "-E", "UTF8"],
    {
      env: envWithPath(),
    }
  );
}

function startCluster() {
  if (isRunning()) {
    return;
  }

  ensureLocalDir();
  run(
    bin("pg_ctl"),
    ["-D", DATA_DIR, "-l", LOG_FILE, "-o", `-p ${PG_PORT} -h ${PG_HOST}`, "-w", "start"],
    {
      env: envWithPath(),
    }
  );
}

function stopCluster() {
  if (!isRunning()) {
    return;
  }

  run(bin("pg_ctl"), ["-D", DATA_DIR, "-w", "stop"], {
    env: envWithPath(),
  });
}

function databaseExists() {
  const output = run(
    bin("psql"),
    [
      "-h",
      PG_HOST,
      "-p",
      PG_PORT,
      "-U",
      PG_USER,
      "-d",
      "postgres",
      "-tAc",
      `SELECT 1 FROM pg_database WHERE datname = '${DB_NAME.replace(/'/g, "''")}';`,
    ],
    {
      env: envWithPath(),
    }
  );

  return output.trim() === "1";
}

function ensureDatabase() {
  if (databaseExists()) {
    return;
  }

  run(
    bin("createdb"),
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, DB_NAME],
    {
      env: envWithPath(),
    }
  );
}

function writeEnvLocal() {
  const databaseUrl = `postgresql://${PG_USER}@${PG_HOST}:${PG_PORT}/${DB_NAME}?schema=public`;
  const content = [
    `DATABASE_URL="${databaseUrl}"`,
    `DIRECT_URL="${databaseUrl}"`,
    "",
  ].join("\n");

  if (existsSync(ENV_FILE) && readFileSync(ENV_FILE, "utf8") === content) {
    return;
  }

  writeFileSync(ENV_FILE, content, "utf8");
}

function printStatus() {
  console.log(`Postgres bin dir: ${BIN_DIR}`);
  console.log(`Data dir: ${DATA_DIR}`);
  console.log(`Log file: ${LOG_FILE}`);
  console.log(`Database: ${DB_NAME}`);
  console.log(`Connection: postgresql://${PG_USER}@${PG_HOST}:${PG_PORT}/${DB_NAME}?schema=public`);
  console.log(`Initialized: ${isInitialized() ? "yes" : "no"}`);
  console.log(`Running: ${isRunning() ? "yes" : "no"}`);
}

function setup() {
  initCluster();
  startCluster();
  ensureDatabase();
  writeEnvLocal();
  printStatus();
}

const command = process.argv[2] ?? "status";

switch (command) {
  case "setup":
    setup();
    break;
  case "start":
    initCluster();
    startCluster();
    writeEnvLocal();
    printStatus();
    break;
  case "stop":
    stopCluster();
    printStatus();
    break;
  case "status":
    printStatus();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error("Usage: node scripts/db-local.mjs [setup|start|stop|status]");
    process.exit(1);
}
