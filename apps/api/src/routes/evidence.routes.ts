import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { accessibleCaseIds, userCanAccessCase } from "../lib/access";
import { notifyUsers } from "../lib/notify";
import { PackageCondition } from "@prisma/client";
import { recordAudit } from "../lib/audit";

const router = Router();

/**
 * Evidence access: Admin, anyone on the case, the current custodian, or
 * anyone who has ever held the item (they appear in its custody chain).
 */
async function userCanAccessEvidence(
  userId: string,
  role: string,
  ev: { id: string; caseId: string; currentCustodianId: string | null }
): Promise<boolean> {
  if (role === "ADMIN") return true;
  if (ev.currentCustodianId === userId) return true;
  if (await userCanAccessCase(userId, role, ev.caseId)) return true;
  const held = await prisma.evidenceTransfer.findFirst({
    where: { evidenceId: ev.id, OR: [{ fromUserId: userId }, { toUserId: userId }] },
    select: { id: true },
  });
  return !!held;
}

async function custodianMap(ids: Array<string | null>) {
  const clean = [...new Set(ids.filter((x): x is string => !!x))];
  const users = await prisma.user.findMany({
    where: { id: { in: clean } },
    select: { id: true, name: true, role: true },
  });
  return new Map(users.map((u) => [u.id, u]));
}

// GET /api/evidence - list visible evidence items
router.get("/", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;

  let where: any = {};
  if (role !== "ADMIN") {
    const caseIds = (await accessibleCaseIds(userId, role)) as string[];
    where = {
      OR: [
        { currentCustodianId: userId },
        { caseId: { in: caseIds } },
        { transfers: { some: { OR: [{ fromUserId: userId }, { toUserId: userId }] } } },
      ],
    };
  }

  const items = await prisma.evidenceItem.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      case: { select: { id: true, caseNumber: true, title: true } },
      _count: { select: { transfers: true } },
    },
  });
  const users = await custodianMap(items.map((i) => i.currentCustodianId));

  return res.json({
    evidence: items.map((i) => ({
      ...i,
      currentCustodian: i.currentCustodianId ? users.get(i.currentCustodianId) ?? null : null,
    })),
  });
});

// GET /api/evidence/transfers/pending - list pending custody transfers for the caller
router.get("/transfers/pending", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;

  let where: any = { status: "PENDING" };
  if (role !== "ADMIN") {
    where = {
      status: "PENDING",
      OR: [{ toUserId: userId }, { fromUserId: userId }],
    };
  }

  const transfers = await prisma.evidenceTransfer.findMany({
    where,
    orderBy: { transferredAt: "desc" },
    include: {
      evidence: {
        select: {
          id: true,
          name: true,
          status: true,
          case: { select: { id: true, caseNumber: true, title: true } },
        },
      },
      fromUser: { select: { id: true, name: true, role: true } },
      toUser: { select: { id: true, name: true, role: true } },
    },
  });

  return res.json({ transfers });
});

