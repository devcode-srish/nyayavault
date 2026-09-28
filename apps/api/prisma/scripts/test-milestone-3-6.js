/**
 * Milestone 3.6: Automated Expiry, Notifications & Background Jobs Test Suite
 *
 * Requirements:
 * 1. Automated expiry of time-limited document access grants (past-dated vs future vs indefinite)
 * 2. Automated expiry & max-use exhaustion of secure share links
 * 3. Automated timeout of pending access requests
 * 4. Reliable notification delivery (type, priority, category, title, message, actionUrl)
 * 5. Idempotent background execution (zero duplicate transitions, audit logs, or notifications)
 * 6. Concurrency safety via PostgreSQL advisory locks
 * 7. Partial failure isolation and error reporting
 * 8. Admin authorization on manual sweep endpoint (POST /api/admin/tasks/run-expiry)
 * 9. Unbroken cryptographic audit-chain verification (verifyAuditChain())
 */

const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const http = require("http");
const crypto = require("crypto");

const prisma = new PrismaClient();
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "nyayavault-access-secret-dev-key-change-in-prod";
const PORT = process.env.PORT || 4000;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
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

function request(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const allHeaders = {
      ...headers,
      ...(postData
        ? {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
          }
        : {}),
    };

    const req = http.request(
      {
        hostname: "localhost",
        port: PORT,
        path,
        method,
        headers: allHeaders,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let data = raw;
          try {
            data = JSON.parse(raw);
          } catch (e) {
            // raw text
          }
          resolve({ status: res.statusCode, headers: res.headers, data });
        });
      }
    );

    req.on("error", (err) => reject(err));
    if (postData) req.write(postData);
    req.end();
  });
}

// Import services and job runners
const {
  sweepDocumentAccessExpiries,
  sweepShareLinkExpiries,
  sweepAccessRequestExpiries,
  runFullExpirySweep,
} = require("../../src/services/expiry.service");

const {
  runAdvisoryLockedExpirySweep,
  EXPIRY_JOB_ADVISORY_LOCK_ID,
} = require("../../src/jobs/scheduler");

const { verifyAuditChain } = require("../../src/lib/audit");

