import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

type ChatApiResponse = {
  answer: string;
  usedModel: string;
  sources: Array<{ tweetId: string; url: string; authorHandle: string }>;
  error?: string;
};

function resolveApiUrl(argv: string[]): string {
  const apiArg = argv.find((arg) => arg.startsWith("--api="));
  if (apiArg) {
    return apiArg.slice("--api=".length);
  }

  const hostArg = argv.find((arg) => arg.startsWith("--host="));
  if (hostArg) {
    const host = hostArg.slice("--host=".length).replace(/\/$/, "");
    return `${host}/api/chat`;
  }

  return process.env.REDMAESTER_CHAT_API_URL ?? "http://localhost:3010/api/chat";
}

async function askApi(apiUrl: string, question: string, history: ChatTurn[]): Promise<ChatApiResponse> {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history })
  });

  const payload = (await response.json().catch(() => ({}))) as ChatApiResponse;
  if (!response.ok) {
    throw new Error(payload.error ?? `Chat API error (${response.status})`);
  }

  return payload;
}

async function main() {
  const apiUrl = resolveApiUrl(process.argv.slice(2));
  const rl = createInterface({ input, output });
  const history: ChatTurn[] = [];

  console.log(`Connected to ${apiUrl}`);
  console.log('Type your question. Commands: "/exit" to quit, "/clear" to reset conversation.');

  while (true) {
    const question = (await rl.question("\nYou: ")).trim();

    if (!question) {
      continue;
    }

    if (question === "/exit") {
      break;
    }

    if (question === "/clear") {
      history.length = 0;
      console.log("Conversation cleared.");
      continue;
    }

    try {
      const result = await askApi(apiUrl, question, history);
      console.log(`\nRedmaester (${result.usedModel}):\n${result.answer}`);
      if (result.sources.length > 0) {
        console.log("\nSources:");
        for (const source of result.sources.slice(0, 8)) {
          console.log(`- @${source.authorHandle} (${source.tweetId}) ${source.url}`);
        }
      }
      history.push({ role: "user", content: question });
      history.push({ role: "assistant", content: result.answer });
      if (history.length > 20) {
        history.splice(0, history.length - 20);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      console.error(`\nError: ${message}`);
      console.error("Make sure Redmaester is running (npm run dev -- --port 3010).");
    }
  }

  rl.close();
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Chat client failed");
  process.exit(1);
});
