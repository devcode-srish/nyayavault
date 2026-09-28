/**
 * NyayaVault — Milestone 4.4 Physical Custody Receipts & QR Labels Automated Test Suite
 *
 * Validates:
 * 1. AES-256-GCM symmetric encryption with unique random IVs & auth tags.
 * 2. 256-bit QR token entropy (32 CSPRNG bytes = 64 hex chars).
 * 3. Hashed database storage (SHA-256) & zero raw token leakage in audit logs.
 * 4. Tiered QR verification: anti-oracle generic response for unauthenticated vs complete custody chain for authorized case members.
 * 5. Cross-case IDOR authorization protection.
 * 6. QR token rotation & immediate invalidation of old physical tags with EVIDENCE_QR_ROTATED audit emission.
 * 7. Custody handover receipts: status fidelity, pending watermark, deterministic receipt numbers, and CUSTODY_RECEIPT_GENERATED audit emission.
 * 8. State immutability: receipt generation/reprinting never mutates custody state.
 * 9. 100% Cryptographic audit hash chain continuity from Genesis to Tip.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import { recordAudit } from "../../src/lib/audit";
import { encryptData, decryptData } from "../../src/lib/encryption";
import { generateQRToken, hashQRToken } from "../../src/lib/qr";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();
const BASE_URL = process.env.API_BASE_URL || "http://localhost:4000/api";

let adminToken = "";
let officerToken = "";
let seniorToken = "";
let otherOfficerToken = "";

let testCaseId = "";
let isolatedCaseId = "";
let adminUserId = "";
let officerUserId = "";
let seniorUserId = "";
let otherOfficerUserId = "";

let testEvidenceId = "";
let testTransferId = "";
let initialQRToken = "";

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

async function runTests() {
  console.log("\n=======================================================");
  console.log("NYAYAVAULT MILESTONE 4.4 — PHYSICAL CUSTODY & QR SUITE");
  console.log("=======================================================\n");

  try {
    // 0. Setup test users and cases
    console.log("--- Setup: Authentication & Fixtures ---");
    adminToken = await login("admin@nyayavault.demo");
    officerToken = await login("officer@nyayavault.demo");
    seniorToken = await login("senior@nyayavault.demo");
    otherOfficerToken = await login("legal@nyayavault.demo");

    const adminUser = await prisma.user.findUnique({ where: { email: "admin@nyayavault.demo" } });
    const officerUser = await prisma.user.findUnique({ where: { email: "officer@nyayavault.demo" } });
    const seniorUser = await prisma.user.findUnique({ where: { email: "senior@nyayavault.demo" } });
    const otherUser = await prisma.user.findUnique({ where: { email: "legal@nyayavault.demo" } });

    adminUserId = adminUser.id;
    officerUserId = officerUser.id;
    seniorUserId = seniorUser.id;
    otherOfficerUserId = otherUser.id;

    // Create Primary Test Case
    const case1 = await prisma.case.create({
      data: {
        caseNumber: `CASE-PHYSICAL-${Date.now()}`,
        title: "Forensic Physical Evidence Chain Probe",
        description: "Primary test case for physical custody receipts and QR labels",
        status: "OPEN",
        members: {
          create: [
            { userId: officerUserId, roleInCase: "LEAD_INVESTIGATOR" },
            { userId: seniorUserId, roleInCase: "SUPERVISOR" },
          ],
        },
      },
    });
    testCaseId = case1.id;

    await recordAudit({
      action: "CASE_CREATED",
      actorId: adminUserId,
      caseId: testCaseId,
      notes: `Case "${case1.title}" created for Milestone 4.4 test`,
    });

    // Create Isolated Case where officer is NOT a member
    const case2 = await prisma.case.create({
      data: {
        caseNumber: `CASE-RESTRICTED-${Date.now()}`,
        title: "Compartmentalized Intelligence Exhibit Case",
        status: "OPEN",
        members: {
          create: [{ userId: otherOfficerUserId, roleInCase: "LEAD_INVESTIGATOR" }],
        },
      },
    });
    isolatedCaseId = case2.id;

    // Log a new Physical Evidence item in primary case
    const evItem = await prisma.evidenceItem.create({
      data: {
        caseId: testCaseId,
        name: "Sealed Solid State Drive - Exhibit A1",
        description: "Samsung 980 Pro 2TB encrypted SSD seized from suspect workstation",
        status: "COLLECTED",
        currentCustodianId: officerUserId,
        transfers: {
          create: {
            fromUserId: null,
            toUserId: officerUserId,
            status: "COMPLETED",
            packageCondition: "SEALED_INTACT",
            sealNumber: "SEAL-IND-884920",
            location: "Field Seizure Scene A",
            notes: "Initial evidence logging and tagging",
          },
        },
      },
    });
    testEvidenceId = evItem.id;

    await recordAudit({
      action: "EVIDENCE_TRANSFERRED",
      actorId: officerUserId,
      evidenceId: evItem.id,
      caseId: testCaseId,
      targetUserId: officerUserId,
      notes: `Evidence "${evItem.name}" logged by Investigating Officer Rao`,
    });

    assert(!!testCaseId && !!testEvidenceId, "Fixtures initialized with case and physical evidence item");

    // =========================================================================
    // 1. AES-256-GCM Encryption Utility Verification & Key Rotation
    // =========================================================================
    console.log("\n--- Test 1: AES-256-GCM Cryptographic Encryption & Decryption ---");
    const testPlaintext = "nyayavault-secure-test-token-payload-256bit";
    const encrypted = encryptData(testPlaintext);
    assert(typeof encrypted === "string" && encrypted.split(":").length === 3, "Encrypted payload has format IV:AuthTag:Ciphertext");

    const decrypted = decryptData(encrypted);
    assert(decrypted === testPlaintext, "AES-256-GCM successfully decrypts ciphertext with authentic tag");

    // Decryption failure on corrupted auth tag
    const parts = encrypted.split(":");
    const corruptedTag = parts[0] + ":" + "00".repeat(16) + ":" + parts[2];
    let tagTamperedFailed = false;
    try {
      decryptData(corruptedTag);
    } catch {
      tagTamperedFailed = true;
    }
    assert(tagTamperedFailed, "Decryption strictly throws error on tampered authentication tag");

    // Test Key Rotation Fallback
    const oldSecret = "nyayavault-legacy-rotation-secret-key-12345";
    const oldKey = crypto.createHash("sha256").update(oldSecret, "utf8").digest();
    const legacyIv = crypto.randomBytes(12);
    const legacyCipher = crypto.createCipheriv("aes-256-gcm", oldKey, legacyIv, { authTagLength: 16 });
    let legacyEncrypted = legacyCipher.update("legacy-encrypted-token-data", "utf8", "hex");
    legacyEncrypted += legacyCipher.final("hex");
    const legacyTag = legacyCipher.getAuthTag().toString("hex");
    const legacyPayload = `${legacyIv.toString("hex")}:${legacyTag}:${legacyEncrypted}`;

    process.env.PREVIOUS_ENCRYPTION_SECRETS = oldSecret;
    const legacyDecrypted = decryptData(legacyPayload);
    assert(legacyDecrypted === "legacy-encrypted-token-data", "AES-256-GCM decrypts legacy payloads using candidate rotation keys");


    // =========================================================================
    // 2. Physical Evidence QR Label Retrieval & Initialization
    // =========================================================================
    console.log("\n--- Test 2: Physical Evidence QR Label Generation & Storage ---");
    const labelRes = await apiRequest(`/evidence/${testEvidenceId}/qr-label`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    assert(labelRes.status === 200, "GET /api/evidence/:id/qr-label returns 200 OK");
    assert(!!labelRes.body.label?.verificationUrl, "Label response contains canonical verificationUrl");
    assert(!!labelRes.body.label?.qrSvg, "Label response includes vector SVG string");
    assert(labelRes.body.label?.qrDataUri.startsWith("data:image/svg+xml;base64,"), "Label response includes Data URI for browser printing");
    assert(labelRes.body.label?.caseNumber === case1.caseNumber, "Label includes case number");
    assert(labelRes.body.label?.name === evItem.name, "Label includes evidence name");

    // Extract raw token from verification URL
    const urlObj = new URL(labelRes.body.label.verificationUrl);
    initialQRToken = urlObj.searchParams.get("token");
    assert(!!initialQRToken && initialQRToken.length === 64, "QR token has exactly 64 hexadecimal characters (256 bits of entropy)");

    // Verify hashed database storage
    const dbItem = await prisma.evidenceItem.findUnique({ where: { id: testEvidenceId } });
    assert(dbItem.qrTokenHash === hashQRToken(initialQRToken), "Database stores canonical SHA-256 hash of token");
    assert(dbItem.qrTokenEncrypted !== initialQRToken, "Database does NOT store plaintext raw token (encrypted with AES-256-GCM)");

    // =========================================================================
    // 3. Tiered Public Verification & Anti-Oracle Protection
    // =========================================================================
    console.log("\n--- Test 3: Public QR Verification & Anti-Oracle Defense ---");
    // Unauthenticated request with valid token
    const unauthVerifyRes = await apiRequest(`/evidence/verify/${initialQRToken}`);
    assert(unauthVerifyRes.status === 200, "Unauthenticated verification returns HTTP 200");
    assert(unauthVerifyRes.body.authenticated === false, "Response clearly indicates unauthenticated status");
    assert(unauthVerifyRes.body.validTag === true, "Valid tag detected flag returned");
    assert(unauthVerifyRes.body.evidence === undefined, "Zero confidential evidence metadata leaked to unauthenticated caller");
    assert(unauthVerifyRes.body.case === undefined, "Zero case metadata leaked to unauthenticated caller");

    // Unauthenticated request with nonexistent token
    const fakeToken = crypto.randomBytes(32).toString("hex");
    const fakeVerifyRes = await apiRequest(`/evidence/verify/${fakeToken}`);
    assert(fakeVerifyRes.body.authenticated === false, "Nonexistent token returns unauthenticated response");
    assert(fakeVerifyRes.body.evidence === undefined, "Nonexistent token does not reveal database details");

    // =========================================================================
    // 4. Authenticated & Authorized Case Member Verification
    // =========================================================================
    console.log("\n--- Test 4: Authenticated & Authorized QR Verification ---");
    const authVerifyRes = await apiRequest(`/evidence/verify/${initialQRToken}`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    assert(authVerifyRes.status === 200, "Authorized case member verification returns HTTP 200");
    assert(authVerifyRes.body.authenticated === true, "Authenticated status is true");
    assert(authVerifyRes.body.authorized === true, "Authorized status is true");
    assert(authVerifyRes.body.evidence?.name === evItem.name, "Verified evidence name matches");
    assert(authVerifyRes.body.evidence?.case?.caseNumber === case1.caseNumber, "Verified case number matches");
    assert(Array.isArray(authVerifyRes.body.evidence?.transfers), "Complete custody chain transfers array returned");

    // Non-member officer IDOR protection
    const idorVerifyRes = await apiRequest(`/evidence/verify/${initialQRToken}`, {
      headers: { Authorization: `Bearer ${otherOfficerToken}` },
    });
    assert(idorVerifyRes.status === 403, "Non-member officer is blocked from inspecting evidence via QR (HTTP 403 Forbidden)");

    // =========================================================================
    // 5. QR Token Rotation & Instant Old Token Invalidation
    // =========================================================================
    console.log("\n--- Test 5: QR Token Rotation & Invalidation ---");
    const rotateRes = await apiRequest(`/evidence/${testEvidenceId}/rotate-qr`, {
      method: "POST",
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    assert(rotateRes.status === 200, "POST /api/evidence/:id/rotate-qr returns 200 OK");
    assert(!!rotateRes.body.label?.verificationUrl, "New verification URL returned upon rotation");

    const newUrlObj = new URL(rotateRes.body.label.verificationUrl);
    const newQRToken = newUrlObj.searchParams.get("token");
    assert(newQRToken !== initialQRToken, "Newly generated QR token is distinct from old token");

    // Verify that OLD raw token is now INVALID
    const oldTokenLookup = await apiRequest(`/evidence/verify/${initialQRToken}`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    assert(oldTokenLookup.status === 404, "Verification using old raw token fails immediately (HTTP 404 Tag Not Found / Revoked)");

    // Verify that NEW raw token is valid
    const newTokenLookup = await apiRequest(`/evidence/verify/${newQRToken}`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    assert(newTokenLookup.status === 200 && newTokenLookup.body.evidence?.name === evItem.name, "Verification using new rotated token succeeds");

    // Verify EVIDENCE_QR_ROTATED audit log emission
    const rotateAudit = await prisma.auditLog.findFirst({
      where: { evidenceId: testEvidenceId, action: "EVIDENCE_QR_ROTATED" },
      orderBy: { createdAt: "desc" },
    });
    assert(!!rotateAudit, "EVIDENCE_QR_ROTATED audit log was emitted in database");
    assert(!rotateAudit.notes.includes(newQRToken) && !JSON.stringify(rotateAudit.metadata).includes(newQRToken), "Raw token is strictly excluded from audit notes and metadata (Zero secret leakage)");

    // =========================================================================
    // 6. Custody Handover Receipts (Pending vs Completed)
    // =========================================================================
    console.log("\n--- Test 6: Custody Handover Receipt Generation & State Invariants ---");
    // Initiate two-step transfer (creates PENDING transfer)
    const transferRes = await apiRequest(`/evidence/${testEvidenceId}/transfer`, {
      method: "POST",
      headers: { Authorization: `Bearer ${officerToken}` },
      body: JSON.stringify({
        toUserId: seniorUserId,
        purpose: "Transfer to forensic laboratory for write-blocker image acquisition",
        packageCondition: "SEALED_INTACT",
        sealNumber: "SEAL-IND-884920",
        location: "Forensic Lab Intake Station B",
        notes: "Evidence container inspect seals verified intact",
      }),
    });
    assert(transferRes.status === 201, "Transfer initiated in PENDING status (HTTP 201 Created)");
    testTransferId = transferRes.body.transfer.id;

    // Check Receipt for PENDING transfer
    const pendingReceiptRes = await apiRequest(`/evidence/transfers/${testTransferId}/receipt`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    assert(pendingReceiptRes.status === 200, "GET /api/evidence/transfers/:id/receipt returns 200 OK");
    assert(pendingReceiptRes.body.receipt.status === "PENDING", "Receipt status accurately reports PENDING");
    assert(pendingReceiptRes.body.receipt.isPending === true, "isPending flag is true");
    assert(pendingReceiptRes.body.receipt.watermarkText.includes("PENDING TRANSFER"), "Pending transfer receipt includes prominent warning watermark");
    assert(pendingReceiptRes.body.receipt.receiptNumber.startsWith("NYA-REC-"), "Deterministic receipt number starts with NYA-REC-");

    // Verify State Immutability: Receipt retrieval did NOT change custody or transfer state
    const postReceiptItem = await prisma.evidenceItem.findUnique({ where: { id: testEvidenceId } });
    assert(postReceiptItem.currentCustodianId === officerUserId, "Evidence currentCustodianId is UNCHANGED (still sender)");
    const postReceiptTransfer = await prisma.evidenceTransfer.findUnique({ where: { id: testTransferId } });
    assert(postReceiptTransfer.status === "PENDING", "Evidence transfer status is UNCHANGED (still PENDING)");

    // Recipient accepts the transfer
    const acceptRes = await apiRequest(`/evidence/transfers/${testTransferId}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${seniorToken}` },
    });
    assert(acceptRes.status === 200, "Recipient accepts transfer (HTTP 200 OK)");

    // Check Receipt for ACCEPTED / COMPLETED transfer
    const acceptedReceiptRes = await apiRequest(`/evidence/transfers/${testTransferId}/receipt?recordAudit=true`, {
      headers: { Authorization: `Bearer ${seniorToken}` },
    });
    assert(acceptedReceiptRes.status === 200, "GET completed transfer receipt returns 200 OK");
    assert(acceptedReceiptRes.body.receipt.status === "ACCEPTED", "Receipt status accurately reports ACCEPTED");
    assert(acceptedReceiptRes.body.receipt.isPending === false, "isPending flag is false");
    assert(acceptedReceiptRes.body.receipt.watermarkText === null, "Completed receipt has no pending watermark");
    assert(acceptedReceiptRes.body.receipt.receiptNumber === pendingReceiptRes.body.receipt.receiptNumber, "Receipt reference number is stable and identical across reprints");
    assert(acceptedReceiptRes.body.receipt.parties.sender.name === officerUser.name, "Sender name recorded correctly");
    assert(acceptedReceiptRes.body.receipt.parties.recipient.name === seniorUser.name, "Recipient name recorded correctly");
    assert(acceptedReceiptRes.body.receipt.handoverDetails.sealNumber === "SEAL-IND-884920", "Seal number recorded on receipt");
    assert(!!acceptedReceiptRes.body.receipt.auditProof?.hash, "Receipt references authoritative audit log hash");

    // Verify CUSTODY_RECEIPT_GENERATED audit log emission
    const receiptAudit = await prisma.auditLog.findFirst({
      where: { evidenceId: testEvidenceId, action: "CUSTODY_RECEIPT_GENERATED" },
      orderBy: { createdAt: "desc" },
    });
    assert(!!receiptAudit, "CUSTODY_RECEIPT_GENERATED audit log was emitted in database");
    assert(receiptAudit.notes.includes(acceptedReceiptRes.body.receipt.receiptNumber), "Audit notes contain receipt reference number");

    // =========================================================================
    // 7. Full Cryptographic Audit Hash Chain Continuity
    // =========================================================================
    console.log("\n--- Test 7: Cryptographic Audit Hash Chain Verification ---");
    const verifyChainRes = await apiRequest("/audit/verify", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(verifyChainRes.status === 200, "GET /api/audit/verify returns 200 OK");
    assert(verifyChainRes.body.report.status === "VALID", "Cryptographic audit chain remains 100% VALID from genesis to tip");
    assert(verifyChainRes.body.report.validRecords > 0, `Total valid audit records in chain: ${verifyChainRes.body.report.validRecords}`);
  } catch (err) {
    console.error("Test execution aborted with error:", err);
    failed++;
  }

  console.log("\n=======================================================");
  console.log(`MILESTONE 4.4 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