// POST /api/evidence/transfers/:transferId/accept - recipient explicitly accepts custody
router.post("/transfers/:transferId/accept", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { transferId } = req.params;

  const transfer = await prisma.evidenceTransfer.findUnique({
    where: { id: transferId },
    include: {
      evidence: { select: { id: true, name: true, caseId: true, currentCustodianId: true } },
      fromUser: { select: { id: true, name: true } },
    },
  });

  if (!transfer) return res.status(404).json({ error: "Transfer record not found" });

  if (role !== "ADMIN" && transfer.toUserId !== userId) {
    return res.status(403).json({ error: "Only the designated recipient (or an Admin) can accept this transfer" });
  }

  if (transfer.status !== "PENDING") {
    return res.status(409).json({ error: `Transfer is no longer pending (current status: ${transfer.status})` });
  }

  const now = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Atomic guard: transition transfer status from PENDING to ACCEPTED
      const updated = await tx.evidenceTransfer.updateMany({
        where: { id: transferId, status: "PENDING" },
        data: {
          status: "ACCEPTED",
          decidedAt: now,
        },
      });

      if (updated.count === 0) {
        throw new Error("ALREADY_DECIDED");
      }

      // 2. Transfer the actual custody to recipient
      await tx.evidenceItem.update({
        where: { id: transfer.evidenceId },
        data: {
          currentCustodianId: transfer.toUserId,
        },
      });

      // 3. Transactionally consistent audit log creation
      await recordAudit(
        {
          action: "EVIDENCE_TRANSFERRED",
          actorId: userId,
          evidenceId: transfer.evidenceId,
          caseId: transfer.evidence.caseId,
          targetUserId: transfer.toUserId,
          notes: `Custody of "${transfer.evidence.name}" accepted by recipient. Package condition: ${transfer.packageCondition}${transfer.sealNumber ? ", Seal: " + transfer.sealNumber : ""}`,
        },
        tx
      );
    });
  } catch (err) {
    if (err instanceof Error && err.message === "ALREADY_DECIDED") {
      return res.status(409).json({ error: "Transfer has already been accepted, rejected, or cancelled" });
    }
    throw err;
  }

  if (transfer.fromUserId) {
    await notifyUsers([transfer.fromUserId], {
      type: "GENERAL",
      title: "Custody transfer accepted",
      message: `Custody of "${transfer.evidence.name}" has been accepted by the recipient.`,
    });
  }

  return res.json({ ok: true, status: "ACCEPTED", transferredAt: now });
});

const rejectSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

// POST /api/evidence/transfers/:transferId/reject - recipient rejects custody transfer
router.post("/transfers/:transferId/reject", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { transferId } = req.params;

  const parsed = rejectSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid rejection parameters" });
  }

  const transfer = await prisma.evidenceTransfer.findUnique({
    where: { id: transferId },
    include: {
      evidence: { select: { id: true, name: true, caseId: true } },
    },
  });

  if (!transfer) return res.status(404).json({ error: "Transfer record not found" });

  if (role !== "ADMIN" && transfer.toUserId !== userId) {
    return res.status(403).json({ error: "Only the designated recipient (or an Admin) can reject this transfer" });
  }

  if (transfer.status !== "PENDING") {
    return res.status(409).json({ error: `Transfer is no longer pending (current status: ${transfer.status})` });
  }

  const now = new Date();
  const reason = parsed.data.reason || "Rejected by designated recipient";

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.evidenceTransfer.updateMany({
        where: { id: transferId, status: "PENDING" },
        data: {
          status: "REJECTED",
          rejectionReason: reason,
          decidedAt: now,
        },
      });

      if (updated.count === 0) {
        throw new Error("ALREADY_DECIDED");
      }

      await recordAudit(
        {
          action: "EVIDENCE_TRANSFERRED",
          actorId: userId,
          evidenceId: transfer.evidenceId,
          caseId: transfer.evidence.caseId,
          targetUserId: transfer.fromUserId ?? undefined,
          notes: `Custody transfer of "${transfer.evidence.name}" rejected: ${reason}`,
        },
        tx
      );
    });
  } catch (err) {
    if (err instanceof Error && err.message === "ALREADY_DECIDED") {
      return res.status(409).json({ error: "Transfer has already been decided" });
    }
    throw err;
  }

  if (transfer.fromUserId) {
    await notifyUsers([transfer.fromUserId], {
      type: "GENERAL",
      title: "Custody transfer rejected",
      message: `Custody transfer of "${transfer.evidence.name}" was rejected: ${reason}`,
    });
  }

  return res.json({ ok: true, status: "REJECTED" });
});

