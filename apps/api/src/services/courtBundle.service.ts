/**
 * NyayaVault — Courtroom Evidence Bundle Service & Archive Generator
 *
 * Implements:
 * 1. Assembly of multi-version evidence documents, timelines, custody receipts, and 65B certificates.
 * 2. Deterministic Merkle Tree computation (NYAYAVAULT-MERKLE-V1).
 * 3. Authority-signed RFC 8785 canonical audit checkpointing.
 * 4. Zero-dependency offline verifier bundling (verify.js + authority_cert.pem).
 * 5. Crash-safe tri-state lifecycle tracking (GENERATING, COMPLETED, FAILED) with automatic stale-job reconciliation.
 */

import crypto from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";
import { recordAudit } from "../lib/audit";
import { userCanAccessCase } from "../lib/access";
import { computeMerkleTree, ArtifactEntry } from "../lib/merkle";
import {
  signAuditCheckpoint,
  getAuthorityKeypair,
  canonicalizeJSON,
} from "../lib/courtAuthority";
import { createZipArchive, ZipEntry } from "../lib/zip";
import { generateVerifyScriptContent } from "../lib/verifyScript";
import { saveFile, readFile, fileExists } from "../lib/storage";

export class CourtBundleError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message);
    this.name = "CourtBundleError";
  }
}

/**
 * Allowed roles for generating and downloading court bundles.
 */
export const ALLOWED_BUNDLE_ROLES = [
  "ADMIN",
  "SENIOR_OFFICER",
  "INVESTIGATING_OFFICER",
  "LEGAL_OFFICER",
];

function generateBundleNumber(): string {
  const year = new Date().getFullYear();
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `NYA-CRTB-${year}-${rand}`;
}

/**
 * Reconciles stale GENERATING export jobs older than 15 minutes to FAILED.
 */
export async function reconcileStaleBundleJobs(caseId?: string): Promise<number> {
  const staleThreshold = new Date(Date.now() - 15 * 60 * 1000);
  const whereClause: any = {
    status: "GENERATING",
    createdAt: { lt: staleThreshold },
  };
  if (caseId) {
    whereClause.caseId = caseId;
  }

  const staleJobs = await prisma.courtBundleExport.findMany({
    where: whereClause,
  });

  for (const job of staleJobs) {
    await prisma.courtBundleExport.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorMessage: "Generation timed out after 15 minutes (reconciled)",
      },
    });

    await recordAudit({
      action: "COURT_BUNDLE_FAILED",
      actorId: job.exportedById,
      caseId: job.caseId,
      metadata: {
        bundleNumber: job.bundleNumber,
        reason: "Stale job timeout reconciliation",
      },
      notes: `Court bundle export ${job.bundleNumber} timed out and was reconciled to FAILED`,
    });
  }

  return staleJobs.length;
}

/**
 * Initiates and executes complete courtroom evidence bundle generation.
 */
