import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { prisma } from "../lib/prisma";

const router = Router();

// Only ADMIN may list users. Calling this with any other role's valid
// token returns 403 — try it with the officer/senior/forensic/legal demo
// accounts to see backend RBAC enforced, not just hidden in the sidebar.
router.get("/", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return res.json({ users });
});

export default router;
