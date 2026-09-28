import { prisma } from "../lib/prisma";
import { recordAudit } from "../lib/audit";
import { notifyUsers } from "../lib/notify";

export interface SweepMetric {
  processed: number;
  failed: number;
  errors: string[];
}

export interface ExpirySweepResult {
  timestamp: string;
  accessGrants: SweepMetric;
  shareLinks: SweepMetric;
  accessRequests: SweepMetric;
}

/**
 * Sweeps expired document access grants.
 * For each expired grant:
 * 1. Atomically updates isActive=false, revokedAt=now, revokeReason="EXPIRED_AUTOMATIC".
 * 2. Emits audit log entry via recordAudit (SYSTEM actor, action ACCESS_REJECTED).
 * 3. Sends notification to the granted user.
 */
export async function sweepDocumentAccessExpiries(now: Date = new Date()): Promise<SweepMetric> {
  const metric: SweepMetric = { processed: 0, failed: 0, errors: [] };

  try {
    const candidates = await prisma.documentAccess.findMany({
      where: {
        isActive: true,
        expiresAt: { lte: now, not: null },
      },
      select: {
        id: true,
        documentId: true,
        userId: true,
        expiresAt: true,
        document: { select: { name: true, caseId: true } },
      },
      take: 100,
    });

    for (const grant of candidates) {
      try {
        await prisma.$transaction(async (tx) => {
          // Conditional atomic update to prevent double-processing
          const updateRes = await tx.documentAccess.updateMany({
            where: { id: grant.id, isActive: true },
            data: {
              isActive: false,
              revokedAt: now,
              revokeReason: "EXPIRED_AUTOMATIC",
            },
          });

          if (updateRes.count === 0) return;

          // Record audit log
          await recordAudit(
            {
              action: "ACCESS_REJECTED",
              actorId: null,
              documentId: grant.documentId,
              caseId: grant.document?.caseId || null,
              targetUserId: grant.userId,
              notes: `Temporary access grant expired automatically (elapsed at ${grant.expiresAt?.toISOString()})`,
              metadata: {
                automated: true,
                job: "DOCUMENT_ACCESS_EXPIRY",
                grantId: grant.id,
                originalExpiresAt: grant.expiresAt?.toISOString() || null,
                expiredAt: now.toISOString(),
              },
            },
            tx
          );

          // Dispatch notification
          await notifyUsers(
            [grant.userId],
            {
              type: "ACCESS_REJECTED",
              title: "Document Access Expired",
              message: `Your temporary access to "${grant.document?.name || "Document"}" has expired.`,
              priority: "MEDIUM",
              category: "ACCESS_EXPIRY",
              actionUrl: `/documents/${grant.documentId}`,
            },
            tx
          );
        });

        metric.processed++;
      } catch (err: any) {
        metric.failed++;
        metric.errors.push(`Grant ${grant.id}: ${err?.message || String(err)}`);
      }
    }
  } catch (err: any) {
    metric.errors.push(`Query failure in documentAccess sweep: ${err?.message || String(err)}`);
  }

  return metric;
}

/**
 * Sweeps expired or exhausted secure share links.
 * For each expired/exhausted share link:
 * 1. Atomically sets isRevoked=true.
 * 2. Emits audit log entry via recordAudit (SYSTEM actor, action DOCUMENT_SHARED).
 * 3. Sends notification to the creator.
 */
