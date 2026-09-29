import { prisma } from "../lib/prisma";
import { recordAudit, GENESIS_PREV_HASH } from "../lib/audit";
import { userCanAccessCase } from "../lib/access";
import { AuditAction, TimelineEventCategory, Prisma } from "@prisma/client";

export type TimelineSource = "AUDIT_LOG" | "MANUAL_NOTE";

export interface UnifiedTimelineEvent {
  id: string;
  source: TimelineSource;
  sourceId: string;
  caseId: string;
  category: TimelineEventCategory;
  title: string;
  description: string | null;
  occurredAt: string;
  createdAt: string;
  isMilestone: boolean;
  actor: {
    id: string | null;
    name: string;
    role: string | null;
  };
  document: {
    id: string;
    name: string;
  } | null;
  evidence: {
    id: string;
    name: string;
  } | null;
  auditProof: {
    hash: string | null;
    previousHash: string | null;
    verifiedProvenance: boolean;
  } | null;
  metadata: any;
}

export interface TimelineQueryFilters {
  category?: TimelineEventCategory | "ALL";
  source?: TimelineSource | "ALL";
  isMilestone?: boolean;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  order?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export interface PaginatedTimelineResult {
  case: {
    id: string;
    caseNumber: string;
    title: string;
    status: string;
  };
  events: UnifiedTimelineEvent[];
  pagination: {
    totalEvents: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

/**
 * Maps an AuditAction to a high-level timeline event category.
 */
export function mapAuditActionToCategory(action: AuditAction): TimelineEventCategory {
  switch (action) {
    case "CASE_CREATED":
    case "USER_CREATED":
    case "ROLE_CHANGED":
      return "CASE_LIFECYCLE";
    case "EVIDENCE_TRANSFERRED":
      return "EVIDENCE_CUSTODY";
    case "DOCUMENT_UPLOADED":
    case "VERSION_CREATED":
    case "DOCUMENT_VIEWED":
    case "DOCUMENT_DOWNLOADED":
      return "DOCUMENT_VERSIONING";
    case "DOCUMENT_SIGNED":
    case "SIGNATURE_VERIFIED":
      return "DIGITAL_SIGNATURE";
    case "INTEGRITY_CHECK":
    case "INTEGRITY_MISMATCH":
    case "TAMPER_SIMULATED":
      return "STORAGE_INTEGRITY";
    case "DOCUMENT_SHARED":
    case "ACCESS_REQUESTED":
    case "ACCESS_APPROVED":
    case "ACCESS_REJECTED":
      return "ACCESS_SHARING";
    case "INVESTIGATION_NOTE_CREATED":
      return "INVESTIGATOR_NOTE";
    default:
      return "CASE_LIFECYCLE";
  }
}

/**
 * Formats an AuditAction into a human-readable title.
 */
export function formatAuditActionTitle(action: AuditAction, notes?: string | null): string {
  switch (action) {
    case "CASE_CREATED":
      return "Case Initiated";
    case "DOCUMENT_UPLOADED":
      return "Evidence Document Uploaded";
    case "VERSION_CREATED":
      return "New Document Version Ingested";
    case "DOCUMENT_VIEWED":
      return "Document Viewed in Case";
    case "DOCUMENT_DOWNLOADED":
      return "Document Downloaded";
    case "DOCUMENT_SHARED":
      return "Secure Share Link Generated";
    case "DOCUMENT_SIGNED":
      return "Cryptographic Signature & Section 65B Certificate Executed";
    case "SIGNATURE_VERIFIED":
      return "Digital Signature Verified";
    case "ACCESS_REQUESTED":
      return "Temporary Access Requested";
    case "ACCESS_APPROVED":
      return "Access Request Approved";
    case "ACCESS_REJECTED":
      return "Access Request Rejected / Expired";
    case "INTEGRITY_CHECK":
      return "Storage Integrity Verification";
    case "INTEGRITY_MISMATCH":
      return "Storage Integrity Discrepancy Alert";
    case "TAMPER_SIMULATED":
      return "Storage Tamper Simulation";
    case "EVIDENCE_TRANSFERRED":
      return "Physical Evidence Custody Transfer";
    case "INVESTIGATION_NOTE_CREATED":
      return "Investigation Note Recorded";
    default:
      return action.replace(/_/g, " ");
  }
}

/**
 * Retrieves a unified, deterministically paginated timeline for a case.
 */
export async function getCaseTimeline(
  caseId: string,
  userId: string,
  userRole: string,
  filters: TimelineQueryFilters = {}
): Promise<{ success: boolean; status: number; data?: PaginatedTimelineResult; error?: string }> {
  // 1. Enforce strict case access authorization
  const canAccess = await userCanAccessCase(userId, userRole, caseId);
  if (!canAccess) {
    return { success: false, status: 403, error: "Access denied: you are not a member of this case" };
  }

  const targetCase = await prisma.case.findUnique({
    where: { id: caseId },
    select: { id: true, caseNumber: true, title: true, status: true },
  });

  if (!targetCase) {
    return { success: false, status: 404, error: "Case not found" };
  }

  const {
    category = "ALL",
    source = "ALL",
    isMilestone,
    dateFrom,
    dateTo,
    search,
    order = "desc",
    page = 1,
    limit = 25,
  } = filters;

  const validPage = Math.max(1, page);
  const validLimit = Math.min(100, Math.max(1, limit));

  // Date filters
  const dateFilterGte = dateFrom ? new Date(dateFrom) : undefined;
  const dateFilterLte = dateTo ? new Date(dateTo) : undefined;

  let auditEntries: UnifiedTimelineEvent[] = [];
  let noteEntries: UnifiedTimelineEvent[] = [];

  // 2. Query AuditLog if source permits
  if (source === "ALL" || source === "AUDIT_LOG") {
    const auditWhere: Prisma.AuditLogWhereInput = {
      caseId,
    };

    if (dateFilterGte || dateFilterLte) {
      auditWhere.createdAt = {};
      if (dateFilterGte) auditWhere.createdAt.gte = dateFilterGte;
      if (dateFilterLte) auditWhere.createdAt.lte = dateFilterLte;
    }

    const logs = await prisma.auditLog.findMany({
      where: auditWhere,
      include: {
        actor: { select: { id: true, name: true, role: true } },
        document: { select: { id: true, name: true } },
        evidence: { select: { id: true, name: true } },
      },
    });

    auditEntries = logs.map((log) => {
      const eventCat = mapAuditActionToCategory(log.action);
      const title = formatAuditActionTitle(log.action, log.notes);
      const isSignOrMilestone =
        log.action === "DOCUMENT_SIGNED" ||
        log.action === "CASE_CREATED" ||
        log.action === "INTEGRITY_MISMATCH";

      return {
        id: `audit-${log.id}`,
        source: "AUDIT_LOG" as TimelineSource,
        sourceId: log.id,
        caseId,
        category: eventCat,
        title,
        description: log.notes || null,
        occurredAt: log.createdAt.toISOString(),
        createdAt: log.createdAt.toISOString(),
        isMilestone: isSignOrMilestone,
        actor: {
          id: log.actor?.id || log.actorId || null,
          name: log.actor?.name || "System Automation",
          role: log.actor?.role || null,
        },
        document: log.document ? { id: log.document.id, name: log.document.name } : null,
        evidence: log.evidence ? { id: log.evidence.id, name: log.evidence.name } : null,
        auditProof: {
          hash: log.hash || null,
          previousHash: log.previousHash || GENESIS_PREV_HASH,
          verifiedProvenance: !!log.hash,
        },
        metadata: log.metadata,
      };
    });
  }

  // 3. Query InvestigationTimelineEvent if source permits
  if (source === "ALL" || source === "MANUAL_NOTE") {
    const noteWhere: Prisma.InvestigationTimelineEventWhereInput = {
      caseId,
    };

    if (dateFilterGte || dateFilterLte) {
      noteWhere.occurredAt = {};
      if (dateFilterGte) noteWhere.occurredAt.gte = dateFilterGte;
      if (dateFilterLte) noteWhere.occurredAt.lte = dateFilterLte;
    }

    if (category !== "ALL") {
      noteWhere.category = category;
    }

    if (isMilestone !== undefined) {
      noteWhere.isMilestone = isMilestone;
    }

    const notes = await prisma.investigationTimelineEvent.findMany({
      where: noteWhere,
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
      },
    });

    noteEntries = notes.map((n) => ({
      id: `note-${n.id}`,
      source: "MANUAL_NOTE" as TimelineSource,
      sourceId: n.id,
      caseId,
      category: n.category,
      title: n.title,
      description: n.description,
      occurredAt: n.occurredAt.toISOString(),
      createdAt: n.createdAt.toISOString(),
      isMilestone: n.isMilestone,
      actor: {
        id: n.createdBy?.id || n.createdById || null,
        name: n.createdBy?.name || "Case Officer",
        role: n.createdBy?.role || null,
      },
      document: null,
      evidence: null,
      auditProof: null, // Truthful: manual notes are not system audit hashes
      metadata: n.metadata,
    }));
  }

  // 4. Merge and apply category/search filters
  let combined = [...auditEntries, ...noteEntries];

  if (category !== "ALL") {
    combined = combined.filter((e) => e.category === category);
  }

  if (isMilestone !== undefined) {
    combined = combined.filter((e) => e.isMilestone === isMilestone);
  }

  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    combined = combined.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        (e.description && e.description.toLowerCase().includes(q)) ||
        e.actor.name.toLowerCase().includes(q) ||
        (e.document && e.document.name.toLowerCase().includes(q)) ||
        (e.evidence && e.evidence.name.toLowerCase().includes(q))
    );
  }

