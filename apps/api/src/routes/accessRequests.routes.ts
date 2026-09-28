import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { userCanAccessDocument, canDecideForCase, accessibleCaseIds } from "../lib/access";
import { recordAudit } from "../lib/audit";
import { notifyUsers, approverIdsForCase } from "../lib/notify";

const router = Router();

const createSchema = z.object({
  documentId: z.string().min(1),
  reason: z.string().trim().min(5, "Please give a reason (at least 5 characters)").max(500),
});

// POST /api/access-requests — ask for access to a document you can't open.
router.post("/", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message || "Invalid request";
    return res.status(400).json({ error: msg });
  }
  const { documentId, reason } = parsed.data;

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { case: { select: { caseNumber: true } } },
  });
  if (!document) return res.status(404).json({ error: "Document not found" });

  if (await userCanAccessDocument(userId, role, document)) {
    return res.status(409).json({ error: "You already have access to this document" });
  }

  const pending = await prisma.accessRequest.findFirst({
    where: { documentId, requestedById: userId, status: "PENDING" },
  });
  if (pending) {
    return res.status(409).json({ error: "You already have a pending request for this document" });
  }

  const request = await prisma.accessRequest.create({
    data: { documentId, requestedById: userId, reason },
  });

  await recordAudit({
    action: "ACCESS_REQUESTED",
    actorId: userId,
    documentId,
    caseId: document.caseId,
    notes: `Requested access: ${reason}`,
  });

  const requester = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  const approvers = (await approverIdsForCase(document.caseId)).filter((id) => id !== userId);
  await notifyUsers(approvers, {
    type: "ACCESS_REQUEST",
    title: "New access request",
    message: `${requester?.name ?? "A user"} requested access to "${document.name}" (${document.case.caseNumber}).`,
  });

  return res.status(201).json({ request });
});

// GET /api/access-requests
//  - Admin: every request
//  - Senior Officer: requests for documents in cases they supervise + their own
//  - Everyone else: only their own requests
router.get("/", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;

  let where: any;
  if (role === "ADMIN") {
    where = {};
  } else if (role === "SENIOR_OFFICER") {
    const ids = (await accessibleCaseIds(userId, role)) as string[];
    where = { OR: [{ requestedById: userId }, { document: { caseId: { in: ids } } }] };
  } else {
    where = { requestedById: userId };
  }

  const requests = await prisma.accessRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      document: {
        select: {
          id: true,
          name: true,
          classification: true,
          caseId: true,
          case: { select: { caseNumber: true } },
        },
      },
      requestedBy: { select: { name: true, role: true } },
      decidedBy: { select: { name: true } },
    },
  });

  const now = new Date();
  const result = requests.map((r) => {
    const expired = r.status === "APPROVED" && r.expiresAt !== null && r.expiresAt < now;
    const canDecide =
      r.status === "PENDING" &&
      r.requestedById !== userId &&
      (role === "ADMIN" || role === "SENIOR_OFFICER");
    return { ...r, status: expired ? "EXPIRED" : r.status, canDecide };
  });

  return res.json({ requests: result });
});

const approveSchema = z.object({
  expiresInHours: z.number().int().min(1).max(24 * 30).default(24),
});

router.post("/:id/approve", requireAuth, requireRole("SENIOR_OFFICER", "ADMIN"), async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id } = req.params;

  const parsed = approveSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid expiry" });
  const { expiresInHours } = parsed.data;

  const request = await prisma.accessRequest.findUnique({
    where: { id },
    include: { document: { select: { id: true, name: true, caseId: true } } },
  });
  if (!request) return res.status(404).json({ error: "Request not found" });
  if (request.requestedById === userId) {
    return res.status(403).json({ error: "You cannot decide your own request" });
  }
  if (!(await canDecideForCase(userId, role, request.document.caseId))) {
    return res.status(403).json({ error: "You do not supervise the case this document belongs to" });
  }
  if (request.status !== "PENDING") {
    return res.status(409).json({ error: "This request has already been decided" });
  }

  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  try {
    await prisma.$transaction(async (tx) => {
      // The status guard makes a double-click / two approvers safe: only one wins.
      const updated = await tx.accessRequest.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "APPROVED", decidedById: userId, decidedAt: new Date(), expiresAt },
      });
      if (updated.count === 0) throw new Error("ALREADY_DECIDED");

      await tx.documentAccess.create({
        data: {
          documentId: request.documentId,
          userId: request.requestedById,
          grantedById: userId,
          expiresAt,
          isActive: true,
        },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ALREADY_DECIDED") {
      return res.status(409).json({ error: "This request has already been decided" });
    }
    throw e;
  }

  await recordAudit({
    action: "ACCESS_APPROVED",
    actorId: userId,
    documentId: request.documentId,
    caseId: request.document.caseId,
    targetUserId: request.requestedById,
    notes: `Temporary access granted for ${expiresInHours}h (until ${expiresAt.toISOString()})`,
  });

  await notifyUsers([request.requestedById], {
    type: "ACCESS_APPROVED",
    title: "Access approved",
    message: `Your request for "${request.document.name}" was approved. Access expires ${expiresAt.toLocaleString()}.`,
  });

  return res.json({ ok: true, expiresAt });
});

const rejectSchema = z.object({ note: z.string().trim().max(300).optional() });

router.post("/:id/reject", requireAuth, requireRole("SENIOR_OFFICER", "ADMIN"), async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id } = req.params;

  const parsed = rejectSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid note" });

  const request = await prisma.accessRequest.findUnique({
    where: { id },
    include: { document: { select: { id: true, name: true, caseId: true } } },
  });
  if (!request) return res.status(404).json({ error: "Request not found" });
  if (request.requestedById === userId) {
    return res.status(403).json({ error: "You cannot decide your own request" });
  }
  if (!(await canDecideForCase(userId, role, request.document.caseId))) {
    return res.status(403).json({ error: "You do not supervise the case this document belongs to" });
  }

  const updated = await prisma.accessRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "REJECTED", decidedById: userId, decidedAt: new Date() },
  });
  if (updated.count === 0) {
    return res.status(409).json({ error: "This request has already been decided" });
  }

  await recordAudit({
    action: "ACCESS_REJECTED",
    actorId: userId,
    documentId: request.documentId,
    caseId: request.document.caseId,
    targetUserId: request.requestedById,
    notes: parsed.data.note ? `Rejected: ${parsed.data.note}` : "Rejected",
  });

  await notifyUsers([request.requestedById], {
    type: "ACCESS_REJECTED",
    title: "Access rejected",
    message: `Your request for "${request.document.name}" was rejected.${parsed.data.note ? " Note: " + parsed.data.note : ""}`,
  });

  return res.json({ ok: true });
});

export default router;
