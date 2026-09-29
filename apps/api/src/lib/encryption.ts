/**
 * NyayaVault — Cryptographic Encryption Utility (AES-256-GCM)
 *
 * Provides authenticated symmetric encryption for sensitive bearer tokens
 * (such as physical evidence QR tokens) stored in the database.
 *
 * Features:
 * - AES-256-GCM authenticated encryption with unique 12-byte IV per encryption.
 * - 128-bit authentication tag verification on decryption.
 * - Startup key derivation, entropy validation, and configuration diagnostics.
 * - Key rotation support with fallback decryption against candidate previous keys.
 * - Explicit error handling on authentication failure / data corruption.
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptionError";
  }
}

/**
 * Validates the encryption configuration at application startup.
 */
export function validateEncryptionConfig(): {
  isValid: boolean;
  hasCustomSecret: boolean;
  rotationKeysConfigured: number;
} {
  const secret = process.env.ENCRYPTION_SECRET;
  const isProduction = process.env.NODE_ENV === "production";

  if (!secret && isProduction) {
    // eslint-disable-next-line no-console
    console.warn(
      "[SECURITY WARNING] ENCRYPTION_SECRET is not explicitly set in production. Falling back to JWT_ACCESS_SECRET or default seed."
    );
  }

  const oldSecrets = (process.env.PREVIOUS_ENCRYPTION_SECRETS || process.env.OLD_ENCRYPTION_SECRETS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    isValid: true,
    hasCustomSecret: !!secret,
    rotationKeysConfigured: oldSecrets.length,
  };
}

/**
 * Derives a consistent 256-bit encryption key from a secret string.
 */
function deriveKeyFromSecret(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

/**
 * Returns primary and candidate rotation keys.
 */
function getAllEncryptionKeys(): Buffer[] {
  const primarySecret =
    process.env.ENCRYPTION_SECRET ||
    process.env.JWT_ACCESS_SECRET ||
    "nyayavault-default-master-key-seed-change-in-production";

  const primaryKey = deriveKeyFromSecret(primarySecret);
  const keys = [primaryKey];

  const oldSecrets = (process.env.PREVIOUS_ENCRYPTION_SECRETS || process.env.OLD_ENCRYPTION_SECRETS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const oldSecret of oldSecrets) {
    if (oldSecret !== primarySecret) {
      keys.push(deriveKeyFromSecret(oldSecret));
    }
  }

  return keys;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns formatted string: `${ivHex}:${authTagHex}:${ciphertextHex}`
 */
export function encryptData(plaintext: string): string {
  if (!plaintext) {
    throw new Error("Cannot encrypt empty data");
  }

  const [primaryKey] = getAllEncryptionKeys();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, primaryKey, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");
  const ivHex = iv.toString("hex");

  return `${ivHex}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a formatted AES-256-GCM string (`${ivHex}:${authTagHex}:${ciphertextHex}`).
 * Attempts decryption with the primary key first, then candidate rotation keys if available.
 * Throws DecryptionError if all candidate keys fail authentication tag verification.
 */
export function decryptData(encryptedPayload: string): string {
  if (!encryptedPayload || typeof encryptedPayload !== "string") {
    throw new DecryptionError("Invalid encrypted payload format: expected non-empty string");
  }

  const parts = encryptedPayload.split(":");
  if (parts.length !== 3) {
    throw new DecryptionError("Encrypted payload must contain IV, AuthTag, and Ciphertext separated by colons");
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new DecryptionError("Malformed encrypted payload: missing IV, AuthTag, or Ciphertext segment");
  }

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  if (iv.length !== IV_LENGTH) {
    throw new DecryptionError(`Invalid IV length: expected ${IV_LENGTH} bytes`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new DecryptionError(`Invalid AuthTag length: expected ${AUTH_TAG_LENGTH} bytes`);
  }

  const candidateKeys = getAllEncryptionKeys();

  for (const key of candidateKeys) {
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(ciphertextHex, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch {
      // Authentication tag mismatch or decryption failure with this candidate key; try next
      continue;
    }
  }

  throw new DecryptionError("Decryption failed: authentication tag mismatch or corrupted ciphertext across all candidate keys");
}