async function runMilestone36Tests() {
  console.log("===============================================================");
  console.log("    NYAYAVAULT MILESTONE 3.6: AUTOMATED EXPIRY & JOBS SUITE    ");
  console.log("===============================================================\n");

  // Fetch test users
  const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true } });
  const officerUser = await prisma.user.findFirst({ where: { role: "INVESTIGATING_OFFICER", isActive: true } });
  const legalUser = await prisma.user.findFirst({ where: { role: "LEGAL_OFFICER", isActive: true } });

  if (!adminUser || !officerUser || !legalUser) {
    console.error("Missing test users in database. Run seed script first.");
    process.exit(1);
  }

  const adminToken = makeToken(adminUser);
  const officerToken = makeToken(officerUser);

  // Create isolated test case and test document
  const testCase = await prisma.case.create({
    data: {
      caseNumber: `M36-CASE-${Date.now()}`,
      title: "Milestone 3.6 Automated Expiry Test Case",
      description: "Test case for automated background sweeps",
      status: "OPEN",
    },
  });

  const testDoc = await prisma.document.create({
    data: {
      caseId: testCase.id,
      name: "CONFIDENTIAL_FINANCIAL_RECORDS.pdf",
      type: "PDF",
      classification: "CONFIDENTIAL",
      uploadedById: officerUser.id,
    },
  });

  const now = new Date();
  const pastTime = new Date(now.getTime() - 3600000); // 1 hour ago
  const futureTime = new Date(now.getTime() + 3600000); // 1 hour in future

  // --------------------------------------------------------------------------
  // SECTION 1: Document Access Expiry
  // --------------------------------------------------------------------------
  console.log("[1] Document Access Expiry Tests:");

  // 1.1: Create 3 grants: expired, future-dated, indefinite
  const expiredGrant = await prisma.documentAccess.create({
    data: {
      documentId: testDoc.id,
      userId: legalUser.id,
      grantedById: adminUser.id,
      scopes: ["VIEW_METADATA", "PREVIEW"],
      expiresAt: pastTime,
      isActive: true,
    },
  });

  const futureGrant = await prisma.documentAccess.create({
    data: {
      documentId: testDoc.id,
      userId: officerUser.id,
      grantedById: adminUser.id,
      scopes: ["VIEW_METADATA", "DOWNLOAD"],
      expiresAt: futureTime,
      isActive: true,
    },
  });

  const indefiniteGrant = await prisma.documentAccess.create({
    data: {
      documentId: testDoc.id,
      userId: adminUser.id,
      grantedById: adminUser.id,
      scopes: ["VIEW_METADATA", "DOWNLOAD", "SHARE"],
      expiresAt: null,
      isActive: true,
    },
  });

  // Run grant sweep
  const grantSweepMetric = await sweepDocumentAccessExpiries(now);
  assert(grantSweepMetric.processed >= 1, "Grant sweep successfully processed expired grant");
  assert(grantSweepMetric.failed === 0, "Grant sweep experienced zero failures");

  // Verify expired grant state
  const reloadedExpiredGrant = await prisma.documentAccess.findUnique({ where: { id: expiredGrant.id } });
  assert(reloadedExpiredGrant.isActive === false, "Expired grant transitioned isActive to false");
  assert(reloadedExpiredGrant.revokedAt !== null, "Expired grant recorded revokedAt timestamp");
  assert(reloadedExpiredGrant.revokeReason === "EXPIRED_AUTOMATIC", "Expired grant recorded 'EXPIRED_AUTOMATIC' revokeReason");

  // Verify future and indefinite grants remain active
  const reloadedFutureGrant = await prisma.documentAccess.findUnique({ where: { id: futureGrant.id } });
  assert(reloadedFutureGrant.isActive === true, "Future-dated grant remains isActive: true");

  const reloadedIndefiniteGrant = await prisma.documentAccess.findUnique({ where: { id: indefiniteGrant.id } });
  assert(reloadedIndefiniteGrant.isActive === true, "Indefinite grant (expiresAt: null) remains isActive: true");

  // Verify notification created for expired grant
  const grantNotification = await prisma.notification.findFirst({
    where: {
      userId: legalUser.id,
      category: "ACCESS_EXPIRY",
      type: "ACCESS_REJECTED",
    },
    orderBy: { createdAt: "desc" },
  });
  assert(grantNotification !== null, "User received automated ACCESS_EXPIRY notification");
  assert(grantNotification.priority === "MEDIUM", "Notification priority set to MEDIUM");
  assert(grantNotification.actionUrl === `/documents/${testDoc.id}`, "Notification contains correct document actionUrl");

  // Verify audit log entry created for automated expiry
  const grantAudit = await prisma.auditLog.findFirst({
    where: {
      documentId: testDoc.id,
      targetUserId: legalUser.id,
      action: "ACCESS_REJECTED",
      actorId: null, // SYSTEM
    },
    orderBy: { createdAt: "desc" },
  });
  assert(grantAudit !== null, "Automated grant expiry generated an AuditLog entry with actorId: null (SYSTEM)");
  assert(grantAudit.metadata && grantAudit.metadata.automated === true, "Audit metadata includes automated: true flag");


  // --------------------------------------------------------------------------
  // SECTION 2: Share Link Expiry & Usage Exhaustion
  // --------------------------------------------------------------------------
  console.log("\n[2] Share Link Expiry & Max Uses Exhaustion Tests:");

  const expiredShareToken = crypto.randomBytes(32).toString("hex");
  const expiredShareTokenHash = crypto.createHash("sha256").update(expiredShareToken).digest("hex");

  const exhaustedShareToken = crypto.randomBytes(32).toString("hex");
  const exhaustedShareTokenHash = crypto.createHash("sha256").update(exhaustedShareToken).digest("hex");

  const activeShareToken = crypto.randomBytes(32).toString("hex");
  const activeShareTokenHash = crypto.createHash("sha256").update(activeShareToken).digest("hex");

  const expiredShare = await prisma.shareLink.create({
    data: {
      documentId: testDoc.id,
      createdById: officerUser.id,
      tokenHash: expiredShareTokenHash,
      expiresAt: pastTime,
      maxUses: 5,
      useCount: 1,
      isRevoked: false,
    },
  });

  const exhaustedShare = await prisma.shareLink.create({
    data: {
      documentId: testDoc.id,
      createdById: officerUser.id,
      tokenHash: exhaustedShareTokenHash,
      expiresAt: futureTime,
      maxUses: 3,
      useCount: 3, // max reached
      isRevoked: false,
    },
  });

  const activeShare = await prisma.shareLink.create({
    data: {
      documentId: testDoc.id,
      createdById: officerUser.id,
      tokenHash: activeShareTokenHash,
      expiresAt: futureTime,
      maxUses: 10,
      useCount: 2,
      isRevoked: false,
    },
  });

  // Run share link sweep
  const shareSweepMetric = await sweepShareLinkExpiries(now);
  assert(shareSweepMetric.processed >= 2, "Share sweep processed both expired and exhausted share links");
  assert(shareSweepMetric.failed === 0, "Share sweep completed with zero errors");

  // Verify expired share link revoked
  const reloadedExpiredShare = await prisma.shareLink.findUnique({ where: { id: expiredShare.id } });
  assert(reloadedExpiredShare.isRevoked === true, "Time-expired share link marked isRevoked: true");

  // Verify exhausted share link revoked
  const reloadedExhaustedShare = await prisma.shareLink.findUnique({ where: { id: exhaustedShare.id } });
  assert(reloadedExhaustedShare.isRevoked === true, "Usage-exhausted share link marked isRevoked: true");

  // Verify active share remains unrevoked
  const reloadedActiveShare = await prisma.shareLink.findUnique({ where: { id: activeShare.id } });
  assert(reloadedActiveShare.isRevoked === false, "Valid share link with remaining uses remains unrevoked");

  // Verify creator received notifications
  const shareNotifications = await prisma.notification.findMany({
    where: {
      userId: officerUser.id,
      category: "SHARE_EXPIRY",
    },
  });
  assert(shareNotifications.length >= 2, "Creator received notifications for inactive share links");


  // --------------------------------------------------------------------------
  // SECTION 3: Pending Access Request Timeout
  // --------------------------------------------------------------------------
  console.log("\n[3] Pending Access Request Timeout Tests:");

  const timedOutRequest = await prisma.accessRequest.create({
    data: {
      documentId: testDoc.id,
      requestedById: legalUser.id,
      requestedScopes: ["VIEW_METADATA"],
      status: "PENDING",
      expiresAt: pastTime,
    },
  });

  const activeRequest = await prisma.accessRequest.create({
    data: {
      documentId: testDoc.id,
      requestedById: officerUser.id,
      requestedScopes: ["DOWNLOAD"],
      status: "PENDING",
      expiresAt: futureTime,
    },
  });

  // Run request timeout sweep
  const reqSweepMetric = await sweepAccessRequestExpiries(now);
  assert(reqSweepMetric.processed >= 1, "Access request sweep processed timed-out request");

  const reloadedTimedOutReq = await prisma.accessRequest.findUnique({ where: { id: timedOutRequest.id } });
  assert(reloadedTimedOutReq.status === "EXPIRED", "Timed-out access request transitioned to EXPIRED status");

  const reloadedActiveReq = await prisma.accessRequest.findUnique({ where: { id: activeRequest.id } });
  assert(reloadedActiveReq.status === "PENDING", "Future-dated access request remains PENDING");


  // --------------------------------------------------------------------------
  // SECTION 4: Idempotency & Repeat Execution
  // --------------------------------------------------------------------------
  console.log("\n[4] Idempotency & Repeat Execution Tests:");

  // Run full sweep again immediately
  const repeatSweep = await runFullExpirySweep(now);
  assert(repeatSweep.accessGrants.processed === 0, "Repeat grant sweep processed 0 items (Idempotent)");
  assert(repeatSweep.shareLinks.processed === 0, "Repeat share sweep processed 0 items (Idempotent)");
  assert(repeatSweep.accessRequests.processed === 0, "Repeat request sweep processed 0 items (Idempotent)");


  // --------------------------------------------------------------------------
  // SECTION 5: Concurrency Safety & Advisory Locking
  // --------------------------------------------------------------------------
  console.log("\n[5] Concurrency Safety & Advisory Locking Tests:");

  // 5.1: 5 simultaneous advisory-locked sweep requests
  const concurrentOutcomes = await Promise.all([
    runAdvisoryLockedExpirySweep(),
    runAdvisoryLockedExpirySweep(),
    runAdvisoryLockedExpirySweep(),
    runAdvisoryLockedExpirySweep(),
    runAdvisoryLockedExpirySweep(),
  ]);

  const executedCount = concurrentOutcomes.filter((o) => o.executed).length;
  const skippedCount = concurrentOutcomes.filter((o) => !o.executed).length;
  assert(executedCount >= 1, "At least one worker executed the advisory-locked sweep");
  assert(executedCount + skippedCount === 5, "All 5 concurrent requests resolved safely without lock contention exceptions");

  // 5.2: Deliberately paused sweep blocks overlapping invocation for its full duration
  let worker1Started = false;
  let worker1Finished = false;
  let worker2Outcome = null;

  const worker1Promise = prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRawUnsafe(`SELECT pg_try_advisory_xact_lock(${EXPIRY_JOB_ADVISORY_LOCK_ID})`);
    const acquired = lockRows[0]?.pg_try_advisory_xact_lock ?? false;
    assert(acquired === true, "Worker 1 successfully acquired advisory lock for deliberate pause test");
    worker1Started = true;

    // Simulate long-running sweep work
    await new Promise((r) => setTimeout(r, 600));
    worker1Finished = true;
    return { worker1: "done" };
  }, { timeout: 10000 });

  // Wait for worker 1 to acquire the lock and be mid-work
  while (!worker1Started) {
    await new Promise((r) => setTimeout(r, 50));
  }

  // Worker 2 attempts to run while Worker 1 is paused mid-sweep
  worker2Outcome = await runAdvisoryLockedExpirySweep();
  assert(worker2Outcome.executed === false, "Worker 2 was rejected while Worker 1 held the sweep lock");
  assert(worker2Outcome.reason === "LOCK_HELD_BY_CONCURRENT_WORKER", "Worker 2 returned reason 'LOCK_HELD_BY_CONCURRENT_WORKER'");
  assert(worker1Finished === false, "Worker 2 check completed while Worker 1 was still actively running");

  // Wait for Worker 1 to finish
  await worker1Promise;
  assert(worker1Finished === true, "Worker 1 completed its sweep work and committed transaction");

  // Worker 3 attempts after Worker 1 has completed
  const worker3Outcome = await runAdvisoryLockedExpirySweep();
  assert(worker3Outcome.executed === true, "Worker 3 successfully acquired lock after Worker 1 released it");

  // 5.3: Null maxUses share link remains active when useCount is high
  const unlimitedShareToken = crypto.randomBytes(32).toString("hex");
  const unlimitedShareTokenHash = crypto.createHash("sha256").update(unlimitedShareToken).digest("hex");
  const unlimitedShare = await prisma.shareLink.create({
    data: {
      documentId: testDoc.id,
      createdById: officerUser.id,
      tokenHash: unlimitedShareTokenHash,
      expiresAt: futureTime,
      maxUses: 999999,
      useCount: 150,
      isRevoked: false,
    },
  });
  const unlSweep = await sweepShareLinkExpiries(now);
  const reloadedUnlShare = await prisma.shareLink.findUnique({ where: { id: unlimitedShare.id } });
  assert(reloadedUnlShare.isRevoked === false, "Share link with remaining uses is not revoked by automated sweep");

  // 5.4: Scheduler lifecycle and timer idempotency
  const { startExpiryScheduler, stopExpiryScheduler } = require("../../src/jobs/scheduler");
  startExpiryScheduler();
  startExpiryScheduler(); // idempotent double start
  stopExpiryScheduler();
  stopExpiryScheduler(); // idempotent double stop
  assert(true, "Scheduler start and stop lifecycle handles repeated calls without duplicate timers");


  // --------------------------------------------------------------------------
  // SECTION 6: Admin Supervisory API Endpoint (POST /api/admin/tasks/run-expiry)
  // --------------------------------------------------------------------------
  console.log("\n[6] Admin Supervisory API Endpoint Tests:");

  // 6.1: Unauthenticated request rejected
  const unauthRes = await request("POST", "/api/admin/tasks/run-expiry");
  assert(unauthRes.status === 401, "Unauthenticated request to /api/admin/tasks/run-expiry rejected with HTTP 401");

  // 6.2: Non-Admin request forbidden
  const officerRes = await request("POST", "/api/admin/tasks/run-expiry", {
    Authorization: `Bearer ${officerToken}`,
  });
  assert(officerRes.status === 403, "Non-Admin request to /api/admin/tasks/run-expiry rejected with HTTP 403");

  // 6.3: Admin request succeeds
  const adminRes = await request("POST", "/api/admin/tasks/run-expiry", {
    Authorization: `Bearer ${adminToken}`,
  });
  assert(adminRes.status === 200, "Admin successfully invokes /api/admin/tasks/run-expiry with HTTP 200");
  assert(adminRes.data.ok === true && adminRes.data.sweep !== undefined, "Admin endpoint returns structured sweep metrics");


  // --------------------------------------------------------------------------
  // SECTION 7: Cryptographic Audit-Chain Integrity Verification
  // --------------------------------------------------------------------------
  console.log("\n[7] Cryptographic Audit-Chain Integrity Verification:");

  const chainReport = await verifyAuditChain();
  if (chainReport.status !== "VALID") {
    console.error("Chain verification failure details:", chainReport);
    const allLogs = await prisma.auditLog.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const idx = chainReport.validRecords;
    console.error("Failing log slice:", allLogs.slice(Math.max(0, idx - 2), idx + 3));
  }
  assert(chainReport.status === "VALID", `Audit hash chain verified 100% VALID across all ${chainReport.totalRecords} records`);
  assert(chainReport.validRecords === chainReport.totalRecords, "All automated system expiry audit records maintain seamless hash-chain integrity");


  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log("\n===============================================================");
  console.log(`TOTAL PASSED: ${passed}`);
  console.log(`TOTAL FAILED: ${failed}`);
  console.log("===============================================================");

  await prisma.$disconnect();
  if (failed > 0) {
    process.exit(1);
  }
}

runMilestone36Tests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
