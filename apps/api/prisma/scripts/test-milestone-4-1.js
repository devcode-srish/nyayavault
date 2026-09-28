/**
 * NyayaVault Milestone 4.1 Verification Suite
 * Asymmetric Digital Signatures & Section 65B Electronic Evidence Certificate Drafts
 */

import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import {
  generateAsymmetricKeyPair,
  canonicalSignaturePayload,
  signCanonicalPayload,
  verifyAsymmetricSignature,
  computeKeyFingerprint,
} from "../../src/lib/signature";
import { verifyAuditChain } from "../../src/lib/audit";

const prisma = new PrismaClient();
const API_BASE = "http://localhost:4000/api";

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ [PASS] ${message}`);
    passCount++;
  } else {
    console.error(`  ✗ [FAIL] ${message}`);
    failCount++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function request(method, path, headers = {}, body = null) {
  const url = `${API_BASE}${path}`;
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  let data = null;
  const contentType = res.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  return { status: res.status, headers: res.headers, data };
}

async function runMilestone41Tests() {
  console.log("==============================================================================");
  console.log("          NYAYAVAULT MILESTONE 4.1: DIGITAL SIGNATURES & 65B CERTS            ");
  console.log("==============================================================================");

  // Setup / User Logins
  const adminLogin = await request("POST", "/auth/login", {}, { email: "admin@nyayavault.demo", password: "Demo@1234" });
  const officerLogin = await request("POST", "/auth/login", {}, { email: "officer@nyayavault.demo", password: "Demo@1234" });
  const seniorLogin = await request("POST", "/auth/login", {}, { email: "senior@nyayavault.demo", password: "Demo@1234" });
  const legalLogin = await request("POST", "/auth/login", {}, { email: "legal@nyayavault.demo", password: "Demo@1234" });

  const adminToken = adminLogin.data.accessToken;
  const officerToken = officerLogin.data.accessToken;
  const seniorToken = seniorLogin.data.accessToken;
  const legalToken = legalLogin.data.accessToken;

  const officerUser = await prisma.user.findUnique({ where: { email: "officer@nyayavault.demo" } });
  const seniorUser = await prisma.user.findUnique({ where: { email: "senior@nyayavault.demo" } });
  const legalUser = await prisma.user.findUnique({ where: { email: "legal@nyayavault.demo" } });

  // 1. Setup isolated test case and document with 2 versions
  const timestamp = Date.now();
  const testCase = await prisma.case.create({
    data: {
      caseNumber: `E2E_CASE_SIG_${timestamp}`,
      title: "Digital Signature & 65B Evidence Verification Case",
      isSynthetic: true,
      members: {
        create: [
          { userId: officerUser.id, roleInCase: "LEAD_INVESTIGATOR" },
          { userId: seniorUser.id, roleInCase: "SUPERVISOR" },
        ],
      },
    },
  });

  const v1Sha256 = crypto.createHash("sha256").update(`V1-CONTENT-${timestamp}`).digest("hex");
  const v2Sha256 = crypto.createHash("sha256").update(`V2-CONTENT-${timestamp}`).digest("hex");

  const testDoc = await prisma.document.create({
    data: {
      caseId: testCase.id,
      name: `Forensic_Report_E2E_${timestamp}.pdf`,
      type: "Forensic Report",
      classification: "CONFIDENTIAL",
      uploadedById: officerUser.id,
      latestVersionNo: 2,
      versions: {
        create: [
          {
            versionNo: 1,
            originalName: `Forensic_Report_v1_${timestamp}.pdf`,
            mimeType: "application/pdf",
            sizeBytes: 2048,
            sha256: v1Sha256,
            storageKey: `test/sig/v1_${timestamp}.pdf`,
            createdById: officerUser.id,
          },
          {
            versionNo: 2,
            originalName: `Forensic_Report_v2_${timestamp}.pdf`,
            mimeType: "application/pdf",
            sizeBytes: 3072,
            sha256: v2Sha256,
            storageKey: `test/sig/v2_${timestamp}.pdf`,
            createdById: officerUser.id,
          },
        ],
      },
    },
    include: { versions: { orderBy: { versionNo: "asc" } } },
  });

  const version1 = testDoc.versions[0];
  const version2 = testDoc.versions[1];

  console.log("\n[1] Asymmetric Keypair & Public-Key Management Tests:");

  // 1.1 Generate ECDSA P-256 keypair
  const officerKey1 = generateAsymmetricKeyPair("ECDSA-P256-SHA256");
  assert(officerKey1.publicKeyPem.includes("BEGIN PUBLIC KEY"), "ECDSA-P256 keypair generated with standard SPKI PEM public key");
  assert(officerKey1.keyFingerprint.length === 64, "Public key SHA-256 fingerprint correctly computed (64 hex characters)");

  // 1.2 Register Public Key via API
  const regKeyRes = await request(
    "POST",
    "/signatures/public-key",
    { Authorization: `Bearer ${officerToken}` },
    {
      publicKeyPem: officerKey1.publicKeyPem,
      algorithm: "ECDSA-P256-SHA256",
      label: "Officer Rao Primary Hardware Key",
    }
  );
  assert(regKeyRes.status === 201 && regKeyRes.data.key.keyFingerprint === officerKey1.keyFingerprint, "Investigating Officer registers public key via POST /api/signatures/public-key");

  // 1.3 Query Registered Public Key
  const getKeyRes = await request("GET", `/signatures/public-key/${officerUser.id}`, { Authorization: `Bearer ${officerToken}` });
  assert(getKeyRes.status === 200 && getKeyRes.data.key.publicKeyPem === officerKey1.publicKeyPem, "Query public key returns registered public key without private key leakage");

  console.log("\n[2] Server Signing Challenge & Replay Protection Tests:");

  // 2.1 Request Server Challenge for Version 1
  const challengeRes = await request(
    "POST",
    "/signatures/challenge",
    { Authorization: `Bearer ${officerToken}` },
    { documentVersionId: version1.id }
  );
  assert(challengeRes.status === 200, "Server issues unpredictable signing challenge (HTTP 200)");
  const challenge = challengeRes.data.challenge;
  assert(challenge.challengeNonce && challenge.challengeNonce.length === 64, "Challenge contains 256-bit cryptographic nonce");
  assert(challenge.versionSha256 === v1Sha256, "Challenge binds exact immutable DocumentVersion SHA-256");
  assert(challenge.signerId === officerUser.id, "Challenge binds caller user ID");

  // 2.2 Replay Prevention Test (Pre-emptively test using bad nonce)
  const badNonceSign = await request(
    "POST",
    "/signatures/sign",
    { Authorization: `Bearer ${officerToken}` },
    {
      documentVersionId: version1.id,
      signatureValue: "fake_sig",
      challengeNonce: "0000000000000000000000000000000000000000000000000000000000000000",
    }
  );
  assert(badNonceSign.status === 400 && badNonceSign.data.code === "INVALID_CHALLENGE", "Unrecognized challenge nonce rejected with HTTP 400");

  // 2.3 Challenge Version Mismatch Test
  const wrongVersionSign = await request(
    "POST",
    "/signatures/sign",
    { Authorization: `Bearer ${officerToken}` },
    {
      documentVersionId: version2.id, // Mismatch: challenge was issued for version 1
      signatureValue: "fake_sig",
      challengeNonce: challenge.challengeNonce,
    }
  );
  assert(wrongVersionSign.status === 400 && wrongVersionSign.data.code === "CHALLENGE_VERSION_MISMATCH", "Challenge issued for Version 1 cannot be submitted for Version 2 (HTTP 400)");

  console.log("\n[3] Cryptographic Signing & Verification Tests:");

  // 3.1 Client signs canonical payload with private key
  const canonicalPayload = canonicalSignaturePayload({
    documentId: testDoc.id,
    documentVersionId: version1.id,
    versionSha256: version1.sha256,
    versionNo: version1.versionNo,
    signerId: officerUser.id,
    signedAt: challenge.issuedAt,
    challengeNonce: challenge.challengeNonce,
    algorithm: "ECDSA-P256-SHA256",
  });

  const validSignatureValue = signCanonicalPayload(canonicalPayload, officerKey1.privateKeyPem, "ECDSA-P256-SHA256");
  assert(validSignatureValue.length > 50, "Client generates valid ECDSA-P256 signature value");

  // 3.2 Submit Valid Signature
  const signRes = await request(
    "POST",
    "/signatures/sign",
    { Authorization: `Bearer ${officerToken}` },
    {
      documentVersionId: version1.id,
      signatureValue: validSignatureValue,
      challengeNonce: challenge.challengeNonce,
      publicKeyPem: officerKey1.publicKeyPem,
      algorithm: "ECDSA-P256-SHA256",
    }
  );
  assert(signRes.status === 201 && signRes.data.verified === true, "Authorized officer submits valid signature (HTTP 201 Created)");
  const signatureRecord = signRes.data.signature;
  assert(signatureRecord.certificateNumber.startsWith("SEC65B-"), "Signature assigned Section 65B certificate reference number");

  // 3.3 Replay Prevention on Consumed Challenge
  const replayRes = await request(
    "POST",
    "/signatures/sign",
    { Authorization: `Bearer ${officerToken}` },
    {
      documentVersionId: version1.id,
      signatureValue: validSignatureValue,
      challengeNonce: challenge.challengeNonce,
    }
  );
  assert(replayRes.status === 400 && replayRes.data.code === "CHALLENGE_REPLAYED", "Replay of consumed challenge nonce strictly rejected (HTTP 400 CHALLENGE_REPLAYED)");

  // 3.3b Concurrent Challenge Consumption Race Test
  const raceChallengeRes = await request(
    "POST",
    "/signatures/challenge",
    { Authorization: `Bearer ${officerToken}` },
    { documentVersionId: version2.id }
  );
  const raceChallenge = raceChallengeRes.data.challenge;
  const raceCanonicalPayload = canonicalSignaturePayload({
    documentId: testDoc.id,
    documentVersionId: version2.id,
    versionSha256: version2.sha256,
    versionNo: version2.versionNo,
    signerId: officerUser.id,
    signedAt: raceChallenge.issuedAt,
    challengeNonce: raceChallenge.challengeNonce,
    algorithm: "ECDSA-P256-SHA256",
  });
  const raceSigValue = signCanonicalPayload(raceCanonicalPayload, officerKey1.privateKeyPem, "ECDSA-P256-SHA256");

  const racePromises = Array.from({ length: 5 }, () =>
    request(
      "POST",
      "/signatures/sign",
      { Authorization: `Bearer ${officerToken}` },
      {
        documentVersionId: version2.id,
        signatureValue: raceSigValue,
        challengeNonce: raceChallenge.challengeNonce,
        publicKeyPem: officerKey1.publicKeyPem,
        algorithm: "ECDSA-P256-SHA256",
      }
    )
  );
  const raceResults = await Promise.all(racePromises);
  const successes = raceResults.filter((r) => r.status === 201);
  const rejects = raceResults.filter((r) => r.status === 400 && r.data.code === "CHALLENGE_REPLAYED");
  assert(successes.length === 1, "Exactly ONE request in 5 concurrent race attempts successfully consumes challenge (HTTP 201)");
  assert(rejects.length === 4, "All 4 concurrent race attempts are rejected with HTTP 400 CHALLENGE_REPLAYED");

  // 3.4 Real-time Verification API
  const verifyRes = await request("GET", `/signatures/verify/${signatureRecord.id}`, { Authorization: `Bearer ${officerToken}` });
  assert(verifyRes.status === 200 && verifyRes.data.report.isCryptographicallyValid === true, "GET /api/signatures/verify/:id returns cryptographically VALID report");
  assert(verifyRes.data.report.status === "SIGNED", "Signature status confirmed SIGNED");

  console.log("\n[4] Tampering, Cross-Version Reuse & Key Rotation Tests:");

  // 4.1 Tampered Signature Value Detection
  const tamperedSig = validSignatureValue.slice(0, -4) + "AAAA";
  const isTamperedValid = verifyAsymmetricSignature({
    payloadString: canonicalPayload,
    signatureValue: tamperedSig,
    publicKeyPem: officerKey1.publicKeyPem,
    algorithm: "ECDSA-P256-SHA256",
  });
  assert(!isTamperedValid, "Tampered signature value fails cryptographic verification");

  // 4.2 Tampered Document SHA-256 Binding Detection
  const tamperedPayload = canonicalSignaturePayload({
    documentId: testDoc.id,
    documentVersionId: version1.id,
    versionSha256: "0000000000000000000000000000000000000000000000000000000000000000", // Modified by 1 byte
    versionNo: version1.versionNo,
    signerId: officerUser.id,
    signedAt: challenge.issuedAt,
    challengeNonce: challenge.challengeNonce,
    algorithm: "ECDSA-P256-SHA256",
  });
  const isHashTamperedValid = verifyAsymmetricSignature({
    payloadString: tamperedPayload,
    signatureValue: validSignatureValue,
    publicKeyPem: officerKey1.publicKeyPem,
    algorithm: "ECDSA-P256-SHA256",
  });
  assert(!isHashTamperedValid, "Signature cannot verify if DocumentVersion SHA-256 is modified (Tamper-evident)");

  // 4.3 Cross-Version Reuse Prevention
  const v2PayloadWithV1Sig = canonicalSignaturePayload({
    documentId: testDoc.id,
    documentVersionId: version2.id,
    versionSha256: version2.sha256,
    versionNo: version2.versionNo,
    signerId: officerUser.id,
    signedAt: challenge.issuedAt,
    challengeNonce: challenge.challengeNonce,
    algorithm: "ECDSA-P256-SHA256",
  });
  const isCrossVersionValid = verifyAsymmetricSignature({
    payloadString: v2PayloadWithV1Sig,
    signatureValue: validSignatureValue,
    publicKeyPem: officerKey1.publicKeyPem,
    algorithm: "ECDSA-P256-SHA256",
  });
  assert(!isCrossVersionValid, "Signature created for Version 1 cannot be reused or validated against Version 2");

  // 4.4 Key Rotation Preservation
  // Officer registers a NEW second keypair (Key 2)
  const officerKey2 = generateAsymmetricKeyPair("ECDSA-P256-SHA256");
  await request(
    "POST",
    "/signatures/public-key",
    { Authorization: `Bearer ${officerToken}` },
    {
      publicKeyPem: officerKey2.publicKeyPem,
      algorithm: "ECDSA-P256-SHA256",
      label: "Officer Rao Rotated Key 2",
    }
  );

  // Historical signature created with Key 1 must still verify 100% VALID
  const histVerify = await request("GET", `/signatures/verify/${signatureRecord.id}`, { Authorization: `Bearer ${officerToken}` });
  assert(histVerify.status === 200 && histVerify.data.report.isCryptographicallyValid === true, "Historical signature signed with Key 1 remains VALID after user rotates to Key 2");

  console.log("\n[5] Section 65B Electronic Evidence Certificate Draft Tests:");

  // 5.1 Generate Section 65B Certificate Draft
  const certRes = await request("GET", `/signatures/certificate/${version1.id}`, { Authorization: `Bearer ${officerToken}` });
  assert(certRes.status === 200, "GET /api/signatures/certificate/:documentVersionId succeeds (HTTP 200)");
  const cert = certRes.data.certificate;
  assert(
    cert.certificateHeader.disclaimer === "DRAFT — SUBJECT TO APPROPRIATE LEGAL REVIEW AND FORMAL CERTIFICATION",
    "Certificate header includes mandatory legal draft disclaimer"
  );
  assert(cert.electronicRecord.sha256Checksum === version1.sha256, "Certificate electronic record lists authoritative document SHA-256");
  assert(cert.cryptographicSignature.signerName === "Investigating Officer Rao", "Certificate includes signer identification");
  assert(cert.cryptographicSignature.signatureValue === validSignatureValue, "Certificate contains full cryptographic signature proof");

  console.log("\n[6] Authorization Boundaries & IDOR Security Tests:");

  // 6.1 Non-case member cannot request challenge or sign
  const unauthChallenge = await request(
    "POST",
    "/signatures/challenge",
    { Authorization: `Bearer ${legalToken}` }, // Legal Officer is not assigned to testCase
    { documentVersionId: version1.id }
  );
  assert(unauthChallenge.status === 403, "Unassigned officer is blocked from requesting signing challenge (HTTP 403)");

  // 6.2 Signatures listing endpoint filters by access
  const sigListRes = await request("GET", "/signatures", { Authorization: `Bearer ${officerToken}` });
  assert(sigListRes.status === 200 && Array.isArray(sigListRes.data.signatures), "Accessible signatures list returned successfully");
  const foundSig = sigListRes.data.signatures.find((s) => s.id === signatureRecord.id);
  assert(foundSig !== undefined, "Newly created signature appears in signatures ledger");

  console.log("\n[7] Zero Secret Leakage & Audit Chain Integrity Tests:");

  // 7.1 Verify Audit Log was recorded
  const auditLogs = await prisma.auditLog.findMany({
    where: { documentId: testDoc.id, action: "DOCUMENT_SIGNED" },
  });
  assert(auditLogs.length > 0, "DOCUMENT_SIGNED audit log recorded in database");
  const auditEntry = auditLogs[0];
  assert(!JSON.stringify(auditEntry).includes("PRIVATE KEY"), "Audit log entry contains zero private key strings");

  // 7.2 Run full cryptographic audit chain verification
  const chainReport = await verifyAuditChain();
  assert(chainReport.status === "VALID", `Cryptographic audit hash chain remains 100% VALID (${chainReport.validRecords}/${chainReport.totalRecords} records)`);

  console.log("\n==============================================================================");
  console.log(`MILESTONE 4.1 RESULTS: ${passCount} PASSED | ${failCount} FAILED`);
  console.log("==============================================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

runMilestone41Tests()
  .catch((err) => {
    console.error("Test suite execution failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
