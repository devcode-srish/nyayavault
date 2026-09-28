import { prisma } from "../lib/prisma";
import { runFullExpirySweep, ExpirySweepResult } from "../services/expiry.service";

export const EXPIRY_JOB_ADVISORY_LOCK_ID = 749215092;

export interface AdvisorySweepExecutionResult {
  executed: boolean;
  reason?: string;
  result?: ExpirySweepResult;
}

let schedulerTimer: NodeJS.Timeout | null = null;

/**
 * Runs the expiry sweep routine protected by a PostgreSQL non-blocking transaction advisory lock.
 * If another worker or cron instance is already executing, this call immediately yields without blocking.
 */
export async function runAdvisoryLockedExpirySweep(now: Date = new Date()): Promise<AdvisorySweepExecutionResult> {
  return prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRawUnsafe<{ pg_try_advisory_xact_lock: boolean }[]>(
      `SELECT pg_try_advisory_xact_lock(${EXPIRY_JOB_ADVISORY_LOCK_ID})`
    );
    const acquired = lockRows[0]?.pg_try_advisory_xact_lock ?? false;

    if (!acquired) {
      return {
        executed: false,
        reason: "LOCK_HELD_BY_CONCURRENT_WORKER",
      };
    }

    const result = await runFullExpirySweep(now);
    return {
      executed: true,
      result,
    };
  });
}

/**
 * Starts the in-process periodic background scheduler if enabled.
 */
export function startExpiryScheduler(): void {
  const isTest = process.env.NODE_ENV === "test";
  const isExplicitlyEnabled = process.env.ENABLE_EXPIRY_SCHEDULER === "true";

  // Guard against starting during automated tests unless explicitly requested
  if (isTest && !isExplicitlyEnabled) {
    return;
  }

  if (schedulerTimer) {
    return;
  }

  const intervalMs = parseInt(process.env.EXPIRY_SWEEP_INTERVAL_MS || "60000", 10);

  schedulerTimer = setInterval(async () => {
    try {
      const outcome = await runAdvisoryLockedExpirySweep();
      if (outcome.executed && outcome.result) {
        const grantsCount = outcome.result.accessGrants.processed;
        const sharesCount = outcome.result.shareLinks.processed;
        const requestsCount = outcome.result.accessRequests.processed;
        if (grantsCount > 0 || sharesCount > 0 || requestsCount > 0) {
          console.log(
            `[ExpiryScheduler] Swept: ${grantsCount} grants, ${sharesCount} share links, ${requestsCount} requests.`
          );
        }
      }
    } catch (err: any) {
      console.error("[ExpiryScheduler] Periodic sweep error:", err?.message || err);
    }
  }, intervalMs);

  // Unref timer so node process can exit cleanly if needed
  if (schedulerTimer.unref) {
    schedulerTimer.unref();
  }
}

/**
 * Stops the periodic background scheduler.
 */
export function stopExpiryScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
