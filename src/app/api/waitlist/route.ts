import { NextResponse } from "next/server";
import { z } from "zod";
import { render } from "@react-email/components";
import { db } from "@/db";
import { waitlist } from "@/db/schema/waitlist";
import sendMail from "@/lib/email/sendMail";
import Welcome from "@/emails/Welcome";
import { appConfig } from "@/lib/config";

const waitlistSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  twitterAccount: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const body = waitlistSchema.parse(json);

    const entry = await db
      .insert(waitlist)
      .values({
        name: body.name,
        email: body.email,
        twitterAccount: body.twitterAccount || null,
      })
      .returning();

    try {
      const html = await render(
        Welcome({
          userName: body.name,
          dashboardUrl: process.env.NEXT_PUBLIC_APP_URL ?? "/",
        })
      );
      await sendMail(
        body.email,
        `You're on the ${appConfig.projectName} waitlist`,
        html
      );
    } catch (emailError) {
      console.error("Failed to send waitlist email:", emailError);
    }

    return NextResponse.json(entry[0], { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }

    console.error("Waitlist POST error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
