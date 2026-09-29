import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  startStorageScan,
  cancelStorageScan,
  getStorageScanRuns,
  getActiveStorageScan,
  getStorageScanRunDetails,
  getStorageScanFindings,
  getStorageIntegritySummary,
} from "../services/integrity.service";
import { FindingStatus } from "@prisma/client";

const router = Router();

const SCAN_ROLES = ["ADMIN", "SENIOR_OFFICER", "INVESTIGATING_OFFICER"] as const;

const scanStartSchema = z.object({
  caseId: z.string().trim().optional(),
});

/**
 * POST /api/integrity/scan
 * Initiates an authorized storage integrity scan.
 * Non-admins can only scan cases they belong to.
 */
router.post("/scan", requireAuth, requireRole(...SCAN_ROLES), async (req, res) => {
  const { sub: userId, role } = req.user!;
  const parsed = scanStartSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid scan parameters", details: parsed.error.flatten() });
  }

  const result = await startStorageScan({
    initiatedById: userId,
    userRole: role,
    caseId: parsed.data.caseId,
  });

  if (!result.success) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.status(202).json({
    message: "Storage integrity scan initiated",
    scanRun: result.scanRun,
  });
});

/**
 * POST /api/integrity/scans/:id/cancel
 * Cancels an in-progress scan run.
 */
router.post("/scans/:id/cancel", requireAuth, requireRole(...SCAN_ROLES), async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id } = req.params;

  const result = await cancelStorageScan(id, userId, role);
  if (!result.success) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.json({ ok: true, message: "Storage scan cancelled successfully" });
});

/**
 * GET /api/integrity/scans/active
 * Polls the current in-progress scan run (if any).
 */
router.get("/scans/active", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { caseId } = req.query as { caseId?: string };

  const active = await getActiveStorageScan(userId, role, caseId);
  return res.json({ activeScan: active });
});

/**
 * GET /api/integrity/scans
 * Lists recent scan runs accessible to the caller.
 */
router.get("/scans", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { caseId } = req.query as { caseId?: string };

  const runs = await getStorageScanRuns(userId, role, caseId);
  return res.json({ scans: runs });
});

/**
 * GET /api/integrity/scans/:id
 * Retrieves detailed metrics and findings for a specific scan run.
 */
router.get("/scans/:id", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id } = req.params;

  const result = await getStorageScanRunDetails(id, userId, role);
  if (!result.success) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.json({ scanRun: result.scanRun, findings: result.findings });
});

/**
 * GET /api/integrity/findings
 * Filterable query for individual scan findings.
 */
router.get("/findings", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { scanRunId, caseId, documentId, status, dateFrom, dateTo, limit } = req.query as Record<
    string,
    string | undefined
  >;

  let validStatus: FindingStatus | undefined;
  if (status && Object.values(FindingStatus).includes(status as FindingStatus)) {
    validStatus = status as FindingStatus;
  }

  const findings = await getStorageScanFindings(userId, role, {
    scanRunId,
    caseId,
    documentId,
    status: validStatus,
    dateFrom,
    dateTo,
    limit: limit ? parseInt(limit, 10) : undefined,
  });

  return res.json({ findings });
});

/**
 * GET /api/integrity/summary
 * Health summary for dashboard and security center.
 */
router.get("/summary", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { caseId } = req.query as { caseId?: string };

  const result = await getStorageIntegritySummary(userId, role, caseId);
  if (!result.success) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.json(result.summary);
});

export default router;
