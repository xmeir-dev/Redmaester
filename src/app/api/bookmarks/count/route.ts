import { NextResponse } from "next/server";
import { createXClient } from "@/lib/sync/x-client";

export async function POST() {
  try {
    const client = createXClient();
    const result = await client.countBookmarks();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
