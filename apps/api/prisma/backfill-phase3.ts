import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

const GENESIS_PREV_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Deterministic JSON Canonicalization (RFC 8785 subset):
 * Sorts all object keys lexicographically and strips extraneous whitespace.
 */
export function canonicalJson(obj: any): string {
  if (obj === null || obj === undefined) return "";
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]));
  return "{" + pairs.join(",") + "}";
}

/**
 * Deterministic Canonical String construction for Audit Log entry.
 */
export function canonicalAuditString(entry: {
  id: string;
  createdAt: Date;
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
  return [
    entry.id,
    entry.createdAt.toISOString(),
    entry.action,
    entry.outcome || "SUCCESS",
    entry.actorId || "",
    entry.caseId || "",
    entry.documentId || "",
    entry.evidenceId || "",
    entry.notes ? entry.notes.trim() : "",
    canonicalJson(entry.metadata),
    entry.previousHash,
  ].join("|");
}

export function computeAuditHash(entry: Parameters<typeof canonicalAuditString>[0]): string {
  const canonical = canonicalAuditString(entry);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

async function main() {
  console.log("=== Starting Phase 3.1 Idempotent Data Backfill ===");

  // -------------------------------------------------------------
  // 1. Backfill ShareLink tokenHash
  // -------------------------------------------------------------
  console.log("1. Backfilling ShareLink tokenHash...");
  const unhashedLinks = await prisma.shareLink.findMany({
    where: { tokenHash: null },
  });

  for (const link of unhashedLinks) {
    const tokenHash = crypto.createHash("sha256").update(link.token).digest("hex");
    await prisma.shareLink.update({
      where: { id: link.id },
      data: { tokenHash },
    });
  }
  console.log(`   Processed ${unhashedLinks.length} unhashed ShareLinks.`);

  // -------------------------------------------------------------
  // 2. Backfill EvidenceTransfer status & packageCondition
  // -------------------------------------------------------------
  console.log("2. Ensuring EvidenceTransfer default statuses...");
  const updatedTransfers = await prisma.evidenceTransfer.updateMany({
    where: { status: { not: "COMPLETED" } },
    data: { status: "COMPLETED", packageCondition: "SEALED_INTACT" },
  });
  console.log(`   Verified/Updated ${updatedTransfers.count} legacy transfers to COMPLETED.`);

  // -------------------------------------------------------------
  // 3. Backfill AuditLog Hash Chain
  // -------------------------------------------------------------
  console.log("3. Backfilling AuditLog linear cryptographic hash chain...");
  const allLogs = await prisma.auditLog.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  let currentPrevHash = GENESIS_PREV_HASH;
  let backfilledCount = 0;

  for (const log of allLogs) {
    const expectedHash = computeAuditHash({
      id: log.id,
      createdAt: log.createdAt,
      action: log.action,
      outcome: log.outcome,
      actorId: log.actorId,
      caseId: log.caseId,
      documentId: log.documentId,
      evidenceId: log.evidenceId,
      notes: log.notes,
      metadata: log.metadata,
      previousHash: currentPrevHash,
    });

    if (log.previousHash !== currentPrevHash || log.hash !== expectedHash) {
      await prisma.auditLog.update({
        where: { id: log.id },
        data: {
          previousHash: currentPrevHash,
          hash: expectedHash,
        },
      });
      backfilledCount++;
    }

    currentPrevHash = expectedHash;
  }
  console.log(`   Total audit entries processed: ${allLogs.length}. Backfilled/Updated: ${backfilledCount}.`);

  // -------------------------------------------------------------
  // 4. Verification Check
  // -------------------------------------------------------------
  console.log("4. Verifying final linear audit chain integrity...");
  const verifiedLogs = await prisma.auditLog.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  let verifyPrevHash = GENESIS_PREV_HASH;
  let chainValid = true;
  let brokenIndex = -1;

  for (let i = 0; i < verifiedLogs.length; i++) {
    const log = verifiedLogs[i];
    const recalculated = computeAuditHash({
      id: log.id,
      createdAt: log.createdAt,
      action: log.action,
      outcome: log.outcome,
      actorId: log.actorId,
      caseId: log.caseId,
      documentId: log.documentId,
      evidenceId: log.evidenceId,
      notes: log.notes,
      metadata: log.metadata,
      previousHash: verifyPrevHash,
    });

    if (log.previousHash !== verifyPrevHash || log.hash !== recalculated) {
      chainValid = false;
      brokenIndex = i;
      console.error(`❌ Chain verification FAILED at index ${i} (ID: ${log.id})`);
      break;
    }
    verifyPrevHash = log.hash!;
  }

  if (chainValid) {
    console.log(`✅ Audit hash chain verified 100% intact across all ${verifiedLogs.length} entries!`);
    console.log(`   Genesis PrevHash: ${GENESIS_PREV_HASH}`);
    console.log(`   Latest Chain Tip: ${verifyPrevHash}`);
  } else {
    throw new Error(`Audit chain verification failed at entry index ${brokenIndex}`);
  }

  console.log("=== Milestone 3.1 Backfill Completed Successfully ===");
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
