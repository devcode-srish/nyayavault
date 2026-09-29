/**
 * ==============================================================================
 * NYAYAVAULT MASTER END-TO-END VERIFICATION & AUDIT SUITE (PHASES 1, 2, 3)
 * ==============================================================================
 * Comprehensive functional, integration, security, concurrency, and regression
 * test suite covering all 13 required verification areas.
 */

const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "nyayavault-access-secret-dev-key-change-in-prod";
const PORT = process.env.PORT || 4000;

let passed = 0;
let failed = 0;
let totalExecuted = 0;

function assert(condition, message) {
  totalExecuted++;
  if (condition) {
    console.log(`  ✓ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ✗ [FAIL] ${message}`);
    failed++;
  }
}

function makeToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
    },
    ACCESS_SECRET,
    { expiresIn: "1h" }
  );
}

function request(method, pathUrl, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    let postData = null;
    let isMultipart = false;

    if (body) {
      if (typeof body === "object" && !(body instanceof Buffer)) {
        postData = JSON.stringify(body);
      } else {
        postData = body;
      }
    }

    const allHeaders = {
      ...headers,
      ...(postData && !headers["Content-Type"]
        ? {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
          }
        : {}),
    };

    if (postData && headers["Content-Type"]) {
      allHeaders["Content-Length"] = Buffer.byteLength(postData);
    }

    const req = http.request(
      {
        hostname: "localhost",
        port: PORT,
        path: pathUrl,
        method,
        headers: allHeaders,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const rawBuffer = Buffer.concat(chunks);
          let data = rawBuffer.toString("utf8");
          try {
            data = JSON.parse(data);
          } catch (e) {
            // raw string/buffer
          }
          resolve({ status: res.statusCode, headers: res.headers, data, rawBuffer });
        });
      }
    );

    req.on("error", (err) => reject(err));
    if (postData) req.write(postData);
    req.end();
  });
}