// POST /api/evidence/transfers/:transferId/cancel - sender cancels pending transfer
router.post("/transfers/:transferId/cancel", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { transferId } = req.params;

  const transfer = await prisma.evidenceTransfer.findUnique({
    where: { id: transferId },
    include: {
      evidence: { select: { id: true, name: true, caseId: true } },
    },
  });

  if (!transfer) return res.status(404).json({ error: "Transfer record not found" });

  if (role !== "ADMIN" && transfer.fromUserId !== userId) {
    return res.status(403).json({ error: "Only the initiating sender (or an Admin) can cancel this transfer" });
  }

  if (transfer.status !== "PENDING") {
    return res.status(409).json({ error: `Transfer is no longer pending (current status: ${transfer.status})` });
  }

  const now = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.evidenceTransfer.updateMany({
        where: { id: transferId, status: "PENDING" },
        data: {
          status: "CANCELLED",
          decidedAt: now,
        },
      });

      if (updated.count === 0) {
        throw new Error("ALREADY_DECIDED");
      }

      await recordAudit(
        {
          action: "EVIDENCE_TRANSFERRED",
          actorId: userId,
          evidenceId: transfer.evidenceId,
          caseId: transfer.evidence.caseId,
          targetUserId: transfer.toUserId,
          notes: `Custody transfer of "${transfer.evidence.name}" cancelled by sender`,
        },
        tx
      );
    });
  } catch (err) {
    if (err instanceof Error && err.message === "ALREADY_DECIDED") {
      return res.status(409).json({ error: "Transfer has already been decided" });
    }
    throw err;
  }

  return res.json({ ok: true, status: "CANCELLED" });
});

// GET /api/evidence/:id - detail, custodian, and complete transfer history
router.get("/:id", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const item = await prisma.evidenceItem.findUnique({
    where: { id: req.params.id },
    include: {
      case: { select: { id: true, caseNumber: true, title: true } },
      transfers: {
        orderBy: { transferredAt: "asc" },
        include: {
          fromUser: { select: { id: true, name: true, role: true } },
          toUser: { select: { id: true, name: true, role: true } },
        },
      },
    },
  });
  if (!item) return res.status(404).json({ error: "Evidence not found" });

  if (!(await userCanAccessEvidence(userId, role, item))) {
    return res.status(403).json({ error: "You do not have access to this evidence item" });
  }

  const users = await custodianMap([item.currentCustodianId]);
  const pendingTransfer = item.transfers.find((t) => t.status === "PENDING") || null;

  return res.json({
    evidence: {
      ...item,
      currentCustodian: item.currentCustodianId ? users.get(item.currentCustodianId) ?? null : null,
    },
    pendingTransfer,
    canTransfer: (role === "ADMIN" || item.currentCustodianId === userId) && !pendingTransfer,
    canAccept: pendingTransfer ? (role === "ADMIN" || pendingTransfer.toUserId === userId) : false,
    canReject: pendingTransfer ? (role === "ADMIN" || pendingTransfer.toUserId === userId) : false,
    canCancel: pendingTransfer ? (role === "ADMIN" || pendingTransfer.fromUserId === userId) : false,
  });
});

const createSchema = z.object({
  caseId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
});

// POST /api/evidence - Log a new evidence item
router.post(
  "/",
  requireAuth,
  requireRole("ADMIN", "INVESTIGATING_OFFICER", "SENIOR_OFFICER", "FORENSIC_OFFICER"),
  async (req, res) => {
    const { sub: userId, role } = req.user!;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    const { caseId, name, description } = parsed.data;

    if (!(await userCanAccessCase(userId, role, caseId))) {
      return res.status(403).json({ error: "You do not have access to this case" });
    }
    const caseExists = await prisma.case.findUnique({ where: { id: caseId } });
    if (!caseExists) return res.status(404).json({ error: "Case not found" });

    let item: any;
    await prisma.$transaction(async (tx) => {
      item = await tx.evidenceItem.create({
        data: {
          caseId,
          name,
          description,
          status: "COLLECTED",
          currentCustodianId: userId,
          transfers: {
            create: {
              fromUserId: null,
              toUserId: userId,
              status: "COMPLETED",
              packageCondition: "SEALED_INTACT",
              notes: "Evidence logged - initial custody",
            },
          },
        },
      });

      await recordAudit(
        {
          action: "EVIDENCE_TRANSFERRED",
          actorId: userId,
          evidenceId: item.id,
          caseId,
          targetUserId: userId,
          notes: `Evidence "${name}" logged (initial custody)`,
        },
        tx
      );
    });

    return res.status(201).json({ evidence: item });
  }
);

