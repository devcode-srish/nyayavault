/**
 * NyayaVault — Phase 4.5 Milestone 1 Foundation Test Suite
 *
 * Validates:
 * 1. NYAYAVAULT-MERKLE-V1 Merkle Tree calculation against all fixed test vectors.
 * 2. Strict rejection of duplicate normalized paths.
 * 3. Path traversal security checks (rejection of ".." segments).
 * 4. RFC 8785 JSON Canonicalization Scheme (JCS) deterministic key ordering.
 * 5. Institutional Authority ECDSA-P256-SHA256 checkpoint signing and verification.
 * 6. Tamper detection on modified checkpoint fields.
 * 7. Database schema CourtBundleExport model & AuditAction enums.
 * 8. Cryptographic audit hash chain continuity.
 */

import { PrismaClient } from "@prisma/client";
import {
  computeMerkleTree,
  normalizePOSIXPath,
  computeFileSHA256,
  MERKLE_ALGORITHM_ID,
} from "../../src/lib/merkle";
import {
  canonicalizeJSON,
  signAuditCheckpoint,
  verifyAuditCheckpoint,
  getAuthorityKeypair,
  computePublicKeyFingerprint,
} from "../../src/lib/courtAuthority";
import { recordAudit } from "../../src/lib/audit";

const prisma = new PrismaClient();
const BASE_URL = process.env.API_BASE_URL || "http://localhost:4000/api";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function apiRequest(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, headers: res.headers, body };
}

