import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { accountantFirms } from "@/db/schema/muneem";
import { users } from "@/db/schema/user";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const registerSchema = z.object({
  firmName: z.string().min(1, "Firm name is required"),
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function POST(request: Request) {
  if (process.env.ALPHA_MODE === "true") {
    return NextResponse.json(
      { error: "Public registration is disabled in alpha mode" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const result = registerSchema.safeParse(body);

  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid input", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const { firmName, name, email, password } = result.data;

  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (existingUser) {
    return NextResponse.json(
      { error: "An account with this email already exists" },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Create the accountant firm first
  const [firm] = await db
    .insert(accountantFirms)
    .values({ name: firmName, email })
    .returning();

  // Create the CA admin user in Indie Kit's app_user table
  await db.insert(users).values({
    id: crypto.randomUUID(),
    email,
    name,
    password: passwordHash,
    role: "ca_admin",
    firmId: firm.id,
  });

  return NextResponse.json(
    { message: "Account created successfully" },
    { status: 201 }
  );
}
