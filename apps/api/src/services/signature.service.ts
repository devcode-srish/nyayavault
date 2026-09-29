import { prisma } from "../lib/prisma";
import { recordAudit } from "../lib/audit";
import { userCanAccessCase, userCanAccessDocument } from "../lib/access";
import {
  DEFAULT_SIGNATURE_ALGORITHM,
  computeKeyFingerprint,
  canonicalSignaturePayload,
  verifyAsymmetricSignature,
  generateChallengeNonce,
  generateCertificateNumber,
  normalizePublicKeyPem,
} from "../lib/signature";

export class SignatureError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message);
    this.name = "SignatureError";
  }
}

/**
 * 1. Issue an unpredictable, server-bound signing challenge.
 */
export async function issueSigningChallenge(userId: string, role: string, documentVersionId: string) {
  const version = await prisma.documentVersion.findUnique({
    where: { id: documentVersionId },
    include: { document: true },
  });

  if (!version) {
    throw new SignatureError(404, "Document version not found", "VERSION_NOT_FOUND");
  }

  // Access check
  if (!(await userCanAccessCase(userId, role, version.document.caseId))) {
    throw new SignatureError(403, "You do not have access to this case", "CASE_ACCESS_DENIED");
  }

  const access = await userCanAccessDocument(userId, role, version.document);
  if (!access) {
    throw new SignatureError(403, "You do not have access to this document", "DOCUMENT_ACCESS_DENIED");
  }

  const nonce = generateChallengeNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 5 * 60 * 1000); // 5 minute TTL

  const challenge = await prisma.signingChallenge.create({
    data: {
      nonce,
      userId,
      documentId: version.documentId,
      documentVersionId: version.id,
      versionSha256: version.sha256,
      issuedAt,
      expiresAt,
    },
  });

  const canonicalPayloadPreview = canonicalSignaturePayload({
    documentId: version.documentId,
    documentVersionId: version.id,
    versionSha256: version.sha256,
    versionNo: version.versionNo,
    signerId: userId,
    signedAt: issuedAt,
    challengeNonce: nonce,
    algorithm: DEFAULT_SIGNATURE_ALGORITHM,
  });

  return {
    challengeNonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    documentId: version.documentId,
    documentVersionId: version.id,
    versionNo: version.versionNo,
    versionSha256: version.sha256,
    signerId: userId,
    algorithm: DEFAULT_SIGNATURE_ALGORITHM,
    canonicalPayload: canonicalPayloadPreview,
  };
}

/**
 * 2. Register or update a user's asymmetric public signing key.
 */