  // 5. Deterministic sorting with 3-tier tie-breakers
  // 1. occurredAt timestamp
  // 2. createdAt timestamp
  // 3. unique id string
  combined.sort((a, b) => {
    const timeA = new Date(a.occurredAt).getTime();
    const timeB = new Date(b.occurredAt).getTime();
    if (timeA !== timeB) {
      return order === "asc" ? timeA - timeB : timeB - timeA;
    }

    const createA = new Date(a.createdAt).getTime();
    const createB = new Date(b.createdAt).getTime();
    if (createA !== createB) {
      return order === "asc" ? createA - createB : createB - createA;
    }

    return order === "asc" ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
  });

  // 6. Stable pagination
  const totalEvents = combined.length;
  const totalPages = Math.ceil(totalEvents / validLimit) || 1;
  const startIndex = (validPage - 1) * validLimit;
  const paginatedEvents = combined.slice(startIndex, startIndex + validLimit);

  return {
    success: true,
    status: 200,
    data: {
      case: targetCase,
      events: paginatedEvents,
      pagination: {
        totalEvents,
        page: validPage,
        limit: validLimit,
        totalPages,
        hasNextPage: validPage < totalPages,
        hasPrevPage: validPage > 1,
      },
    },
  };
}

/**
 * Creates a manual investigation milestone or field note for a case.
 */
