import { Router, Response } from "express";
import crypto from "crypto";
import argon2 from "argon2";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import {
  userCanAccessCase,
  userCanAccessDocument,
  annotateDocumentAccess,
  accessibleCaseIds,
  isRestricted,
} from "../lib/access";
import { handleSingleFileUpload } from "../lib/upload";
import { sha256Buffer } from "../lib/hash";
import { saveFile, readFile } from "../lib/storage";
import { recordAudit } from "../lib/audit";
import { attachmentHeader } from "../lib/http";
import { analyzeDocument } from "../lib/ai";

const router = Router();

// Forensic officers work with EvidenceItem instead of case documents.
const UPLOAD_ROLES = ["ADMIN", "INVESTIGATING_OFFICER", "SENIOR_OFFICER", "LEGAL_OFFICER"] as const;

/**
 * Standard 403 for a document the caller can't open. It carries no document
 * metadata (name, classification, ...) so it leaks nothing to people who
 * aren't already allowed to see the document exists. `pendingRequest` lets
 * the UI show "request already submitted".
 */
async function denyDocument(res: Response, userId: string, documentId: string) {
  const pendingRequest =
    (await prisma.accessRequest.count({
      where: { documentId, requestedById: userId, status: "PENDING" },
    })) > 0;
  return res.status(403).json({
    error: "You do not have access to this document",
    code: "DOCUMENT_ACCESS_DENIED",
    documentId,
    pendingRequest,
  });
}

// GET /api/documents?caseId=...
// Lists documents in cases you belong to, plus documents you hold an active
// grant for. Restricted documents appear with canAccess=false (locked) so a
// case member can find them and request access; opening one still returns 403.
router.get("/", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { caseId } = req.query as { caseId?: string };

  const ids = await accessibleCaseIds(userId, role);
  let where: any;
  if (ids === "ALL") {
    where = caseId ? { caseId } : {};
  } else {
    const now = new Date();
    where = {
      AND: [
        caseId ? { caseId } : {},
        {
          OR: [
            { caseId: { in: ids } },
            {
              accessGrants: {
                some: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
              },
            },
          ],
        },
      ],
    };
  }

  const documents = await prisma.document.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      case: { select: { id: true, caseNumber: true, title: true } },
      uploadedBy: { select: { name: true } },
    },
  });

  return res.json({ documents: await annotateDocumentAccess(userId, role, documents) });
});

const uploadMetaSchema = z.object({
  caseId: z.string().min(1),
  name: z.string().min(1).max(255),
  type: z.string().min(1).max(100),
  classification: z.enum(["PUBLIC", "INTERNAL", "RESTRICTED", "CONFIDENTIAL"]).default("INTERNAL"),
});

// POST /api/documents - upload a brand-new document (version 1).
router.post(
  "/",
  requireAuth,
  requireRole(...UPLOAD_ROLES),
  handleSingleFileUpload,
  async (req, res) => {
    const { sub: userId, role } = req.user!;
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded (field name must be 'file')" });
    }

    const parsed = uploadMetaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid metadata", details: parsed.error.flatten() });
    }
    const { caseId, name, type, classification } = parsed.data;

    if (!(await userCanAccessCase(userId, role, caseId))) {
      return res.status(403).json({ error: "You do not have access to this case" });
    }
    const caseExists = await prisma.case.findUnique({ where: { id: caseId } });
    if (!caseExists) return res.status(404).json({ error: "Case not found" });

    const sha256 = sha256Buffer(file.buffer);
    const storageKey = saveFile(file.buffer, file.originalname);

    const document = await prisma.document.create({
      data: {
        caseId,
        name,
        type,
        classification,
        uploadedById: userId,
        latestVersionNo: 1,
        integrityStatus: "VERIFIED", // hash was computed from the exact bytes just stored
        versions: {
          create: {
            versionNo: 1,
            storageKey,
            originalName: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            sha256,
            createdById: userId,
          },
        },
      },
      include: { versions: true },
    });

    await recordAudit({
      action: "DOCUMENT_UPLOADED",
      actorId: userId,
      documentId: document.id,
      caseId,
      notes: `Uploaded "${name}" (v1, ${classification})`,
    });
    await recordAudit({
      action: "VERSION_CREATED",
      actorId: userId,
      documentId: document.id,
      caseId,
      notes: "Version 1 created",
    });

    return res.status(201).json({ document });
  }
);