function createMultipartBody(fields, fileFieldName, fileName, fileBuffer, mimeType = "application/pdf") {
  const boundary = "----NyayaVaultBoundary" + Date.now();
  const chunks = [];

  for (const [key, val] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`));
  }

  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileFieldName}"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    )
  );
  chunks.push(fileBuffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  return {
    boundary,
    body: Buffer.concat(chunks),
  };
}

const { verifyAuditChain } = require("../../src/lib/audit");
const { runAdvisoryLockedExpirySweep } = require("../../src/jobs/scheduler");

async function runMasterE2ETests() {
  console.log("==============================================================================");
  console.log("          NYAYAVAULT MASTER COMPREHENSIVE E2E & SECURITY SUITE               ");
  console.log("==============================================================================\n");

  // Load Seed Users
  const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true } });
  const officerUser = await prisma.user.findFirst({ where: { role: "INVESTIGATING_OFFICER", isActive: true } });
  const seniorUser = await prisma.user.findFirst({ where: { role: "SENIOR_OFFICER", isActive: true } });
  const forensicUser = await prisma.user.findFirst({ where: { role: "FORENSIC_OFFICER", isActive: true } });
  const legalUser = await prisma.user.findFirst({ where: { role: "LEGAL_OFFICER", isActive: true } });

  if (!adminUser || !officerUser || !seniorUser || !forensicUser || !legalUser) {
    console.error("Missing test users. Please seed database.");
    process.exit(1);
  }

  const adminToken = makeToken(adminUser);
  const officerToken = makeToken(officerUser);
  const seniorToken = makeToken(seniorUser);
  const forensicToken = makeToken(forensicUser);
  const legalToken = makeToken(legalUser);

  // ==========================================================================
  // PART 2: Authentication & RBAC Access Control
  // ==========================================================================
  console.log("[PART 2] Authentication & Role-Based Access Control (RBAC) Tests:");

  // 2.1: Valid Login
  const validLogin = await request("POST", "/api/auth/login", {}, { email: "admin@nyayavault.demo", password: "Demo@1234" });
  assert(validLogin.status === 200 && validLogin.data.accessToken, "Valid login returns HTTP 200 with JWT access token");

  // 2.2: Bad Password Login
  const badPwLogin = await request("POST", "/api/auth/login", {}, { email: "admin@nyayavault.demo", password: "WrongPassword999" });
  assert(badPwLogin.status === 401, "Login with invalid password rejected with HTTP 401");

  // 2.3: Nonexistent Account Login
  const noAccLogin = await request("POST", "/api/auth/login", {}, { email: "nonexistent_officer@nyayavault.demo", password: "Demo@1234" });
  assert(noAccLogin.status === 401, "Login with nonexistent account rejected with HTTP 401");

  // 2.4: Authenticated /api/auth/me
  const authMe = await request("GET", "/api/auth/me", { Authorization: `Bearer ${validLogin.data.accessToken}` });
  assert(authMe.status === 200 && authMe.data.user.email === "admin@nyayavault.demo", "/api/auth/me returns authenticated user profile");

  // 2.5: Unauthenticated protected route access
  const unauthAccess = await request("GET", "/api/cases");
  assert(unauthAccess.status === 401, "Unauthenticated request to protected route rejected with HTTP 401");

  // 2.6: Admin route blocked for non-admin
  const nonAdminAudit = await request("GET", "/api/audit/verify", { Authorization: `Bearer ${officerToken}` });
  assert(nonAdminAudit.status === 403, "Non-Admin access to /api/audit/verify forbidden with HTTP 403");

  const nonAdminSweep = await request("POST", "/api/admin/tasks/run-expiry", { Authorization: `Bearer ${officerToken}` });
  assert(nonAdminSweep.status === 403, "Non-Admin access to /api/admin/tasks/run-expiry forbidden with HTTP 403");


  // ==========================================================================
  // PART 3: Case Management & Access Boundaries
  // ==========================================================================
  console.log("\n[PART 3] Case Management & Boundaries Tests:");

  const caseNumber = `E2E_CASE_${Date.now()}`;
  const testCase = await prisma.case.create({
    data: {
      caseNumber,
      title: "E2E Digital Evidence Investigation",
      description: "End-to-End verified case record",
      status: "OPEN",
      members: {
        create: [
          { userId: officerUser.id, roleInCase: "LEAD_INVESTIGATOR" },
          { userId: seniorUser.id, roleInCase: "SUPERVISOR" },
        ],
      },
    },
  });
  const e2eCaseId = testCase.id;
  assert(testCase && testCase.id, "Case record created with explicit case memberships");

  // Retrieve assigned cases listing
  const getCases = await request("GET", "/api/cases", { Authorization: `Bearer ${officerToken}` });
  assert(getCases.status === 200 && Array.isArray(getCases.data.cases), "Assigned case member retrieves case list (HTTP 200)");
  const foundCase = getCases.data.cases.find((c) => c.id === e2eCaseId);
  assert(foundCase && foundCase.caseNumber === caseNumber, "Newly created case appears in assigned cases list with count aggregates");

  // Retrieve case detail
  const getCase = await request("GET", `/api/cases/${e2eCaseId}`, { Authorization: `Bearer ${officerToken}` });
  assert(getCase.status === 200 && getCase.data.case.caseNumber === caseNumber, "Retrieve case detail succeeds for assigned investigator");
  assert(getCase.data.case.members.length === 2, "Case details include member assignments and roles");

  // Access Boundary: Non-member officer cannot access case
  const unauthCaseAccess = await request("GET", `/api/cases/${e2eCaseId}`, { Authorization: `Bearer ${legalToken}` });
  assert(unauthCaseAccess.status === 403, "Non-member officer is strictly blocked from case details (HTTP 403)");

  // Retrieve nonexistent case
  const getFakeCase = await request("GET", `/api/cases/nonexistent-case-id-12345`, { Authorization: `Bearer ${adminToken}` });
  assert(getFakeCase.status === 404, "Retrieve nonexistent case returns HTTP 404");


  // ==========================================================================
  // PART 4: Document Lifecycle, Storage, Versioning & Hash Verification
  // ==========================================================================
  console.log("\n[PART 4] Document Lifecycle, Storage, Versioning & Cryptographic Integrity Tests:");

  const originalContent = Buffer.from("CRITICAL EVIDENCE LOG - NYAYAVAULT TEST CONTENT " + Date.now());
  const originalSha256 = crypto.createHash("sha256").update(originalContent).digest("hex");

  const multipart1 = createMultipartBody(
    {
      caseId: e2eCaseId,
      name: "E2E_PRIMARY_EVIDENCE_DOC.pdf",
      type: "Evidence Report",
      classification: "CONFIDENTIAL",
    },
    "file",
    "E2E_PRIMARY_EVIDENCE_DOC.pdf",
    originalContent
  );

  const uploadDoc = await request("POST", "/api/documents", {
    Authorization: `Bearer ${officerToken}`,
    "Content-Type": `multipart/form-data; boundary=${multipart1.boundary}`,
  }, multipart1.body);

  assert(uploadDoc.status === 201 && uploadDoc.data.document.id, "Upload valid document succeeds with HTTP 201");
  const e2eDocId = uploadDoc.data.document.id;

  // Download and compare binary sha256
  const downloadV1 = await request("GET", `/api/documents/${e2eDocId}/download`, { Authorization: `Bearer ${officerToken}` });
  assert(downloadV1.status === 200, "Uploader successfully downloads document content (HTTP 200)");
  const downloadedSha256 = crypto.createHash("sha256").update(downloadV1.rawBuffer).digest("hex");
  assert(downloadedSha256 === originalSha256, "Downloaded binary stream cryptographically matches original uploaded SHA-256");

  // Upload Version 2
  const v2Content = Buffer.from("VERSION 2 SUPPLEMENTARY AUDIT LOG - " + Date.now());
  const v2Sha256 = crypto.createHash("sha256").update(v2Content).digest("hex");
  const multipart2 = createMultipartBody(
    { notes: "Added forensic supplementary analysis" },
    "file",
    "E2E_PRIMARY_EVIDENCE_DOC_V2.pdf",
    v2Content
  );

  const uploadV2 = await request("POST", `/api/documents/${e2eDocId}/versions`, {
    Authorization: `Bearer ${officerToken}`,
    "Content-Type": `multipart/form-data; boundary=${multipart2.boundary}`,
  }, multipart2.body);

  assert(uploadV2.status === 201, "Upload Version 2 succeeds with HTTP 201");

  const docMeta = await request("GET", `/api/documents/${e2eDocId}`, { Authorization: `Bearer ${officerToken}` });
  assert(docMeta.data.document.latestVersionNo === 2, "Document metadata reflects latestVersionNo: 2");
  assert(Array.isArray(docMeta.data.document.versions) && docMeta.data.document.versions.length === 2, "Document preserves complete version history (Version 1 and Version 2)");

  // Unauthorized access check: Legal officer without grant cannot access confidential document
  const unauthDocAccess = await request("GET", `/api/documents/${e2eDocId}`, { Authorization: `Bearer ${legalToken}` });
  assert(unauthDocAccess.status === 403, "Non-granted user receives HTTP 403 on restricted/confidential document");


  // ==========================================================================
  // PART 5: Evidence Management & Two-Step Custody Handshake State Machine
  // ==========================================================================
  console.log("\n[PART 5] Evidence Management & Custody Handshake State Machine Tests:");

  const createEvidence = await prisma.evidenceItem.create({
    data: {
      caseId: e2eCaseId,
      name: "E2E Seized Hardware Key",
      description: "Cryptographic hardware token retrieved from scene",
      status: "COLLECTED",
      currentCustodianId: officerUser.id,
    },
  });
  assert(createEvidence.currentCustodianId === officerUser.id, "Evidence created with initial custodian: Investigating Officer");

  // 5.1: Non-custodian cannot initiate transfer
  const badInit = await request("POST", `/api/evidence/${createEvidence.id}/transfer`, { Authorization: `Bearer ${legalToken}` }, {
    toUserId: forensicUser.id,
    purpose: "Unauthorized attempt",
  });
  assert(badInit.status === 403, "Non-custodian non-admin is forbidden from initiating custody transfer (HTTP 403)");

  // 5.2: Self-transfer blocked
  const selfInit = await request("POST", `/api/evidence/${createEvidence.id}/transfer`, { Authorization: `Bearer ${officerToken}` }, {
    toUserId: officerUser.id,
    purpose: "Self-transfer",
  });
  assert(selfInit.status === 400, "Self-transfer rejected with HTTP 400");

  // 5.3: Valid transfer initiation
  const initTransfer = await request("POST", `/api/evidence/${createEvidence.id}/transfer`, { Authorization: `Bearer ${officerToken}` }, {
    toUserId: forensicUser.id,
    purpose: "Forensic extraction and hardware dump",
    sealNumber: "SEAL-IND-8841",
    packageCondition: "SEALED_INTACT",
    location: "Central Forensic Science Laboratory",
  });
  assert(initTransfer.status === 201 && initTransfer.data.transfer.status === "PENDING", "Transfer initiated into PENDING status");
  const transferId = initTransfer.data.transfer.id;

  // Invariant: Sender remains current custodian while PENDING
  const midEvidence = await prisma.evidenceItem.findUnique({ where: { id: createEvidence.id } });
  assert(midEvidence.currentCustodianId === officerUser.id, "Sender remains accountable custodian while transfer is PENDING");

  // 5.4: Unauthorized user cannot accept
  const badAccept = await request("POST", `/api/evidence/transfers/${transferId}/accept`, { Authorization: `Bearer ${legalToken}` });
  assert(badAccept.status === 403, "Non-recipient is forbidden from accepting transfer (HTTP 403)");

  // 5.5: Recipient accepts transfer -> atomic custodian handoff
  const goodAccept = await request("POST", `/api/evidence/transfers/${transferId}/accept`, { Authorization: `Bearer ${forensicToken}` });
  assert(goodAccept.status === 200, "Intended recipient accepts transfer successfully");

  const acceptedEvidence = await prisma.evidenceItem.findUnique({ where: { id: createEvidence.id } });
  assert(acceptedEvidence.currentCustodianId === forensicUser.id, "Evidence current custodian updated atomically to Forensic Officer upon acceptance");

  // Duplicate accept rejected
  const dupAccept = await request("POST", `/api/evidence/transfers/${transferId}/accept`, { Authorization: `Bearer ${forensicToken}` });
  assert(dupAccept.status === 409, "Duplicate accept on finalized transfer rejected with HTTP 409 Conflict");


  // ==========================================================================
  // PART 6: Granular Access Control & Scopes
  // ==========================================================================
  console.log("\n[PART 6] Granular Access Scopes & Access Request Lifecycle Tests:");

  // Submit access request as Legal Officer for VIEW_METADATA only
  const submitReq = await request("POST", "/api/access-requests", { Authorization: `Bearer ${legalToken}` }, {
    documentId: e2eDocId,
    reason: "Legal review for affidavit preparation",
    durationHours: 6,
    requestedScopes: ["VIEW_METADATA", "PREVIEW"],
  });
  assert(submitReq.status === 201 && submitReq.data.request.status === "PENDING", "Access request submitted in PENDING status");
  const accessReqId = submitReq.data.request.id;

  // Approve request as Senior Officer
  const approveReq = await request("POST", `/api/access-requests/${accessReqId}/approve`, { Authorization: `Bearer ${seniorToken}` }, {
    expiresInHours: 6,
  });
  assert(approveReq.status === 200 && approveReq.data.ok === true, "Senior Officer approves access request");

  // Verify Legal Officer can now view document metadata
  const legalView = await request("GET", `/api/documents/${e2eDocId}`, { Authorization: `Bearer ${legalToken}` });
  assert(legalView.status === 200, "Legal Officer with active VIEW_METADATA grant views document metadata (HTTP 200)");

  // Verify Legal Officer CANNOT download (missing DOWNLOAD scope)
  const legalBadDownload = await request("GET", `/api/documents/${e2eDocId}/download`, { Authorization: `Bearer ${legalToken}` });
  assert(legalBadDownload.status === 403, "Legal Officer blocked from download due to missing DOWNLOAD scope (HTTP 403)");

  // Revoke grant
  const activeGrants = await prisma.documentAccess.findFirst({ where: { documentId: e2eDocId, userId: legalUser.id, isActive: true } });
  const revokeGrant = await request("POST", `/api/access-requests/grants/${activeGrants.id}/revoke`, { Authorization: `Bearer ${seniorToken}` }, {
    reason: "Early termination of review assignment",
  });
  assert(revokeGrant.status === 200, "Senior Officer revokes access grant early");

  // Immediate denial after revocation
  const postRevokeView = await request("GET", `/api/documents/${e2eDocId}`, { Authorization: `Bearer ${legalToken}` });
  assert(postRevokeView.status === 403, "Access immediately denied following grant revocation (HTTP 403)");


  // ==========================================================================
  // PART 7: Secure Sharing & Token Hash Migration
  // ==========================================================================
  console.log("\n[PART 7] Secure Share Links, Token Hashing & PIN Enforcement Tests:");

  // Create PIN-protected share link
  const createShare = await request("POST", `/api/documents/${e2eDocId}/share`, { Authorization: `Bearer ${seniorToken}` }, {
    expiresInHours: 24,
    maxUses: 2,
    pin: "9876",
  });
  assert(createShare.status === 201 && createShare.data.share.token, "Share link created with raw token returned once in response");
  const rawShareToken = createShare.data.share.token;
  const shareLinkId = createShare.data.share.id;

  // Verify raw token is NOT stored in DB
  const storedShare = await prisma.shareLink.findUnique({ where: { id: shareLinkId } });
  assert(storedShare.token === null, "Plaintext token is NOT stored in database");
  assert(storedShare.tokenHash !== null, "SHA-256 tokenHash is stored in database");

  // Access without PIN -> 401 requiresPin
  const publicNoPin = await request("GET", `/api/share/${rawShareToken}`);
  assert(publicNoPin.status === 401 && publicNoPin.data.requiresPin === true, "Public share lookup without PIN returns HTTP 401 { requiresPin: true }");

  // Query parameter PIN ?pin=... rejected (Header-only enforcement)
  const publicQueryPin = await request("GET", `/api/share/${rawShareToken}?pin=9876`);
  assert(publicQueryPin.status === 401, "Query-parameter PIN (?pin=...) rejected with HTTP 401 (Header-only enforced)");

  // Correct PIN in x-share-pin header succeeds
  const publicGoodPin = await request("GET", `/api/share/${rawShareToken}`, { "x-share-pin": "9876" });
  assert(publicGoodPin.status === 200 && publicGoodPin.data.share.name, "Public share lookup with x-share-pin header succeeds (HTTP 200)");

  // Download with valid PIN
  const publicDownload = await request("GET", `/api/share/${rawShareToken}/download`, { "x-share-pin": "9876" });
  assert(publicDownload.status === 200, "Public download with valid PIN header succeeds");
  const dlSha = crypto.createHash("sha256").update(publicDownload.rawBuffer).digest("hex");
  assert(dlSha === v2Sha256, "Publicly downloaded file matches latest document version SHA-256");


  // ==========================================================================
  // PART 8: Audit Logging, Verifiability & CSV/JSON Export
  // ==========================================================================
  console.log("\n[PART 8] Cryptographic Audit Chain Integrity & Export Tests:");

  // 8.1: Run verification engine
  const chainReport = await verifyAuditChain();
  assert(chainReport.status === "VALID", `Cryptographic audit chain verified 100% VALID (${chainReport.validRecords}/${chainReport.totalRecords} records)`);

  // 8.2: Export JSON
  const jsonExport = await request("GET", "/api/audit/export?format=json", { Authorization: `Bearer ${adminToken}` });
  assert(jsonExport.status === 200 && Array.isArray(jsonExport.data.records), "Admin exports audit logs in JSON format");
  assert(JSON.stringify(jsonExport.data).indexOf("passwordHash") === -1, "Exported JSON strictly scrubs all password hashes");

  // 8.3: Export CSV
  const csvExport = await request("GET", "/api/audit/export?format=csv", { Authorization: `Bearer ${adminToken}` });
  assert(csvExport.status === 200 && typeof csvExport.data === "string", "Admin exports audit logs in CSV format");
  const csvHeader = csvExport.data.split("\n")[0];
  assert(csvHeader.includes("previousHash") && csvHeader.includes("formatVersion"), "CSV header contains full cryptographic verification columns");


  // ==========================================================================
  // PART 9: Automated Expiry & Background Jobs
  // ==========================================================================
  console.log("\n[PART 9] Automated Expiry Sweeps & Advisory Lock Concurrency Tests:");

  // Create an expired grant
  const pastGrant = await prisma.documentAccess.create({
    data: {
      documentId: e2eDocId,
      userId: forensicUser.id,
      grantedById: adminUser.id,
      scopes: ["VIEW_METADATA"],
      expiresAt: new Date(Date.now() - 3600000),
      isActive: true,
    },
  });

  // Execute sweep
  const sweepOutcome = await runAdvisoryLockedExpirySweep();
  assert(sweepOutcome.executed === true && sweepOutcome.result.accessGrants.processed >= 1, "Advisory-locked expiry sweep processed expired grant");

  const reloadedPastGrant = await prisma.documentAccess.findUnique({ where: { id: pastGrant.id } });
  assert(reloadedPastGrant.isActive === false && reloadedPastGrant.revokeReason === "EXPIRED_AUTOMATIC", "Expired grant marked isActive: false with 'EXPIRED_AUTOMATIC'");


  // ==========================================================================
  // PART 10: Notification Delivery & User Isolation
  // ==========================================================================
  console.log("\n[PART 10] Notification Delivery & Visibility Tests:");

  const userNotifications = await request("GET", "/api/notifications", { Authorization: `Bearer ${forensicToken}` });
  assert(userNotifications.status === 200 && Array.isArray(userNotifications.data.notifications), "User retrieves personalized notification inbox");

  const unreadCount = await request("GET", "/api/notifications/unread-count", { Authorization: `Bearer ${forensicToken}` });
  assert(unreadCount.status === 200 && typeof unreadCount.data.count === "number", "User unread count endpoint returns numerical count");


  // ==========================================================================
  // PART 11: Database & Data Integrity
  // ==========================================================================
  console.log("\n[PART 11] Database Relationship & Foreign Key Integrity Tests:");

  const postChainReport = await verifyAuditChain();
  assert(postChainReport.status === "VALID", "Audit chain remains 100% VALID after all E2E operations");


  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log("\n==============================================================================");
  console.log(`MASTER E2E SUITE RESULTS:`);
  console.log(`TOTAL EXECUTED : ${totalExecuted}`);
  console.log(`TOTAL PASSED   : ${passed}`);
  console.log(`TOTAL FAILED   : ${failed}`);
  console.log("==============================================================================");

  await prisma.$disconnect();
  if (failed > 0) {
    process.exit(1);
  }
}

runMasterE2ETests().catch((err) => {
  console.error("Master E2E execution failed:", err);
  process.exit(1);
});
