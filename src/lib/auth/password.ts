"use server";

/**
 * Password hashing and verification using bcrypt
 * Server-only (Node.js runtime required)
 *
 * bcrypt is a battle-tested password hashing algorithm based on the
 * Blowfish cipher and is widely used in production applications.
 * Using bcryptjs for pure JavaScript implementation (no native dependencies).
 */

import bcrypt from "bcryptjs";

/**
 * Hashes a password using bcrypt
 *
 * Configuration:
 * - Algorithm: bcrypt (adaptive hash function)
 * - Salt rounds: 10 (2^10 iterations)
 * - Automatically generates and includes salt in the hash
 *
 * @param password - The password to hash
 * @returns Hashed password string (includes salt)
 */
export async function hashPassword(password: string): Promise<string> {
  try {
    const saltRounds = 10; // 10 rounds is industry standard
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    return hashedPassword;
  } catch (error) {
    console.error("Error hashing password:", error);
    throw new Error("Failed to hash password");
  }
}

/**
 * Verifies a password against a bcrypt hash
 *
 * @param password - The password to verify
 * @param storedHash - The stored bcrypt hash
 * @returns true if password matches, false otherwise
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  try {
    return await bcrypt.compare(password, storedHash);
  } catch (error) {
    console.error("Error verifying password:", error);
    return false;
  }
}
