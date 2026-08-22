import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_BYTES = 32;

function encryptionKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  const key = Buffer.from(raw, "hex");
  if (key.length !== KEY_BYTES) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32-byte hex (64 characters)");
  }
  return key;
}

/** AES-256-GCM. Format: base64(iv).base64(tag).base64(ciphertext) */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptToken(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token payload");
  }
  const [ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(
    ALGO,
    encryptionKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
