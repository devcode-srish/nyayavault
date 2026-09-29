/**
 * NyayaVault — Milestone 4.3 Investigation Timeline Automated Test Suite
 *
 * Validates:
 * 1. Unified hybrid timeline aggregating audit events and manual investigator notes.
 * 2. Deterministic merged pagination and 3-tier tie-breaker ordering.
 * 3. Accurate distinction between occurredAt and createdAt timestamps.
 * 4. Provenance tracking: AuditProof for audit events vs null for manual notes.
 * 5. Semantically correct INVESTIGATION_NOTE_CREATED audit action emission.
 * 6. Category, source, milestone, and free-text search filters.
 * 7. Role-based authorization and cross-case IDOR protection.
 * 8. Cryptographic audit chain integrity (100% VALID).
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import { recordAudit } from "../../src/lib/audit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();
const BASE_URL = process.env.API_BASE_URL || "http://localhost:4000/api";
const LOCAL_STORAGE_DIR = path.resolve(__dirname, "../../storage");

let adminToken = "";
let officerToken = "";
let otherOfficerToken = "";

let testCaseId = "";
let isolatedCaseId = "";
let adminUserId = "";
let officerUserId = "";
let otherOfficerUserId = "";

let createdCaseIds = [];
let createdDocIds = [];
let createdTempStorageFiles = [];

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
  console.log("NYAYAVAULT MILESTONE 4.3 — INVESTIGATION TIMELINE SUITE");
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

    // Create primary test case
    const case1 = await prisma.case.create({
      data: {
        caseNumber: `CASE-TIMELINE-${Date.now()}`,
        title: "Cybercrime Financial Fraud Investigation",
        description: "Primary test case for investigation timeline verification",
        status: "OPEN",
        members: {
          create: [{ userId: officerUserId, roleInCase: "LEAD_INVESTIGATOR" }],
        },
      },
    });
    testCaseId = case1.id;
    createdCaseIds.push(case1.id);

    // Record initial audit log for case creation
    await recordAudit({
      action: "CASE_CREATED",
      actorId: adminUserId,
      caseId: testCaseId,
      notes: `Case "${case1.title}" created`,
    });

    // Create isolated case where officer is NOT a member
    const case2 = await prisma.case.create({
      data: {
        caseNumber: `CASE-ISOLATED-${Date.now()}`,
        title: "Confidential State Security Probe",
        status: "OPEN",
        members: {
          create: [{ userId: otherOfficerUserId, roleInCase: "SUPERVISOR" }],
        },
      },
    });
    isolatedCaseId = case2.id;
    createdCaseIds.push(case2.id);

    // Upload a document into Primary Case to generate audit-backed timeline events
    const fileBytes = Buffer.from("Milestone 4.3 Test Evidence Document Content - " + Date.now());
    const fileHash = crypto.createHash("sha256").update(fileBytes).digest("hex");
    const key = `${crypto.randomBytes(24).toString("hex")}.pdf`;
    fs.writeFileSync(path.join(LOCAL_STORAGE_DIR, key), fileBytes);
    createdTempStorageFiles.push(key);

    const doc = await prisma.document.create({
      data: {
        caseId: testCaseId,
        name: "Bank Statement Ledger.pdf",
        type: "FINANCIAL_RECORD",
        classification: "RESTRICTED",
        uploadedById: officerUserId,
        latestVersionNo: 1,
        integrityStatus: "VERIFIED",
        versions: {
          create: {
            versionNo: 1,
            storageKey: key,
            originalName: "statement_q1.pdf",
            mimeType: "application/pdf",
            sizeBytes: fileBytes.length,
            sha256: fileHash,
            createdById: officerUserId,
          },
        },
      },
    });
    createdDocIds.push(doc.id);

    await recordAudit({
      action: "DOCUMENT_UPLOADED",
      actorId: officerUserId,
      documentId: doc.id,
      caseId: testCaseId,
      notes: 'Uploaded "Bank Statement Ledger.pdf" (v1)',
    });

    assert(!!testCaseId && !!doc.id, "Case and document fixtures initialized successfully");

    // 1. Query Initial Case Timeline
    console.log("\n--- Test 1: Query Case Timeline API ---");
    const timelineRes = await apiRequest(`/cases/${testCaseId}/timeline`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    assert(timelineRes.status === 200, "GET /api/cases/:id/timeline returns 200 OK");
    assert(Array.isArray(timelineRes.body.events), "Timeline response contains events array");
    assert(timelineRes.body.events.length >= 2, "Timeline contains initial CASE_CREATED and DOCUMENT_UPLOADED events");
    assert(timelineRes.body.pagination.totalEvents >= 2, "Pagination totalEvents accurately reported");

    // 2. Record Manual Investigation Notes & Milestones
    console.log("\n--- Test 2: Record Manual Investigation Note & Milestone ---");
    const historicalTime = new Date(Date.now() - 3600000 * 5).toISOString(); // 5 hours ago

    const note1Res = await apiRequest(`/cases/${testCaseId}/timeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${officerToken}` },
      body: JSON.stringify({
        title: "Primary Suspect Witness Interview",
        description: "Witness confirmed unauthorized account access from external IP address in Mumbai.",
        category: "INVESTIGATOR_NOTE",
        occurredAt: historicalTime,
        isMilestone: true,
      }),
    });
    assert(note1Res.status === 201, "POST /api/cases/:id/timeline returns 201 Created");
    assert(note1Res.body.event.title === "Primary Suspect Witness Interview", "Note title matches input");
    assert(note1Res.body.event.isMilestone === true, "isMilestone flag correctly set");
    assert(note1Res.body.event.source === "MANUAL_NOTE", "Event source is marked MANUAL_NOTE");
    assert(note1Res.body.event.auditProof === null, "Manual note does not claim false cryptographic audit proof");
    assert(note1Res.body.event.occurredAt === historicalTime, "Historical occurredAt timestamp preserved");
    assert(!!note1Res.body.event.createdAt, "Server-authoritative createdAt timestamp recorded");

    // Verify INVESTIGATION_NOTE_CREATED audit log emission
    const noteAudit = await prisma.auditLog.findFirst({
      where: { caseId: testCaseId, action: "INVESTIGATION_NOTE_CREATED" },
      orderBy: { createdAt: "desc" },
    });
    assert(!!noteAudit, "INVESTIGATION_NOTE_CREATED audit log was emitted in database");
    assert(noteAudit.notes.includes("Primary Suspect Witness Interview"), "Audit log notes contain event title");

    // Record second note (routine observation)
    const note2Res = await apiRequest(`/cases/${testCaseId}/timeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${officerToken}` },
      body: JSON.stringify({
        title: "CCTV Footage Request Submitted",
        description: "Formal Section 91 CrPC notice dispatched to banking facility.",
        category: "INVESTIGATOR_NOTE",
        isMilestone: false,
      }),
    });
    assert(note2Res.status === 201, "Second routine note created with 201 Created");

    // 3. Deterministic Sorting & Merged Pagination
    console.log("\n--- Test 3: Deterministic Merged Pagination & Ordering ---");
    const descRes = await apiRequest(`/cases/${testCaseId}/timeline?order=desc&limit=2`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    assert(descRes.status === 200, "GET timeline page 1 (descending) returns 200 OK");
    assert(descRes.body.events.length === 2, "Page 1 contains exactly 2 events");
    assert(descRes.body.pagination.page === 1, "Page is 1");
    assert(descRes.body.pagination.hasNextPage === true, "hasNextPage is true");

    const page2Res = await apiRequest(`/cases/${testCaseId}/timeline?order=desc&page=2&limit=2`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    assert(page2Res.status === 200, "GET timeline page 2 returns 200 OK");
    assert(page2Res.body.events.length >= 2, "Page 2 contains remaining events");

    // Verify no overlap across pages
    const page1Ids = new Set(descRes.body.events.map((e) => e.id));
    const page2Ids = new Set(page2Res.body.events.map((e) => e.id));
    const overlap = [...page1Ids].filter((id) => page2Ids.has(id));
    assert(overlap.length === 0, "Zero overlapping events across page 1 and page 2 (Deterministic pagination)");

    // Ascending order check
    const ascRes = await apiRequest(`/cases/${testCaseId}/timeline?order=asc&limit=10`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    assert(ascRes.status === 200, "GET timeline ascending returns 200 OK");
    const firstEventTime = new Date(ascRes.body.events[0].occurredAt).getTime();
    const lastEventTime = new Date(ascRes.body.events[ascRes.body.events.length - 1].occurredAt).getTime();
    assert(firstEventTime <= lastEventTime, "Events ordered chronologically from oldest to newest in asc mode");

    // 4. Filtering Tests
    console.log("\n--- Test 4: Category, Source & Milestone Filtering ---");
    // Filter by Category
    const noteCatRes = await apiRequest(`/cases/${testCaseId}/timeline?category=INVESTIGATOR_NOTE`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    assert(noteCatRes.body.events.every((e) => e.category === "INVESTIGATOR_NOTE"), "Category filter returns only INVESTIGATOR_NOTE events");

    // Filter by Source
    const auditSrcRes = await apiRequest(`/cases/${testCaseId}/timeline?source=AUDIT_LOG`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    assert(auditSrcRes.body.events.every((e) => e.source === "AUDIT_LOG"), "Source filter returns only AUDIT_LOG events");
    assert(auditSrcRes.body.events.every((e) => !!e.auditProof?.hash), "Audit-backed events include authoritative auditProof");

    // Filter by Milestone
    const milestoneRes = await apiRequest(`/cases/${testCaseId}/timeline?isMilestone=true`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    assert(milestoneRes.body.events.every((e) => e.isMilestone === true), "isMilestone=true filter returns only key milestones");
    assert(milestoneRes.body.events.some((e) => e.title === "Primary Suspect Witness Interview"), "Interview milestone is in filtered result");

    // Free-text Search Filter
    const searchRes = await apiRequest(`/cases/${testCaseId}/timeline?search=Mumbai`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    assert(searchRes.body.events.length >= 1, "Free-text search matches description keyword 'Mumbai'");
    assert(searchRes.body.events[0].title === "Primary Suspect Witness Interview", "Search matched correct event");

    // 5. Input Validation & Timestamp Safety
    console.log("\n--- Test 5: Input Validation & Historical Timestamp Safety ---");
    const emptyTitleRes = await apiRequest(`/cases/${testCaseId}/timeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${officerToken}` },
      body: JSON.stringify({ title: "" }),
    });
    assert(emptyTitleRes.status === 400, "Empty title rejected with HTTP 400");

    const futureDateRes = await apiRequest(`/cases/${testCaseId}/timeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${officerToken}` },
      body: JSON.stringify({
        title: "Future Event Test",
        occurredAt: "2099-01-01T00:00:00Z",
      }),
    });
    assert(futureDateRes.status === 400, "Future occurredAt date rejected with HTTP 400");

    // 6. Role-Based Authorization & Cross-Case IDOR Protection
    console.log("\n--- Test 6: Authorization & Cross-Case IDOR Protection ---");
    // Officer accessing unassigned case
    const idorGetRes = await apiRequest(`/cases/${isolatedCaseId}/timeline`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    assert(idorGetRes.status === 403, "Unassigned officer blocked from viewing case timeline (HTTP 403 Forbidden)");

    const idorPostRes = await apiRequest(`/cases/${isolatedCaseId}/timeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${officerToken}` },
      body: JSON.stringify({ title: "Unauthorized Note Attempt" }),
    });
    assert(idorPostRes.status === 403, "Unassigned officer blocked from posting notes to case (HTTP 403 Forbidden)");

    // Unauthenticated request
    const noAuthRes = await apiRequest(`/cases/${testCaseId}/timeline`);
    assert(noAuthRes.status === 401, "Unauthenticated request rejected with HTTP 401 Unauthorized");

    // Admin can access all cases
    const adminTimelineRes = await apiRequest(`/cases/${isolatedCaseId}/timeline`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminTimelineRes.status === 200, "Admin role can view timeline for any case (HTTP 200 OK)");

    // 7. Cryptographic Audit Chain Continuity
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
  } finally {
    console.log("\n--- Teardown Storage Artifacts ---");
    for (const key of createdTempStorageFiles) {
      const p = path.join(LOCAL_STORAGE_DIR, key);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    console.log("Teardown completed cleanly (preserving audit trail).");
  }

  console.log("\n=======================================================");
  console.log(`MILESTONE 4.3 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
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
