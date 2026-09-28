import { Router } from "express";
import { prisma } from "../lib/prisma";
import { readFile } from "../lib/storage";
import { sha256Buffer } from "../lib/hash";
import { recordAudit } from "../lib/audit";
import { attachmentHeader } from "../lib/http";

/**
 * PUBLIC routes (no login) for secure share links.
 *
 * The link contains only a random 256-bit token. It says nothing about the
 * document, the case, or where the file lives on disk. Links expire, have a
 * download limit, and are refused if the stored file no longer matches its
 * recorded SHA-256.
 */
const router = Router();

async function findLink(token: string) {
  const link = await prisma.shareLink.findUnique({
    where: { token },
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
  if (!link) return { status: 404, error: "This link is not valid." } as const;
  if (link.expiresAt < new Date()) return { status: 410, error: "This link has expired." } as const;
  if (link.useCount >= link.maxUses) {
    return { status: 410, error: "This link has reached its download limit." } as const;
  }
  const version = link.document.versions[0];
  if (!version) return { status: 404, error: "This link is not valid." } as const;
  return { link, version } as const;
}

// Metadata only. Viewing this page does not use up a download.
router.get("/:token", async (req, res) => {
  const found = await findLink(req.params.token);
  if ("error" in found) return res.status(found.status).json({ error: found.error });
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
    },
  });
});

router.get("/:token/download", async (req, res) => {
  const found = await findLink(req.params.token);
  if ("error" in found) return res.status(found.status).json({ error: found.error });
  const { link, version } = found;

  let buffer: Buffer;
  try {
    buffer = readFile(version.storageKey);
  } catch {
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
      documentId: link.document.id,
      caseId: link.document.caseId,
      notes: "Share-link download blocked: stored file does not match recorded SHA-256",
    });
    return res.status(409).json({ error: "Download blocked: this file failed an integrity check." });
  }

  // Atomically claim one use. If two people race for the last use, only one wins.
  const claimed = await prisma.shareLink.updateMany({
    where: { id: link.id, useCount: { lt: link.maxUses }, expiresAt: { gt: new Date() } },
    data: { useCount: { increment: 1 } },
  });
  if (claimed.count === 0) {
    return res.status(410).json({ error: "This link has reached its download limit." });
  }

  await recordAudit({
    action: "DOCUMENT_DOWNLOADED",
    documentId: link.document.id,
    caseId: link.document.caseId,
    notes: `Downloaded v${version.versionNo} via share link created by ${link.createdBy.name}`,
  });

  res.setHeader("Content-Type", version.mimeType);
  res.setHeader("Content-Disposition", attachmentHeader(version.originalName));
  return res.send(buffer);
});

export default router;
