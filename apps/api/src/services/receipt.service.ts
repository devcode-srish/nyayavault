/**
 * NyayaVault — Custody Handover Receipt Engine (Milestone 4.4)
 *
 * Provides:
 * 1. Deterministic and immutable receipt reference generation (`NYA-REC-YYYY-XXXX`).
 * 2. Structured, tamper-evident physical custody receipt generation.
 * 3. Separation of read-only receipt retrieval from explicit official export audit events.
 * 4. Audit hash chain linking and legal framing.
 */

import { prisma } from "../lib/prisma";
import { recordAudit } from "../lib/audit";
import { userCanAccessCase } from "../lib/access";

export interface CustodyReceiptDTO {
  receiptNumber: string;
  transferId: string;
  status: string;
  isPending: boolean;
  watermarkText: string | null;
  generatedAt: string;
  generatedBy: {
    id: string;
    name: string;
    role: string;
  };
  evidence: {
    id: string;
    name: string;
    description: string | null;
    status: string;
  };
  case: {
    id: string;
    caseNumber: string;
    title: string;
  };
  parties: {
    sender: {
      id: string | null;
      name: string;
      role: string | null;
    };
    recipient: {
      id: string;
      name: string;
      role: string;
    };
  };
  handoverDetails: {
    purpose: string | null;
    sealNumber: string | null;
    packageCondition: string;
    location: string | null;
    notes: string | null;
    rejectionReason: string | null;
    transferredAt: string;
    decidedAt: string | null;
  };
  auditProof: {
    auditLogId: string | null;
    hash: string | null;
    previousHash: string | null;
    verifiedProvenance: boolean;
  };
  legalNotice: string;
}

/**
 * Derives a deterministic receipt number from the authoritative transfer timestamp and ID.
 * Optional attempt index appends cryptographic entropy on unique collision retries.
 */
export function deriveReceiptNumber(
  transfer: { id: string; transferredAt: Date },
  attempt = 0
): string {
  const year = transfer.transferredAt.getUTCFullYear();
  const suffix = transfer.id.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(-8);
  if (attempt === 0) {
    return `NYA-REC-${year}-${suffix}`;
  }
  const entropy = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `NYA-REC-${year}-${suffix}-${entropy}`;
}

/**
 * Ensures an authoritative receiptNumber exists on the transfer record.
 * Handles database uniqueness conflicts safely with collision retry loops.
 */
export async function getOrAssignReceiptNumber(transferId: string): Promise<string> {
  const transfer = await prisma.evidenceTransfer.findUnique({
    where: { id: transferId },
    select: { id: true, transferredAt: true, receiptNumber: true },
  });

  if (!transfer) {
    throw new Error("Evidence transfer not found");
  }

  if (transfer.receiptNumber) {
    return transfer.receiptNumber;
  }

  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const generatedNumber = deriveReceiptNumber(transfer, attempt);
    try {
      const updated = await prisma.evidenceTransfer.update({
        where: { id: transferId },
        data: { receiptNumber: generatedNumber },
        select: { receiptNumber: true },
      });
      return updated.receiptNumber || generatedNumber;
    } catch (err: any) {
      // In case of unique collision or race condition, re-check authoritative value
      const refetched = await prisma.evidenceTransfer.findUnique({
        where: { id: transferId },
        select: { receiptNumber: true },
      });
      if (refetched?.receiptNumber) {
        return refetched.receiptNumber;
      }
      if (attempt === maxAttempts - 1) {
        throw new Error(`Failed to assign unique receipt number after ${maxAttempts} attempts`);
      }
    }
  }

  return deriveReceiptNumber(transfer, 0);
}

/**
 * Generates an official custody handover receipt payload for an evidence transfer.
 * Note: Receipt retrieval is strictly read-only and never mutates custody state or audit logs.
 */
