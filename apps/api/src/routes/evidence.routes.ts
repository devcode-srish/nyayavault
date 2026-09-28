import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { accessibleCaseIds, userCanAccessCase } from "../lib/access";
import { recordAudit } from "../lib/audit";
import { notifyUsers } from "../lib/notify";

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

router.get("/:id", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const item = await prisma.evidenceItem.findUnique({
    where: { id: req.params.id },
    include: {
      case: { select: { id: true, caseNumber: true, title: true } },
      transfers: {
        orderBy: { transferredAt: "asc" },
        include: {
          fromUser: { select: { name: true, role: true } },
          toUser: { select: { name: true, role: true } },
        },
      },
    },
  });
  if (!item) return res.status(404).json({ error: "Evidence not found" });

  if (!(await userCanAccessEvidence(userId, role, item))) {
    return res.status(403).json({ error: "You do not have access to this evidence item" });
  }

  const users = await custodianMap([item.currentCustodianId]);
  return res.json({
    evidence: {
      ...item,
      currentCustodian: item.currentCustodianId ? users.get(item.currentCustodianId) ?? null : null,
    },
    canTransfer: role === "ADMIN" || item.currentCustodianId === userId,
  });
});

const createSchema = z.object({
  caseId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
});

// Logging a new evidence item starts its chain of custody: the first
// transfer record goes from "nobody" to the person who logged it.
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

    const item = await prisma.evidenceItem.create({
      data: {
        caseId,
        name,
        description,
        status: "COLLECTED",
        currentCustodianId: userId,
        transfers: {
          create: { fromUserId: null, toUserId: userId, notes: "Evidence logged - initial custody" },
        },
      },
    });

    await recordAudit({
      action: "EVIDENCE_TRANSFERRED",
      actorId: userId,
      caseId,
      targetUserId: userId,
      notes: `Evidence "${name}" logged (initial custody)`,
    });

    return res.status(201).json({ evidence: item });
  }
);

const transferSchema = z.object({
  toUserId: z.string().min(1),
  notes: z.string().trim().max(300).optional(),
});

router.post("/:id/transfer", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id } = req.params;

  const parsed = transferSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body" });
  const { toUserId, notes } = parsed.data;

  const item = await prisma.evidenceItem.findUnique({ where: { id } });
  if (!item) return res.status(404).json({ error: "Evidence not found" });

  if (!(await userCanAccessEvidence(userId, role, item))) {
    return res.status(403).json({ error: "You do not have access to this evidence item" });
  }
  // Only the person who currently holds the item can hand it over.
  if (role !== "ADMIN" && item.currentCustodianId !== userId) {
    return res.status(403).json({ error: "Only the current custodian (or an Admin) can transfer this evidence" });
  }

  const target = await prisma.user.findUnique({ where: { id: toUserId } });
  if (!target || !target.isActive) return res.status(400).json({ error: "Invalid recipient" });
  if (target.id === item.currentCustodianId) {
    return res.status(400).json({ error: "This evidence is already in that person's custody" });
  }

  await prisma.$transaction([
    prisma.evidenceTransfer.create({
      data: { evidenceId: id, fromUserId: item.currentCustodianId, toUserId: target.id, notes },
    }),
    prisma.evidenceItem.update({ where: { id }, data: { currentCustodianId: target.id } }),
  ]);

  await recordAudit({
    action: "EVIDENCE_TRANSFERRED",
    actorId: userId,
    caseId: item.caseId,
    targetUserId: target.id,
    notes: `"${item.name}" transferred${notes ? ": " + notes : ""}`,
  });

  await notifyUsers([target.id], {
    type: "GENERAL",
    title: "Evidence transferred to you",
    message: `Custody of "${item.name}" has been transferred to you.`,
  });

  return res.json({ ok: true });
});

export default router;
