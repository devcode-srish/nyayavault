import { AuditAction, AuditOutcome, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import crypto from "crypto";

export const GENESIS_PREV_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

// Constant 64-bit integer advisory lock key for audit log chain serialization
export const AUDIT_CHAIN_ADVISORY_LOCK_ID = 749215091;

/**
 * Deterministic JSON Canonicalization (RFC 8785 subset):
 * Recursively sorts all object keys lexicographically and formats primitives unambiguously.
 */
export function canonicalJson(obj: any): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "number" || typeof obj === "boolean") return JSON.stringify(obj);
  if (typeof obj === "string") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJson).join(",") + "]";
  }
  if (typeof obj === "object") {
    const keys = Object.keys(obj).sort();
    const pairs = keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]));
    return "{" + pairs.join(",") + "}";
  }
  return JSON.stringify(obj);
}

/**
 * Version 1 (Legacy Pipe-Delimited) Canonical String.
 * Preserved strictly for verifying historical records.
 */
export function canonicalAuditStringV1(entry: {
  id: string;
  createdAt: Date | string;
  action: string;
  outcome?: string | null;
  actorId?: string | null;
  caseId?: string | null;
  documentId?: string | null;
  evidenceId?: string | null;
  notes?: string | null;
  metadata?: any;
  previousHash: string;
}): string {
  const createdAtIso = entry.createdAt instanceof Date ? entry.createdAt.toISOString() : new Date(entry.createdAt).toISOString();
  let metaStr = "";
  if (entry.metadata !== null && entry.metadata !== undefined) {
    if (typeof entry.metadata === "object") {
      const keys = Object.keys(entry.metadata).sort();
      const pairs = keys.map((k) => JSON.stringify(k) + ":" + (typeof entry.metadata[k] === "object" ? canonicalJson(entry.metadata[k]) : JSON.stringify(entry.metadata[k])));
      metaStr = "{" + pairs.join(",") + "}";
    } else {
      metaStr = JSON.stringify(entry.metadata);
    }
  }
  return [
    entry.id,
    createdAtIso,
    entry.action,
    entry.outcome || "SUCCESS",
    entry.actorId || "",
    entry.caseId || "",
    entry.documentId || "",
    entry.evidenceId || "",
    entry.notes ? entry.notes.trim() : "",
    metaStr,
    entry.previousHash,
  ].join("|");
}