// POST /api/documents/:id/versions - adds a NEW version. Old versions and
// their stored files are never touched.
router.post(
  "/:id/versions",
  requireAuth,
  requireRole(...UPLOAD_ROLES),
  handleSingleFileUpload,
  async (req, res) => {
    const { sub: userId, role } = req.user!;
    const { id } = req.params;
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded (field name must be 'file')" });
    }

    const document = await prisma.document.findUnique({ where: { id } });
    if (!document) return res.status(404).json({ error: "Document not found" });
    if (!(await userCanAccessDocument(userId, role, document))) {
      return denyDocument(res, userId, id);
    }

    const sha256 = sha256Buffer(file.buffer);
    const storageKey = saveFile(file.buffer, file.originalname);
    const nextVersionNo = document.latestVersionNo + 1;

    const version = await prisma.documentVersion.create({
      data: {
        documentId: id,
        versionNo: nextVersionNo,
        storageKey,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        sha256,
        createdById: userId,
        notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
      },
    });

    await prisma.document.update({
      where: { id },
      data: { latestVersionNo: nextVersionNo, integrityStatus: "VERIFIED" },
    });

    await recordAudit({
      action: "VERSION_CREATED",
      actorId: userId,
      documentId: id,
      caseId: document.caseId,
      notes: `Version ${nextVersionNo} created`,
    });

    return res.status(201).json({ version });
  }
);

// GET /api/documents/:id - detail + version history
router.get("/:id", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id } = req.params;

  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      case: { select: { id: true, caseNumber: true, title: true } },
      uploadedBy: { select: { name: true } },
      versions: {
        orderBy: { versionNo: "desc" },
        include: { createdBy: { select: { name: true } } },
      },
    },
  });
  if (!document) return res.status(404).json({ error: "Document not found" });

  if (!(await userCanAccessDocument(userId, role, document))) {
    return denyDocument(res, userId, id);
  }

  // One "viewed" entry per minute per person keeps the custody chain readable.
  const recentView = await prisma.auditLog.findFirst({
    where: {
      action: "DOCUMENT_VIEWED",
      actorId: userId,
      documentId: id,
      createdAt: { gt: new Date(Date.now() - 60_000) },
    },
    select: { id: true },
  });
  if (!recentView) {
    await recordAudit({
      action: "DOCUMENT_VIEWED",
      actorId: userId,
      documentId: id,
      caseId: document.caseId,
    });
  }

  // Strip internal storage keys: they must never reach the client.
  const safeVersions = document.versions.map(({ storageKey, ...rest }) => rest);
  return res.json({ document: { ...document, versions: safeVersions } });
});

// GET /api/documents/:id/custody - chain of custody for a document, built
// from the audit trail: who did what to it, when, and to whom.
router.get("/:id/custody", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id } = req.params;

  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) return res.status(404).json({ error: "Document not found" });
  if (!(await userCanAccessDocument(userId, role, document))) {
    return denyDocument(res, userId, id);
  }

  const logs = await prisma.auditLog.findMany({
    where: { documentId: id },
    orderBy: { createdAt: "asc" },
    include: { actor: { select: { name: true, role: true } } },
  });

  const targetIds = [...new Set(logs.map((l) => l.targetUserId).filter((x): x is string => !!x))];
  const targets = await prisma.user.findMany({
    where: { id: { in: targetIds } },
    select: { id: true, name: true },
  });
  const targetName = new Map(targets.map((t) => [t.id, t.name]));

  return res.json({
    events: logs.map((l) => ({
      id: l.id,
      action: l.action,
      actor: l.actor?.name ?? "External recipient (share link)",
      actorRole: l.actor?.role ?? null,
      targetUser: l.targetUserId ? targetName.get(l.targetUserId) ?? null : null,
      notes: l.notes,
      at: l.createdAt,
    })),
  });
});

