/**
 * NyayaVault — Court Authority & Audit Checkpoint Signer
 *
 * Implements:
 * 1. RFC 8785 JSON Canonicalization Scheme (JCS) deterministic serialization.
 * 2. Institutional Authority Signing Keypair & Certificate management (ECDSA-P256-SHA256).
 * 3. Asymmetric digital signing of audit checkpoint blocks for courtroom bundles.
 * 4. Zero-dependency cryptographic verification of checkpoints.
 */

import crypto from "crypto";

export const AUTHORITY_ALGORITHM = "ECDSA-P256-SHA256";
export const AUTHORITY_ISSUER_NAME = "NyayaVault Central Authority (Unit-DEL-01)";

/**
 * RFC 8785 (JSON Canonicalization Scheme - JCS) Deterministic Serializer.
 * - Sorts all dictionary keys lexicographically by UTF-16 code units.
 * - Eliminates insignificant whitespace.
 * - Formats numbers and strings according to standard ECMAScript / JCS specifications.
 */
export function canonicalizeJSON(obj: any): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    const elements = obj.map((item) => canonicalizeJSON(item));
    return `[${elements.join(",")}]`;
  }

  const keys = Object.keys(obj).sort((a, b) => {
    // Lexicographical sort by UTF-16 code units
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });

  const properties: string[] = [];
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && typeof value !== "function" && typeof value !== "symbol") {
      const canonicalVal = canonicalizeJSON(value);
      properties.push(`${JSON.stringify(key)}:${canonicalVal}`);
    }
  }

  return `{${properties.join(",")}}`;
}

/**
 * Computes SHA-256 fingerprint of an SPKI public key PEM.
 */
export function computePublicKeyFingerprint(publicKeyPem: string): string {
  const cleanPem = publicKeyPem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  const spkiDer = Buffer.from(cleanPem, "base64");
  return crypto.createHash("sha256").update(spkiDer).digest("hex");
}

let cachedAuthorityKeypair: {
  privateKeyPem: string;
  publicKeyPem: string;
  keyFingerprint: string;
} | null = null;

/**
 * Retrieves or derives the Institutional Authority Keypair.
 */
export function getAuthorityKeypair(): {
  privateKeyPem: string;
  publicKeyPem: string;
  keyFingerprint: string;
} {
  if (cachedAuthorityKeypair) {
    return cachedAuthorityKeypair;
  }

  if (process.env.SERVER_AUTHORITY_PRIVATE_KEY && process.env.SERVER_AUTHORITY_PUBLIC_KEY) {
    const privateKeyPem = process.env.SERVER_AUTHORITY_PRIVATE_KEY.replace(/\\n/g, "\n");
    const publicKeyPem = process.env.SERVER_AUTHORITY_PUBLIC_KEY.replace(/\\n/g, "\n");
    cachedAuthorityKeypair = {
      privateKeyPem,
      publicKeyPem,
      keyFingerprint: computePublicKeyFingerprint(publicKeyPem),
    };
    return cachedAuthorityKeypair;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "FATAL: SERVER_AUTHORITY_PRIVATE_KEY and SERVER_AUTHORITY_PUBLIC_KEY must be configured in production environment."
    );
  }

  // Development/Test fallback only
  // Generate ECDSA P-256 Keypair
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  cachedAuthorityKeypair = {
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    keyFingerprint: computePublicKeyFingerprint(publicKey),
  };

  return cachedAuthorityKeypair;
}

/**
 * Signs an audit checkpoint object using RFC 8785 JCS canonicalization and ECDSA-P256-SHA256.
 * Returns the canonical JSON string, DER Base64 signature, and signer key fingerprint.
 */
export function signAuditCheckpoint(checkpointPayload: Record<string, any>): {
  canonicalJson: string;
  signatureBase64: string;
  keyFingerprint: string;
  issuer: string;
} {
  const { privateKeyPem, keyFingerprint } = getAuthorityKeypair();
  const canonicalJson = canonicalizeJSON(checkpointPayload);
  const inputBytes = Buffer.from(canonicalJson, "utf8");

  const sign = crypto.createSign("SHA256");
  sign.update(inputBytes);
  sign.end();

  const signatureBase64 = sign.sign(privateKeyPem).toString("base64");

  return {
    canonicalJson,
    signatureBase64,
    keyFingerprint,
    issuer: AUTHORITY_ISSUER_NAME,
  };
}

/**
 * Verifies a canonical checkpoint signature against an Authority Public Key.
 */
export function verifyAuditCheckpoint(
  canonicalJson: string,
  signatureBase64: string,
  publicKeyPem: string
): boolean {
  try {
    const inputBytes = Buffer.from(canonicalJson, "utf8");
    const verify = crypto.createVerify("SHA256");
    verify.update(inputBytes);
    verify.end();

    return verify.verify(publicKeyPem, Buffer.from(signatureBase64, "base64"));
  } catch (err) {
    return false;
  }
}
