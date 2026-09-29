import { Router } from "express";
import { Prisma } from "@prisma/client";
import crypto from "crypto";
import argon2 from "argon2";
import { prisma } from "../lib/prisma";
import { readFile } from "../lib/storage";
import { sha256Buffer } from "../lib/hash";
import { recordAudit } from "../lib/audit";
import { attachmentHeader } from "../lib/http";

const router = Router();

type ShareLinkWithDoc = Prisma.ShareLinkGetPayload<{
  include: {
    createdBy: { select: { name: true } };
    document: {
      select: {
        id: true;
        name: true;
        type: true;
        caseId: true;
        classification: true;
        versions: { orderBy: { versionNo: "desc" }; take: 1 };
      };
    };
  };
}>;

type FindLinkResult =
  | { status: 404 | 410; error: string; link?: ShareLinkWithDoc }
  | { status: 401; error: string; requiresPin: true; link: ShareLinkWithDoc }
  | { link: ShareLinkWithDoc; version: ShareLinkWithDoc["document"]["versions"][0] };

async function findLink(rawToken: string, providedPin?: string): Promise<FindLinkResult> {
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  // Primary lookup using tokenHash
  let link = await prisma.shareLink.findUnique({
    where: { tokenHash },
    include: {
      createdBy: { select: { name: true } },
      document: {
        select: {
          id: true,
          name: true,
          type: true,
          caseId: true,
          classification: true,
          versions: { orderBy: { versionNo: "desc" }, take: 1 },
        },
      },
    },
  });

  // Backward-compatibility fallback for legacy unhashed links if any exist
  if (!link) {
    link = await prisma.shareLink.findUnique({
      where: { token: rawToken },
      include: {
        createdBy: { select: { name: true } },
        document: {
          select: {
            id: true,
            name: true,
            type: true,
            caseId: true,
            classification: true,
            versions: { orderBy: { versionNo: "desc" }, take: 1 },
          },
        },
      },
    });
  }

  if (!link) return { status: 404, error: "This link is not valid." };
  if (link.isRevoked) {
    await recordAudit({
      action: "DOCUMENT_VIEWED",
      outcome: "DENIED",
      documentId: link.document.id,
      caseId: link.document.caseId,
      notes: "Share link access denied: link has been revoked",
    });
    return { status: 410, error: "This link has been revoked.", link };
  }
  if (link.expiresAt < new Date()) {
    await recordAudit({
      action: "DOCUMENT_VIEWED",
      outcome: "DENIED",
      documentId: link.document.id,
      caseId: link.document.caseId,
      notes: "Share link access denied: link has expired",
    });
    return { status: 410, error: "This link has expired.", link };
  }
  if (link.useCount >= link.maxUses) {
    await recordAudit({
      action: "DOCUMENT_VIEWED",
      outcome: "DENIED",
      documentId: link.document.id,
      caseId: link.document.caseId,
      notes: "Share link access denied: download limit reached",
    });
    return { status: 410, error: "This link has reached its download limit.", link };
  }

  // PIN security check: accepted ONLY via x-share-pin header.
  if (link.pinHash) {
    if (!providedPin) {
      return { status: 401, error: "This share link is protected by a PIN.", requiresPin: true, link };
    }
    const pinMatches = await argon2.verify(link.pinHash, providedPin);
    if (!pinMatches) {
      await recordAudit({
        action: "DOCUMENT_VIEWED",
        outcome: "DENIED",
        documentId: link.document.id,
        caseId: link.document.caseId,
        notes: "Share link access denied: invalid PIN provided",
      });
      return { status: 401, error: "Invalid PIN.", requiresPin: true, link };
    }
  }

  const version = link.document.versions[0];
  if (!version) return { status: 404, error: "This link is not valid." };
  return { link, version };
}

// GET /share/:token - View share link metadata
router.get("/:token", async (req, res) => {
  const rawToken = req.params.token;
  // Security Rule: PINs are accepted ONLY via x-share-pin header; query parameters are ignored.
  const pin = (req.headers["x-share-pin"] as string) || undefined;

  const found = await findLink(rawToken, pin);
  if ("error" in found) {
    if (found.status === 401 && "requiresPin" in found) {
      return res.status(401).json({
        error: found.error,
        requiresPin: true,
        share: {
          name: found.link.document.name,
          requiresPin: true,
        },
      });
    }
    return res.status(found.status).json({ error: found.error });
  }

  const { link, version } = found;

  return res.json({
    share: {
      name: link.document.name,
      type: link.document.type,
      classification: link.document.classification,
      fileName: version.originalName,
      mimeType: version.mimeType,
      sizeBytes: version.sizeBytes,
      versionNo: version.versionNo,
      sha256: version.sha256,
      sharedBy: link.createdBy.name,
      expiresAt: link.expiresAt,
      usesRemaining: link.maxUses - link.useCount,
      requiresPin: !!link.pinHash,
    },
  });
});

// GET /share/:token/download - Download shared file
router.get("/:token/download", async (req, res) => {
  const rawToken = req.params.token;
  // Security Rule: PINs are accepted ONLY via x-share-pin header; query parameters are ignored.
  const pin = (req.headers["x-share-pin"] as string) || undefined;

  const found = await findLink(rawToken, pin);
  if ("error" in found) {
    if (found.status === 401 && "requiresPin" in found) {
      return res.status(401).json({ error: found.error, requiresPin: true });
    }
    return res.status(found.status).json({ error: found.error });
  }

  const { link, version } = found;

  let buffer: Buffer;
  try {
    buffer = readFile(version.storageKey);
  } catch {
    // Missing file on disk does NOT consume user download limit
    return res.status(404).json({ error: "File is not available." });
  }

  // Integrity gate: never hand out a file that no longer matches its hash.
  if (sha256Buffer(buffer) !== version.sha256) {
    await prisma.document.update({
      where: { id: link.document.id },
      data: { integrityStatus: "MISMATCH" },
    });
    await recordAudit({
      action: "INTEGRITY_MISMATCH",
      outcome: "MISMATCH",
      documentId: link.document.id,
      caseId: link.document.caseId,
      notes: "Share-link download blocked: stored file does not match recorded SHA-256",
    });
    // Failed integrity check does NOT consume user download limit
    return res.status(409).json({ error: "Download blocked: this file failed an integrity check." });
  }

  // Atomically claim one use with concurrency guard
  const claimed = await prisma.shareLink.updateMany({
    where: {
      id: link.id,
      isRevoked: false,
      useCount: { lt: link.maxUses },
      expiresAt: { gt: new Date() },
    },
    data: { useCount: { increment: 1 } },
  });

  if (claimed.count === 0) {
    return res.status(410).json({ error: "This link has reached its download limit or expired." });
  }

  await recordAudit({
    action: "DOCUMENT_DOWNLOADED",
    outcome: "SUCCESS",
    documentId: link.document.id,
    caseId: link.document.caseId,
    notes: `Downloaded v${version.versionNo} via secure share link (created by ${link.createdBy.name})`,
  });

  res.setHeader("Content-Type", version.mimeType);
  res.setHeader("Content-Disposition", attachmentHeader(version.originalName));
  return res.send(buffer);
});

export default router;
