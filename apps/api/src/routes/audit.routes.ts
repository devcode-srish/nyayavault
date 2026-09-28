import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { AuditAction } from "@prisma/client";

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

export default router;
