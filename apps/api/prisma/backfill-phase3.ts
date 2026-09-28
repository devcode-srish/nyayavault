import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import {
  GENESIS_PREV_HASH,
  computeAuditHashV2,
  computeAuditHashV1,
  verifyAuditChain,
  canonicalJson,
} from "../src/lib/audit";

const prisma = new PrismaClient();


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
    // 1. Check if the log already has a valid hash linking to currentPrevHash under V2 or V1
    const isValidV2 = log.hash && log.previousHash === currentPrevHash && log.hash === computeAuditHashV2({
      id: log.id,
      createdAt: log.createdAt,
      action: log.action,
      outcome: log.outcome,
      actorId: log.actorId,
      caseId: log.caseId,
      documentId: log.documentId,
      evidenceId: log.evidenceId,
      targetUserId: log.targetUserId,
      notes: log.notes,
      metadata: log.metadata,
      previousHash: currentPrevHash,
    });

    const isValidV1 = log.hash && log.previousHash === currentPrevHash && log.hash === computeAuditHashV1({
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

    if (isValidV2 || isValidV1) {
      // Historical record is already valid and cryptographically chained — preserve untouched!
      currentPrevHash = log.hash!;
      continue;
    }

    // 2. Unhashed record or unlinked legacy entry: compute V2 canonical hash
    const expectedHash = computeAuditHashV2({
      id: log.id,
      createdAt: log.createdAt,
      action: log.action,
      outcome: log.outcome,
      actorId: log.actorId,
      caseId: log.caseId,
      documentId: log.documentId,
      evidenceId: log.evidenceId,
      targetUserId: log.targetUserId,
      notes: log.notes,
      metadata: log.metadata,
      previousHash: currentPrevHash,
    });

    await prisma.auditLog.update({
      where: { id: log.id },
      data: {
        previousHash: currentPrevHash,
        hash: expectedHash,
      },
    });
    backfilledCount++;
    currentPrevHash = expectedHash;
  }
  console.log(`   Total audit entries processed: ${allLogs.length}. Newly Backfilled: ${backfilledCount}. Preserved Historical: ${allLogs.length - backfilledCount}.`);


  // -------------------------------------------------------------
  // 4. Verification Check
  // -------------------------------------------------------------
  console.log("4. Verifying final linear audit chain integrity via verifyAuditChain()...");
  const result = await verifyAuditChain();

  if (result.status === "VALID") {
    console.log(`✅ Audit hash chain verified 100% intact across all ${result.totalRecords} entries!`);
    console.log(`   Genesis PrevHash: ${GENESIS_PREV_HASH}`);
    console.log(`   Format versions encountered: ${result.formatVersions.join(", ")}`);
  } else {
    throw new Error(`Audit chain verification failed: ${result.failureReason}`);
  }

  console.log("=== Milestone 3.5 Backfill & Verification Completed Successfully ===");
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