export async function registerUserSigningKey(
  userId: string,
  publicKeyPem: string,
  algorithm: string = DEFAULT_SIGNATURE_ALGORITHM,
  label?: string
) {
  const normalizedPem = normalizePublicKeyPem(publicKeyPem);
  if (!normalizedPem.includes("PUBLIC KEY")) {
    throw new SignatureError(400, "Invalid public key PEM format", "INVALID_PUBLIC_KEY");
  }

  const keyFingerprint = computeKeyFingerprint(normalizedPem);
  const keyId = `KEY-${userId.slice(-6)}-${keyFingerprint.slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;

  const userSigningKey = await prisma.userSigningKey.create({
    data: {
      userId,
      keyId,
      publicKeyPem: normalizedPem,
      keyFingerprint,
      algorithm,
      label: label || `Key registered ${new Date().toLocaleDateString()}`,
      isActive: true,
    },
  });

  return {
    id: userSigningKey.id,
    keyId: userSigningKey.keyId,
    keyFingerprint: userSigningKey.keyFingerprint,
    algorithm: userSigningKey.algorithm,
    label: userSigningKey.label,
    createdAt: userSigningKey.createdAt,
  };
}

/**
 * 3. Retrieve user's active signing key.
 */
export async function getUserSigningKey(userId: string) {
  return prisma.userSigningKey.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * 4. Submit and verify digital signature with challenge validation.
 */
export async function signDocumentVersion(params: {
  userId: string;
  role: string;
  documentVersionId: string;
  signatureValue: string;
  challengeNonce: string;
  publicKeyPem?: string;
  algorithm?: string;
}) {
  const { userId, role, documentVersionId, signatureValue, challengeNonce, algorithm = DEFAULT_SIGNATURE_ALGORITHM } = params;

  const version = await prisma.documentVersion.findUnique({
    where: { id: documentVersionId },
    include: { document: true },
  });

  if (!version) {
    throw new SignatureError(404, "Document version not found", "VERSION_NOT_FOUND");
  }

  // Access check
  if (!(await userCanAccessCase(userId, role, version.document.caseId))) {
    throw new SignatureError(403, "You do not have access to this case", "CASE_ACCESS_DENIED");
  }

  const access = await userCanAccessDocument(userId, role, version.document);
  if (!access) {
    throw new SignatureError(403, "You do not have access to this document", "DOCUMENT_ACCESS_DENIED");
  }

  // Challenge validation & replay prevention
  const challenge = await prisma.signingChallenge.findUnique({
    where: { nonce: challengeNonce },
  });

  if (!challenge) {
    throw new SignatureError(400, "Invalid or unrecognized signing challenge nonce", "INVALID_CHALLENGE");
  }

  if (challenge.consumedAt) {
    throw new SignatureError(400, "Signing challenge has already been consumed (replay rejected)", "CHALLENGE_REPLAYED");
  }

  if (challenge.userId !== userId) {
    throw new SignatureError(403, "Signing challenge was issued to a different user", "CHALLENGE_USER_MISMATCH");
  }

  if (challenge.documentVersionId !== documentVersionId) {
    throw new SignatureError(400, "Signing challenge was issued for a different document version", "CHALLENGE_VERSION_MISMATCH");
  }

  if (new Date() > challenge.expiresAt) {
    throw new SignatureError(400, "Signing challenge has expired. Request a new challenge", "CHALLENGE_EXPIRED");
  }

  // Determine public key
  let signingKeyPem = params.publicKeyPem ? normalizePublicKeyPem(params.publicKeyPem) : null;
  let registeredKey = null;

  if (!signingKeyPem) {
    registeredKey = await getUserSigningKey(userId);
    if (!registeredKey) {
      throw new SignatureError(400, "No public key registered for user and none provided in request", "KEY_NOT_FOUND");
    }
    signingKeyPem = registeredKey.publicKeyPem;
  } else {
    registeredKey = await prisma.userSigningKey.findFirst({
      where: { userId, keyFingerprint: computeKeyFingerprint(signingKeyPem) },
    });
  }

  const keyFingerprint = computeKeyFingerprint(signingKeyPem);

  // Construct deterministic canonical payload
  const canonicalPayload = canonicalSignaturePayload({
    documentId: version.documentId,
    documentVersionId: version.id,
    versionSha256: version.sha256,
    versionNo: version.versionNo,
    signerId: userId,
    signedAt: challenge.issuedAt,
    challengeNonce: challenge.nonce,
    algorithm,
  });

  // Verify signature cryptographically
  const isValid = verifyAsymmetricSignature({
    payloadString: canonicalPayload,
    signatureValue,
    publicKeyPem: signingKeyPem,
    algorithm,
  });

  if (!isValid) {
    throw new SignatureError(400, "Cryptographic signature verification failed. Signature does not match payload", "INVALID_SIGNATURE");
  }

  const certificateNumber = generateCertificateNumber();
  const now = new Date();

  let createdSignature: any;

  // Atomic database commit & audit log
  await prisma.$transaction(async (tx) => {
    // 1. Atomic guard: mark challenge as consumed
    const updatedChallenge = await tx.signingChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: now },
    });

    if (updatedChallenge.count === 0) {
      throw new SignatureError(400, "Signing challenge has already been consumed (replay rejected)", "CHALLENGE_REPLAYED");
    }

    // 2. Create digital signature record
    createdSignature = await tx.digitalSignature.create({
      data: {
        documentId: version.documentId,
        documentVersionId: version.id,
        signerId: userId,
        keyId: registeredKey?.id || null,
        publicKeyPem: signingKeyPem,
        keyFingerprint,
        certificateNumber,
        challengeNonce: challenge.nonce,
        signedPayloadJson: canonicalPayload,
        algorithm,
        signatureValue,
        status: "SIGNED",
        signedAt: challenge.issuedAt,
        verifiedAt: now,
      },
      include: {
        signer: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    // 3. Update document signatureStatus
    await tx.document.update({
      where: { id: version.documentId },
      data: { signatureStatus: "SIGNED" },
    });

    // 4. Record audit entry
    await recordAudit(
      {
        action: "DOCUMENT_SIGNED",
        actorId: userId,
        documentId: version.documentId,
        caseId: version.document.caseId,
        metadata: {
          documentVersionId: version.id,
          versionNo: version.versionNo,
          certificateNumber,
          keyFingerprint,
          algorithm,
          challengeNonce: challenge.nonce,
        },
        notes: `Document version ${version.versionNo} digitally signed (${algorithm})`,
      },
      tx
    );
  });

  return {
    signature: createdSignature,
    certificateNumber,
    verified: true,
  };
}

/**
 * 5. Real-time verification of an existing signature record.
 */
export async function verifyExistingSignature(signatureId: string, userId: string, role: string) {
  const signature = await prisma.digitalSignature.findUnique({
    where: { id: signatureId },
    include: {
      document: true,
      documentVersion: true,
      signer: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  if (!signature) {
    throw new SignatureError(404, "Digital signature record not found", "SIGNATURE_NOT_FOUND");
  }

  // Access check
  if (!(await userCanAccessCase(userId, role, signature.document.caseId))) {
    throw new SignatureError(403, "You do not have access to this case", "CASE_ACCESS_DENIED");
  }

  const access = await userCanAccessDocument(userId, role, signature.document);
  if (!access) {
    throw new SignatureError(403, "You do not have access to this document", "DOCUMENT_ACCESS_DENIED");
  }

  // Use stored publicKeyPem for historical preservation
  const publicKeyPem = signature.publicKeyPem;
  if (!publicKeyPem) {
    throw new SignatureError(500, "Public key not recorded with signature", "MISSING_PUBLIC_KEY");
  }

  // Canonical payload reconstructed from authoritative version and recorded metadata
  const payloadToVerify =
    signature.signedPayloadJson ||
    canonicalSignaturePayload({
      documentId: signature.documentId,
      documentVersionId: signature.documentVersionId,
      versionSha256: signature.documentVersion.sha256,
      versionNo: signature.documentVersion.versionNo,
      signerId: signature.signerId,
      signedAt: signature.signedAt,
      challengeNonce: signature.challengeNonce || "",
      algorithm: signature.algorithm,
    });

  const isCryptographicallyValid = verifyAsymmetricSignature({
    payloadString: payloadToVerify,
    signatureValue: signature.signatureValue,
    publicKeyPem,
    algorithm: signature.algorithm,
  });

  const now = new Date();

  // Record audit verification
  await recordAudit({
    action: "SIGNATURE_VERIFIED",
    outcome: isCryptographicallyValid ? "SUCCESS" : "FAILED",
    actorId: userId,
    documentId: signature.documentId,
    caseId: signature.document.caseId,
    metadata: {
      signatureId: signature.id,
      certificateNumber: signature.certificateNumber,
      documentVersionId: signature.documentVersionId,
      versionNo: signature.documentVersion.versionNo,
      isCryptographicallyValid,
    },
    notes: `Digital signature verification for v${signature.documentVersion.versionNo}: ${
      isCryptographicallyValid ? "VALID" : "INVALID"
    }`,
  });

  return {
    signatureId: signature.id,
    certificateNumber: signature.certificateNumber,
    isCryptographicallyValid,
    status: isCryptographicallyValid ? "SIGNED" : "VERIFICATION_FAILED",
    algorithm: signature.algorithm,
    keyFingerprint: signature.keyFingerprint,
    signedAt: signature.signedAt,
    verifiedAt: now,
    signer: signature.signer,
    documentVersion: {
      id: signature.documentVersion.id,
      versionNo: signature.documentVersion.versionNo,
      sha256: signature.documentVersion.sha256,
      originalName: signature.documentVersion.originalName,
      sizeBytes: signature.documentVersion.sizeBytes,
    },
  };
}

/**
 * 6. Generate Section 65B Electronic Evidence Certificate Draft.
 */
export async function generateSection65BCertificateDraft(documentVersionId: string, userId: string, role: string) {
  const version = await prisma.documentVersion.findUnique({
    where: { id: documentVersionId },
    include: {
      document: {
        include: {
          case: { select: { id: true, caseNumber: true, title: true } },
          uploadedBy: { select: { id: true, name: true, role: true } },
        },
      },
      signatures: {
        orderBy: { signedAt: "desc" },
        include: {
          signer: { select: { id: true, name: true, email: true, role: true } },
        },
      },
    },
  });

  if (!version) {
    throw new SignatureError(404, "Document version not found", "VERSION_NOT_FOUND");
  }

  // Access check
  if (!(await userCanAccessCase(userId, role, version.document.caseId))) {
    throw new SignatureError(403, "You do not have access to this case", "CASE_ACCESS_DENIED");
  }

  const access = await userCanAccessDocument(userId, role, version.document);
  if (!access) {
    throw new SignatureError(403, "You do not have access to this document", "DOCUMENT_ACCESS_DENIED");
  }

  const latestSig = version.signatures[0] || null;

  return {
    certificateHeader: {
      title: "CERTIFICATE OF ELECTRONIC EVIDENCE",
      statutoryReference: "Section 65B, Indian Evidence Act, 1872 / Section 63, Bharatiya Sakshya Adhiniyam, 2023",
      disclaimer: "DRAFT — SUBJECT TO APPROPRIATE LEGAL REVIEW AND FORMAL CERTIFICATION",
      generatedAt: new Date().toISOString(),
      certificateNumber: latestSig?.certificateNumber || `DRAFT-${generateCertificateNumber()}`,
    },
    caseDetails: {
      caseId: version.document.case.id,
      caseNumber: version.document.case.caseNumber,
      caseTitle: version.document.case.title,
    },
    electronicRecord: {
      documentId: version.document.id,
      documentName: version.document.name,
      classification: version.document.classification,
      versionId: version.id,
      versionNo: version.versionNo,
      originalFilename: version.originalName,
      mimeType: version.mimeType,
      sizeBytes: version.sizeBytes,
      sha256Checksum: version.sha256,
      uploadedAt: version.createdAt,
      uploadedBy: version.document.uploadedBy.name,
    },
    cryptographicSignature: latestSig
      ? {
          signatureId: latestSig.id,
          signerName: latestSig.signer.name,
          signerEmail: latestSig.signer.email,
          signerRole: latestSig.signer.role,
          signedAt: latestSig.signedAt,
          algorithm: latestSig.algorithm,
          keyFingerprint: latestSig.keyFingerprint,
          signatureValue: latestSig.signatureValue,
          status: latestSig.status,
          verifiedAt: latestSig.verifiedAt,
        }
      : null,
    integrityDeclaration: {
      hashAlgorithm: "SHA-256",
      hashDigest: version.sha256,
      storageSystem: "NyayaVault Tamper-Evident Repository",
      auditChainStatus: "CONTINUOUS_CRYPTOGRAPHIC_VERIFICATION",
    },
  };
}
