import { Classification } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Authorization is layered. Each layer is enforced on the backend:
 *
 *  1. Role (middleware/auth.ts)            - what kind of user are you?
 *  2. Case membership (this file)          - are you assigned to the case?
 *  3. Document access (this file)          - for RESTRICTED / CONFIDENTIAL
 *     documents, case membership alone is NOT enough. You need an active
 *     DocumentAccess grant (created when a Senior Officer / Admin approves
 *     an access request), or you must be the uploader, a Senior Officer on
 *     the case, or an Admin.
 */

export async function userCanAccessCase(
  userId: string,
  role: string,
  caseId: string
): Promise<boolean> {
  if (role === "ADMIN") return true;
  const membership = await prisma.caseMember.findUnique({
    where: { caseId_userId: { caseId, userId } },
  });
  return !!membership;
}

export async function accessibleCaseIds(userId: string, role: string): Promise<string[] | "ALL"> {
  if (role === "ADMIN") return "ALL";
  const memberships = await prisma.caseMember.findMany({
    where: { userId },
    select: { caseId: true },
  });
  return memberships.map((m) => m.caseId);
}

export function isRestricted(classification: Classification): boolean {
  return classification === "RESTRICTED" || classification === "CONFIDENTIAL";
}

export interface DocumentAccessSubject {
  id: string;
  caseId: string;
  classification: Classification;
  uploadedById: string;
}

export async function userCanAccessDocument(
  userId: string,
  role: string,
  doc: DocumentAccessSubject
): Promise<boolean> {
  if (role === "ADMIN") return true;

  // A temporary grant (from an approved access request) works even if the
  // person is not a member of the case. Expired grants are ignored.
  const grant = await prisma.documentAccess.findFirst({
    where: { documentId: doc.id, userId, isActive: true },
  });
  if (grant && (!grant.expiresAt || grant.expiresAt > new Date())) return true;

  const membership = await prisma.caseMember.findUnique({
    where: { caseId_userId: { caseId: doc.caseId, userId } },
  });
  if (!membership) return false;

  if (!isRestricted(doc.classification)) return true;
  return doc.uploadedById === userId || role === "SENIOR_OFFICER";
}

/**
 * Batch version for list pages: annotates each document with `canAccess`
 * using two queries total instead of two per document.
 */
export async function annotateDocumentAccess<T extends DocumentAccessSubject>(
  userId: string,
  role: string,
  docs: T[]
): Promise<Array<T & { canAccess: boolean }>> {
  if (role === "ADMIN") return docs.map((d) => ({ ...d, canAccess: true }));

  const now = new Date();
  const [grants, memberships] = await Promise.all([
    prisma.documentAccess.findMany({
      where: { userId, documentId: { in: docs.map((d) => d.id) } },
    }),
    prisma.caseMember.findMany({ where: { userId }, select: { caseId: true } }),
  ]);
  const activeGrants = new Set(
    grants.filter((g) => !g.expiresAt || g.expiresAt > now).map((g) => g.documentId)
  );
  const memberCases = new Set(memberships.map((m) => m.caseId));

  return docs.map((d) => {
    let canAccess = activeGrants.has(d.id);
    if (!canAccess && memberCases.has(d.caseId)) {
      canAccess = !isRestricted(d.classification) || d.uploadedById === userId || role === "SENIOR_OFFICER";
    }
    return { ...d, canAccess };
  });
}

/** Who may approve/reject access requests for documents in this case. */
export async function canDecideForCase(
  userId: string,
  role: string,
  caseId: string
): Promise<boolean> {
  if (role === "ADMIN") return true;
  if (role !== "SENIOR_OFFICER") return false;
  return userCanAccessCase(userId, role, caseId);
}
