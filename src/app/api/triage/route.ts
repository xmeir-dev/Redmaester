import { NextResponse } from "next/server";

import { getTriageData } from "@/lib/domain/queries";

export async function GET() {
  const triage = await getTriageData();
  return NextResponse.json({ triage });
}
