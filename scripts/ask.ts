import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const question = process.argv.slice(2).join(" ").trim();

  if (!question) {
    console.error('Usage: npm run ask -- "your question"');
    process.exit(1);
  }

  const { answerQuestion } = await import("../src/lib/chat/assistant");
  const result = await answerQuestion(question);

  console.log("");
  console.log(result.answer);
  console.log("");
  console.log(`Model: ${result.usedModel}`);
  console.log("Sources:");
  if (result.sources.length === 0) {
    console.log("- none");
    return;
  }

  for (const source of result.sources) {
    console.log(`- @${source.authorHandle} (${source.tweetId}) ${source.url}`);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Failed to answer question");
  process.exit(1);
});