export function computeAuditHashV1(entry: Parameters<typeof canonicalAuditStringV1>[0]): string {
  const canonical = canonicalAuditStringV1(entry);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Version 2 (Canonical JSON Object Envelope) Canonical String.
 * Unambiguous, delimiter-free, key-order independent representation of all security-relevant fields.
 */
export function canonicalAuditObjectV2(entry: {
  id: string;
  action: string;
  outcome?: string | null;
  actorId?: string | null;
  documentId?: string | null;
  evidenceId?: string | null;
  caseId?: string | null;
  targetUserId?: string | null;
  notes?: string | null;
  metadata?: any;
  previousHash: string;
  createdAt: Date | string;
}): string {
  const createdAtIso = entry.createdAt instanceof Date ? entry.createdAt.toISOString() : new Date(entry.createdAt).toISOString();
  const canonicalObj = {
    action: entry.action,
    actorId: entry.actorId ?? null,
    caseId: entry.caseId ?? null,
    createdAt: createdAtIso,
    documentId: entry.documentId ?? null,
    evidenceId: entry.evidenceId ?? null,
    id: entry.id,
    metadata: entry.metadata ?? null,
    notes: entry.notes ? entry.notes.trim() : null,
    outcome: entry.outcome ?? "SUCCESS",
    previousHash: entry.previousHash,
    targetUserId: entry.targetUserId ?? null,
  };
  return canonicalJson(canonicalObj);
}

export function computeAuditHashV2(entry: Parameters<typeof canonicalAuditObjectV2>[0]): string {
  const canonical = canonicalAuditObjectV2(entry);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Compute the default/current canonical audit hash (Version 2).
 */
export function computeAuditHash(entry: Parameters<typeof canonicalAuditObjectV2>[0]): string {
  return computeAuditHashV2(entry);
}

export interface RecordAuditParams {
  action: AuditAction;
  outcome?: AuditOutcome;
  actorId?: string | null;
  documentId?: string | null;
  evidenceId?: string | null;
  caseId?: string | null;
  targetUserId?: string | null;
  notes?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Concurrency-safe, atomic audit log creation.
 * Uses PostgreSQL transaction advisory lock (AUDIT_CHAIN_ADVISORY_LOCK_ID) to serialize
 * chain writes without table locking. If `tx` is provided, executes inside the caller's transaction.
 */
export async function recordAudit(
  params: RecordAuditParams,
  existingTx?: Prisma.TransactionClient
) {
  const executeInTransaction = async (tx: Prisma.TransactionClient) => {
    // 1. Acquire PostgreSQL transaction-level advisory lock
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_ADVISORY_LOCK_ID})`);

    // 2. Fetch the latest chain tip
    const lastLog = await tx.auditLog.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { hash: true },
    });

    const previousHash = lastLog?.hash || GENESIS_PREV_HASH;
    const createdAt = new Date();

    // 3. Create record skeleton to obtain generated/specified ID
    const createdLog = await tx.auditLog.create({
      data: {
        action: params.action,
        outcome: params.outcome ?? "SUCCESS",
        actorId: params.actorId ?? undefined,
        documentId: params.documentId ?? undefined,
        evidenceId: params.evidenceId ?? undefined,
        caseId: params.caseId ?? undefined,
        targetUserId: params.targetUserId ?? undefined,
        notes: params.notes ?? undefined,
        metadata: params.metadata,
        previousHash,
        hash: "PENDING_CALCULATION",
        createdAt,
      },
    });

    // 4. Compute canonical hash over exact persisted fields
    const hash = computeAuditHashV2({
      id: createdLog.id,
      action: createdLog.action,
      outcome: createdLog.outcome,
      actorId: createdLog.actorId,
      documentId: createdLog.documentId,
      evidenceId: createdLog.evidenceId,
      caseId: createdLog.caseId,
      targetUserId: createdLog.targetUserId,
      notes: createdLog.notes,
      metadata: createdLog.metadata,
      previousHash,
      createdAt: createdLog.createdAt,
    });

    // 5. Update with the definitive computed hash
    const finalizedLog = await tx.auditLog.update({
      where: { id: createdLog.id },
      data: { hash },
    });

    return finalizedLog;
  };

  if (existingTx) {
    return executeInTransaction(existingTx);
  } else {
    return prisma.$transaction(async (tx) => {
      return executeInTransaction(tx);
    });
  }
}

export interface VerificationResult {
  status: "VALID" | "INVALID";
  totalRecords: number;
  validRecords: number;
  firstInvalidRecordId: string | null;
  failureReason: string | null;
  expectedHash: string | null;
  actualHash: string | null;
  expectedPreviousHash: string | null;
  actualPreviousHash: string | null;
  verifiedAt: string;
  formatVersions: string[];
}

/**
 * Detects whether an audit record's hash matches V2 (canonical JSON) or V1 (legacy pipe-delimited) format.
 * Returns 'unknown' if neither hash matches.
 */
export function detectAuditRecordVersion(log: {
  id: string;
  action: string;
  outcome: string;
  actorId: string | null;
  documentId: string | null;
  evidenceId: string | null;
  caseId: string | null;
  targetUserId?: string | null;
  notes: string | null;
  metadata: any;
  previousHash: string | null;
  hash: string | null;
  createdAt: Date | string;
}): "v2_canonical_json" | "v1_legacy" | "unknown" {
  if (!log.hash) return "unknown";

  const createdAt = log.createdAt instanceof Date ? log.createdAt : new Date(log.createdAt);

  const expectedV2 = computeAuditHashV2({
    id: log.id,
    action: log.action as any,
    outcome: log.outcome as any,
    actorId: log.actorId,
    documentId: log.documentId,
    evidenceId: log.evidenceId,
    caseId: log.caseId,
    targetUserId: log.targetUserId,
    notes: log.notes,
    metadata: log.metadata,
    previousHash: log.previousHash || GENESIS_PREV_HASH,
    createdAt,
  });

  if (log.hash === expectedV2) {
    return "v2_canonical_json";
  }

  const expectedV1 = computeAuditHashV1({
    id: log.id,
    action: log.action as any,
    outcome: log.outcome as any,
    actorId: log.actorId,
    caseId: log.caseId,
    documentId: log.documentId,
    evidenceId: log.evidenceId,
    notes: log.notes,
    metadata: log.metadata,
    previousHash: log.previousHash || GENESIS_PREV_HASH,
    createdAt,
  });

  if (log.hash === expectedV1) {
    return "v1_legacy";
  }

  return "unknown";
}

/**
 * Read-only audit chain verification service.
 * Verifies every record in sequence from genesis to tip.
 * Supports both V2 (canonical JSON) and V1 (legacy pipe-delimited) hash formats.
 * Never mutates or repairs records.
 */
export async function verifyAuditChain(client?: Prisma.TransactionClient): Promise<VerificationResult> {
  const db = client || prisma;
  const logs = await db.auditLog.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const verifiedAt = new Date().toISOString();
  const formatVersionsSet = new Set<string>();

  if (logs.length === 0) {
    return {
      status: "VALID",
      totalRecords: 0,
      validRecords: 0,
      firstInvalidRecordId: null,
      failureReason: null,
      expectedHash: null,
      actualHash: null,
      expectedPreviousHash: null,
      actualPreviousHash: null,
      verifiedAt,
      formatVersions: [],
    };
  }

  let expectedPrevHash = GENESIS_PREV_HASH;
  let validRecords = 0;

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];

    // 1. Verify previousHash link continuity
    if (!log.previousHash || log.previousHash !== expectedPrevHash) {
      return {
        status: "INVALID",
        totalRecords: logs.length,
        validRecords,
        firstInvalidRecordId: log.id,
        failureReason: `Broken previousHash reference at index ${i} (record ${log.id}). Expected ${expectedPrevHash}, found ${log.previousHash || "null"}`,
        expectedHash: null,
        actualHash: log.hash,
        expectedPreviousHash: expectedPrevHash,
        actualPreviousHash: log.previousHash,
        verifiedAt,
        formatVersions: Array.from(formatVersionsSet),
      };
    }

    // 2. Verify record hash against V2 canonical JSON format or V1 legacy format
    const matchedVersion = detectAuditRecordVersion(log);

    if (matchedVersion === "unknown") {
      const expectedV2 = computeAuditHashV2({
        id: log.id,
        action: log.action,
        outcome: log.outcome,
        actorId: log.actorId,
        documentId: log.documentId,
        evidenceId: log.evidenceId,
        caseId: log.caseId,
        targetUserId: log.targetUserId,
        notes: log.notes,
        metadata: log.metadata,
        previousHash: log.previousHash,
        createdAt: log.createdAt,
      });

      return {
        status: "INVALID",
        totalRecords: logs.length,
        validRecords,
        firstInvalidRecordId: log.id,
        failureReason: `Cryptographic digest mismatch at index ${i} (record ${log.id}). Stored hash does not match computed hash for supported formats.`,
        expectedHash: expectedV2,
        actualHash: log.hash,
        expectedPreviousHash: expectedPrevHash,
        actualPreviousHash: log.previousHash,
        verifiedAt,
        formatVersions: Array.from(formatVersionsSet),
      };
    }

    formatVersionsSet.add(matchedVersion);
    validRecords++;
    expectedPrevHash = log.hash!;
  }

  return {
    status: "VALID",
    totalRecords: logs.length,
    validRecords,
    firstInvalidRecordId: null,
    failureReason: null,
    expectedHash: null,
    actualHash: null,
    expectedPreviousHash: null,
    actualPreviousHash: null,
    verifiedAt,
    formatVersions: Array.from(formatVersionsSet),
  };
}

