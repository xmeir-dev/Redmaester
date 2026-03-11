import { runClassificationPipeline } from "@/lib/classification/pipeline";

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const reclassify = url.searchParams.get("reclassify") === "true";
  const force = url.searchParams.get("force") === "true";

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const result = await runClassificationPipeline({
          reclassify,
          force,
          onLog(message) {
            controller.enqueue(
              encoder.encode(JSON.stringify({ log: message }) + "\n"),
            );
          },
          onBookmarkStep(bookmarkId, step) {
            controller.enqueue(
              encoder.encode(JSON.stringify({ bookmarkId, step }) + "\n"),
            );
          },
        });

        // Write the final result (without the log array to avoid duplication)
        const { log: _log, ...rest } = result;
        controller.enqueue(
          encoder.encode(JSON.stringify({ ...rest, done: true }) + "\n"),
        );
        controller.close();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Classification pipeline failed";
        console.error("[classify] Pipeline error:", error);
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              error: message,
              done: true,
            }) + "\n",
          ),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
