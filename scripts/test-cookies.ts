import { execSync } from "child_process";
import { copyFileSync, mkdtempSync, rmSync, existsSync } from "fs";
import { createDecipheriv, pbkdf2Sync } from "crypto";
import { homedir } from "os";
import { tmpdir } from "os";
import { join } from "path";

const cookieDb = join(homedir(), "Library/Application Support/Arc/User Data/Default/Cookies");
const tmpDir = mkdtempSync(join(tmpdir(), "test-cookies-"));
const tmpDb = join(tmpDir, "Cookies");

copyFileSync(cookieDb, tmpDb);
for (const suffix of ["-wal", "-journal", "-shm"]) {
  const src = cookieDb + suffix;
  if (existsSync(src)) copyFileSync(src, tmpDb + suffix);
}

const output = execSync('security find-generic-password -s "Arc Safe Storage" -g 2>&1', {
  encoding: "utf-8",
});
const m = output.match(/^password:\s*"(.+)"$/m);
if (m === null) {
  process.exit(1);
}

const key = pbkdf2Sync(m[1], "saltysalt", 1003, 16, "sha1");

const sep = "\x1f";
const query =
  'SELECT name, hex(encrypted_value) FROM cookies WHERE host_key LIKE "%.twitter.com";';
const rows = execSync(`sqlite3 -separator "${sep}" "${tmpDb}" '${query}'`, {
  encoding: "utf-8",
}).trim();

for (const line of rows.split("\n")) {
  const parts = line.split(sep);
  const name = parts[0];
  const enc = Buffer.from(parts[1], "hex");
  const data = enc.slice(3);

  const d = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  const plain = Buffer.concat([d.update(data), d.final()]);

  console.log(`${name}:`);
  console.log(`  hex:    ${plain.toString("hex")}`);
  console.log(`  utf-8:  "${plain.toString("utf-8")}"`);
  console.log(`  length: ${plain.length} bytes`);
  // Show each byte
  const bytes = Array.from(plain).map((b) =>
    b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, "0")}`
  );
  console.log(`  bytes:  ${bytes.join("")}`);
  console.log();
}

rmSync(tmpDir, { recursive: true, force: true });