const transferSchema = z.object({
  toUserId: z.string().min(1),
  purpose: z.string().trim().max(300).optional(),
  sealNumber: z.string().trim().max(100).optional(),
  packageCondition: z
    .enum(["SEALED_INTACT", "SEAL_BROKEN", "DAMAGED", "OPENED_FOR_EXAMINATION", "RE_SEALED"])
    .default("SEALED_INTACT"),
  location: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
});

// POST /api/evidence/:id/transfer - initiate a two-step custody transfer
router.post("/:id/transfer", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id } = req.params;

  const parsed = transferSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  }
  const { toUserId, purpose, sealNumber, packageCondition, location, notes } = parsed.data;

  const item = await prisma.evidenceItem.findUnique({ where: { id } });
  if (!item) return res.status(404).json({ error: "Evidence not found" });

  if (!(await userCanAccessEvidence(userId, role, item))) {
    return res.status(403).json({ error: "You do not have access to this evidence item" });
  }

  // Only the current custodian (or Admin) can initiate a transfer.
  if (role !== "ADMIN" && item.currentCustodianId !== userId) {
    return res.status(403).json({ error: "Only the current custodian (or an Admin) can transfer this evidence" });
  }

  // State-transition invariant: Prevent self-transfer even for Admin
  if (toUserId === item.currentCustodianId) {
    return res.status(400).json({ error: "This evidence is already in that person's custody" });
  }

  const target = await prisma.user.findUnique({ where: { id: toUserId } });
  if (!target || !target.isActive) {
    return res.status(400).json({ error: "Invalid recipient" });
  }

  let transfer: any;
  try {
    await prisma.$transaction(async (tx) => {
      // Prevent multiple simultaneous pending transfers for the same evidence item
      const existingPending = await tx.evidenceTransfer.findFirst({
        where: { evidenceId: id, status: "PENDING" },
      });
      if (existingPending) {
        throw new Error("ALREADY_PENDING");
      }

      // Create the transfer record in PENDING status.
      // Note: item.currentCustodianId is deliberately NOT changed yet (Option A Two-Step Handshake).
      transfer = await tx.evidenceTransfer.create({
        data: {
          evidenceId: id,
          fromUserId: item.currentCustodianId,
          toUserId: target.id,
          status: "PENDING",
          purpose,
          sealNumber,
          packageCondition: packageCondition as PackageCondition,
          location,
          notes,
        },
      });

      await recordAudit(
        {
          action: "EVIDENCE_TRANSFERRED",
          actorId: userId,
          evidenceId: id,
          caseId: item.caseId,
          targetUserId: target.id,
          notes: `Custody transfer of "${item.name}" initiated to ${target.name} (pending acceptance). Seal: ${sealNumber || "N/A"}, Condition: ${packageCondition}`,
        },
        tx
      );
    });
  } catch (err) {
    if (err instanceof Error && err.message === "ALREADY_PENDING") {
      return res.status(409).json({ error: "There is already an active pending transfer for this evidence item" });
    }
    throw err;
  }

  await notifyUsers([target.id], {
    type: "GENERAL",
    title: "Evidence custody transfer pending",
    message: `Custody transfer of "${item.name}" has been initiated for you to accept or reject.`,
  });

  return res.status(201).json({ ok: true, transfer });
});

export default router;
