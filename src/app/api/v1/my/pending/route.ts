import { NextResponse } from "next/server";

/** Replaced by GET /api/v1/owner/checklist/summary — do not return a transaction table. */
export async function GET() {
  return NextResponse.json(
    {
      error: "GONE",
      use: "/api/v1/owner/checklist/summary",
    },
    { status: 410 },
  );
}