export async function createInvestigationNote(params: {
  caseId: string;
  userId: string;
  userRole: string;
  title: string;
  description?: string;
  category?: TimelineEventCategory;
  occurredAt?: string;
  isMilestone?: boolean;
  metadata?: any;
}): Promise<{ success: boolean; status: number; event?: UnifiedTimelineEvent; error?: string }> {
  const { caseId, userId, userRole, title, description, category, occurredAt, isMilestone, metadata } =
    params;

  // 1. Authorize case membership
  const canAccess = await userCanAccessCase(userId, userRole, caseId);
  if (!canAccess) {
    return { success: false, status: 403, error: "Access denied: you are not authorized to post notes to this case" };
  }

  // 2. Validate input
  if (!title || !title.trim()) {
    return { success: false, status: 400, error: "Event title is required" };
  }

  let eventOccurredAt = new Date();
  if (occurredAt) {
    const parsedDate = new Date(occurredAt);
    if (Number.isNaN(parsedDate.getTime())) {
      return { success: false, status: 400, error: "Invalid occurredAt date format" };
    }
    // Prevent timestamps far in the future
    if (parsedDate.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      return { success: false, status: 400, error: "occurredAt date cannot be in the future" };
    }
    eventOccurredAt = parsedDate;
  }

  const selectedCategory: TimelineEventCategory = category || "INVESTIGATOR_NOTE";

  // 3. Execute inside transaction to guarantee atomic note persistence and audit emission
  return prisma.$transaction(async (tx) => {
    const note = await tx.investigationTimelineEvent.create({
      data: {
        caseId,
        title: title.trim(),
        description: description?.trim() || null,
        category: selectedCategory,
        occurredAt: eventOccurredAt,
        createdById: userId,
        isMilestone: !!isMilestone,
        metadata: metadata || undefined,
        createdAt: new Date(),
      },
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
      },
    });

    // 4. Emit semantically correct AuditAction INVESTIGATION_NOTE_CREATED
    await recordAudit(
      {
        action: "INVESTIGATION_NOTE_CREATED",
        actorId: userId,
        caseId,
        notes: `Investigation note recorded: "${title.trim()}"${isMilestone ? " [MILESTONE]" : ""}`,
        metadata: {
          noteId: note.id,
          category: selectedCategory,
          isMilestone: !!isMilestone,
          occurredAt: eventOccurredAt.toISOString(),
          createdAt: note.createdAt.toISOString(),
        },
      },
      tx
    );

    const formattedEvent: UnifiedTimelineEvent = {
      id: `note-${note.id}`,
      source: "MANUAL_NOTE",
      sourceId: note.id,
      caseId,
      category: note.category,
      title: note.title,
      description: note.description,
      occurredAt: note.occurredAt.toISOString(),
      createdAt: note.createdAt.toISOString(),
      isMilestone: note.isMilestone,
      actor: {
        id: note.createdBy?.id || userId,
        name: note.createdBy?.name || "Case Officer",
        role: note.createdBy?.role || userRole,
      },
      document: null,
      evidence: null,
      auditProof: null,
      metadata: note.metadata,
    };

    return {
      success: true,
      status: 201,
      event: formattedEvent,
    };
  });
}
