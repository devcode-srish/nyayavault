import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { prisma } from "../lib/prisma";

const router = Router();

// Every query below is scoped by userId from the verified token, so nobody
// can read or modify another user's notifications.

router.get("/", requireAuth, async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user!.sub },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return res.json({ notifications });
});

router.get("/unread-count", requireAuth, async (req, res) => {
  const count = await prisma.notification.count({
    where: { userId: req.user!.sub, isRead: false },
  });
  return res.json({ count });
});

router.post("/read-all", requireAuth, async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user!.sub, isRead: false },
    data: { isRead: true },
  });
  return res.json({ ok: true });
});

router.post("/:id/read", requireAuth, async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user!.sub },
    data: { isRead: true },
  });
  if (result.count === 0) return res.status(404).json({ error: "Notification not found" });
  return res.json({ ok: true });
});

export default router;
