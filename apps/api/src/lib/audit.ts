import { AuditAction, AuditOutcome, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export async function recordAudit(params: {
  action: AuditAction;
  outcome?: AuditOutcome;
  actorId?: string | null;
  documentId?: string | null;
  evidenceId?: string | null;
  caseId?: string | null;
  targetUserId?: string | null;
  notes?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.auditLog.create({
    data: {
      action: params.action,
      outcome: params.outcome,
      actorId: params.actorId ?? undefined,
      documentId: params.documentId ?? undefined,
      evidenceId: params.evidenceId ?? undefined,
      caseId: params.caseId ?? undefined,
      targetUserId: params.targetUserId ?? undefined,
      notes: params.notes ?? undefined,
      metadata: params.metadata,
    },
  });
}
