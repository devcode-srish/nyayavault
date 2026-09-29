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

/**
 * Computes SHA-256 hash by streaming file chunks directly from storage disk.
 * Handles files of any size with constant memory overhead and safe error handling.
 */
export async function computeFileSha256Stream(storageKey: string): Promise<{
  success: boolean;
  hash?: string;
  sizeBytes?: number;
  error?: string;
  errorCode?: "MISSING" | "UNREADABLE" | "INVALID_KEY";
}> {
  try {
    const filePath = path.join(LOCAL_ROOT, storageKey);
    if (!filePath.startsWith(LOCAL_ROOT)) {
      return { success: false, error: "Invalid storage key path", errorCode: "INVALID_KEY" };
    }

    if (!fs.existsSync(filePath)) {
      return { success: false, error: "File not found on storage disk", errorCode: "MISSING" };
    }

    return new Promise((resolve) => {
      let sizeBytes = 0;
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath);

      stream.on("data", (chunk) => {
        sizeBytes += chunk.length;
        hash.update(chunk);
      });

      stream.on("end", () => {
        resolve({
          success: true,
          hash: hash.digest("hex"),
          sizeBytes,
        });
      });

      stream.on("error", (err: any) => {
        resolve({
          success: false,
          error: err?.message || "Failed to read file from storage",
          errorCode: "UNREADABLE",
        });
      });
    });
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "Unexpected storage access error",
      errorCode: "UNREADABLE",
    };
  }
}

/** DEMO-ONLY: used by the Phase 4 tamper simulation to corrupt stored bytes
 * without touching the DB-stored hash, so integrity verification can catch
 * the mismatch. Never used outside the explicit "Simulate Tampering" action. */
export function overwriteFileForDemo(storageKey: string, buffer: Buffer): void {
  fs.writeFileSync(path.join(LOCAL_ROOT, storageKey), buffer);
}
