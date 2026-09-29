/**
 * NyayaVault — Canonical Merkle Tree Engine (NYAYAVAULT-MERKLE-V1)
 *
 * Implements the versioned NYAYAVAULT-MERKLE-V1 algorithm:
 * 1. Path normalization to POSIX format with path traversal security checks.
 * 2. Strict rejection of duplicate normalized paths (no silent deduplication).
 * 3. Deterministic sorting by raw UTF-8 byte comparison.
 * 4. Domain-separated leaf hashing (0x00 prefix).
 * 5. RFC 6962 recursive binary tree folding (0x01 prefix).
 */

import crypto from "crypto";

export const MERKLE_ALGORITHM_ID = "NYAYAVAULT-MERKLE-V1";

export interface ArtifactEntry {
  path: string; // Relative POSIX path, e.g. "artifacts/documents/doc1/v1.pdf"
  content: Buffer | string;
}

export interface MerkleLeafInfo {
  path: string;
  fileSha256: string;
  leafHash: string;
}

export interface MerkleTreeResult {
  algorithm: string;
  merkleRoot: string;
  artifactCount: number;
  leaves: MerkleLeafInfo[];
}

/**
 * Normalizes a relative path to standard POSIX forward-slash format.
 * Rejects path traversal attempts ("..") and absolute paths.
 */
export function normalizePOSIXPath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== "string") {
    throw new Error("Invalid artifact path: expected non-empty string");
  }

  // Replace Windows backslashes with forward slashes
  const normalized = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");

  // Path traversal security check
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment === ".." || segment === ".") {
      throw new Error(`Path traversal detected in artifact path: "${rawPath}"`);
    }
  }

  return normalized;
}

/**
 * Computes the SHA-256 hash of raw file content.
 */
export function computeFileSHA256(content: Buffer | string): Buffer {
  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return crypto.createHash("sha256").update(buf).digest();
}

/**
 * Computes a domain-separated leaf hash under NYAYAVAULT-MERKLE-V1:
 * LeafData = PathBytes || 0x00 || FileSha256Bytes (32 bytes)
 * LeafHash = SHA256(0x00 || LeafData)
 */
export function computeLeafHash(normalizedPath: string, fileSha256Bytes: Buffer): Buffer {
  const pathBytes = Buffer.from(normalizedPath, "utf8");
  const prefix = Buffer.from([0x00]);
  const separator = Buffer.from([0x00]);

  const leafData = Buffer.concat([prefix, pathBytes, separator, fileSha256Bytes]);
  return crypto.createHash("sha256").update(leafData).digest();
}

/**
 * RFC 6962 Section 2.1 Recursive Tree Folding:
 * MTH({}) = SHA256("")
 * MTH({d0}) = d0
 * MTH(D[n]) = SHA256(0x01 || MTH(D[0..k]) || MTH(D[k..n])) where k is largest power of 2 < n.
 */
export function computeRFC6962TreeHash(leafHashes: Buffer[]): Buffer {
  const n = leafHashes.length;

  if (n === 0) {
    // Empty set hash = SHA256("")
    return crypto.createHash("sha256").update("").digest();
  }

  if (n === 1) {
    return leafHashes[0];
  }

  // Find largest power of 2 strictly less than n
  let k = 1;
  while (k * 2 < n) {
    k *= 2;
  }

  const leftSubtree = leafHashes.slice(0, k);
  const rightSubtree = leafHashes.slice(k);

  const leftHash = computeRFC6962TreeHash(leftSubtree);
  const rightHash = computeRFC6962TreeHash(rightSubtree);

  const parentPrefix = Buffer.from([0x01]);
  return crypto
    .createHash("sha256")
    .update(Buffer.concat([parentPrefix, leftHash, rightHash]))
    .digest();
}

/**
 * Computes the complete NYAYAVAULT-MERKLE-V1 Merkle Tree across a collection of artifacts.
 */
export function computeMerkleTree(artifacts: ArtifactEntry[]): MerkleTreeResult {
  if (!Array.isArray(artifacts)) {
    throw new Error("Artifacts must be an array");
  }

  // 1. Normalize paths and check for duplicates
  const seenPaths = new Set<string>();
  const prepared: Array<{ normalizedPath: string; content: Buffer | string }> = [];

  for (const item of artifacts) {
    const norm = normalizePOSIXPath(item.path);
    if (seenPaths.has(norm)) {
      throw new Error(`DUPLICATE_ARTIFACT_PATH_DETECTED: Duplicate normalized path "${norm}"`);
    }
    seenPaths.add(norm);
    prepared.push({ normalizedPath: norm, content: item.content });
  }

  // 2. Sort lexicographically by raw UTF-8 bytes
  prepared.sort((a, b) => {
    const bufA = Buffer.from(a.normalizedPath, "utf8");
    const bufB = Buffer.from(b.normalizedPath, "utf8");
    return Buffer.compare(bufA, bufB);
  });

  // 3. Compute leaves
  const leaves: MerkleLeafInfo[] = [];
  const leafHashBuffers: Buffer[] = [];

  for (const item of prepared) {
    const fileSha256Buf = computeFileSHA256(item.content);
    const leafHashBuf = computeLeafHash(item.normalizedPath, fileSha256Buf);

    leaves.push({
      path: item.normalizedPath,
      fileSha256: fileSha256Buf.toString("hex"),
      leafHash: leafHashBuf.toString("hex"),
    });
    leafHashBuffers.push(leafHashBuf);
  }

  // 4. Compute Merkle Root via RFC 6962 recursive splitting
  const rootBuf = computeRFC6962TreeHash(leafHashBuffers);

  return {
    algorithm: MERKLE_ALGORITHM_ID,
    merkleRoot: rootBuf.toString("hex"),
    artifactCount: leaves.length,
    leaves,
  };
}
