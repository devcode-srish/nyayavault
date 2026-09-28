import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * GET /api/dashboard
 * Each role gets a genuinely different payload; each branch only queries
 * what that role is meant to see.
 */
router.get("/", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;

  const myRequests = async () => {
    const rows = await prisma.accessRequest.findMany({
      where: { requestedById: userId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { document: { select: { id: true, name: true } } },
    });
    const now = new Date();
    return rows.map((r) => ({
      ...r,
      status: r.status === "APPROVED" && r.expiresAt && r.expiresAt < now ? "EXPIRED" : r.status,
    }));
  };

  switch (role) {
    case "ADMIN": {
      const [userCount, activeCases, pendingApprovals, integrityAlerts, recentAudit] = await Promise.all([
        prisma.user.count(),
        prisma.case.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
        prisma.accessRequest.count({ where: { status: "PENDING" } }),
        prisma.document.count({ where: { integrityStatus: "MISMATCH" } }),
        prisma.auditLog.findMany({
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { actor: { select: { name: true } } },
        }),
      ]);
      return res.json({
        role,
        widgets: { userCount, activeCases, pendingApprovals, integrityAlerts },
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
        take: 8,
      });
      return res.json({
        role,
        widgets: { assignedCases, recentDocuments, myAccessRequests: await myRequests() },
      });
    }

    case "SENIOR_OFFICER": {
      const memberships = await prisma.caseMember.findMany({
        where: { userId },
        include: { case: true },
      });
      const caseIds = memberships.map((m) => m.caseId);
      const [pendingApprovals, integrityAlerts] = await Promise.all([
        prisma.accessRequest.findMany({
          where: { status: "PENDING", requestedById: { not: userId }, document: { caseId: { in: caseIds } } },
          orderBy: { createdAt: "desc" },
          include: {
            document: { select: { id: true, name: true, classification: true } },
            requestedBy: { select: { name: true } },
          },
          take: 20,
        }),
        prisma.document.count({ where: { caseId: { in: caseIds }, integrityStatus: "MISMATCH" } }),
      ]);
      return res.json({
        role,
        widgets: {
          supervisedCases: memberships.map((m) => m.case),
          pendingApprovals,
          integrityAlerts,
        },
      });
    }

    case "FORENSIC_OFFICER": {
      const evidence = await prisma.evidenceItem.findMany({
        where: { currentCustodianId: userId },
        orderBy: { updatedAt: "desc" },
        include: { case: { select: { caseNumber: true } } },
        take: 20,
      });
      return res.json({ role, widgets: { assignedEvidence: evidence } });
    }

    case "LEGAL_OFFICER": {
      const memberships = await prisma.caseMember.findMany({
        where: { userId },
        include: { case: true },
      });
      return res.json({
        role,
        widgets: { assignedCases: memberships.map((m) => m.case), myAccessRequests: await myRequests() },
      });
    }

    default:
      return res.status(403).json({ error: "Unknown role" });
  }
});

export default router;
