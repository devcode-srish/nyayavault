import crypto from "crypto";
import { canonicalJson } from "./audit";

export const DEFAULT_SIGNATURE_ALGORITHM = "ECDSA-P256-SHA256";

/**
 * Normalizes a public key PEM string (cleans CRLF/LF variations).
 */
export function normalizePublicKeyPem(pem: string): string {
  return pem.trim().replace(/\r\n/g, "\n");
}

/**
 * Computes a SHA-256 fingerprint for a public key PEM.
 */
export function computeKeyFingerprint(publicKeyPem: string): string {
  const normalized = normalizePublicKeyPem(publicKeyPem);
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

export interface CanonicalSignaturePayloadInput {
  documentId: string;
  documentVersionId: string;
  versionSha256: string;
  versionNo: number;
  signerId: string;
  signedAt: Date | string;
  challengeNonce: string;
  algorithm?: string;
}

/**
 * Produces the unambiguous deterministic canonical JSON string
 * that the client must sign and the server verifies.
 */
export function canonicalSignaturePayload(input: CanonicalSignaturePayloadInput): string {
  const signedAtIso = input.signedAt instanceof Date ? input.signedAt.toISOString() : new Date(input.signedAt).toISOString();
  const canonicalObj = {
    algorithm: input.algorithm || DEFAULT_SIGNATURE_ALGORITHM,
    challengeNonce: input.challengeNonce,
    documentId: input.documentId,
    documentVersionId: input.documentVersionId,
    signedAt: signedAtIso,
    signerId: input.signerId,
    versionNo: input.versionNo,
    versionSha256: input.versionSha256,
  };
  return canonicalJson(canonicalObj);
}

/**
 * Verifies an asymmetric digital signature against a canonical payload string.
 * Supports ECDSA-P256-SHA256 (default) and RSA-SHA256.
 */
export function verifyAsymmetricSignature(params: {
  payloadString: string;
  signatureValue: string;
  publicKeyPem: string;
  algorithm?: string;
}): boolean {
  const { payloadString, signatureValue, publicKeyPem, algorithm = DEFAULT_SIGNATURE_ALGORITHM } = params;
  const normalizedKey = normalizePublicKeyPem(publicKeyPem);

  try {
    const signatureBuffer = Buffer.from(
      signatureValue,
      /^[0-9a-fA-F]+$/.test(signatureValue) && signatureValue.length % 2 === 0 ? "hex" : "base64"
    );

    const verifier = crypto.createVerify("SHA256");
    verifier.update(payloadString, "utf8");
    verifier.end();

    if (algorithm === "ECDSA-P256-SHA256" || algorithm === "ECDSA_P256") {
      return verifier.verify(
        {
          key: normalizedKey,
          dsaEncoding: "der",
        },
        signatureBuffer
      );
    } else if (algorithm === "RSA-SHA256" || algorithm === "RSA-SHA256-PROTOTYPE") {
      return verifier.verify(normalizedKey, signatureBuffer);
    } else {
      return verifier.verify(normalizedKey, signatureBuffer);
    }
  } catch {
    return false;
  }
}

/**
 * Cryptographic helper to generate an asymmetric key pair.
 * Used for testing, offline tools, and test harness execution.
 * (Note: Production private keys are retained client-side and never saved to the server DB).
 */
export function generateAsymmetricKeyPair(algorithm: "ECDSA-P256-SHA256" | "RSA-SHA256" = "ECDSA-P256-SHA256"): {
  publicKeyPem: string;
  privateKeyPem: string;
  keyFingerprint: string;
} {
  if (algorithm === "ECDSA-P256-SHA256") {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    return {
      publicKeyPem: normalizePublicKeyPem(publicKey),
      privateKeyPem: normalizePublicKeyPem(privateKey),
      keyFingerprint: computeKeyFingerprint(publicKey),
    };
  } else {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    return {
      publicKeyPem: normalizePublicKeyPem(publicKey),
      privateKeyPem: normalizePublicKeyPem(privateKey),
      keyFingerprint: computeKeyFingerprint(publicKey),
    };
  }
}

/**
 * Signs a canonical payload string using a private key PEM.
 * Used by test harnesses and client-side modules.
 */
export function signCanonicalPayload(
  payloadString: string,
  privateKeyPem: string,
  algorithm: "ECDSA-P256-SHA256" | "RSA-SHA256" = "ECDSA-P256-SHA256"
): string {
  const normalizedKey = normalizePublicKeyPem(privateKeyPem);
  const signer = crypto.createSign("SHA256");
  signer.update(payloadString, "utf8");
  signer.end();

  if (algorithm === "ECDSA-P256-SHA256") {
    return signer.sign({ key: normalizedKey, dsaEncoding: "der" }).toString("base64");
  } else {
    return signer.sign(normalizedKey).toString("base64");
  }
}

/**
 * Generates a cryptographically secure 256-bit hex challenge nonce.
 */
export function generateChallengeNonce(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Generates a Section 65B Electronic Evidence Certificate Reference Number.
 */
export function generateCertificateNumber(): string {
  const year = new Date().getFullYear();
  const randomPart = crypto.randomBytes(4).toString("hex").toUpperCase();
  const timePart = Date.now().toString(36).toUpperCase().slice(-4);
  return `SEC65B-${year}-${timePart}-${randomPart}`;
}
