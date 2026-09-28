import { prisma } from "../lib/prisma";
import { recordAudit } from "../lib/audit";
import { notifyUsers } from "../lib/notify";
import { computeFileSha256Stream } from "../lib/storage";
import { accessibleCaseIds, userCanAccessCase } from "../lib/access";
import { FindingStatus, StorageScanStatus, Prisma } from "@prisma/client";

export const STORAGE_SCAN_ADVISORY_LOCK_ID = 849302194;
const STALE_HEARTBEAT_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export interface StartScanOptions {
  initiatedById: string;
  userRole: string;
  caseId?: string;
}

export interface ScanProgressReport {
  id: string;
  status: StorageScanStatus;
  caseId: string | null;
  caseName?: string | null;
  totalVersions: number;
  processedVersions: number;
  percentage: number;
  verifiedCount: number;
  mismatchCount: number;
  missingCount: number;
  unreadableCount: number;
  errorCount: number;
  startedAt: string;
  completedAt: string | null;
  elapsedMs: number | null;
  errorMessage: string | null;
  initiatedBy: {
    id: string;
    name: string;
    role: string;
  };
}

/**
 * Recovers stale or abandoned scan runs that timed out without completion.
 */
export async function recoverAbandonedScanRuns(): Promise<number> {
  const staleCutoff = new Date(Date.now() - STALE_HEARTBEAT_THRESHOLD_MS);
  const staleRuns = await prisma.storageScanRun.findMany({
    where: {
      status: "IN_PROGRESS",
      heartbeatAt: { lt: staleCutoff },
    },
    select: { id: true, startedAt: true },
  });

  if (staleRuns.length === 0) return 0;

  const now = new Date();
  for (const run of staleRuns) {
    const elapsed = now.getTime() - new Date(run.startedAt).getTime();
    await prisma.storageScanRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: now,
        elapsedMs: elapsed,
        errorMessage: "Scan abandoned or timed out (worker interruption/restart detected)",
      },
    });

    await recordAudit({
      action: "INTEGRITY_CHECK",
      outcome: "FAILED",
      notes: `Storage scan run ${run.id} recovered after timeout/process interruption`,
      metadata: {
        scanRunId: run.id,
        recoveredAt: now.toISOString(),
      },
    });
  }

  return staleRuns.length;
}

/**
 * Initiates an authorized storage integrity scan run.
 * Concurrency-safe via transaction advisory lock & active run detection.
 */