export async function generateCourtBundle(params: {
  caseId: string;
  userId: string;
  role: string;
  courtRefNumber?: string;
}) {
  const { caseId, userId, role, courtRefNumber } = params;

  // 1. Authorization checks
  if (!ALLOWED_BUNDLE_ROLES.includes(role)) {
    throw new CourtBundleError(
      403,
      "Your role is not authorized to generate courtroom evidence bundles",
      "ROLE_NOT_AUTHORIZED"
    );
  }

  const hasAccess = await userCanAccessCase(userId, role, caseId);
  if (!hasAccess) {
    throw new CourtBundleError(403, "You do not have access to this case", "CASE_ACCESS_DENIED");
  }

  // 2. Reconcile stale jobs and check for active concurrency lock
  await reconcileStaleBundleJobs(caseId);

  const activeJob = await prisma.courtBundleExport.findFirst({
    where: {
      caseId,
      status: "GENERATING",
    },
  });

  if (activeJob) {
    throw new CourtBundleError(
      409,
      `A court evidence bundle is already being generated for this case (${activeJob.bundleNumber})`,
      "BUNDLE_IN_PROGRESS"
    );
  }

  // 3. Retrieve user and case details
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const caseRecord = await prisma.case.findUnique({
    where: { id: caseId },
    include: {
      members: {
        include: {
          user: { select: { id: true, name: true, role: true } },
        },
      },
    },
  });

  if (!caseRecord || !user) {
    throw new CourtBundleError(404, "Case or User not found", "NOT_FOUND");
  }

  const bundleNumber = generateBundleNumber();

  // 4. Create database export record with GENERATING status
  const exportRecord = await prisma.courtBundleExport.create({
    data: {
      caseId,
      bundleNumber,
      courtRefNumber: courtRefNumber || null,
      status: "GENERATING",
      exportedById: userId,
    },
  });

  // Emit COURT_BUNDLE_INITIATED audit log
  await recordAudit({
    action: "COURT_BUNDLE_INITIATED",
    actorId: userId,
    caseId,
    metadata: {
      bundleNumber,
      courtRefNumber,
    },
    notes: `Court evidence bundle generation initiated: ${bundleNumber}`,
  });

  try {
    // 5. Gather all exhibits, multi-version documents, timeline, and custody records
    const artifacts: ArtifactEntry[] = [];

    // 5a. Documents & Versions
    const documents = await prisma.document.findMany({
      where: { caseId },
      include: {
        versions: {
          orderBy: { versionNo: "asc" },
        },
        uploadedBy: { select: { id: true, name: true, role: true } },
      },
    });

    for (const doc of documents) {
      for (const ver of doc.versions) {
        if (fileExists(ver.storageKey)) {
          const fileBuffer = readFile(ver.storageKey);
          const sanitizedFilename = ver.originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
          const artifactPath = `artifacts/documents/${doc.id}/v${ver.versionNo}_${sanitizedFilename}`;
          artifacts.push({
            path: artifactPath,
            content: fileBuffer,
          });
        }
      }
    }

    // 5b. Timeline Events
    const timelineEvents = await prisma.investigationTimelineEvent.findMany({
      where: { caseId },
      orderBy: { occurredAt: "asc" },
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
      },
    });

    const timelinePayload = {
      caseId: caseRecord.id,
      caseNumber: caseRecord.caseNumber,
      caseTitle: caseRecord.title,
      exportedAt: new Date().toISOString(),
      totalEvents: timelineEvents.length,
      events: timelineEvents.map((e) => ({
        id: e.id,
        category: e.category,
        title: e.title,
        description: e.description,
        occurredAt: e.occurredAt.toISOString(),
        createdAt: e.createdAt.toISOString(),
        isMilestone: e.isMilestone,
        createdBy: e.createdBy ? { name: e.createdBy.name, role: e.createdBy.role } : null,
      })),
    };

    artifacts.push({
      path: "artifacts/timeline/timeline.json",
      content: canonicalizeJSON(timelinePayload),
    });

    // 5c. Physical Custody Transfers & Receipts
    const evidenceItems = await prisma.evidenceItem.findMany({
      where: { caseId },
      include: {
        transfers: {
          orderBy: { transferredAt: "asc" },
          include: {
            fromUser: { select: { id: true, name: true, role: true } },
            toUser: { select: { id: true, name: true, role: true } },
          },
        },
      },
    });

    const custodyPayload = {
      caseId: caseRecord.id,
      caseNumber: caseRecord.caseNumber,
      exportedAt: new Date().toISOString(),
      evidenceItems: evidenceItems.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        status: item.status,
        transfers: item.transfers.map((t) => ({
          transferId: t.id,
          status: t.status,
          transferredAt: t.transferredAt.toISOString(),
          decidedAt: t.decidedAt ? t.decidedAt.toISOString() : null,
          sender: t.fromUser ? { name: t.fromUser.name, role: t.fromUser.role } : null,
          recipient: { name: t.toUser.name, role: t.toUser.role },
          purpose: t.purpose,
          sealNumber: t.sealNumber,
          packageCondition: t.packageCondition,
        })),
      })),
    };

    artifacts.push({
      path: "artifacts/custody/custody_history.json",
      content: canonicalizeJSON(custodyPayload),
    });

    // 5d. Section 65B Digital Signatures
    const signatures = await prisma.digitalSignature.findMany({
      where: {
        document: { caseId },
      },
      include: {
        document: { select: { id: true, name: true } },
        documentVersion: { select: { id: true, versionNo: true, sha256: true } },
        signer: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { signedAt: "asc" },
    });

    const signaturesPayload = {
      caseId: caseRecord.id,
      caseNumber: caseRecord.caseNumber,
      statutoryReference: "Section 65B, Indian Evidence Act / Section 63, Bharatiya Sakshya Adhiniyam",
      exportedAt: new Date().toISOString(),
      totalSignatures: signatures.length,
      signatures: signatures.map((s) => ({
        id: s.id,
        certificateNumber: s.certificateNumber,
        documentId: s.documentId,
        documentName: s.document.name,
        documentVersionId: s.documentVersionId,
        versionNo: s.documentVersion.versionNo,
        versionSha256: s.documentVersion.sha256,
        signer: {
          id: s.signer.id,
          name: s.signer.name,
          role: s.signer.role,
        },
        keyFingerprint: s.keyFingerprint,
        publicKeyPem: s.publicKeyPem,
        algorithm: s.algorithm,
        signedPayloadJson: s.signedPayloadJson,
        signatureValue: s.signatureValue,
        signedAt: s.signedAt.toISOString(),
      })),
    };

    artifacts.push({
      path: "artifacts/section65b/signatures.json",
      content: canonicalizeJSON(signaturesPayload),
    });

    // 6. Compute Canonical Merkle Tree (NYAYAVAULT-MERKLE-V1)
    const merkleResult = computeMerkleTree(artifacts);

    // 7. Obtain Latest Audit Hash Block for Anchor
    const latestAudit = await prisma.auditLog.findFirst({
      orderBy: { createdAt: "desc" },
    });
    const chainTipHeight = await prisma.auditLog.count();
    const chainTipHash = latestAudit?.hash || "GENESIS_ROOT";

    // 8. Construct & Sign Authority Checkpoint
    const checkpointData = {
      bundleNumber,
      caseId: caseRecord.id,
      caseNumber: caseRecord.caseNumber,
      courtRefNumber: courtRefNumber || null,
      merkleAlgorithm: merkleResult.algorithm,
      merkleRootHash: merkleResult.merkleRoot,
      artifactCount: merkleResult.artifactCount,
      chainTipHeight,
      chainTipHash,
      anchoredAt: new Date().toISOString(),
      exportedBy: {
        id: user.id,
        name: user.name,
        role: user.role,
      },
    };

    const signedCheckpoint = signAuditCheckpoint(checkpointData);
    const authorityKeypair = getAuthorityKeypair();

    // 9. Build Manifest Structure (manifest.json)
    const manifest = {
      schemaVersion: "3.4.0",
      docketType: "COURT_EVIDENCE_BUNDLE",
      bundleNumber,
      courtRefNumber: courtRefNumber || null,
      generatedAt: checkpointData.anchoredAt,
      caseDetails: {
        id: caseRecord.id,
        caseNumber: caseRecord.caseNumber,
        title: caseRecord.title,
        status: caseRecord.status,
        description: caseRecord.description,
        createdAt: caseRecord.createdAt.toISOString(),
      },
      exportedBy: {
        id: user.id,
        name: user.name,
        role: user.role,
      },
      merkleAlgorithm: merkleResult.algorithm,
      merkleRootHash: merkleResult.merkleRoot,
      totalArtifacts: merkleResult.artifactCount,
      artifacts: merkleResult.leaves.map((leaf) => ({
        path: leaf.path,
        sha256: leaf.fileSha256,
        leafHash: leaf.leafHash,
      })),
      section65bSignatures: signaturesPayload.signatures,
      authorityCheckpoint: {
        payload: checkpointData,
        canonicalJson: signedCheckpoint.canonicalJson,
        signatureBase64: signedCheckpoint.signatureBase64,
        keyFingerprint: signedCheckpoint.keyFingerprint,
        issuer: signedCheckpoint.issuer,
      },
      disclaimer:
        "This bundle is an electronic record prepared in accordance with Section 65B of the Indian Evidence Act, 1872 / Section 63 of Bharatiya Sakshya Adhiniyam, 2023. Mathematical integrity does not constitute a judicial ruling on substantive truth or statutory admissibility.",
    };

    // 10. Prepare ZIP entries
    const zipEntries: ZipEntry[] = [
      ...artifacts,
      {
        path: "manifest.json",
        content: canonicalizeJSON(manifest),
      },
      {
        path: "trust/authority_cert.pem",
        content: authorityKeypair.publicKeyPem,
      },
      {
        path: "verify.js",
        content: generateVerifyScriptContent(),
      },
    ];

    // 11. Create ZIP archive and save to storage
    const zipBuffer = createZipArchive(zipEntries);
    const zipStorageKey = saveFile(zipBuffer, `${bundleNumber}.zip`);

    // 12. Update database record to COMPLETED
    const completedExport = await prisma.courtBundleExport.update({
      where: { id: exportRecord.id },
      data: {
        status: "COMPLETED",
        merkleRootHash: merkleResult.merkleRoot,
        authorityKeyFp: signedCheckpoint.keyFingerprint,
        authoritySignature: signedCheckpoint.signatureBase64,
        zipStorageKey,
        zipSizeBytes: zipBuffer.length,
        manifestJson: manifest as any,
        completedAt: new Date(),
      },
    });

    // 13. Emit COURT_BUNDLE_COMPLETED audit log
    await recordAudit({
      action: "COURT_BUNDLE_COMPLETED",
      actorId: userId,
      caseId,
      metadata: {
        bundleId: completedExport.id,
        bundleNumber,
        merkleRootHash: merkleResult.merkleRoot,
        artifactCount: merkleResult.artifactCount,
        zipSizeBytes: zipBuffer.length,
        authorityKeyFp: signedCheckpoint.keyFingerprint,
      },
      notes: `Court evidence bundle generated successfully: ${bundleNumber} (Merkle: ${merkleResult.merkleRoot})`,
    });

    return {
      success: true,
      bundle: completedExport,
      merkleRoot: merkleResult.merkleRoot,
      artifactCount: merkleResult.artifactCount,
      zipSizeBytes: zipBuffer.length,
    };
  } catch (err: any) {
    // 14. Error handling & reconciliation
    await prisma.courtBundleExport.update({
      where: { id: exportRecord.id },
      data: {
        status: "FAILED",
        errorMessage: err?.message || "Bundle generation failed",
      },
    });

    await recordAudit({
      action: "COURT_BUNDLE_FAILED",
      actorId: userId,
      caseId,
      metadata: {
        bundleId: exportRecord.id,
        bundleNumber,
        error: err?.message || "Unknown error",
      },
      notes: `Court evidence bundle generation failed for ${bundleNumber}: ${err?.message || "Unknown error"}`,
    });

    throw err;
  }
}

