import { Router } from "express";
import { z } from "zod";
import { AccessScope } from "@prisma/client";
import { requireAuth, requireRole } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { userCanAccessDocument, canDecideForCase, accessibleCaseIds } from "../lib/access";
import { recordAudit } from "../lib/audit";
import { notifyUsers, approverIdsForCase } from "../lib/notify";

const router = Router();

const scopeEnum = z.enum([
  "VIEW_METADATA",
  "PREVIEW",
  "DOWNLOAD",
  "SHARE",
  "TRANSFER_CUSTODY",
]);

const createSchema = z.object({
  documentId: z.string().min(1),
  reason: z.string().trim().min(5, "Please give a reason (at least 5 characters)").max(500),
  durationHours: z.number().int().min(1).max(24 * 30).default(24),
  courtOrderRef: z.string().trim().max(100).optional(),
  requestedScopes: z.array(scopeEnum).min(1).default(["VIEW_METADATA", "PREVIEW", "DOWNLOAD"]),
});

// POST /api/access-requests — ask for access to a document you can't open.
router.post("/", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message || "Invalid request";
    return res.status(400).json({ error: msg });
  }
  const { documentId, reason, durationHours, courtOrderRef, requestedScopes } = parsed.data;

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { case: { select: { caseNumber: true } } },
  });
  if (!document) return res.status(404).json({ error: "Document not found" });

  if (await userCanAccessDocument(userId, role, document, "DOWNLOAD")) {
    return res.status(409).json({ error: "You already have full access to this document" });
  }

  const pending = await prisma.accessRequest.findFirst({
    where: { documentId, requestedById: userId, status: "PENDING" },
  });
  if (pending) {
    return res.status(409).json({ error: "You already have a pending request for this document" });
  }

  const request = await prisma.accessRequest.create({
    data: {
      documentId,
      requestedById: userId,
      reason,
      durationHours,
      courtOrderRef,
      requestedScopes: requestedScopes as AccessScope[],
    },
  });

  await recordAudit({
    action: "ACCESS_REQUESTED",
    actorId: userId,
    documentId,
    caseId: document.caseId,
    notes: `Requested access (${requestedScopes.join(", ")}) for ${durationHours}h: ${reason}${courtOrderRef ? " [Court Ref: " + courtOrderRef + "]" : ""}`,
  });

  const requester = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  const approvers = (await approverIdsForCase(document.caseId)).filter((id) => id !== userId);
  await notifyUsers(approvers, {
    type: "ACCESS_REQUEST",
    title: "New access request",
    message: `${requester?.name ?? "A user"} requested access to "${document.name}" (${document.case.caseNumber}) for ${durationHours}h.`,
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
  expiresInHours: z.number().int().min(1).max(24 * 30).optional(),
  grantedScopes: z.array(scopeEnum).min(1).optional(),
  decisionNotes: z.string().trim().max(500).optional(),
});

// POST /api/access-requests/:id/approve - approve a pending request and create active grant
router.post("/:id/approve", requireAuth, requireRole("SENIOR_OFFICER", "ADMIN"), async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id } = req.params;

  const parsed = approveSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid parameters" });

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

  const hours = parsed.data.expiresInHours ?? request.durationHours ?? 24;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const grantedScopes = (parsed.data.grantedScopes ?? request.requestedScopes) as AccessScope[];
  const decisionNotes = parsed.data.decisionNotes ?? undefined;

  let createdGrantId = "";
  try {
    await prisma.$transaction(async (tx) => {
      // 1. Create the new historical DocumentAccess grant record
      const grant = await tx.documentAccess.create({
        data: {
          documentId: request.documentId,
          userId: request.requestedById,
          grantedById: userId,
          scopes: grantedScopes,
          expiresAt,
          isActive: true,
        },
      });
      createdGrantId = grant.id;

      // 2. Atomic guard: Update access request with decision & link to grant
      const updated = await tx.accessRequest.updateMany({
        where: { id, status: "PENDING" },
        data: {
          status: "APPROVED",
          decidedById: userId,
          decidedAt: new Date(),
          decisionNotes,
          expiresAt,
          accessGrantId: grant.id,
        },
      });
      if (updated.count === 0) throw new Error("ALREADY_DECIDED");
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
    notes: `Temporary access (${grantedScopes.join(", ")}) granted for ${hours}h (until ${expiresAt.toISOString()})${decisionNotes ? " [Note: " + decisionNotes + "]" : ""}`,
  });

  await notifyUsers([request.requestedById], {
    type: "ACCESS_APPROVED",
    title: "Access approved",
    message: `Your request for "${request.document.name}" was approved for ${hours}h. Access expires ${expiresAt.toLocaleString()}.`,
  });

  return res.json({ ok: true, grantId: createdGrantId, expiresAt });
});

const rejectSchema = z.object({ note: z.string().trim().max(300).optional() });

// POST /api/access-requests/:id/reject - reject a pending request
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
    data: {
      status: "REJECTED",
      decidedById: userId,
      decidedAt: new Date(),
      decisionNotes: parsed.data.note,
    },
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

const revokeSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

// POST /api/access-requests/grants/:id/revoke - immediately revoke an active grant
router.post("/grants/:id/revoke", requireAuth, requireRole("SENIOR_OFFICER", "ADMIN"), async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id } = req.params;

  const parsed = revokeSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid revoke parameters" });

  const grant = await prisma.documentAccess.findUnique({
    where: { id },
    include: { document: { select: { id: true, name: true, caseId: true } } },
  });
  if (!grant) return res.status(404).json({ error: "Grant not found" });
  if (!grant.isActive) return res.status(409).json({ error: "Grant is already inactive or revoked" });

  if (role !== "ADMIN" && grant.grantedById !== userId && !(await canDecideForCase(userId, role, grant.document.caseId))) {
    return res.status(403).json({ error: "You do not have authority to revoke this grant" });
  }

  const now = new Date();
  const revokeReason = parsed.data.reason || "Revoked by supervisor";

  await prisma.documentAccess.update({
    where: { id },
    data: {
      isActive: false,
      revokedAt: now,
      revokedById: userId,
      revokeReason,
    },
  });

  await recordAudit({
    action: "ACCESS_REJECTED",
    actorId: userId,
    documentId: grant.documentId,
    caseId: grant.document.caseId,
    targetUserId: grant.userId,
    notes: `Access revoked early by ${role}: ${revokeReason}`,
  });

  await notifyUsers([grant.userId], {
    type: "ACCESS_REJECTED",
    title: "Access Revoked",
    message: `Your temporary access to "${grant.document.name}" has been revoked: ${revokeReason}`,
  });

  return res.json({ ok: true, revokedAt: now });
});

// GET /api/access-requests/grants/active - list active grants
router.get("/grants/active", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const now = new Date();

  let where: any = {
    isActive: true,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };

  if (role !== "ADMIN") {
    if (role === "SENIOR_OFFICER") {
      const ids = (await accessibleCaseIds(userId, role)) as string[];
      where = {
        ...where,
        OR: [{ userId }, { grantedById: userId }, { document: { caseId: { in: ids } } }],
      };
    } else {
      where = { ...where, userId };
    }
  }

  const grants = await prisma.documentAccess.findMany({
    where,
    orderBy: { grantedAt: "desc" },
    include: {
      document: { select: { id: true, name: true, classification: true, caseId: true } },
      user: { select: { id: true, name: true, role: true } },
      grantedBy: { select: { id: true, name: true } },
    },
  });

  return res.json({ grants });
});

export default router;
