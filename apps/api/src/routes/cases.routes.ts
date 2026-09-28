import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { accessibleCaseIds, userCanAccessCase, annotateDocumentAccess } from "../lib/access";
import { getCaseTimeline, createInvestigationNote } from "../services/timeline.service";

const router = Router();

// GET /api/cases — Admin sees every case; everyone else sees only cases
// they are a CaseMember of. This is enforced here, not just filtered in
// the UI — calling this with a non-member's token never returns cases
// they aren't assigned to.
router.get("/", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const ids = await accessibleCaseIds(userId, role);

  const cases = await prisma.case.findMany({
    where: ids === "ALL" ? {} : { id: { in: ids } },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { documents: true, members: true, evidenceItems: true } },
    },
  });

  return res.json({ cases });
});

router.get("/:id", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id } = req.params;

  const allowed = await userCanAccessCase(userId, role, id);
  if (!allowed) {
    return res.status(403).json({ error: "You do not have access to this case" });
  }

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    include: {
      members: { include: { user: { select: { id: true, name: true, role: true } } } },
      documents: {
        orderBy: { updatedAt: "desc" },
        include: { uploadedBy: { select: { name: true } } },
      },
    },
  });

  if (!caseRecord) {
    return res.status(404).json({ error: "Case not found" });
  }

  // Restricted documents are listed but flagged canAccess=false so the UI can
  // show a lock. The API still refuses to open them (see documents.routes.ts).
  const documents = await annotateDocumentAccess(userId, role, caseRecord.documents);
  return res.json({ case: { ...caseRecord, documents } });
});

/**
 * GET /api/cases/:id/timeline
 * Unified chronological investigation timeline with deterministic pagination and filtering.
 */
router.get("/:id/timeline", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id: caseId } = req.params;
  const { category, source, isMilestone, dateFrom, dateTo, search, order, page, limit } = req.query as Record<
    string,
    string | undefined
  >;

  const result = await getCaseTimeline(caseId, userId, role, {
    category: category as any,
    source: source as any,
    isMilestone: isMilestone !== undefined ? isMilestone === "true" : undefined,
    dateFrom,
    dateTo,
    search,
    order: order === "asc" ? "asc" : "desc",
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 25,
  });

  if (!result.success) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.json(result.data);
});

/**
 * POST /api/cases/:id/timeline
 * Records a manual investigation note or milestone with immutable audit trail.
 */
router.post("/:id/timeline", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id: caseId } = req.params;
  const { title, description, category, occurredAt, isMilestone, metadata } = req.body || {};

  const result = await createInvestigationNote({
    caseId,
    userId,
    userRole: role,
    title,
    description,
    category,
    occurredAt,
    isMilestone,
    metadata,
  });

  if (!result.success) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.status(201).json({ event: result.event });
});

export default router;
