import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { accessibleCaseIds } from "../lib/access";
import {
  issueSigningChallenge,
  registerUserSigningKey,
  getUserSigningKey,
  signDocumentVersion,
  verifyExistingSignature,
  generateSection65BCertificateDraft,
  SignatureError,
} from "../services/signature.service";

const router = Router();

// 1. POST /api/signatures/challenge - Issue server-signed challenge with timestamp & nonce
const challengeSchema = z.object({
  documentVersionId: z.string().min(1),
});

router.post("/challenge", requireAuth, async (req, res) => {
  const parsed = challengeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  }

  const { sub: userId, role } = req.user!;
  try {
    const challenge = await issueSigningChallenge(userId, role, parsed.data.documentVersionId);
    return res.status(200).json({ challenge });
  } catch (err) {
    if (err instanceof SignatureError) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    throw err;
  }
});

// 2. POST /api/signatures/public-key - Register or update user public key
const registerKeySchema = z.object({
  publicKeyPem: z.string().min(10),
  algorithm: z.string().optional(),
  label: z.string().max(100).optional(),
});

router.post("/public-key", requireAuth, async (req, res) => {
  const parsed = registerKeySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  }

  const { sub: userId } = req.user!;
  try {
    const result = await registerUserSigningKey(
      userId,
      parsed.data.publicKeyPem,
      parsed.data.algorithm,
      parsed.data.label
    );
    return res.status(201).json({ key: result });
  } catch (err) {
    if (err instanceof SignatureError) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    throw err;
  }
});

// 3. GET /api/signatures/public-key/:userId - Get public key of a user
router.get("/public-key/:userId", requireAuth, async (req, res) => {
  const key = await getUserSigningKey(req.params.userId);
  if (!key) {
    return res.status(404).json({ error: "User has no registered public signing key" });
  }
  return res.json({
    key: {
      id: key.id,
      keyId: key.keyId,
      keyFingerprint: key.keyFingerprint,
      publicKeyPem: key.publicKeyPem,
      algorithm: key.algorithm,
      label: key.label,
      createdAt: key.createdAt,
    },
  });
});

// 4. POST /api/signatures/sign - Submit cryptographic signature for a document version
const signSchema = z.object({
  documentVersionId: z.string().min(1),
  signatureValue: z.string().min(1),
  challengeNonce: z.string().min(32),
  publicKeyPem: z.string().optional(),
  algorithm: z.string().optional(),
});

router.post("/sign", requireAuth, async (req, res) => {
  const parsed = signSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  }

  const { sub: userId, role } = req.user!;
  try {
    const result = await signDocumentVersion({
      userId,
      role,
      documentVersionId: parsed.data.documentVersionId,
      signatureValue: parsed.data.signatureValue,
      challengeNonce: parsed.data.challengeNonce,
      publicKeyPem: parsed.data.publicKeyPem,
      algorithm: parsed.data.algorithm,
    });
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof SignatureError) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    throw err;
  }
});

// 5. GET /api/signatures/verify/:id - Cryptographically verify signature
router.get("/verify/:id", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  try {
    const report = await verifyExistingSignature(req.params.id, userId, role);
    return res.json({ report });
  } catch (err) {
    if (err instanceof SignatureError) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    throw err;
  }
});

// 6. GET /api/signatures/certificate/:documentVersionId - Section 65B Certificate Draft
router.get("/certificate/:documentVersionId", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  try {
    const certificate = await generateSection65BCertificateDraft(req.params.documentVersionId, userId, role);
    return res.json({ certificate });
  } catch (err) {
    if (err instanceof SignatureError) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    throw err;
  }
});

// 7. GET /api/signatures - List signatures across accessible cases
router.get("/", requireAuth, async (req, res) => {
  const { sub: userId, role } = req.user!;
  const { caseId, documentId } = req.query as { caseId?: string; documentId?: string };

  let where: any = {};
  if (role !== "ADMIN") {
    const caseIds = (await accessibleCaseIds(userId, role)) as string[];
    where = {
      document: {
        caseId: { in: caseIds },
      },
    };
  }

  if (caseId) {
    where.document = { ...(where.document || {}), caseId };
  }
  if (documentId) {
    where.documentId = documentId;
  }

  const signatures = await prisma.digitalSignature.findMany({
    where,
    orderBy: { signedAt: "desc" },
    include: {
      signer: { select: { id: true, name: true, email: true, role: true } },
      document: { select: { id: true, name: true, caseId: true, case: { select: { caseNumber: true, title: true } } } },
      documentVersion: { select: { id: true, versionNo: true, sha256: true, originalName: true } },
    },
  });

  return res.json({ signatures });
});

export default router;