// GET /api/documents/:id/download?versionNo=N - streams file bytes. The
// storage key is resolved on the server and never sent to the client.
router.get("/:id/download", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id } = req.params;
  const versionNoParam = req.query.versionNo as string | undefined;

  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) return res.status(404).json({ error: "Document not found" });
  if (!(await userCanAccessDocument(userId, role, document, "DOWNLOAD"))) {
    return denyDocument(res, userId, id);
  }

  const versionNo = versionNoParam ? parseInt(versionNoParam, 10) : document.latestVersionNo;
  if (Number.isNaN(versionNo)) return res.status(400).json({ error: "Invalid versionNo" });

  const version = await prisma.documentVersion.findUnique({
    where: { documentId_versionNo: { documentId: id, versionNo } },
  });
  if (!version) return res.status(404).json({ error: "Version not found" });

  let buffer: Buffer;
  try {
    buffer = readFile(version.storageKey);
  } catch {
    return res.status(404).json({ error: "Stored file is missing" });
  }

  await recordAudit({
    action: "DOCUMENT_DOWNLOADED",
    actorId: userId,
    documentId: id,
    caseId: document.caseId,
    notes: `Downloaded version ${versionNo}`,
  });

  res.setHeader("Content-Type", version.mimeType);
  res.setHeader("Content-Disposition", attachmentHeader(version.originalName));
  return res.send(buffer);
});

// POST /api/documents/:id/verify-integrity - recompute SHA-256 of the
// latest version's stored bytes and compare with the hash recorded at upload.
router.post("/:id/verify-integrity", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id } = req.params;

  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) return res.status(404).json({ error: "Document not found" });
  if (!(await userCanAccessDocument(userId, role, document))) {
    return denyDocument(res, userId, id);
  }

  const version = await prisma.documentVersion.findUnique({
    where: { documentId_versionNo: { documentId: id, versionNo: document.latestVersionNo } },
  });
  if (!version) return res.status(404).json({ error: "Latest version not found" });

  let buffer: Buffer;
  try {
    buffer = readFile(version.storageKey);
  } catch {
    return res.status(404).json({ error: "Stored file is missing" });
  }
  const recalculated = sha256Buffer(buffer);
  const matches = recalculated === version.sha256;

  const updated = await prisma.document.update({
    where: { id },
    data: { integrityStatus: matches ? "VERIFIED" : "MISMATCH" },
  });

  await recordAudit({
    action: matches ? "INTEGRITY_CHECK" : "INTEGRITY_MISMATCH",
    actorId: userId,
    documentId: id,
    caseId: document.caseId,
    notes: matches
      ? "Hash matches stored value"
      : `MISMATCH: expected ${version.sha256}, got ${recalculated}`,
  });

  return res.json({
    integrityStatus: updated.integrityStatus,
    storedHash: version.sha256,
    recalculatedHash: recalculated,
  });
});

const shareSchema = z.object({
  expiresInHours: z.number().int().min(1).max(168).default(24),
  maxUses: z.number().int().min(1).max(10).default(1),
  pin: z.string().trim().regex(/^\d{4,8}$/, "PIN must be between 4 and 8 digits").optional(),
});

// POST /api/documents/:id/share - create an expiring, limited-use link with optional PIN and hashed-only token storage.
router.post("/:id/share", requireAuth, requireRole(...UPLOAD_ROLES), async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id } = req.params;

  const parsed = shareSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid share settings", details: parsed.error.flatten() });
  }
  const { expiresInHours, maxUses, pin } = parsed.data;

  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) return res.status(404).json({ error: "Document not found" });
  if (!(await userCanAccessDocument(userId, role, document, "SHARE"))) {
    return denyDocument(res, userId, id);
  }

  // Restricted material can leave the system only with a supervisor's say-so.
  if (isRestricted(document.classification) && role !== "ADMIN" && role !== "SENIOR_OFFICER") {
    return res.status(403).json({
      error: "Only a Senior Officer or Admin can create share links for restricted or confidential documents",
    });
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const pinHash = pin ? await argon2.hash(pin) : null;
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  // Store hashed-only representation in database. Plaintext token is null.
  const link = await prisma.shareLink.create({
    data: {
      documentId: id,
      token: null,
      tokenHash,
      pinHash,
      createdById: userId,
      expiresAt,
      maxUses,
    },
  });

  await recordAudit({
    action: "DOCUMENT_SHARED",
    actorId: userId,
    documentId: id,
    caseId: document.caseId,
    notes: `Share link created (expires in ${expiresInHours}h, max ${maxUses} download${maxUses === 1 ? "" : "s"}${pin ? ", PIN protected" : ""})`,
  });

  return res.status(201).json({
    share: {
      id: link.id,
      token: rawToken,
      path: `/share/${rawToken}`,
      expiresAt,
      maxUses,
      hasPin: !!pin,
    },
  });
});

