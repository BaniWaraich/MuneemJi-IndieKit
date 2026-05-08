import { NextResponse } from "next/server";
import { signUpRequestSchema } from "@/lib/validations/auth.schema";
import { encryptJson } from "@/lib/encryption/edge-jwt";
import { render } from "@react-email/components";
import SignUpEmail from "@/emails/SignUpEmail";
import sendMail from "@/lib/email/sendMail";
import { appConfig } from "@/lib/config";
import { db } from "@/db";
import { users } from "@/db/schema/user";
import { eq } from "drizzle-orm";

interface SignUpToken {
  name: string;
  email: string;
  expiry: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validation = signUpRequestSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.issues },
        { status: 400 }
      );
    }

    const { name, email } = validation.data;

    // Check if user already exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
      .then((users) => users[0]);

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 400 }
      );
    }

    // Create signup token
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
    const signUpToken: SignUpToken = {
      name,
      email,
      expiry: expiresAt.toISOString(),
    };

    const token = await encryptJson(signUpToken);

    // Generate set password URL
    const setPasswordUrl = new URL(
      `${process.env.NEXTAUTH_URL}/sign-up/set-password`
    );
    setPasswordUrl.searchParams.append("token", token);

    // Send email
    const html = await render(
      SignUpEmail({ name, url: setPasswordUrl.toString(), expiresAt })
    );

    await sendMail(
      email,
      `Complete your ${appConfig.projectName} account setup`,
      html
    );

    return NextResponse.json({ 
      success: true,
      message: "Check your email to complete account setup" 
    });
  } catch (error) {
    console.error("Error in signup request:", error);
    return NextResponse.json(
      { error: "Failed to process signup request" },
      { status: 500 }
    );
  }
}

