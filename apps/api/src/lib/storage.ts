import fs from "fs";
import path from "path";
import crypto from "crypto";

// Storage abstraction: every caller goes through save/read/exists here, so
// swapping STORAGE_DRIVER to s3/supabase later only means changing this
// file, not any route or controller.

const LOCAL_ROOT = path.resolve(
  process.cwd(),
  process.env.STORAGE_LOCAL_PATH || "./storage"
);

function ensureRoot() {
  if (!fs.existsSync(LOCAL_ROOT)) {
    fs.mkdirSync(LOCAL_ROOT, { recursive: true });
  }
}

/**
 * Saves a buffer under a random, non-guessable key (never the original
 * filename — that's stored separately in the DB) and returns the storage
 * key. The key is an internal implementation detail; it is never sent to
 * the frontend or exposed in any API response.
 */
export function saveFile(buffer: Buffer, originalName: string): string {
  ensureRoot();
  const ext = path.extname(originalName);
  const key = `${crypto.randomBytes(24).toString("hex")}${ext}`;
  fs.writeFileSync(path.join(LOCAL_ROOT, key), buffer);
  return key;
}

export function readFile(storageKey: string): Buffer {
  const filePath = path.join(LOCAL_ROOT, storageKey);
  if (!filePath.startsWith(LOCAL_ROOT)) {
    // Defense in depth against path traversal, even though storageKey is
    // always server-generated and never comes from user input.
    throw new Error("Invalid storage key");
  }
  return fs.readFileSync(filePath);
}

export function fileExists(storageKey: string): boolean {
  return fs.existsSync(path.join(LOCAL_ROOT, storageKey));
}

/** DEMO-ONLY: used by the Phase 4 tamper simulation to corrupt stored bytes
 * without touching the DB-stored hash, so integrity verification can catch
 * the mismatch. Never used outside the explicit "Simulate Tampering" action. */
export function overwriteFileForDemo(storageKey: string, buffer: Buffer): void {
  fs.writeFileSync(path.join(LOCAL_ROOT, storageKey), buffer);
}