// POST /api/documents/:id/shares/:shareId/revoke - revoke a share link
router.post("/:id/shares/:shareId/revoke", requireAuth, requireRole(...UPLOAD_ROLES), async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id: documentId, shareId } = req.params;

  const link = await prisma.shareLink.findUnique({
    where: { id: shareId },
    include: { document: { select: { id: true, caseId: true } } },
  });

  if (!link || link.documentId !== documentId) {
    return res.status(404).json({ error: "Share link not found" });
  }

  const seeAll = role === "ADMIN" || role === "SENIOR_OFFICER";
  if (!seeAll && link.createdById !== userId) {
    return res.status(403).json({ error: "You do not have permission to revoke this share link" });
  }

  if (link.isRevoked) {
    return res.status(409).json({ error: "Share link is already revoked" });
  }

  await prisma.shareLink.update({
    where: { id: shareId },
    data: { isRevoked: true },
  });

  await recordAudit({
    action: "DOCUMENT_SHARED",
    actorId: userId,
    documentId: link.documentId,
    caseId: link.document.caseId,
    notes: "Share link revoked",
  });

  return res.json({ ok: true, isRevoked: true });
});

// GET /api/documents/:id/shares - links for this document. Admins and Senior
// Officers see everyone's; other roles see only the links they created.
router.get("/:id/shares", requireAuth, requireRole(...UPLOAD_ROLES), async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id } = req.params;

  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) return res.status(404).json({ error: "Document not found" });
  if (!(await userCanAccessDocument(userId, role, document))) {
    return denyDocument(res, userId, id);
  }

  const seeAll = role === "ADMIN" || role === "SENIOR_OFFICER";
  const links = await prisma.shareLink.findMany({
    where: { documentId: id, ...(seeAll ? {} : { createdById: userId }) },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { createdBy: { select: { name: true } } },
  });

  const now = new Date();
  return res.json({
    shares: links.map((l) => ({
      id: l.id,
      path: l.token ? `/share/${l.token}` : undefined,
      createdBy: l.createdBy.name,
      createdAt: l.createdAt,
      expiresAt: l.expiresAt,
      maxUses: l.maxUses,
      useCount: l.useCount,
      hasPin: !!l.pinHash,
      isRevoked: l.isRevoked,
      status: l.isRevoked
        ? "REVOKED"
        : l.expiresAt < now
        ? "EXPIRED"
        : l.useCount >= l.maxUses
        ? "USED UP"
        : "ACTIVE",
    })),
  });
});

// POST /api/documents/:id/ai-analyze - analyze document with Gemini AI
router.post("/:id/ai-analyze", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { id } = req.params;

  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) return res.status(404).json({ error: "Document not found" });
  if (!(await userCanAccessDocument(userId, role, document))) {
    return denyDocument(res, userId, id);
  }

  const version = await prisma.documentVersion.findUnique({
    where: { documentId_versionNo: { documentId: id, versionNo: document.latestVersionNo } },
  });
  if (!version) return res.status(404).json({ error: "Latest version not found" });

  let buffer: Buffer;
  try {
    buffer = readFile(version.storageKey);
  } catch {
    return res.status(404).json({ error: "Stored file is missing" });
  }

  try {
    const aiResult = await analyzeDocument(buffer, version.mimeType);

    await recordAudit({
      action: "AI_QUERY", // Using existing AI_QUERY instead of adding new DOCUMENT_AI_ANALYSIS to avoid DB schema migration
      actorId: userId,
      documentId: id,
      caseId: document.caseId,
      notes: `AI Analysis executed on version ${document.latestVersionNo}`,
    });

    return res.json(aiResult);
  } catch (err: any) {
    if (err.message === "Document contains no extractable text.") {
      return res.status(400).json({ error: err.message });
    }
    if (err.message.includes("Unsupported document type")) {
      return res.status(400).json({ error: err.message });
    }
    console.error("AI Analysis Error:", err);
    return res.status(502).json({ error: "AI processing failed. Please try again later." });
  }
});

export default router;
