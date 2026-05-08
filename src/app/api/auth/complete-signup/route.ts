import { NextResponse } from "next/server";
import { setPasswordSchema } from "@/lib/validations/auth.schema";
import { decryptJson } from "@/lib/encryption/edge-jwt";
import { hashPassword } from "@/lib/auth/password";
import { db } from "@/db";
import { users } from "@/db/schema/user";
import { eq } from "drizzle-orm";
import onUserCreate from "@/lib/users/onUserCreate";

// Force Node.js runtime for argon2 support
export const runtime = "nodejs";

interface SignUpToken {
  name: string;
  email: string;
  expiry: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, password, confirmPassword } = body;

    if (!token) {
      return NextResponse.json(
        { error: "Token is required" },
        { status: 400 }
      );
    }

    // Validate password
    const validation = setPasswordSchema.safeParse({ password, confirmPassword });
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.issues },
        { status: 400 }
      );
    }

    // Decrypt and validate token
    const signUpToken = await decryptJson<SignUpToken>(token);

    if (new Date(signUpToken.expiry) < new Date()) {
      return NextResponse.json(
        { error: "Token has expired. Please request a new signup link." },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, signUpToken.email))
      .limit(1)
      .then((users) => users[0]);

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user
    const newUser = await db
      .insert(users)
      .values({
        name: signUpToken.name,
        email: signUpToken.email,
        password: hashedPassword,
        emailVerified: new Date(), // Email is verified through token
      })
      .returning()
      .then((users) => users[0]);

    // Run post-creation hooks (assign default plan, etc.)
    await onUserCreate(newUser);

    return NextResponse.json({
      success: true,
      message: "Account created successfully",
    });
  } catch (error) {
    console.error("Error completing signup:", error);
    return NextResponse.json(
      { error: "Failed to complete signup. Token may be invalid or expired." },
      { status: 500 }
    );
  }
}