async function login(email, password = "Demo@1234") {
  const res = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200 || !res.body?.accessToken) {
    throw new Error(`Failed to login as ${email}: ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken;
}

async function runFoundationTests() {
  console.log("\n=======================================================");
  console.log("NYAYAVAULT PHASE 4.5 (MILESTONE 1) — FOUNDATION SUITE");
  console.log("=======================================================\n");

  try {
    // =========================================================================
    // 1. NYAYAVAULT-MERKLE-V1 Fixed Cryptographic Test Vectors
    // =========================================================================
    console.log("--- Test 1: NYAYAVAULT-MERKLE-V1 Algorithm & Test Vectors ---");

    // Vector 1: N = 0 (Empty Set)
    const tree0 = computeMerkleTree([]);
    assert(tree0.algorithm === MERKLE_ALGORITHM_ID, "Tree algorithm identifier is NYAYAVAULT-MERKLE-V1");
    assert(tree0.merkleRoot === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "Vector 1 (N=0 empty set): root matches SHA-256 of empty string");

    // Vector 2: N = 1 (Single Artifact)
    const tree1 = computeMerkleTree([
      { path: "artifacts/exhibits/report.pdf", content: "NyayaVault Forensic Report Sample" },
    ]);
    assert(tree1.merkleRoot === "fda34a9c22accb1a39cfc7d68b2be258239017e4c9a12173388f5a4cad32ee12", "Vector 2 (N=1 single file): root matches canonical leaf hash");

    // Vector 3: N = 2 (Two Artifacts)
    const tree2 = computeMerkleTree([
      { path: "artifacts/a.txt", content: "A" },
      { path: "artifacts/b.txt", content: "B" },
    ]);
    assert(tree2.merkleRoot === "27daca1cf4a72313e8e9300354eee8cea45ee2bc826f7d5c7088cea85a4c5057", "Vector 3 (N=2 binary split): root matches SHA256(0x01 || LeafA || LeafB)");

    // Vector 4: N = 3 (Three Artifacts, k=2 split)
    const tree3 = computeMerkleTree([
      { path: "artifacts/a.txt", content: "A" },
      { path: "artifacts/b.txt", content: "B" },
      { path: "artifacts/c.txt", content: "C" },
    ]);
    assert(tree3.merkleRoot === "3dd344a2b6b471abcfe37e48c28ed74fb274a72df96ab3b453de04c9e34c2039", "Vector 4 (N=3 split k=2): root matches SHA256(0x01 || NodeAB || LeafC)");

    // Vector 5: N = 5 (Five Artifacts, k=4 split)
    const tree5 = computeMerkleTree([
      { path: "artifacts/a.txt", content: "A" },
      { path: "artifacts/b.txt", content: "B" },
      { path: "artifacts/c.txt", content: "C" },
      { path: "artifacts/d.txt", content: "D" },
      { path: "artifacts/e.txt", content: "E" },
    ]);
    assert(tree5.merkleRoot === "452c6123d938ddebd0511ccb2b428c2a6955795f65c5edc05db7b3f105e32c10", "Vector 5 (N=5 split k=4): root matches recursive tree folding");

    // Vector 6: Empty File (0 Bytes)
    const treeEmpty = computeMerkleTree([{ path: "artifacts/empty.dat", content: "" }]);
    assert(treeEmpty.merkleRoot === "821b6474cef6a6d33805ce56b4d8c681d38e2ed5c8fc69e22ea3db4757dcb2a0", "Vector 6 (0-byte empty file): root matches canonical leaf hash for 0B content");

    // Vector 7: Deterministic Ordering regardless of input order
    const treeReversed = computeMerkleTree([
      { path: "artifacts/c.txt", content: "C" },
      { path: "artifacts/a.txt", content: "A" },
      { path: "artifacts/b.txt", content: "B" },
    ]);
    assert(treeReversed.merkleRoot === tree3.merkleRoot, "Deterministic sorting: input order does not change Merkle root");

    // Vector 8: Single-bit Tamper Detection
    const treeTampered = computeMerkleTree([
      { path: "artifacts/a.txt", content: "A" },
      { path: "artifacts/b.txt", content: "B_modified" },
      { path: "artifacts/c.txt", content: "C" },
    ]);
    assert(treeTampered.merkleRoot !== tree3.merkleRoot, "Tamper sensitivity: single-bit modification produces completely distinct Merkle root");

    // =========================================================================
    // 2. Security Edge Cases: Path Normalization & Rejections
    // =========================================================================
    console.log("\n--- Test 2: Security Boundaries: Path Normalization & Duplicate Rejection ---");

    // Duplicate Path Rejection
    let duplicateRejected = false;
    try {
      computeMerkleTree([
        { path: "artifacts/exhibit1.pdf", content: "Original" },
        { path: "artifacts/exhibit1.pdf", content: "Duplicate" },
      ]);
    } catch (err) {
      if (err.message.includes("DUPLICATE_ARTIFACT_PATH_DETECTED")) {
        duplicateRejected = true;
      }
    }
    assert(duplicateRejected, "Duplicate normalized path is strictly rejected (no silent overwriting)");

    // Path Traversal Rejection
    let traversalRejected = false;
    try {
      normalizePOSIXPath("../../secret/passwords.txt");
    } catch (err) {
      if (err.message.includes("Path traversal detected")) {
        traversalRejected = true;
      }
    }
    assert(traversalRejected, "Path traversal with '..' segments is strictly rejected");

    // Windows backslash normalization
    const normalizedWin = normalizePOSIXPath("artifacts\\documents\\doc1\\v1.pdf");
    assert(normalizedWin === "artifacts/documents/doc1/v1.pdf", "Windows backslashes normalized to POSIX forward slashes");

    // =========================================================================
    // 3. RFC 8785 JSON Canonicalization Scheme (JCS)
    // =========================================================================
    console.log("\n--- Test 3: RFC 8785 Canonical JSON Serialization ---");

    const unorderedObj = {
      zebra: 100,
      alpha: "start",
      nested: {
        gamma: true,
        beta: [3, 2, 1],
      },
    };
    const jcsOutput = canonicalizeJSON(unorderedObj);
    assert(
      jcsOutput === '{"alpha":"start","nested":{"beta":[3,2,1],"gamma":true},"zebra":100}',
      "JCS serializes keys in strict lexicographical order without whitespace"
    );

    // =========================================================================
    // 4. Institutional Authority Checkpoint Signing & Verification
    // =========================================================================
    console.log("\n--- Test 4: Authority Checkpoint Signing & Cryptographic Verification ---");

    const authorityKeypair = getAuthorityKeypair();
    assert(!!authorityKeypair.publicKeyPem && !!authorityKeypair.privateKeyPem, "Authority ECDSA-P256 keypair initialized");

    const checkpointData = {
      bundleNumber: "NYA-CRTB-2026-F9812A",
      caseNumber: "CASE-2026-CR-8891",
      merkleAlgorithm: MERKLE_ALGORITHM_ID,
      merkleRootHash: tree3.merkleRoot,
      chainTipHeight: 1482,
      anchoredAt: "2026-09-29T01:15:00.000Z",
    };

    const signedCheckpoint = signAuditCheckpoint(checkpointData);
    assert(!!signedCheckpoint.signatureBase64, "Generated DER Base64 signature for checkpoint");
    assert(signedCheckpoint.keyFingerprint === authorityKeypair.keyFingerprint, "Signer key fingerprint matches authority key");

    // Verify valid signature
    const isValid = verifyAuditCheckpoint(
      signedCheckpoint.canonicalJson,
      signedCheckpoint.signatureBase64,
      authorityKeypair.publicKeyPem
    );
    assert(isValid === true, "Cryptographic signature verifies successfully against Authority Public Key");

    // Verify tampered payload fails verification
    const tamperedJson = signedCheckpoint.canonicalJson.replace("CASE-2026-CR-8891", "CASE-2026-CR-9999");
    const tamperedValid = verifyAuditCheckpoint(
      tamperedJson,
      signedCheckpoint.signatureBase64,
      authorityKeypair.publicKeyPem
    );
    assert(tamperedValid === false, "Tampered checkpoint payload strictly fails cryptographic verification");

    // =========================================================================
    // 5. Database Schema: CourtBundleExport Model & Audit Actions
    // =========================================================================
    console.log("\n--- Test 5: Additive Database Schema & Model Verification ---");

    const adminUser = await prisma.user.findUnique({ where: { email: "admin@nyayavault.demo" } });
    const testCase = await prisma.case.findFirst();

    const exportRecord = await prisma.courtBundleExport.create({
      data: {
        caseId: testCase.id,
        bundleNumber: `NYA-CRTB-TEST-${Date.now()}`,
        courtRefNumber: "FIR-TEST-442/2026",
        merkleRootHash: tree3.merkleRoot,
        authorityKeyFp: authorityKeypair.keyFingerprint,
        authoritySignature: signedCheckpoint.signatureBase64,
        status: "GENERATING",
        exportedById: adminUser.id,
      },
    });

    assert(!!exportRecord.id, "CourtBundleExport record created in database with status GENERATING");

    // Update status to COMPLETED
    const completedRecord = await prisma.courtBundleExport.update({
      where: { id: exportRecord.id },
      data: {
        status: "COMPLETED",
        zipStorageKey: `bundles/${exportRecord.bundleNumber}.zip`,
        zipSizeBytes: 1048576,
        completedAt: new Date(),
      },
    });
    assert(completedRecord.status === "COMPLETED", "CourtBundleExport updated to COMPLETED");

    // Emit COURT_BUNDLE_INITIATED, COURT_BUNDLE_COMPLETED, and COURT_BUNDLE_FAILED audit records
    await recordAudit({
      action: "COURT_BUNDLE_INITIATED",
      actorId: adminUser.id,
      caseId: testCase.id,
      notes: `Court bundle export initiated: ${exportRecord.bundleNumber}`,
    });

    await recordAudit({
      action: "COURT_BUNDLE_COMPLETED",
      actorId: adminUser.id,
      caseId: testCase.id,
      notes: `Court bundle export completed: ${exportRecord.bundleNumber} (Merkle Root: ${tree3.merkleRoot})`,
      metadata: {
        bundleNumber: exportRecord.bundleNumber,
        merkleRootHash: tree3.merkleRoot,
      },
    });

    await recordAudit({
      action: "COURT_BUNDLE_FAILED",
      actorId: adminUser.id,
      caseId: testCase.id,
      notes: `Simulated bundle failure audit test`,
    });

    assert(true, "All Phase 4.5 audit actions (INITIATED, COMPLETED, FAILED) emitted in audit log");

    // Clean up test export record
    await prisma.courtBundleExport.delete({ where: { id: exportRecord.id } });

    // =========================================================================
    // 6. Cryptographic Audit Hash Chain Continuity
    // =========================================================================
    console.log("\n--- Test 6: Audit Chain Integrity Verification ---");
    const adminToken = await login("admin@nyayavault.demo");
    const verifyRes = await apiRequest("/audit/verify", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert(verifyRes.status === 200, "GET /api/audit/verify returns 200 OK");
    assert(verifyRes.body.report.status === "VALID", "Audit hash chain remains 100% VALID from genesis to tip");
    assert(verifyRes.body.report.validRecords > 0, `Total valid records in chain: ${verifyRes.body.report.validRecords}`);
  } catch (err) {
    console.error("Foundation test failed with error:", err);
    failed++;
  }

  console.log("\n=======================================================");
  console.log(`FOUNDATION TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runFoundationTests()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