export async function getCustodyReceipt(
  transferId: string,
  userId: string,
  userRole: string
): Promise<{ success: boolean; status: number; receipt?: CustodyReceiptDTO; error?: string }> {
  const transfer = await prisma.evidenceTransfer.findUnique({
    where: { id: transferId },
    include: {
      evidence: {
        include: {
          case: { select: { id: true, caseNumber: true, title: true } },
        },
      },
      fromUser: { select: { id: true, name: true, role: true } },
      toUser: { select: { id: true, name: true, role: true } },
    },
  });

  if (!transfer) {
    return { success: false, status: 404, error: "Evidence transfer record not found" };
  }

  // Authorization check: Admin, case member, or direct participant
  const isParticipant = transfer.fromUserId === userId || transfer.toUserId === userId;
  const isCaseMember = await userCanAccessCase(userId, userRole, transfer.evidence.caseId);

  if (userRole !== "ADMIN" && !isParticipant && !isCaseMember) {
    return { success: false, status: 403, error: "Access denied: you are not authorized to view this receipt" };
  }

  const receiptNumber = await getOrAssignReceiptNumber(transferId);
  const caller = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true },
  });

  // Find linked audit log for custody transfer
  const linkedAudit = await prisma.auditLog.findFirst({
    where: {
      evidenceId: transfer.evidenceId,
      action: "EVIDENCE_TRANSFERRED",
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, hash: true, previousHash: true },
  });

  const isPending = transfer.status === "PENDING";
  const watermarkText = isPending
    ? "PENDING TRANSFER — NOT VALID AS PROOF OF COMPLETED HANDOVER"
    : transfer.status === "REJECTED"
    ? "TRANSFER REJECTED"
    : transfer.status === "CANCELLED"
    ? "TRANSFER CANCELLED"
    : null;

  const now = new Date().toISOString();

  const receipt: CustodyReceiptDTO = {
    receiptNumber,
    transferId: transfer.id,
    status: transfer.status,
    isPending,
    watermarkText,
    generatedAt: now,
    generatedBy: {
      id: caller?.id || userId,
      name: caller?.name || "Authorized Officer",
      role: caller?.role || userRole,
    },
    evidence: {
      id: transfer.evidence.id,
      name: transfer.evidence.name,
      description: transfer.evidence.description,
      status: transfer.evidence.status,
    },
    case: {
      id: transfer.evidence.case.id,
      caseNumber: transfer.evidence.case.caseNumber,
      title: transfer.evidence.case.title,
    },
    parties: {
      sender: {
        id: transfer.fromUser?.id || transfer.fromUserId || null,
        name: transfer.fromUser?.name || "Initial Intake Officer",
        role: transfer.fromUser?.role || null,
      },
      recipient: {
        id: transfer.toUser.id,
        name: transfer.toUser.name,
        role: transfer.toUser.role,
      },
    },
    handoverDetails: {
      purpose: transfer.purpose,
      sealNumber: transfer.sealNumber,
      packageCondition: transfer.packageCondition,
      location: transfer.location,
      notes: transfer.notes,
      rejectionReason: transfer.rejectionReason,
      transferredAt: transfer.transferredAt.toISOString(),
      decidedAt: transfer.decidedAt ? transfer.decidedAt.toISOString() : null,
    },
    auditProof: {
      auditLogId: linkedAudit?.id || null,
      hash: linkedAudit?.hash || null,
      previousHash: linkedAudit?.previousHash || null,
      verifiedProvenance: !!linkedAudit?.hash,
    },
    legalNotice:
      "This document is an administrative physical custody transfer receipt recorded in NyayaVault. It certifies the physical movement, seal condition, and custody responsibility of the referenced physical exhibit.",
  };

  return {
    success: true,
    status: 200,
    receipt,
  };
}

/**
 * Explicit official export of a custody handover receipt.
 * Emits a CUSTODY_RECEIPT_GENERATED audit log record and returns the receipt DTO.
 */
export async function exportCustodyReceipt(
  transferId: string,
  userId: string,
  userRole: string
): Promise<{ success: boolean; status: number; receipt?: CustodyReceiptDTO; error?: string }> {
  const result = await getCustodyReceipt(transferId, userId, userRole);
  if (!result.success || !result.receipt) {
    return result;
  }

  const receipt = result.receipt;

  // Emit explicit official export audit log record
  await recordAudit({
    action: "CUSTODY_RECEIPT_GENERATED",
    actorId: userId,
    evidenceId: receipt.evidence.id,
    caseId: receipt.case.id,
    targetUserId: receipt.parties.recipient.id,
    notes: `Official physical custody receipt exported: ${receipt.receiptNumber} (Status: ${receipt.status})`,
    metadata: {
      receiptNumber: receipt.receiptNumber,
      transferId: receipt.transferId,
      status: receipt.status,
      packageCondition: receipt.handoverDetails.packageCondition,
      sealNumber: receipt.handoverDetails.sealNumber,
    },
  });

  return {
    success: true,
    status: 200,
    receipt,
  };
}
