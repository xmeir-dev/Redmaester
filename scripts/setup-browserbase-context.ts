/**
 * Sets up a Browserbase context with authenticated X.com cookies.
 *
 * Usage:
 *   npx tsx scripts/setup-browserbase-context.ts
 *
 * This script:
 * 1. Creates a new Browserbase context (or reuses existing BROWSERBASE_CONTEXT_ID)
 * 2. Launches a session with that context
 * 3. Opens the Browserbase live debug view so you can log into X.com
 * 4. Persists the authenticated session cookies
 * 5. Prints the context ID to add to .env
 */

import { readFileSync } from "fs";
import { createInterface } from "readline";
import { chromium } from "playwright-core";

// Load .env manually (no dotenv dependency)
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const API_KEY = process.env.BROWSERBASE_API_KEY;
const PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID;
const EXISTING_CONTEXT_ID = process.env.BROWSERBASE_CONTEXT_ID || "";

if (!API_KEY || !PROJECT_ID) {
  console.error("Missing BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID in .env");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  "x-bb-api-key": API_KEY,
};

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function createContext(): Promise<string> {
  console.log("Creating new Browserbase context...");
  const resp = await fetch("https://api.browserbase.com/v1/contexts", {
    method: "POST",
    headers,
    body: JSON.stringify({ projectId: PROJECT_ID }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`Failed to create context: HTTP ${resp.status} — ${text}`);
    process.exit(1);
  }

  const data = (await resp.json()) as { id: string };
  console.log(`Created context: ${data.id}`);
  return data.id;
}

async function createSession(contextId: string): Promise<{ id: string; connectUrl: string }> {
  console.log("Creating Browserbase session with context...");
  const resp = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      projectId: PROJECT_ID,
      browserSettings: {
        context: { id: contextId, persist: true },
      },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`Failed to create session: HTTP ${resp.status} — ${text}`);
    process.exit(1);
  }

  const data = (await resp.json()) as { id: string; connectUrl?: string };
  const connectUrl =
    data.connectUrl ??
    `wss://connect.browserbase.com?apiKey=${API_KEY}&sessionId=${data.id}`;
  return { id: data.id, connectUrl };
}

async function main() {
  // Step 1: Get or create context
  let contextId: string;
  if (EXISTING_CONTEXT_ID) {
    const answer = await ask(
      `Existing BROWSERBASE_CONTEXT_ID found: ${EXISTING_CONTEXT_ID}\nRefresh existing context? (Y/n) `
    );
    contextId = answer.toLowerCase() === "n" ? await createContext() : EXISTING_CONTEXT_ID;
  } else {
    contextId = await createContext();
  }

  // Step 2: Create session
  const session = await createSession(contextId);
  const debugUrl = `https://www.browserbase.com/sessions/${session.id}`;

  console.log("\n────────────────────────────────────────────");
  console.log("Open this URL in your browser to log into X.com:");
  console.log(`\n  ${debugUrl}\n`);
  console.log("────────────────────────────────────────────\n");

  // Step 3: Connect via Playwright and navigate to X.com login
  console.log("Connecting to session and navigating to X.com/login...");
  const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
  const defaultContext = browser.contexts()[0];
  if (!defaultContext) {
    console.error("No browser context available");
    process.exit(1);
  }

  const page = defaultContext.pages()[0] ?? (await defaultContext.newPage());
  await page.goto("https://x.com/i/flow/login", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  console.log("Page loaded. Log into X.com in the debug view above.");
  console.log("After you see your X.com home feed, come back here.\n");

  await ask("Press Enter when you've finished logging in...");

  // Step 4: Verify login succeeded
  const currentUrl = page.url();
  console.log(`Current page URL: ${currentUrl}`);

  if (currentUrl.includes("/login") || currentUrl.includes("/i/flow/login")) {
    console.warn("\nWarning: Page is still on login — cookies may not have been saved.");
    console.warn("The context will be persisted anyway. You can re-run this script to try again.\n");
  } else {
    console.log("Login appears successful.\n");
  }

  // Step 5: Close (triggers persist)
  await browser.close();
  console.log("Session closed — cookies persisted to context.\n");

  // Step 6: Output
  console.log("════════════════════════════════════════════");
  console.log("Add this to your .env file:\n");
  console.log(`  BROWSERBASE_CONTEXT_ID=${contextId}\n`);
  console.log("════════════════════════════════════════════");

  if (!EXISTING_CONTEXT_ID || EXISTING_CONTEXT_ID !== contextId) {
    const answer = await ask("Update .env automatically? (Y/n) ");
    if (answer.toLowerCase() !== "n") {
      const { readFileSync: readFs, writeFileSync: writeFs } = await import("fs");
      let envContent = readFs(envPath, "utf-8");

      if (envContent.includes("BROWSERBASE_CONTEXT_ID=")) {
        envContent = envContent.replace(
          /^BROWSERBASE_CONTEXT_ID=.*$/m,
          `BROWSERBASE_CONTEXT_ID=${contextId}`
        );
      } else {
        envContent += `\nBROWSERBASE_CONTEXT_ID=${contextId}\n`;
      }

      writeFs(envPath, envContent);
      console.log(".env updated.");
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