export async function startStorageScan(options: StartScanOptions): Promise<StorageScanRunResult> {
  const { initiatedById, userRole, caseId } = options;

  // 1. Verify case-level access if caseId is provided
  if (caseId) {
    const canAccess = await userCanAccessCase(initiatedById, userRole, caseId);
    if (!canAccess) {
      return { success: false, status: 403, error: "Access denied: unauthorized case for integrity scan" };
    }
  }

  // 2. Recover any stale abandoned runs
  await recoverAbandonedScanRuns();

  // 3. Atomically check and acquire advisory lock for scan initiation
  return prisma.$transaction(async (tx) => {
    // Acquire PostgreSQL transaction-level advisory lock
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${STORAGE_SCAN_ADVISORY_LOCK_ID})`);

    // Check if there is already an active IN_PROGRESS scan run
    const activeRun = await tx.storageScanRun.findFirst({
      where: {
        status: "IN_PROGRESS",
        ...(caseId ? { caseId } : {}),
      },
      select: {
        id: true,
        startedAt: true,
        initiatedBy: { select: { name: true } },
      },
    });

    if (activeRun) {
      return {
        success: false,
        status: 409,
        error: `A storage integrity scan is already in progress (Run ${activeRun.id} initiated by ${activeRun.initiatedBy.name} at ${new Date(activeRun.startedAt).toISOString()})`,
      };
    }

    // Determine accessible case IDs for document version query
    let versionWhere: Prisma.DocumentVersionWhereInput = {};
    if (caseId) {
      versionWhere = { document: { caseId } };
    } else if (userRole !== "ADMIN") {
      const ids = await accessibleCaseIds(initiatedById, userRole);
      if (ids === "ALL") {
        versionWhere = {};
      } else {
        versionWhere = { document: { caseId: { in: ids } } };
      }
    }

    // Fetch target document versions to scan
    const versions = await tx.documentVersion.findMany({
      where: versionWhere,
      select: {
        id: true,
        versionNo: true,
        storageKey: true,
        originalName: true,
        sizeBytes: true,
        sha256: true,
        documentId: true,
        document: {
          select: {
            id: true,
            name: true,
            caseId: true,
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    // Create the initial scan run record
    const scanRun = await tx.storageScanRun.create({
      data: {
        initiatedById,
        caseId: caseId || null,
        status: "IN_PROGRESS",
        totalVersions: versions.length,
        processedVersions: 0,
        verifiedCount: 0,
        mismatchCount: 0,
        missingCount: 0,
        unreadableCount: 0,
        errorCount: 0,
        startedAt: new Date(),
        heartbeatAt: new Date(),
      },
      include: {
        initiatedBy: { select: { id: true, name: true, role: true } },
        case: { select: { id: true, title: true, caseNumber: true } },
      },
    });

    // Emit initial audit log
    await recordAudit(
      {
        action: "INTEGRITY_CHECK",
        actorId: initiatedById,
        caseId: caseId || null,
        notes: `Storage integrity scan started (Run ID: ${scanRun.id}, Total versions: ${versions.length})`,
        metadata: {
          scanRunId: scanRun.id,
          totalVersions: versions.length,
          scope: caseId ? `Case: ${caseId}` : "All Accessible Cases",
        },
      },
      tx
    );

    // Launch background execution asynchronously without blocking HTTP response
    setImmediate(() => {
      executeScanBackground(scanRun.id, versions).catch((err) => {
        console.error(`[StorageScanner] Critical error in scan run ${scanRun.id}:`, err);
      });
    });

    return {
      success: true,
      status: 202,
      scanRun: {
        id: scanRun.id,
        status: scanRun.status,
        caseId: scanRun.caseId,
        caseName: scanRun.case ? `${scanRun.case.caseNumber} - ${scanRun.case.title}` : "System-wide",
        totalVersions: scanRun.totalVersions,
        processedVersions: 0,
        percentage: 0,
        verifiedCount: 0,
        mismatchCount: 0,
        missingCount: 0,
        unreadableCount: 0,
        errorCount: 0,
        startedAt: scanRun.startedAt.toISOString(),
        completedAt: null,
        elapsedMs: null,
        errorMessage: null,
        initiatedBy: scanRun.initiatedBy,
      },
    };
  });
}

export type StorageScanRunResult =
  | { success: true; status: 202; scanRun: ScanProgressReport }
  | { success: false; status: number; error: string };

/**
 * Asynchronous background executor for the storage scan run.
 */
async function executeScanBackground(
  scanRunId: string,
  versions: Array<{
    id: string;
    versionNo: number;
    storageKey: string;
    originalName: string;
    sizeBytes: number;
    sha256: string;
    documentId: string;
    document: { id: string; name: string; caseId: string };
  }>
) {
  const startTime = Date.now();
  let verifiedCount = 0;
  let mismatchCount = 0;
  let missingCount = 0;
  let unreadableCount = 0;
  let errorCount = 0;
  let processedVersions = 0;

  const mismatchesToAlert: Array<{
    documentId: string;
    documentName: string;
    versionNo: number;
    caseId: string;
    status: FindingStatus;
    reason: string;
  }> = [];

  for (const v of versions) {
    // 1. Check if scan was cancelled
    const currentRun = await prisma.storageScanRun.findUnique({
      where: { id: scanRunId },
      select: { status: true },
    });

    if (currentRun?.status === "CANCELLED") {
      const elapsedMs = Date.now() - startTime;
      await prisma.storageScanRun.update({
        where: { id: scanRunId },
        data: {
          completedAt: new Date(),
          elapsedMs,
          processedVersions,
          verifiedCount,
          mismatchCount,
          missingCount,
          unreadableCount,
          errorCount,
        },
      });
      return;
    }

    // 2. Perform streaming SHA-256 calculation
    let findingStatus: FindingStatus = "VERIFIED";
    let actualSha256: string | null = null;
    let reason: string | null = null;

    try {
      const streamRes = await computeFileSha256Stream(v.storageKey);

      if (!streamRes.success) {
        if (streamRes.errorCode === "MISSING") {
          findingStatus = "MISSING";
          reason = "Evidence file missing from physical storage disk";
          missingCount++;
        } else {
          findingStatus = "UNREADABLE";
          reason = streamRes.error || "File I/O permission or read error on storage disk";
          unreadableCount++;
        }
      } else {
        actualSha256 = streamRes.hash || null;
        if (actualSha256 === v.sha256) {
          findingStatus = "VERIFIED";
          reason = "Authoritative SHA-256 digest match verified via stream";
          verifiedCount++;
        } else {
          findingStatus = "MISMATCH";
          reason = `Cryptographic mismatch: expected ${v.sha256}, actual ${actualSha256}`;
          mismatchCount++;
        }
      }
    } catch (err: any) {
      findingStatus = "ERROR";
      reason = `Unexpected error during verification: ${err?.message || String(err)}`;
      errorCount++;
    }

    processedVersions++;

    // 3. Record individual finding (preserving permanent historical forensic record)
    await prisma.storageScanFinding.create({
      data: {
        scanRunId,
        documentId: v.document.id,
        documentVersionId: v.id,
        caseId: v.document.caseId,
        documentName: v.document.name,
        versionNo: v.versionNo,
        originalName: v.originalName,
        sizeBytes: v.sizeBytes,
        status: findingStatus,
        expectedSha256: v.sha256,
        actualSha256,
        reason,
        scannedAt: new Date(),
      },
    });

    // 4. Update Document integrityStatus if corrupted or verified
    if (findingStatus === "MISMATCH" || findingStatus === "MISSING") {
      await prisma.document.update({
        where: { id: v.document.id },
        data: { integrityStatus: "MISMATCH" },
      });

      mismatchesToAlert.push({
        documentId: v.document.id,
        documentName: v.document.name,
        versionNo: v.versionNo,
        caseId: v.document.caseId,
        status: findingStatus,
        reason: reason || "Storage integrity failure",
      });
    }

    // 5. Update heartbeat & intermediate counters periodically
    if (processedVersions % 5 === 0 || processedVersions === versions.length) {
      await prisma.storageScanRun.update({
        where: { id: scanRunId },
        data: {
          processedVersions,
          verifiedCount,
          mismatchCount,
          missingCount,
          unreadableCount,
          errorCount,
          heartbeatAt: new Date(),
        },
      });
    }
  }

  // Finalize scan run
  const elapsedMs = Date.now() - startTime;
  const completedAt = new Date();

  // Validate aggregate counter invariant
  const totalProcessed = verifiedCount + mismatchCount + missingCount + unreadableCount + errorCount;

  await prisma.storageScanRun.update({
    where: { id: scanRunId },
    data: {
      status: "COMPLETED",
      completedAt,
      heartbeatAt: completedAt,
      elapsedMs,
      processedVersions: totalProcessed,
      verifiedCount,
      mismatchCount,
      missingCount,
      unreadableCount,
      errorCount,
    },
  });

  // Emit final audit log for scan completion
  const overallOutcome = mismatchCount > 0 || missingCount > 0 ? "MISMATCH" : "SUCCESS";
  await recordAudit({
    action: mismatchCount > 0 || missingCount > 0 ? "INTEGRITY_MISMATCH" : "INTEGRITY_CHECK",
    outcome: overallOutcome,
    notes: `Storage integrity scan completed in ${elapsedMs}ms: ${verifiedCount} verified, ${mismatchCount} mismatches, ${missingCount} missing, ${unreadableCount} unreadable, ${errorCount} errors`,
    metadata: {
      scanRunId,
      totalVersions: versions.length,
      processedVersions: totalProcessed,
      verifiedCount,
      mismatchCount,
      missingCount,
      unreadableCount,
      errorCount,
      elapsedMs,
      completedAt: completedAt.toISOString(),
    },
  });

  // If discrepancies found, notify admins and senior officers
  if (mismatchesToAlert.length > 0) {
    const adminAndSeniorUsers = await prisma.user.findMany({
      where: {
        role: { in: ["ADMIN", "SENIOR_OFFICER"] },
        isActive: true,
      },
      select: { id: true },
    });

    const userIdsToNotify = adminAndSeniorUsers.map((u) => u.id);
    if (userIdsToNotify.length > 0) {
      await notifyUsers(userIdsToNotify, {
        type: "INTEGRITY_ALERT",
        priority: "URGENT",
        title: "Evidence Storage Integrity Alert",
        message: `Storage integrity scan detected ${mismatchCount} corrupted and ${missingCount} missing evidence files across ${mismatchesToAlert.length} documents.`,
        category: "STORAGE_INTEGRITY",
        actionUrl: `/security`,
      });
    }
  }
}

/**
 * Cancels an in-progress scan run.
 */
export async function cancelStorageScan(
  scanRunId: string,
  userId: string,
  userRole: string
): Promise<{ success: boolean; status: number; error?: string }> {
  const scanRun = await prisma.storageScanRun.findUnique({
    where: { id: scanRunId },
    select: { id: true, status: true, initiatedById: true, startedAt: true },
  });

  if (!scanRun) {
    return { success: false, status: 404, error: "Scan run not found" };
  }

  if (scanRun.status !== "IN_PROGRESS") {
    return { success: false, status: 400, error: `Cannot cancel scan run with status ${scanRun.status}` };
  }

  if (userRole !== "ADMIN" && scanRun.initiatedById !== userId) {
    return { success: false, status: 403, error: "Unauthorized to cancel this scan run" };
  }

  const now = new Date();
  const elapsed = now.getTime() - new Date(scanRun.startedAt).getTime();

  await prisma.storageScanRun.update({
    where: { id: scanRunId },
    data: {
      status: "CANCELLED",
      completedAt: now,
      elapsedMs: elapsed,
      errorMessage: `Scan cancelled by user ${userId}`,
    },
  });

  await recordAudit({
    action: "INTEGRITY_CHECK",
    outcome: "FAILED",
    actorId: userId,
    notes: `Storage integrity scan run ${scanRunId} cancelled by user`,
    metadata: {
      scanRunId,
      cancelledAt: now.toISOString(),
      cancelledBy: userId,
    },
  });

  return { success: true, status: 200 };
}

/**
 * Retrieves recent scan runs with authorization filtering.
 */
export async function getStorageScanRuns(
  userId: string,
  userRole: string,
  caseId?: string
): Promise<ScanProgressReport[]> {
  await recoverAbandonedScanRuns();

  let where: Prisma.StorageScanRunWhereInput = {};
  if (caseId) {
    const canAccess = await userCanAccessCase(userId, userRole, caseId);
    if (!canAccess) return [];
    where.caseId = caseId;
  } else if (userRole !== "ADMIN") {
    const ids = await accessibleCaseIds(userId, userRole);
    if (ids === "ALL") {
      where = {};
    } else {
      where = {
        OR: [{ caseId: { in: ids } }, { initiatedById: userId }],
      };
    }
  }

  const runs = await prisma.storageScanRun.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: 50,
    include: {
      initiatedBy: { select: { id: true, name: true, role: true } },
      case: { select: { id: true, caseNumber: true, title: true } },
    },
  });

  return runs.map((r) => {
    const percentage =
      r.totalVersions > 0 ? Math.min(100, Math.round((r.processedVersions / r.totalVersions) * 100)) : 100;

    return {
      id: r.id,
      status: r.status,
      caseId: r.caseId,
      caseName: r.case ? `${r.case.caseNumber} - ${r.case.title}` : "System-wide",
      totalVersions: r.totalVersions,
      processedVersions: r.processedVersions,
      percentage,
      verifiedCount: r.verifiedCount,
      mismatchCount: r.mismatchCount,
      missingCount: r.missingCount,
      unreadableCount: r.unreadableCount,
      errorCount: r.errorCount,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      elapsedMs: r.elapsedMs,
      errorMessage: r.errorMessage,
      initiatedBy: r.initiatedBy,
    };
  });
}

/**
 * Retrieves the currently active scan run (if any) accessible to the user.
 */
export async function getActiveStorageScan(
  userId: string,
  userRole: string,
  caseId?: string
): Promise<ScanProgressReport | null> {
  await recoverAbandonedScanRuns();

  let where: Prisma.StorageScanRunWhereInput = { status: "IN_PROGRESS" };
  if (caseId) {
    where.caseId = caseId;
  } else if (userRole !== "ADMIN") {
    const ids = await accessibleCaseIds(userId, userRole);
    if (ids !== "ALL") {
      where = {
        status: "IN_PROGRESS",
        OR: [{ caseId: { in: ids } }, { initiatedById: userId }],
      };
    }
  }

  const active = await prisma.storageScanRun.findFirst({
    where,
    orderBy: { startedAt: "desc" },
    include: {
      initiatedBy: { select: { id: true, name: true, role: true } },
      case: { select: { id: true, caseNumber: true, title: true } },
    },
  });

  if (!active) return null;

  const percentage =
    active.totalVersions > 0
      ? Math.min(100, Math.round((active.processedVersions / active.totalVersions) * 100))
      : 0;

  return {
    id: active.id,
    status: active.status,
    caseId: active.caseId,
    caseName: active.case ? `${active.case.caseNumber} - ${active.case.title}` : "System-wide",
    totalVersions: active.totalVersions,
    processedVersions: active.processedVersions,
    percentage,
    verifiedCount: active.verifiedCount,
    mismatchCount: active.mismatchCount,
    missingCount: active.missingCount,
    unreadableCount: active.unreadableCount,
    errorCount: active.errorCount,
    startedAt: active.startedAt.toISOString(),
    completedAt: null,
    elapsedMs: null,
    errorMessage: active.errorMessage,
    initiatedBy: active.initiatedBy,
  };
}

/**
 * Retrieves a single scan run by ID with detailed findings.
 */
export async function getStorageScanRunDetails(
  scanRunId: string,
  userId: string,
  userRole: string
): Promise<{ success: boolean; status: number; scanRun?: ScanProgressReport; findings?: any[]; error?: string }> {
  const scanRun = await prisma.storageScanRun.findUnique({
    where: { id: scanRunId },
    include: {
      initiatedBy: { select: { id: true, name: true, role: true } },
      case: { select: { id: true, caseNumber: true, title: true } },
      findings: {
        orderBy: { scannedAt: "desc" },
        take: 500,
      },
    },
  });

  if (!scanRun) {
    return { success: false, status: 404, error: "Scan run not found" };
  }

  if (scanRun.caseId) {
    const canAccess = await userCanAccessCase(userId, userRole, scanRun.caseId);
    if (!canAccess && userRole !== "ADMIN" && scanRun.initiatedById !== userId) {
      return { success: false, status: 403, error: "Access denied to this scan run" };
    }
  } else if (userRole !== "ADMIN" && scanRun.initiatedById !== userId) {
    return { success: false, status: 403, error: "Access denied to system-wide scan run" };
  }

  const percentage =
    scanRun.totalVersions > 0
      ? Math.min(100, Math.round((scanRun.processedVersions / scanRun.totalVersions) * 100))
      : 100;

  return {
    success: true,
    status: 200,
    scanRun: {
      id: scanRun.id,
      status: scanRun.status,
      caseId: scanRun.caseId,
      caseName: scanRun.case ? `${scanRun.case.caseNumber} - ${scanRun.case.title}` : "System-wide",
      totalVersions: scanRun.totalVersions,
      processedVersions: scanRun.processedVersions,
      percentage,
      verifiedCount: scanRun.verifiedCount,
      mismatchCount: scanRun.mismatchCount,
      missingCount: scanRun.missingCount,
      unreadableCount: scanRun.unreadableCount,
      errorCount: scanRun.errorCount,
      startedAt: scanRun.startedAt.toISOString(),
      completedAt: scanRun.completedAt ? scanRun.completedAt.toISOString() : null,
      elapsedMs: scanRun.elapsedMs,
      errorMessage: scanRun.errorMessage,
      initiatedBy: scanRun.initiatedBy,
    },
    findings: scanRun.findings.map((f) => ({
      id: f.id,
      scanRunId: f.scanRunId,
      documentId: f.documentId,
      documentVersionId: f.documentVersionId,
      caseId: f.caseId,
      documentName: f.documentName,
      versionNo: f.versionNo,
      originalName: f.originalName,
      sizeBytes: f.sizeBytes,
      status: f.status,
      expectedSha256: f.expectedSha256,
      actualSha256: f.actualSha256,
      reason: f.reason,
      scannedAt: f.scannedAt.toISOString(),
    })),
  };
}

/**
 * Filterable query for individual scan findings across historical runs.
 */
export async function getStorageScanFindings(
  userId: string,
  userRole: string,
  filters: {
    scanRunId?: string;
    caseId?: string;
    documentId?: string;
    status?: FindingStatus;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  }
) {
  const where: Prisma.StorageScanFindingWhereInput = {};

  if (filters.scanRunId) where.scanRunId = filters.scanRunId;
  if (filters.documentId) where.documentId = filters.documentId;
  if (filters.status) where.status = filters.status;

  if (filters.dateFrom || filters.dateTo) {
    where.scannedAt = {};
    if (filters.dateFrom) where.scannedAt.gte = new Date(filters.dateFrom);
    if (filters.dateTo) where.scannedAt.lte = new Date(filters.dateTo);
  }

  // Multi-tenancy & IDOR security
  if (filters.caseId) {
    const canAccess = await userCanAccessCase(userId, userRole, filters.caseId);
    if (!canAccess) return [];
    where.caseId = filters.caseId;
  } else if (userRole !== "ADMIN") {
    const ids = await accessibleCaseIds(userId, userRole);
    if (ids !== "ALL") {
      where.caseId = { in: ids };
    }
  }

  const findings = await prisma.storageScanFinding.findMany({
    where,
    orderBy: { scannedAt: "desc" },
    take: filters.limit ? Math.min(filters.limit, 200) : 100,
  });

  return findings.map((f) => ({
    id: f.id,
    scanRunId: f.scanRunId,
    documentId: f.documentId,
    documentVersionId: f.documentVersionId,
    caseId: f.caseId,
    documentName: f.documentName,
    versionNo: f.versionNo,
    originalName: f.originalName,
    sizeBytes: f.sizeBytes,
    status: f.status,
    expectedSha256: f.expectedSha256,
    actualSha256: f.actualSha256,
    reason: f.reason,
    scannedAt: f.scannedAt.toISOString(),
  }));
}

/**
 * System and case-scoped storage integrity health summary.
 */
export async function getStorageIntegritySummary(userId: string, userRole: string, caseId?: string) {
  let docWhere: Prisma.DocumentWhereInput = {};
  let versionWhere: Prisma.DocumentVersionWhereInput = {};

  if (caseId) {
    const canAccess = await userCanAccessCase(userId, userRole, caseId);
    if (!canAccess) {
      return { success: false, status: 403, error: "Access denied" };
    }
    docWhere = { caseId };
    versionWhere = { document: { caseId } };
  } else if (userRole !== "ADMIN") {
    const ids = await accessibleCaseIds(userId, userRole);
    if (ids !== "ALL") {
      docWhere = { caseId: { in: ids } };
      versionWhere = { document: { caseId: { in: ids } } };
    }
  }

  const [totalDocuments, verifiedDocuments, mismatchDocuments, totalVersions, lastCompletedRun] =
    await Promise.all([
      prisma.document.count({ where: docWhere }),
      prisma.document.count({ where: { ...docWhere, integrityStatus: "VERIFIED" } }),
      prisma.document.count({ where: { ...docWhere, integrityStatus: "MISMATCH" } }),
      prisma.documentVersion.count({ where: versionWhere }),
      prisma.storageScanRun.findFirst({
        where: {
          status: "COMPLETED",
          ...(caseId ? { caseId } : {}),
        },
        orderBy: { completedAt: "desc" },
        include: { initiatedBy: { select: { name: true, role: true } } },
      }),
    ]);

  const integrityScore =
    totalDocuments > 0 ? Math.round((verifiedDocuments / totalDocuments) * 100) : 100;

  return {
    success: true,
    status: 200,
    summary: {
      totalDocuments,
      verifiedDocuments,
      mismatchDocuments,
      unverifiedDocuments: totalDocuments - verifiedDocuments - mismatchDocuments,
      totalVersions,
      integrityScore,
      lastScan: lastCompletedRun
        ? {
            id: lastCompletedRun.id,
            completedAt: lastCompletedRun.completedAt?.toISOString() || null,
            verifiedCount: lastCompletedRun.verifiedCount,
            mismatchCount: lastCompletedRun.mismatchCount,
            missingCount: lastCompletedRun.missingCount,
            unreadableCount: lastCompletedRun.unreadableCount,
            errorCount: lastCompletedRun.errorCount,
            elapsedMs: lastCompletedRun.elapsedMs,
            initiatedBy: lastCompletedRun.initiatedBy.name,
          }
        : null,
    },
  };
}
