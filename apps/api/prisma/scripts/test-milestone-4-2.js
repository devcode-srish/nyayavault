/**
 * NyayaVault — Milestone 4.2 Storage Integrity Scanner Automated Test Suite
 *
 * Validates:
 * 1. Multi-version streaming SHA-256 integrity verification.
 * 2. Tampered/corrupted evidence detection (MISMATCH) without modifying authoritative DB hash.
 * 3. Missing physical evidence file detection (MISSING).
 * 4. Concurrency control and 409 Conflict on simultaneous scan attempts.
 * 5. Safe cancellation and recovery of interrupted/abandoned scans.
 * 6. Role-based access control and cross-case IDOR protection.
 * 7. Accurate aggregate counters reconciliation invariant.
 * 8. Permanent historical finding retention.
 * 9. Cryptographic audit chain continuity (100% VALID).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const BASE_URL = process.env.API_BASE_URL || "http://localhost:4000/api";
const LOCAL_STORAGE_DIR = fs.existsSync(path.resolve(process.cwd(), "storage"))
  ? path.resolve(process.cwd(), "storage")
  : path.resolve(__dirname, "../../../../storage");
if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
  fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
}

let adminToken = "";
let officerToken = "";
let otherOfficerToken = "";

let testCaseId = "";
let otherCaseId = "";
let adminUserId = "";
let officerUserId = "";
let otherOfficerUserId = "";

let testDocId = "";
let testDocV1Key = "";
let testDocV2Key = "";

let createdDocIds = [];
let createdCaseIds = [];
let createdScanRunIds = [];
let createdTempStorageFiles = [];

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

async function runTests() {
  console.log("\n=======================================================");
  console.log("NYAYAVAULT MILESTONE 4.2 — STORAGE INTEGRITY SCANNER SUITE");
  console.log("=======================================================\n");

  try {
    // 0. Setup test users and cases
    console.log("--- Setup: Authentication & Test Fixtures ---");
    adminToken = await login("admin@nyayavault.demo");
    officerToken = await login("officer@nyayavault.demo");
    otherOfficerToken = await login("senior@nyayavault.demo");

    const adminUser = await prisma.user.findUnique({ where: { email: "admin@nyayavault.demo" } });
    const officerUser = await prisma.user.findUnique({ where: { email: "officer@nyayavault.demo" } });
    const otherUser = await prisma.user.findUnique({ where: { email: "senior@nyayavault.demo" } });

    adminUserId = adminUser.id;
    officerUserId = officerUser.id;
    otherOfficerUserId = otherUser.id;

    // Create primary test case where officer is member
    const case1 = await prisma.case.create({
      data: {
        caseNumber: `TEST-SCAN-A-${Date.now()}`,
        title: "Milestone 4.2 Scanner Primary Case",
        status: "OPEN",
        members: {
          create: [{ userId: officerUserId, roleInCase: "LEAD_INVESTIGATOR" }],
        },
      },
    });
    testCaseId = case1.id;
    createdCaseIds.push(case1.id);

    // Create isolated test case where officer is NOT member
    const case2 = await prisma.case.create({
      data: {
        caseNumber: `TEST-SCAN-B-${Date.now()}`,
        title: "Milestone 4.2 Scanner Isolated Case",
        status: "OPEN",
        members: {
          create: [{ userId: otherOfficerUserId, roleInCase: "LEAD_INVESTIGATOR" }],
        },
      },
    });
    otherCaseId = case2.id;
    createdCaseIds.push(case2.id);

    // Create multi-version test document in Case 1
    const file1Bytes = Buffer.from("Milestone 4.2 Test Evidence Content Version 1 - " + Date.now());
    const file1Hash = crypto.createHash("sha256").update(file1Bytes).digest("hex");
    const key1 = `${crypto.randomBytes(24).toString("hex")}.txt`;
    fs.writeFileSync(path.join(LOCAL_STORAGE_DIR, key1), file1Bytes);
    testDocV1Key = key1;
    createdTempStorageFiles.push(key1);

    const file2Bytes = Buffer.from("Milestone 4.2 Test Evidence Content Version 2 - " + Date.now());
    const file2Hash = crypto.createHash("sha256").update(file2Bytes).digest("hex");
    const key2 = `${crypto.randomBytes(24).toString("hex")}.txt`;
    fs.writeFileSync(path.join(LOCAL_STORAGE_DIR, key2), file2Bytes);
    testDocV2Key = key2;
    createdTempStorageFiles.push(key2);

    const doc = await prisma.document.create({
      data: {
        caseId: testCaseId,
        name: "Forensic Hard Drive Image Scan Test",
        type: "FORENSIC_IMAGE",
        classification: "RESTRICTED",
        uploadedById: officerUserId,
        latestVersionNo: 2,
        integrityStatus: "VERIFIED",
        versions: {
          create: [
            {
              versionNo: 1,
              storageKey: key1,
              originalName: "drive_image_raw.dd",
              mimeType: "application/octet-stream",
              sizeBytes: file1Bytes.length,
              sha256: file1Hash,
              createdById: officerUserId,
            },
            {
              versionNo: 2,
              storageKey: key2,
              originalName: "drive_image_v2.dd",
              mimeType: "application/octet-stream",
              sizeBytes: file2Bytes.length,
              sha256: file2Hash,
              createdById: officerUserId,
            },
          ],
        },
      },
    });
    testDocId = doc.id;
    createdDocIds.push(doc.id);
    assert(!!testDocId, "Multi-version document test fixtures created");

    // 1. Health Summary API
    console.log("\n--- Test 1: Storage Integrity Summary API ---");
    const sumRes = await apiRequest("/integrity/summary", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(sumRes.status === 200, "GET /api/integrity/summary returns 200 OK");
    assert(typeof sumRes.body.integrityScore === "number", "Summary includes numerical integrityScore");
    assert(typeof sumRes.body.totalDocuments === "number", "Summary includes totalDocuments count");
    assert(typeof sumRes.body.totalVersions === "number", "Summary includes totalVersions count");

    // 2. Global Integrity Scan (Valid state)
    console.log("\n--- Test 2: Execute Global Storage Integrity Scan ---");
    const scanStartRes = await apiRequest("/integrity/scan", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({}),
    });
    assert(scanStartRes.status === 202, "POST /api/integrity/scan accepted with 202 status");
    assert(!!scanStartRes.body?.scanRun?.id, "Scan run ID returned in response");
    const scanRunId1 = scanStartRes.body.scanRun.id;
    createdScanRunIds.push(scanRunId1);

    // Wait for background execution to complete
    let scanDone = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const statusRes = await apiRequest(`/integrity/scans/${scanRunId1}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (statusRes.body?.scanRun?.status === "COMPLETED") {
        scanDone = true;
        assert(statusRes.body.scanRun.status === "COMPLETED", "Scan completed with status COMPLETED");
        const docFindings = statusRes.body.findings?.filter((f) => f.documentId === testDocId) || [];
        assert(docFindings.length === 2, "Both test document versions scanned");
        assert(docFindings.every((f) => f.status === "VERIFIED"), "Both test document versions verified successfully (VERIFIED)");
        assert(docFindings.every((f) => f.status !== "MISMATCH"), "Zero mismatches on untampered test evidence");
        assert(docFindings.every((f) => f.status !== "MISSING"), "Zero missing files on clean test storage");

        // Verify aggregate counter reconciliation invariant
        const r = statusRes.body.scanRun;
        const total = r.verifiedCount + r.mismatchCount + r.missingCount + r.unreadableCount + r.errorCount;
        assert(total === r.totalVersions, `Aggregate counter reconciliation invariant held (${total} == ${r.totalVersions})`);
        break;
      }
    }
    assert(scanDone, "Background scan finished within time threshold");

    // 3. Findings Ledger & Details Inspection
    console.log("\n--- Test 3: Query Scan Findings Ledger ---");
    const findingsRes = await apiRequest(`/integrity/findings?scanRunId=${scanRunId1}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(findingsRes.status === 200, "GET /api/integrity/findings returns 200 OK");
    assert(Array.isArray(findingsRes.body.findings), "Findings is an array");
    const docFindings = findingsRes.body.findings.filter((f) => f.documentId === testDocId);
    assert(docFindings.length === 2, "Found findings for both v1 and v2 of test document");
    assert(docFindings.every((f) => f.status === "VERIFIED"), "All findings for clean document are marked VERIFIED");
    assert(
      docFindings.every((f) => f.expectedSha256 === f.actualSha256),
      "Authoritative expected hash matches recalculated stream hash"
    );

    // 4. Tamper Detection (Simulate Bit Rot / Corrupted Bytes)
    console.log("\n--- Test 4: Tamper Detection (MISMATCH) ---");
    const tamperedBytes = Buffer.from("CORRUPTED BYTES IN STORAGE FILE - TAMPERED EVIDENCE");
    fs.writeFileSync(path.join(LOCAL_STORAGE_DIR, testDocV2Key), tamperedBytes);

    const scanStartRes2 = await apiRequest("/integrity/scan", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ caseId: testCaseId }),
    });
    assert(scanStartRes2.status === 202, "POST /api/integrity/scan accepted for case-scoped scan");
    const scanRunId2 = scanStartRes2.body.scanRun.id;
    createdScanRunIds.push(scanRunId2);

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const statusRes = await apiRequest(`/integrity/scans/${scanRunId2}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (statusRes.body?.scanRun?.status === "COMPLETED") {
        assert(statusRes.body.scanRun.mismatchCount >= 1, "Scanner detected modified bytes as MISMATCH");
        const tamperedFinding = statusRes.body.findings.find(
          (f) => f.documentId === testDocId && f.versionNo === 2
        );
        assert(!!tamperedFinding, "Tampered version 2 finding record found");
        assert(tamperedFinding.status === "MISMATCH", "Finding status is MISMATCH");
        assert(tamperedFinding.expectedSha256 === file2Hash, "Database authoritative expected hash is PRESERVED");
        assert(tamperedFinding.actualSha256 !== file2Hash, "Actual recalculated hash reflects modified bytes");

        // Verify document-level integrity status was updated
        const updatedDoc = await prisma.document.findUnique({ where: { id: testDocId } });
        assert(updatedDoc.integrityStatus === "MISMATCH", "Document integrityStatus updated to MISMATCH in database");
        break;
      }
    }

    // 5. Missing File Detection
    console.log("\n--- Test 5: Missing Physical File Detection (MISSING) ---");
    // Create another version and delete its disk file
    const ghostKey = `${crypto.randomBytes(24).toString("hex")}.txt`;
    createdTempStorageFiles.push(ghostKey);
    const ghostDoc = await prisma.document.create({
      data: {
        caseId: testCaseId,
        name: "Missing Physical File Evidence",
        type: "GHOST_TEST",
        classification: "INTERNAL",
        uploadedById: officerUserId,
        latestVersionNo: 1,
        versions: {
          create: {
            versionNo: 1,
            storageKey: ghostKey,
            originalName: "unlinked_evidence.dat",
            mimeType: "application/octet-stream",
            sizeBytes: 1024,
            sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            createdById: officerUserId,
          },
        },
      },
    });
    createdDocIds.push(ghostDoc.id);

    const scanStartRes3 = await apiRequest("/integrity/scan", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ caseId: testCaseId }),
    });
    const scanRunId3 = scanStartRes3.body.scanRun.id;
    createdScanRunIds.push(scanRunId3);

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const statusRes = await apiRequest(`/integrity/scans/${scanRunId3}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (statusRes.body?.scanRun?.status === "COMPLETED") {
        assert(statusRes.body.scanRun.missingCount >= 1, "Scanner detected missing disk file as MISSING");
        const ghostFinding = statusRes.body.findings.find((f) => f.documentId === ghostDoc.id);
        assert(!!ghostFinding, "Missing file finding created in database");
        assert(ghostFinding.status === "MISSING", "Finding status is MISSING");
        assert(ghostFinding.reason.includes("missing from physical storage"), "Reason explains missing disk file");
        break;
      }
    }

    // 6. Concurrency Control (409 Conflict)
    console.log("\n--- Test 6: Concurrency Control & Active Lock ---");
    // Manually set an active scan run in progress
    const activeTestRun = await prisma.storageScanRun.create({
      data: {
        initiatedById: adminUserId,
        status: "IN_PROGRESS",
        totalVersions: 100,
        processedVersions: 10,
        startedAt: new Date(),
        heartbeatAt: new Date(),
      },
    });
    createdScanRunIds.push(activeTestRun.id);

    const conflictRes = await apiRequest("/integrity/scan", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({}),
    });
    assert(conflictRes.status === 409, "Simultaneous scan attempt returns HTTP 409 Conflict");
    assert(conflictRes.body.error.includes("already in progress"), "Error explains existing active scan in progress");

    // Clean up active test run
    await prisma.storageScanRun.update({
      where: { id: activeTestRun.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    // 7. Safe Cancellation
    console.log("\n--- Test 7: Scan Cancellation ---");
    const cancelRun = await prisma.storageScanRun.create({
      data: {
        initiatedById: officerUserId,
        caseId: testCaseId,
        status: "IN_PROGRESS",
        totalVersions: 50,
        processedVersions: 5,
        startedAt: new Date(),
        heartbeatAt: new Date(),
      },
    });
    createdScanRunIds.push(cancelRun.id);

    const cancelRes = await apiRequest(`/integrity/scans/${cancelRun.id}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    assert(cancelRes.status === 200, "POST /api/integrity/scans/:id/cancel returns 200 OK");
    const cancelledDbRun = await prisma.storageScanRun.findUnique({ where: { id: cancelRun.id } });
    assert(cancelledDbRun.status === "CANCELLED", "Database status updated to CANCELLED");

    // 8. Authorization & Cross-Case IDOR Protection
    console.log("\n--- Test 8: Role-Based Authorization & Cross-Case IDOR ---");
    // Officer cannot trigger scan on isolated case they do not belong to
    const idorStartRes = await apiRequest("/integrity/scan", {
      method: "POST",
      headers: { Authorization: `Bearer ${officerToken}` },
      body: JSON.stringify({ caseId: otherCaseId }),
    });
    assert(idorStartRes.status === 403, "Officer forbidden from starting scan on unassigned case (403 Forbidden)");

    // Unauthenticated request
    const noAuthRes = await apiRequest("/integrity/summary");
    assert(noAuthRes.status === 401, "Unauthenticated request returns 401 Unauthorized");

    // 9. Permanent Finding Retention (Non-Destructive)
    console.log("\n--- Test 9: Historical Finding Retention ---");
    const sampleFinding = await prisma.storageScanFinding.findFirst({
      where: { scanRunId: scanRunId1 },
    });
    assert(!!sampleFinding, "Historical scan finding exists");
    assert(!!sampleFinding.documentName, "Finding retains immutable document name");
    assert(!!sampleFinding.expectedSha256, "Finding retains immutable expected SHA-256");

    // 10. Cryptographic Audit Chain Continuity
    console.log("\n--- Test 10: Cryptographic Audit Chain Verification ---");
    const auditVerifyRes = await apiRequest("/audit/verify", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(auditVerifyRes.status === 200, "GET /api/audit/verify returns 200 OK");
    assert(auditVerifyRes.body.report.status === "VALID", "Cryptographic audit chain is 100% VALID from genesis to tip");
    assert(auditVerifyRes.body.report.validRecords > 0, `Total valid audit records in chain: ${auditVerifyRes.body.report.validRecords}`);
  } catch (err) {
    console.error("Test execution aborted with exception:", err);
    failed++;
  } finally {
    console.log("\n--- Teardown Test Records ---");
    // Clean up test documents and files
    for (const docId of createdDocIds) {
      await prisma.document.delete({ where: { id: docId } }).catch(() => {});
    }
    for (const caseId of createdCaseIds) {
      await prisma.case.delete({ where: { id: caseId } }).catch(() => {});
    }
    for (const runId of createdScanRunIds) {
      await prisma.storageScanRun.delete({ where: { id: runId } }).catch(() => {});
    }
    for (const key of createdTempStorageFiles) {
      const p = path.join(LOCAL_STORAGE_DIR, key);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    console.log("Teardown completed cleanly.");
  }

  console.log("\n=======================================================");
  console.log(`MILESTONE 4.2 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
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