/**
 * Lists historical court bundle exports for a case.
 */
export async function listCaseCourtBundles(caseId: string, userId: string, role: string) {
  const hasAccess = await userCanAccessCase(userId, role, caseId);
  if (!hasAccess) {
    throw new CourtBundleError(403, "You do not have access to this case", "CASE_ACCESS_DENIED");
  }

  return prisma.courtBundleExport.findMany({
    where: { caseId },
    orderBy: { createdAt: "desc" },
    include: {
      exportedBy: { select: { id: true, name: true, role: true, email: true } },
    },
  });
}

/**
 * Retrieves the binary stream / buffer for downloading a completed bundle.
 */
export async function getCourtBundleDownload(bundleId: string, userId: string, role: string) {
  const bundle = await prisma.courtBundleExport.findUnique({
    where: { id: bundleId },
    include: {
      case: true,
      exportedBy: { select: { id: true, name: true, role: true } },
    },
  });

  if (!bundle) {
    throw new CourtBundleError(404, "Court bundle export not found", "BUNDLE_NOT_FOUND");
  }

  const hasAccess = await userCanAccessCase(userId, role, bundle.caseId);
  if (!hasAccess) {
    throw new CourtBundleError(403, "You do not have access to this case", "CASE_ACCESS_DENIED");
  }

  if (bundle.status !== "COMPLETED" || !bundle.zipStorageKey) {
    throw new CourtBundleError(
      400,
      `Bundle is not ready for download (Status: ${bundle.status})`,
      "BUNDLE_NOT_READY"
    );
  }

  if (!fileExists(bundle.zipStorageKey)) {
    throw new CourtBundleError(500, "ZIP archive not found in storage", "ARCHIVE_FILE_MISSING");
  }

  const zipBuffer = readFile(bundle.zipStorageKey);
  return {
    bundle,
    zipBuffer,
    filename: `${bundle.bundleNumber}.zip`,
    sizeBytes: zipBuffer.length,
  };
}