export async function sweepShareLinkExpiries(now: Date = new Date()): Promise<SweepMetric> {
  const metric: SweepMetric = { processed: 0, failed: 0, errors: [] };

  try {
    const candidates = await prisma.shareLink.findMany({
      where: {
        isRevoked: false,
      },
      select: {
        id: true,
        documentId: true,
        createdById: true,
        expiresAt: true,
        maxUses: true,
        useCount: true,
        document: { select: { name: true, caseId: true } },
      },
      take: 100,
    });

    // Filter to expired or max-usage reached (handling null/unlimited maxUses safely)
    const toExpire = candidates.filter((link) => {
      const isTimeExpired = link.expiresAt <= now;
      const isUsageExhausted = link.maxUses != null && link.useCount >= link.maxUses;
      return isTimeExpired || isUsageExhausted;
    });

    for (const link of toExpire) {
      try {
        await prisma.$transaction(async (tx) => {
          const updateRes = await tx.shareLink.updateMany({
            where: { id: link.id, isRevoked: false },
            data: { isRevoked: true },
          });

          if (updateRes.count === 0) return;

          const isTimeExpired = link.expiresAt <= now;
          const reason = isTimeExpired ? "EXPIRED" : "EXHAUSTED";
          const reasonDesc =
            reason === "EXPIRED"
              ? `expired at ${link.expiresAt.toISOString()}`
              : `reached maximum usage limit (${link.useCount}/${link.maxUses})`;

          await recordAudit(
            {
              action: "DOCUMENT_SHARED",
              actorId: null,
              documentId: link.documentId,
              caseId: link.document?.caseId || null,
              notes: `Secure share link expired automatically: ${reasonDesc}`,
              metadata: {
                automated: true,
                job: "SHARE_LINK_EXPIRY",
                shareLinkId: link.id,
                reason,
                expiredAt: now.toISOString(),
              },
            },
            tx
          );

          await notifyUsers(
            [link.createdById],
            {
              type: "GENERAL",
              title: "Share Link Inactive",
              message: `Your share link for "${link.document?.name || "Document"}" is now inactive (${reasonDesc}).`,
              priority: "LOW",
              category: "SHARE_EXPIRY",
              actionUrl: `/documents/${link.documentId}`,
            },
            tx
          );
        });

        metric.processed++;
      } catch (err: any) {
        metric.failed++;
        metric.errors.push(`ShareLink ${link.id}: ${err?.message || String(err)}`);
      }
    }
  } catch (err: any) {
    metric.errors.push(`Query failure in shareLink sweep: ${err?.message || String(err)}`);
  }

  return metric;
}

/**
 * Sweeps timed-out pending access requests.
 * For each timed-out request:
 * 1. Atomically sets status="EXPIRED".
 * 2. Emits audit log entry via recordAudit (SYSTEM actor, action ACCESS_REJECTED).
 * 3. Sends notification to the requester.
 */
export async function sweepAccessRequestExpiries(now: Date = new Date()): Promise<SweepMetric> {
  const metric: SweepMetric = { processed: 0, failed: 0, errors: [] };

  try {
    const candidates = await prisma.accessRequest.findMany({
      where: {
        status: "PENDING",
        expiresAt: { lte: now, not: null },
      },
      select: {
        id: true,
        documentId: true,
        requestedById: true,
        expiresAt: true,
        document: { select: { name: true, caseId: true } },
      },
      take: 100,
    });

    for (const req of candidates) {
      try {
        await prisma.$transaction(async (tx) => {
          const updateRes = await tx.accessRequest.updateMany({
            where: { id: req.id, status: "PENDING" },
            data: { status: "EXPIRED" },
          });

          if (updateRes.count === 0) return;

          await recordAudit(
            {
              action: "ACCESS_REJECTED",
              actorId: null,
              documentId: req.documentId,
              caseId: req.document?.caseId || null,
              targetUserId: req.requestedById,
              notes: `Pending access request timed out automatically`,
              metadata: {
                automated: true,
                job: "ACCESS_REQUEST_EXPIRY",
                requestId: req.id,
                expiredAt: now.toISOString(),
              },
            },
            tx
          );

          await notifyUsers(
            [req.requestedById],
            {
              type: "ACCESS_REJECTED",
              title: "Access Request Timed Out",
              message: `Your access request for "${req.document?.name || "Document"}" was not reviewed within the validity window and has expired.`,
              priority: "LOW",
              category: "REQUEST_TIMEOUT",
              actionUrl: `/documents/${req.documentId}`,
            },
            tx
          );
        });

        metric.processed++;
      } catch (err: any) {
        metric.failed++;
        metric.errors.push(`AccessRequest ${req.id}: ${err?.message || String(err)}`);
      }
    }
  } catch (err: any) {
    metric.errors.push(`Query failure in accessRequest sweep: ${err?.message || String(err)}`);
  }

  return metric;
}

/**
 * Runs the full automated expiry sweep routine sequentially.
 */
export async function runFullExpirySweep(now: Date = new Date()): Promise<ExpirySweepResult> {
  const accessGrants = await sweepDocumentAccessExpiries(now);
  const shareLinks = await sweepShareLinkExpiries(now);
  const accessRequests = await sweepAccessRequestExpiries(now);

  return {
    timestamp: now.toISOString(),
    accessGrants,
    shareLinks,
    accessRequests,
  };
}
