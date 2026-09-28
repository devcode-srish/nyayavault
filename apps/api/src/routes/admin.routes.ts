import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { runAdvisoryLockedExpirySweep } from "../jobs/scheduler";
import { recordAudit } from "../lib/audit";

const router = Router();

/**
 * POST /api/admin/tasks/run-expiry
 * Restricted to ADMIN role.
 * Triggers an immediate advisory-locked expiry sweep across grants, share links, and access requests.
 */
router.post("/tasks/run-expiry", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const outcome = await runAdvisoryLockedExpirySweep();

    if (!outcome.executed) {
      return res.status(409).json({
        ok: false,
        error: "Expiry sweep already in progress by another worker",
        reason: outcome.reason,
      });
    }

    // Record audit entry for supervisory admin trigger
    await recordAudit({
      action: "INTEGRITY_CHECK",
      actorId: req.user!.sub,
      notes: `Administrative manual expiry sweep executed (grants: ${outcome.result?.accessGrants.processed}, shares: ${outcome.result?.shareLinks.processed}, requests: ${outcome.result?.accessRequests.processed})`,
      metadata: {
        manualTrigger: true,
        sweepResult: outcome.result as any,
      },
    });

    return res.json({
      ok: true,
      sweep: outcome.result,
    });
  } catch (err: any) {
    console.error("Admin expiry sweep failed:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Internal server error" });
  }
});

export default router;
