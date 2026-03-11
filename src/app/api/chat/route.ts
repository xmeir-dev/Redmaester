import { NextResponse } from "next/server";
import { z } from "zod";

import { answerQuestion } from "@/lib/chat/assistant";

const bodySchema = z.object({
  question: z.string().trim().min(1, "Question is required"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(2000)
      })
    )
    .max(20)
    .optional()
});

export async function POST(request: Request) {
  try {
    const payload = bodySchema.parse(await request.json().catch(() => ({})));
    const result = await answerQuestion(payload.question, payload.history ?? []);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
