import { NextResponse } from "next/server";
import { resetPasswordRequestSchema } from "@/lib/validations/auth.schema";
import { encryptJson } from "@/lib/encryption/edge-jwt";
import { render } from "@react-email/components";
import ResetPasswordEmail from "@/emails/ResetPasswordEmail";
import sendMail from "@/lib/email/sendMail";
import { appConfig } from "@/lib/config";
import { db } from "@/db";
import { users } from "@/db/schema/user";
import { eq } from "drizzle-orm";

interface ResetPasswordToken {
  email: string;
  expiry: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validation = resetPasswordRequestSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.issues },
        { status: 400 }
      );
    }

    const { email } = validation.data;

    // Check if user exists and has a password (password-based account)
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
      .then((users) => users[0]);


    // Always return success to prevent email enumeration
    // But only send email if user exists and has password auth enabled
    if (existingUser && appConfig.auth?.enablePasswordAuth) {
      // Create reset token
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
      const resetToken: ResetPasswordToken = {
        email,
        expiry: expiresAt.toISOString(),
      };

      const token = await encryptJson(resetToken);

      // Generate reset password URL
      const resetPasswordUrl = new URL(
        `${process.env.NEXTAUTH_URL}/reset-password/confirm`
      );
      resetPasswordUrl.searchParams.append("token", token);

      // Send email
      const html = await render(
        ResetPasswordEmail({ url: resetPasswordUrl.toString(), expiresAt })
      );

      await sendMail(
        email,
        `Reset your ${appConfig.projectName} password`,
        html
      );
    }

    // Always return success to prevent email enumeration
    return NextResponse.json({
      success: true,
      message: "If an account exists with this email, you will receive a password reset link",
    });
  } catch (error) {
    console.error("Error in reset password request:", error);
    return NextResponse.json(
      { error: "Failed to process reset password request" },
      { status: 500 }
    );
  }
}

