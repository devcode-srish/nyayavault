import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { AuditAction } from "@prisma/client";
import { verifyAuditChain, recordAudit, canonicalJson, GENESIS_PREV_HASH, detectAuditRecordVersion } from "../lib/audit";


const router = Router();

// Full audit log is a supervisory tool — Admin and Senior Officer only.
// (Investigating/Forensic/Legal officers see relevant audit entries
// scoped to their own documents via the document detail page instead.)
router.get("/", requireAuth, requireRole("ADMIN", "SENIOR_OFFICER"), async (req, res) => {
  const { userId, caseId, action, dateFrom, dateTo } = req.query as Record<string, string | undefined>;

  const where: any = {};
  if (userId) where.actorId = userId;
  if (caseId) where.caseId = caseId;
  if (action && Object.values(AuditAction).includes(action as AuditAction)) {
    where.action = action;
  }
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      actor: { select: { name: true, role: true } },
      document: { select: { name: true } },
    },
  });

  return res.json({ logs });
});

/**
 * GET /api/audit/verify - Cryptographic Audit Chain Verification
 * Restricted to ADMIN role.
 * Read-only recalculation of all hash links across the entire audit chain.
 */
router.get("/verify", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const result = await verifyAuditChain();

  // Record an audit log entry for the supervisory verification check
  await recordAudit({
    action: "INTEGRITY_CHECK",
    actorId: req.user!.sub,
    notes: `Cryptographic audit chain verification executed (status: ${result.status}, records: ${result.totalRecords})`,
    metadata: {
      verificationStatus: result.status,
      totalRecords: result.totalRecords,
      validRecords: result.validRecords,
      formatVersions: result.formatVersions,
    },
  });

  return res.json({ report: result });
});

/**
 * Helper to sanitize log objects and exclude any sensitive keys.
 */
function sanitizeAuditLog(log: any) {
  const formatVersion = detectAuditRecordVersion(log);
  return {
    id: log.id,
    createdAt: log.createdAt,
    action: log.action,
    outcome: log.outcome,
    actorId: log.actorId,
    actorName: log.actor?.name || null,
    actorRole: log.actor?.role || null,
    caseId: log.caseId,
    documentId: log.documentId,
    documentName: log.document?.name || null,
    evidenceId: log.evidenceId,
    targetUserId: log.targetUserId,
    notes: log.notes,
    metadata: log.metadata,
    previousHash: log.previousHash,
    hash: log.hash,
    formatVersion,
  };
}

/**
 * GET /api/audit/export - Secure Audit Export
 * Restricted to ADMIN role.
 * Preserves deterministic order and hash-chain verification proofs while stripping secrets.
 */
router.get("/export", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { caseId, action, dateFrom, dateTo, format } = req.query as Record<string, string | undefined>;

  const where: any = {};
  if (caseId) where.caseId = caseId;
  if (action && Object.values(AuditAction).includes(action as AuditAction)) {
    where.action = action;
  }
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  // Export in deterministic chronological order
  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      actor: { select: { name: true, role: true } },
      document: { select: { name: true } },
    },
  });

  const sanitizedLogs = logs.map(sanitizeAuditLog);

  // Record audit log for the supervisory export
  await recordAudit({
    action: "INTEGRITY_CHECK",
    actorId: req.user!.sub,
    caseId: caseId || undefined,
    notes: `Audit logs exported (${sanitizedLogs.length} entries, format: ${format || "json"})`,
  });

  if (format === "csv") {
    const csvHeaders = [
      "id",
      "createdAt",
      "action",
      "outcome",
      "actorId",
      "actorName",
      "actorRole",
      "caseId",
      "documentId",
      "documentName",
      "evidenceId",
      "targetUserId",
      "notes",
      "metadata",
      "previousHash",
      "hash",
      "formatVersion",
    ];

    const csvRows = sanitizedLogs.map((l: any) =>
      [
        l.id,
        l.createdAt instanceof Date ? l.createdAt.toISOString() : new Date(l.createdAt).toISOString(),
        l.action,
        l.outcome,
        l.actorId || "",
        l.actorName || "",
        l.actorRole || "",
        l.caseId || "",
        l.documentId || "",
        l.documentName || "",
        l.evidenceId || "",
        l.targetUserId || "",
        l.notes ? `"${l.notes.replace(/"/g, '""')}"` : "",
        l.metadata ? `"${canonicalJson(l.metadata).replace(/"/g, '""')}"` : "",
        l.previousHash || "",
        l.hash || "",
        l.formatVersion || "unknown",
      ].join(",")
    );

    const csvContent = [csvHeaders.join(","), ...csvRows].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="nyayavault-audit-export-${Date.now()}.csv"`);
    return res.send(csvContent);
  }

  return res.json({
    exportTimestamp: new Date().toISOString(),
    totalRecords: sanitizedLogs.length,
    genesisHash: GENESIS_PREV_HASH,
    records: sanitizedLogs,
  });
});

export default router;


