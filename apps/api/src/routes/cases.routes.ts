import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { accessibleCaseIds, userCanAccessCase, annotateDocumentAccess } from "../lib/access";

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

export default router;
