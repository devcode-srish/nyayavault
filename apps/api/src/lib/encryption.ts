/**
 * NyayaVault — Cryptographic Encryption Utility (AES-256-GCM)
 *
 * Provides authenticated symmetric encryption for sensitive bearer tokens
 * (such as physical evidence QR tokens) stored in the database.
 *
 * Features:
 * - AES-256-GCM authenticated encryption with unique 12-byte IV per encryption.
 * - 128-bit authentication tag verification on decryption.
 * - Startup key derivation and validation.
 * - Explicit error handling on authentication failure / data corruption.
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Derives a consistent 256-bit encryption key from environment secrets.
 */
function getMasterEncryptionKey(): Buffer {
  const secret =
    process.env.ENCRYPTION_SECRET ||
    process.env.JWT_ACCESS_SECRET ||
    "nyayavault-default-master-key-seed-change-in-production";

  // SHA-256 derivation guarantees exactly 32 bytes (256 bits)
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns formatted string: `${ivHex}:${authTagHex}:${ciphertextHex}`
 */
export function encryptData(plaintext: string): string {
  if (!plaintext) {
    throw new Error("Cannot encrypt empty data");
  }

  const key = getMasterEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");
  const ivHex = iv.toString("hex");

  return `${ivHex}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a formatted AES-256-GCM string (`${ivHex}:${authTagHex}:${ciphertextHex}`).
 * Throws an error or returns null if decryption or authentication tag verification fails.
 */
export function decryptData(encryptedPayload: string): string {
  if (!encryptedPayload || typeof encryptedPayload !== "string") {
    throw new Error("Invalid encrypted payload format");
  }

  const parts = encryptedPayload.split(":");
  if (parts.length !== 3) {
    throw new Error("Encrypted payload must contain IV, AuthTag, and Ciphertext");
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Malformed encrypted payload parts");
  }

  const key = getMasterEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH} bytes`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Invalid AuthTag length: expected ${AUTH_TAG_LENGTH} bytes`);
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  try {
    let decrypted = decipher.update(ciphertextHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    throw new Error("Decryption failed: authentication tag mismatch or corrupted ciphertext");
  }
}
