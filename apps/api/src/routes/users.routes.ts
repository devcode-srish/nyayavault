import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { prisma } from "../lib/prisma";

const router = Router();

// Only ADMIN may list full user records. Calling this with any other role's
// valid token returns 403.
router.get("/", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return res.json({ users });
});

// Minimal directory (name + role only, no email) so any signed-in user can
// pick a recipient, e.g. when transferring evidence.
router.get("/directory", requireAuth, async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  return res.json({ users });
});

export default router;
