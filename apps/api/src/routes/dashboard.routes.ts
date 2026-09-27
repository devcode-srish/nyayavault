import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * GET /api/dashboard
 * Returns a genuinely different payload per role — not just a relabeled
 * version of the same data. Each branch only queries what that role is
 * meant to see; this is separate from (and in addition to) any
 * document/case-level authorization enforced in later phases.
 */
router.get("/", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;

  switch (role) {
    case "ADMIN": {
      const [userCount, activeCases, pendingApprovals, recentAudit] = await Promise.all([
        prisma.user.count(),
        prisma.case.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
        prisma.accessRequest.count({ where: { status: "PENDING" } }),
        prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
      ]);
      return res.json({
        role,
        widgets: { userCount, activeCases, pendingApprovals },
        recentAudit,
      });
    }

    case "INVESTIGATING_OFFICER": {
      const memberships = await prisma.caseMember.findMany({
        where: { userId },
        include: { case: true },
      });
      const assignedCases = memberships.map((m) => m.case);
      const recentDocuments = await prisma.document.findMany({
        where: { caseId: { in: assignedCases.map((c) => c.id) } },
        orderBy: { updatedAt: "desc" },
        take: 10,
      });
      return res.json({ role, widgets: { assignedCases, recentDocuments } });
    }

    case "SENIOR_OFFICER": {
      const memberships = await prisma.caseMember.findMany({
        where: { userId },
        include: { case: true },
      });
      const pendingApprovals = await prisma.accessRequest.findMany({
        where: { status: "PENDING" },
        include: { document: true, requestedBy: true },
        take: 20,
      });
      return res.json({
        role,
        widgets: { supervisedCases: memberships.map((m) => m.case), pendingApprovals },
      });
    }

    case "FORENSIC_OFFICER": {
      const evidence = await prisma.evidenceItem.findMany({
        where: { currentCustodianId: userId },
        take: 20,
      });
      return res.json({ role, widgets: { assignedEvidence: evidence } });
    }

    case "LEGAL_OFFICER": {
      const memberships = await prisma.caseMember.findMany({
        where: { userId },
        include: { case: true },
      });
      return res.json({ role, widgets: { assignedCases: memberships.map((m) => m.case) } });
    }

    default:
      return res.status(403).json({ error: "Unknown role" });
  }
});

export default router;
