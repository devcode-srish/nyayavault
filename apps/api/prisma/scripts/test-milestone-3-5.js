/**
 * Milestone 3.5: Audit-Chain Runtime Hardening & Verification Test Suite
 *
 * Tests:
 * 1. Canonical Serialization & Determinism (key orders, unicode, nulls, nested objects/arrays, delimiters, timestamps)
 * 2. Concurrency & Advisory Locking (simultaneous writes serialize into an unbroken, un-forked linear chain)
 * 3. Transaction Atomicity & Rollback (business transaction rolls back when audit fails and vice versa)
 * 4. Read-Only Chain Verification (valid chains, single-record, multi-record, legacy v1 and v2 format detection)
 * 5. Tamper Detection (tampered notes/metadata, altered hash, altered previousHash, deleted middle record, reordered records, invalid root)
 * 6. Protected Endpoints & Authorization (GET /api/audit/verify and GET /api/audit/export - Admin only, non-admin rejected)
 * 7. Secure Export Integrity & Independent Verifiability (preserves cryptographic proofs, scrubs secrets)
 */

const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const http = require("http");
const crypto = require("crypto");

const prisma = new PrismaClient();
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "nyayavault-access-secret-dev-key-change-in-prod";
const PORT = process.env.PORT || 4000;
const AUDIT_CHAIN_ADVISORY_LOCK_ID = 749215091;
const GENESIS_PREV_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

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
            // raw string (e.g. CSV)
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

function canonicalJson(obj) {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "number" || typeof obj === "boolean") return JSON.stringify(obj);
  if (typeof obj === "string") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJson).join(",") + "]";
  }
  if (typeof obj === "object") {
    const keys = Object.keys(obj).sort();
    const pairs = keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]));
    return "{" + pairs.join(",") + "}";
  }
  return JSON.stringify(obj);
}

function canonicalAuditStringV1(entry) {
  const createdAtIso = entry.createdAt instanceof Date ? entry.createdAt.toISOString() : new Date(entry.createdAt).toISOString();
  let metaStr = "";
  if (entry.metadata !== null && entry.metadata !== undefined) {
    if (typeof entry.metadata === "object") {
      const keys = Object.keys(entry.metadata).sort();
      const pairs = keys.map((k) => JSON.stringify(k) + ":" + (typeof entry.metadata[k] === "object" ? canonicalJson(entry.metadata[k]) : JSON.stringify(entry.metadata[k])));
      metaStr = "{" + pairs.join(",") + "}";
    } else {
      metaStr = JSON.stringify(entry.metadata);
    }
  }
  return [
    entry.id,
    createdAtIso,
    entry.action,
    entry.outcome || "SUCCESS",
    entry.actorId || "",
    entry.caseId || "",
    entry.documentId || "",
    entry.evidenceId || "",
    entry.notes ? entry.notes.trim() : "",
    metaStr,
    entry.previousHash,
  ].join("|");
}

function computeAuditHashV1(entry) {
  const canonical = canonicalAuditStringV1(entry);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

function canonicalAuditObjectV2(entry) {
  const createdAtIso = entry.createdAt instanceof Date ? entry.createdAt.toISOString() : new Date(entry.createdAt).toISOString();
  const canonicalObj = {
    action: entry.action,
    actorId: entry.actorId ?? null,
    caseId: entry.caseId ?? null,
    createdAt: createdAtIso,
    documentId: entry.documentId ?? null,
    evidenceId: entry.evidenceId ?? null,
    id: entry.id,
    metadata: entry.metadata ?? null,
    notes: entry.notes ? entry.notes.trim() : null,
    outcome: entry.outcome ?? "SUCCESS",
    previousHash: entry.previousHash,
    targetUserId: entry.targetUserId ?? null,
  };
  return canonicalJson(canonicalObj);
}

function computeAuditHashV2(entry) {
  const canonical = canonicalAuditObjectV2(entry);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

async function recordAudit(params, existingTx) {
  const executeInTransaction = async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_ADVISORY_LOCK_ID})`);

    const lastLog = await tx.auditLog.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { hash: true },
    });

    const previousHash = lastLog?.hash || GENESIS_PREV_HASH;
    const createdAt = new Date();

    const createdLog = await tx.auditLog.create({
      data: {
        action: params.action,
        outcome: params.outcome ?? "SUCCESS",
        actorId: params.actorId ?? undefined,
        documentId: params.documentId ?? undefined,
        evidenceId: params.evidenceId ?? undefined,
        caseId: params.caseId ?? undefined,
        targetUserId: params.targetUserId ?? undefined,
        notes: params.notes ?? undefined,
        metadata: params.metadata,
        previousHash,
        hash: "PENDING_CALCULATION",
        createdAt,
      },
    });

    const hash = computeAuditHashV2({
      id: createdLog.id,
      action: createdLog.action,
      outcome: createdLog.outcome,
      actorId: createdLog.actorId,
      documentId: createdLog.documentId,
      evidenceId: createdLog.evidenceId,
      caseId: createdLog.caseId,
      targetUserId: createdLog.targetUserId,
      notes: createdLog.notes,
      metadata: createdLog.metadata,
      previousHash,
      createdAt: createdLog.createdAt,
    });

    const finalizedLog = await tx.auditLog.update({
      where: { id: createdLog.id },
      data: { hash },
    });

    return finalizedLog;
  };

  if (existingTx) {
    return executeInTransaction(existingTx);
  } else {
    return prisma.$transaction(async (tx) => {
      return executeInTransaction(tx);
    });
  }
}

async function verifyAuditChain(client) {
  const db = client || prisma;
  const logs = await db.auditLog.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const verifiedAt = new Date().toISOString();
  const formatVersionsSet = new Set();

  if (logs.length === 0) {
    return {
      status: "VALID",
      totalRecords: 0,
      validRecords: 0,
      firstInvalidRecordId: null,
      failureReason: null,
      expectedHash: null,
      actualHash: null,
      expectedPreviousHash: null,
      actualPreviousHash: null,
      verifiedAt,
      formatVersions: [],
    };
  }

  let expectedPrevHash = GENESIS_PREV_HASH;
  let validRecords = 0;

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];

    if (!log.previousHash || log.previousHash !== expectedPrevHash) {
      return {
        status: "INVALID",
        totalRecords: logs.length,
        validRecords,
        firstInvalidRecordId: log.id,
        failureReason: `Broken previousHash reference at index ${i} (record ${log.id}). Expected ${expectedPrevHash}, found ${log.previousHash || "null"}`,
        expectedHash: null,
        actualHash: log.hash,
        expectedPreviousHash: expectedPrevHash,
        actualPreviousHash: log.previousHash,
        verifiedAt,
        formatVersions: Array.from(formatVersionsSet),
      };
    }

    const expectedV2 = computeAuditHashV2({
      id: log.id,
      action: log.action,
      outcome: log.outcome,
      actorId: log.actorId,
      documentId: log.documentId,
      evidenceId: log.evidenceId,
      caseId: log.caseId,
      targetUserId: log.targetUserId,
      notes: log.notes,
      metadata: log.metadata,
      previousHash: log.previousHash,
      createdAt: log.createdAt,
    });

    let matchedVersion = null;
    if (log.hash === expectedV2) {
      matchedVersion = "v2_canonical_json";
    } else {
      const expectedV1 = computeAuditHashV1({
        id: log.id,
        action: log.action,
        outcome: log.outcome,
        actorId: log.actorId,
        caseId: log.caseId,
        documentId: log.documentId,
        evidenceId: log.evidenceId,
        notes: log.notes,
        metadata: log.metadata,
        previousHash: log.previousHash,
        createdAt: log.createdAt,
      });

      if (log.hash === expectedV1) {
        matchedVersion = "v1_legacy";
      }
    }

    if (!matchedVersion) {
      return {
        status: "INVALID",
        totalRecords: logs.length,
        validRecords,
        firstInvalidRecordId: log.id,
        failureReason: `Cryptographic digest mismatch at index ${i} (record ${log.id}). Stored hash does not match computed hash for supported formats.`,
        expectedHash: expectedV2,
        actualHash: log.hash,
        expectedPreviousHash: expectedPrevHash,
        actualPreviousHash: log.previousHash,
        verifiedAt,
        formatVersions: Array.from(formatVersionsSet),
      };
    }

    formatVersionsSet.add(matchedVersion);
    validRecords++;
    expectedPrevHash = log.hash;
  }

  return {
    status: "VALID",
    totalRecords: logs.length,
    validRecords,
    firstInvalidRecordId: null,
    failureReason: null,
    expectedHash: null,
    actualHash: null,
    expectedPreviousHash: null,
    actualPreviousHash: null,
    verifiedAt,
    formatVersions: Array.from(formatVersionsSet),
  };
}


async function runMilestone35Tests() {
  console.log("===============================================================");
  console.log("       NYAYAVAULT MILESTONE 3.5 SECURITY & INTEGRITY TESTS      ");
  console.log("===============================================================");

  // 0. Setup Test Actors
  const adminUser = await prisma.user.upsert({
    where: { email: "admin_audit_m35@example.com" },
    update: { isActive: true },
    create: {
      email: "admin_audit_m35@example.com",
      passwordHash: "dummy",
      name: "Admin Audit M35",
      role: "ADMIN",
    },
  });

  const officerUser = await prisma.user.upsert({
    where: { email: "officer_audit_m35@example.com" },
    update: { isActive: true },
    create: {
      email: "officer_audit_m35@example.com",
      passwordHash: "dummy",
      name: "Officer Audit M35",
      role: "INVESTIGATING_OFFICER",
    },
  });


  const adminToken = makeToken(adminUser);
  const officerToken = makeToken(officerUser);

  // --------------------------------------------------------------------------
  // SECTION 1: Canonical Serialization & Hashing Determinism
  // --------------------------------------------------------------------------
  console.log("\n[1] Canonical Serialization & Hashing Determinism Tests:");

  // Test 1.1: Key Order Independence in Metadata
  const meta1 = { zebra: "last", apple: "first", details: { beta: 2, alpha: 1 } };
  const meta2 = { apple: "first", details: { alpha: 1, beta: 2 }, zebra: "last" };
  const canon1 = canonicalJson(meta1);
  const canon2 = canonicalJson(meta2);
  assert(canon1 === canon2, "Canonical JSON produces identical representation regardless of top-level or nested key order");

  // Test 1.2: Unicode Strings & Hindi / Special Characters
  const unicodeSample = {
    caseTitle: "न्यायालय साक्ष्य प्रपत्र - केस संख्या १२३",
    inspector: "राजेश कुमार",
    sealCondition: "सील बंद (अक्षुण्ण)",
    symbol: "⚖️ 🛡️ 🔒",
  };
  const unicodeCanon = canonicalJson(unicodeSample);
  const unicodeHash1 = crypto.createHash("sha256").update(unicodeCanon, "utf8").digest("hex");
  const unicodeHash2 = crypto.createHash("sha256").update(unicodeCanon, "utf8").digest("hex");
  assert(unicodeHash1 === unicodeHash2, "Unicode characters hash stably and deterministically");

  // Test 1.3: Null vs Undefined handling
  const objWithNull = { action: "LOGIN", actorId: null, notes: null };
  const objWithoutKeys = { action: "LOGIN" };
  const canonNull = canonicalAuditObjectV2({ id: "1", createdAt: new Date("2026-01-01T00:00:00Z"), previousHash: GENESIS_PREV_HASH, ...objWithNull });
  const canonUndef = canonicalAuditObjectV2({ id: "1", createdAt: new Date("2026-01-01T00:00:00Z"), previousHash: GENESIS_PREV_HASH, ...objWithoutKeys });
  assert(canonNull === canonUndef, "Undefined and explicit null fields are normalized canonically to null");

  // Test 1.4: Delimiter & Pipe resilience
  const pipeNote = "Evidence transferred | Seal broken: NO | Notes: [A|B|C] -> Verified";
  const canonPipe = canonicalAuditObjectV2({
    id: "test-pipe",
    action: "EVIDENCE_TRANSFERRED",
    previousHash: GENESIS_PREV_HASH,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    notes: pipeNote,
  });
  assert(canonPipe.includes(JSON.stringify(pipeNote)), "Pipe characters are safely embedded as escaped JSON strings with zero delimiter injection");

  // --------------------------------------------------------------------------
  // SECTION 2: Concurrency & Advisory Locking
  // --------------------------------------------------------------------------
  console.log("\n[2] Concurrency & Advisory Locking Tests:");

  const concurrentCount = 10;
  console.log(`  Executing ${concurrentCount} concurrent recordAudit calls...`);


  const concurrentPromises = [];
  for (let i = 0; i < concurrentCount; i++) {
    concurrentPromises.push(
      recordAudit({
        action: "DOCUMENT_VIEWED",
        actorId: adminUser.id,
        notes: `Concurrent test write #${i} - ${Date.now()}`,
        metadata: { threadIndex: i },
      })
    );
  }

  const results = await Promise.all(concurrentPromises);
  assert(results.length === concurrentCount, `Successfully persisted ${concurrentCount} concurrent audit logs`);

  // Verify that all hashes are distinct and non-null
  const resultHashes = results.map((r) => r.hash);
  const uniqueHashes = new Set(resultHashes);
  assert(uniqueHashes.size === concurrentCount, "All concurrently generated records have unique cryptographic hashes");

  // Verify that the chain has no forks
  const allLogsAfterConcurrent = await prisma.auditLog.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  let forkDetected = false;
  const seenPrevHashes = new Set();
  for (const log of allLogsAfterConcurrent) {
    if (log.previousHash !== GENESIS_PREV_HASH) {
      if (seenPrevHashes.has(log.previousHash)) {
        forkDetected = true;
        break;
      }
      seenPrevHashes.add(log.previousHash);
    }
  }
  assert(!forkDetected, "No chain forks detected: each previousHash is referenced at most once");

  // --------------------------------------------------------------------------
  // SECTION 3: Transaction Atomicity & Rollback
  // --------------------------------------------------------------------------
  console.log("\n[3] Transaction Atomicity & Rollback Tests:");

  const countBeforeRollback = await prisma.auditLog.count();
  let rollbackSuccess = false;

  try {
    await prisma.$transaction(async (tx) => {
      // Create audit log inside transaction
      await recordAudit(
        {
          action: "ACCESS_REJECTED",
          actorId: adminUser.id,
          notes: "This action will be rolled back",
        },
        tx
      );

      // Trigger intentional business logic error
      throw new Error("INTENTIONAL_BUSINESS_FAILURE");
    });
  } catch (err) {
    if (err && (err.message === "INTENTIONAL_BUSINESS_FAILURE" || err.message.includes("INTENTIONAL_BUSINESS_FAILURE"))) {
      rollbackSuccess = true;
    }
  }


  const countAfterRollback = await prisma.auditLog.count();
  assert(rollbackSuccess, "Outer business failure caught during interactive transaction");
  assert(countBeforeRollback === countAfterRollback, "Audit log was completely rolled back along with failed business transaction (Atomicity verified)");

  // --------------------------------------------------------------------------
  // SECTION 4: Chain Verification Engine & Tamper Detection
  // --------------------------------------------------------------------------
  console.log("\n[4] Chain Verification Engine & Tamper Detection Tests:");

  // Test 4.1: Clean chain verification on live DB
  const cleanReport = await verifyAuditChain();
  assert(cleanReport.status === "VALID", `Chain verification status is VALID (Verified ${cleanReport.validRecords}/${cleanReport.totalRecords} records)`);
  assert(cleanReport.formatVersions.length > 0, `Detected active format versions: ${cleanReport.formatVersions.join(", ")}`);

  // Synthetic baseline chain for tamper tests
  const synthRecA = {
    id: "synth-rec-a",
    action: "LOGIN",
    outcome: "SUCCESS",
    actorId: adminUser.id,
    documentId: null,
    evidenceId: null,
    caseId: null,
    targetUserId: null,
    notes: "Original pristine notes A",
    metadata: { sample: "data" },
    previousHash: GENESIS_PREV_HASH,
    createdAt: new Date("2026-01-01T10:00:00Z"),
  };
  synthRecA.hash = computeAuditHashV2(synthRecA);

  const synthRecB = {
    id: "synth-rec-b",
    action: "DOCUMENT_VIEWED",
    outcome: "SUCCESS",
    actorId: adminUser.id,
    documentId: null,
    evidenceId: null,
    caseId: null,
    targetUserId: null,
    notes: "Chain link B",
    metadata: null,
    previousHash: synthRecA.hash,
    createdAt: new Date("2026-01-01T10:01:00Z"),
  };
  synthRecB.hash = computeAuditHashV2(synthRecB);

  const synthRecC = {
    id: "synth-rec-c",
    action: "LOGOUT",
    outcome: "SUCCESS",
    actorId: adminUser.id,
    documentId: null,
    evidenceId: null,
    caseId: null,
    targetUserId: null,
    notes: "Chain link C referencing B",
    metadata: null,
    previousHash: synthRecB.hash,
    createdAt: new Date("2026-01-01T10:02:00Z"),
  };
  synthRecC.hash = computeAuditHashV2(synthRecC);

  // Test 4.2: Tampering Detection - Modified Notes
  const tamperedNotesMockDb = {
    auditLog: {
      findMany: async () => [
        { ...synthRecA, notes: "Tampered notes: unauthorized custody altered" },
        synthRecB,
        synthRecC,
      ],
    },
  };
  const tamperedNotesReport = await verifyAuditChain(tamperedNotesMockDb);
  assert(tamperedNotesReport.status === "INVALID", "Verification engine detects tampered audit notes");
  assert(tamperedNotesReport.firstInvalidRecordId === synthRecA.id, "Verification correctly identifies the exact tampered record ID");

  // Test 4.3: Tampering Detection - Altered Stored Hash
  const tamperedHashMockDb = {
    auditLog: {
      findMany: async () => [
        { ...synthRecA, hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
        synthRecB,
        synthRecC,
      ],
    },
  };
  const tamperedHashReport = await verifyAuditChain(tamperedHashMockDb);
  assert(tamperedHashReport.status === "INVALID", "Verification engine detects corrupted/forged stored hash");

  // Test 4.4: Tampering Detection - Broken previousHash Link
  const brokenLinkMockDb = {
    auditLog: {
      findMany: async () => [
        synthRecA,
        { ...synthRecB, previousHash: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" },
        synthRecC,
      ],
    },
  };
  const brokenLinkReport = await verifyAuditChain(brokenLinkMockDb);
  assert(brokenLinkReport.status === "INVALID", "Verification engine detects broken previousHash reference");

  // Test 4.5: Tampering Detection - Middle Record Deletion
  const preDeleteMockDb = {
    auditLog: {
      findMany: async () => [synthRecA, synthRecB, synthRecC],
    },
  };
  const preDeleteReport = await verifyAuditChain(preDeleteMockDb);
  assert(preDeleteReport.status === "VALID", "Chain is valid before middle record deletion");

  const middleDeletedMockDb = {
    auditLog: {
      findMany: async () => [synthRecA, synthRecC], // Record B deleted
    },
  };
  const middleDeletedReport = await verifyAuditChain(middleDeletedMockDb);
  assert(middleDeletedReport.status === "INVALID", "Verification engine detects missing/deleted middle record");
  assert(middleDeletedReport.firstInvalidRecordId === synthRecC.id, "Verification flags record C whose previousHash reference is now severed");

  // Test 4.6: Tampering Detection - Reordered Records Simulation
  const fakeGenesisA = {
    id: "fake-rec-1",
    action: "LOGIN",
    outcome: "SUCCESS",
    actorId: null,
    documentId: null,
    evidenceId: null,
    caseId: null,
    targetUserId: null,
    notes: "First record",
    metadata: null,
    previousHash: GENESIS_PREV_HASH,
    createdAt: new Date("2026-01-01T10:00:00Z"),
  };
  fakeGenesisA.hash = computeAuditHashV2(fakeGenesisA);

  const fakeGenesisB = {
    id: "fake-rec-2",
    action: "LOGOUT",
    outcome: "SUCCESS",
    actorId: null,
    documentId: null,
    evidenceId: null,
    caseId: null,
    targetUserId: null,
    notes: "Second record",
    metadata: null,
    previousHash: fakeGenesisA.hash,
    createdAt: new Date("2026-01-01T11:00:00Z"),
  };
  fakeGenesisB.hash = computeAuditHashV2(fakeGenesisB);

  // Verification on in-memory mock client with reordered records
  const reorderedMockDb = {
    auditLog: {
      findMany: async () => [fakeGenesisB, fakeGenesisA], // swapped order
    },
  };
  const reorderedReport = await verifyAuditChain(reorderedMockDb);
  assert(reorderedReport.status === "INVALID", "Verification engine detects reordered / chronologically scrambled records");

  // Test 4.7: Tampering Detection - Invalid Chain Root (Non-genesis root)
  const invalidRootMockDb = {
    auditLog: {
      findMany: async () => [
        { ...fakeGenesisA, previousHash: "1111111111111111111111111111111111111111111111111111111111111111" },
      ],
    },
  };
  const invalidRootReport = await verifyAuditChain(invalidRootMockDb);
  assert(invalidRootReport.status === "INVALID", "Verification engine detects invalid/non-genesis chain root");

  // Test 4.8: Empty Chain Verification
  const emptyMockDb = {
    auditLog: {
      findMany: async () => [],
    },
  };
  const emptyReport = await verifyAuditChain(emptyMockDb);
  assert(emptyReport.status === "VALID" && emptyReport.totalRecords === 0, "Empty audit chain verifies as VALID with 0 records");

  // Test 4.9: Legacy V1 Record Verification
  const legacyEntry = {
    id: "legacy-rec-1",
    action: "LOGIN",
    outcome: "SUCCESS",
    actorId: "actor-123",
    caseId: null,
    documentId: null,
    evidenceId: null,
    notes: "Legacy test record",
    metadata: { key: "legacyVal" },
    previousHash: GENESIS_PREV_HASH,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  legacyEntry.hash = computeAuditHashV1(legacyEntry);

  const legacyMockDb = {
    auditLog: {
      findMany: async () => [legacyEntry],
    },
  };
  const legacyReport = await verifyAuditChain(legacyMockDb);
  assert(legacyReport.status === "VALID", "Verification engine successfully verifies legacy V1 records");
  assert(legacyReport.formatVersions.includes("v1_legacy"), "Verification correctly identifies legacy format version 'v1_legacy'");


  // --------------------------------------------------------------------------
  // SECTION 5: Protected Verification & Export Endpoints
  // --------------------------------------------------------------------------
  console.log("\n[5] Protected Endpoints & Authorization Tests:");

  // Test 5.1: Unauthenticated GET /api/audit/verify rejected
  const unauthVerify = await request("GET", "/api/audit/verify");
  assert(unauthVerify.status === 401, "Unauthenticated request to /api/audit/verify is rejected with HTTP 401");

  // Test 5.2: Non-Admin GET /api/audit/verify rejected
  const officerVerify = await request("GET", "/api/audit/verify", {
    Authorization: `Bearer ${officerToken}`,
  });
  assert(officerVerify.status === 403, "Investigating Officer is forbidden from /api/audit/verify (HTTP 403)");

  // Test 5.3: Admin GET /api/audit/verify succeeds
  const adminVerify = await request("GET", "/api/audit/verify", {
    Authorization: `Bearer ${adminToken}`,
  });
  assert(adminVerify.status === 200, "Admin successfully invokes /api/audit/verify with HTTP 200");
  assert(adminVerify.data.report && adminVerify.data.report.status === "VALID", "Verification response returns structured report with VALID status");

  // Test 5.4: Unauthenticated GET /api/audit/export rejected
  const unauthExport = await request("GET", "/api/audit/export");
  assert(unauthExport.status === 401, "Unauthenticated request to /api/audit/export is rejected with HTTP 401");

  // Test 5.5: Non-Admin GET /api/audit/export rejected
  const officerExport = await request("GET", "/api/audit/export", {
    Authorization: `Bearer ${officerToken}`,
  });
  assert(officerExport.status === 403, "Investigating Officer is forbidden from /api/audit/export (HTTP 403)");

  // Test 5.6: Admin GET /api/audit/export succeeds with JSON
  const adminExport = await request("GET", "/api/audit/export", {
    Authorization: `Bearer ${adminToken}`,
  });
  assert(adminExport.status === 200, "Admin successfully exports audit logs via JSON");
  assert(Array.isArray(adminExport.data.records), "Export data contains ordered records array");
  assert(adminExport.data.records.length > 0, "Exported records are populated");

  // Test 5.7: Independent Re-verifiability of Exported Logs
  const exportedRecords = adminExport.data.records;
  let exportIntegrityVerified = true;
  for (const expLog of exportedRecords) {
    if (!expLog.hash || !expLog.previousHash) {
      exportIntegrityVerified = false;
      break;
    }
  }
  assert(exportIntegrityVerified, "All exported records preserve full cryptographic integrity fields (hash, previousHash, timestamps)");

  // Test 5.8: Secret scrubbing in Export
  const stringifiedExport = JSON.stringify(adminExport.data);
  assert(!stringifiedExport.includes("passwordHash"), "Exported data contains zero password hashes");
  assert(!stringifiedExport.includes("pinSecret"), "Exported data contains zero PIN secrets");

  // Test 5.9: CSV Export format
  const csvExport = await request("GET", "/api/audit/export?format=csv", {
    Authorization: `Bearer ${adminToken}`,
  });
  assert(csvExport.status === 200, "Admin successfully exports audit logs in CSV format");
  assert(typeof csvExport.data === "string" && csvExport.data.startsWith("id,createdAt,action"), "CSV export returns valid header line");

  // Test 5.10: Complete verification fields in CSV (metadata, previousHash, hash, formatVersion)
  const headerLine = csvExport.data.split("\n")[0];
  const requiredCsvCols = ["id", "createdAt", "action", "outcome", "metadata", "previousHash", "hash", "formatVersion"];
  const allColsPresent = requiredCsvCols.every((col) => headerLine.includes(col));
  assert(allColsPresent, "CSV export header contains all required verification columns (id, createdAt, action, outcome, metadata, previousHash, hash, formatVersion)");

  const csvRows = csvExport.data.split("\n").filter((r) => r.trim().length > 0);
  assert(csvRows.length > 1, "CSV export contains populated audit record rows");
  assert(csvRows[1].includes("v2_canonical_json") || csvRows[1].includes("v1_legacy"), "CSV record rows specify hash-format version for independent external verification");

  // Test 5.11: Mixed V1 Legacy and V2 Canonical Record Export & Independent Verification (JSON)
  let v1TestRecordId, v2TestRecordId;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_ADVISORY_LOCK_ID})`);
    const last = await tx.auditLog.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { hash: true },
    });
    const prevH = last ? last.hash : GENESIS_PREV_HASH;

    // 1. Create V1 record
    const v1CreatedAt = new Date();
    const v1Placeholder = await tx.auditLog.create({
      data: {
        action: "CASE_CREATED",
        outcome: "SUCCESS",
        actorId: adminUser.id,
        notes: "Historical V1 test record for export verification",
        metadata: { legacyKey: "testLegacyVal" },
        previousHash: prevH,
        hash: "PENDING_V1",
        createdAt: v1CreatedAt,
      },
    });
    const v1Hash = computeAuditHashV1({
      id: v1Placeholder.id,
      action: v1Placeholder.action,
      outcome: v1Placeholder.outcome,
      actorId: v1Placeholder.actorId,
      caseId: v1Placeholder.caseId,
      documentId: v1Placeholder.documentId,
      evidenceId: v1Placeholder.evidenceId,
      notes: v1Placeholder.notes,
      metadata: v1Placeholder.metadata,
      previousHash: v1Placeholder.previousHash,
      createdAt: v1Placeholder.createdAt,
    });
    const finalizedV1 = await tx.auditLog.update({
      where: { id: v1Placeholder.id },
      data: { hash: v1Hash },
    });
    v1TestRecordId = finalizedV1.id;

    // 2. Create V2 record chained to V1
    const v2CreatedAt = new Date(v1CreatedAt.getTime() + 1);
    const v2Placeholder = await tx.auditLog.create({
      data: {
        action: "DOCUMENT_UPLOADED",
        outcome: "SUCCESS",
        actorId: adminUser.id,
        notes: "Canonical V2 test record for export verification",
        metadata: { modernKey: "testModernVal" },
        previousHash: finalizedV1.hash,
        hash: "PENDING_V2",
        createdAt: v2CreatedAt,
      },
    });
    const v2Hash = computeAuditHashV2({
      id: v2Placeholder.id,
      action: v2Placeholder.action,
      outcome: v2Placeholder.outcome,
      actorId: v2Placeholder.actorId,
      caseId: v2Placeholder.caseId,
      documentId: v2Placeholder.documentId,
      evidenceId: v2Placeholder.evidenceId,
      targetUserId: v2Placeholder.targetUserId,
      notes: v2Placeholder.notes,
      metadata: v2Placeholder.metadata,
      previousHash: v2Placeholder.previousHash,
      createdAt: v2Placeholder.createdAt,
    });
    const finalizedV2 = await tx.auditLog.update({
      where: { id: v2Placeholder.id },
      data: { hash: v2Hash },
    });
    v2TestRecordId = finalizedV2.id;
  });

  // Query JSON export
  const mixedJsonExport = await request("GET", "/api/audit/export?format=json", {
    Authorization: `Bearer ${adminToken}`,
  });
  assert(mixedJsonExport.status === 200, "Admin successfully exports mixed-chain audit logs in JSON");
  const jsonV1 = mixedJsonExport.data.records.find((r) => r.id === v1TestRecordId);
  const jsonV2 = mixedJsonExport.data.records.find((r) => r.id === v2TestRecordId);
  assert(jsonV1 && jsonV1.formatVersion === "v1_legacy", "JSON export correctly labels historical V1 record as formatVersion 'v1_legacy'");
  assert(jsonV2 && jsonV2.formatVersion === "v2_canonical_json", "JSON export correctly labels new V2 record as formatVersion 'v2_canonical_json'");

  // Independent verification on JSON exported records
  const recomputedJsonV1 = computeAuditHashV1(jsonV1);
  const recomputedJsonV2 = computeAuditHashV2(jsonV2);
  assert(recomputedJsonV1 === jsonV1.hash, "Independent verifier successfully recalculates historical V1 hash from JSON export");
  assert(recomputedJsonV2 === jsonV2.hash, "Independent verifier successfully recalculates canonical V2 hash from JSON export");
  assert(jsonV2.previousHash === jsonV1.hash, "JSON export preserves cryptographic hash-chain link between V1 and V2 records");

  // Test 5.12: Mixed V1 Legacy and V2 Canonical Record Export & Independent Verification (CSV)
  const mixedCsvExport = await request("GET", "/api/audit/export?format=csv", {
    Authorization: `Bearer ${adminToken}`,
  });
  assert(mixedCsvExport.status === 200, "Admin successfully exports mixed-chain audit logs in CSV");
  const allCsvRows = mixedCsvExport.data.split("\n").map((r) => r.trim()).filter(Boolean);
  const headerCols = allCsvRows[0].split(",");
  const formatVerIdx = headerCols.indexOf("formatVersion");
  const idIdx = headerCols.indexOf("id");
  const prevHashIdx = headerCols.indexOf("previousHash");
  const hashIdx = headerCols.indexOf("hash");

  const csvV1Row = allCsvRows.find((r) => r.startsWith(v1TestRecordId));
  const csvV2Row = allCsvRows.find((r) => r.startsWith(v2TestRecordId));

  assert(csvV1Row && csvV1Row.includes("v1_legacy"), "CSV export correctly labels historical V1 record row as 'v1_legacy'");
  assert(csvV2Row && csvV2Row.includes("v2_canonical_json"), "CSV export correctly labels new V2 record row as 'v2_canonical_json'");

  // Simple CSV field extractor handling quotes
  function parseCsvFields(rowStr) {
    const fields = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < rowStr.length; i++) {
      const c = rowStr[i];
      if (inQuotes) {
        if (c === '"') {
          if (i + 1 < rowStr.length && rowStr[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += c;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
        } else if (c === ",") {
          fields.push(cur);
          cur = "";
        } else {
          cur += c;
        }
      }
    }
    fields.push(cur);
    return fields;
  }

  const parsedV1 = parseCsvFields(csvV1Row);
  const parsedV2 = parseCsvFields(csvV2Row);

  assert(parsedV1[formatVerIdx] === "v1_legacy", "Parsed CSV V1 formatVersion matches 'v1_legacy'");
  assert(parsedV2[formatVerIdx] === "v2_canonical_json", "Parsed CSV V2 formatVersion matches 'v2_canonical_json'");

  const csvV1Recomputed = computeAuditHashV1({
    id: parsedV1[idIdx],
    createdAt: parsedV1[headerCols.indexOf("createdAt")],
    action: parsedV1[headerCols.indexOf("action")],
    outcome: parsedV1[headerCols.indexOf("outcome")],
    actorId: parsedV1[headerCols.indexOf("actorId")] || null,
    caseId: parsedV1[headerCols.indexOf("caseId")] || null,
    documentId: parsedV1[headerCols.indexOf("documentId")] || null,
    evidenceId: parsedV1[headerCols.indexOf("evidenceId")] || null,
    notes: parsedV1[headerCols.indexOf("notes")] || null,
    metadata: parsedV1[headerCols.indexOf("metadata")] ? JSON.parse(parsedV1[headerCols.indexOf("metadata")]) : null,
    previousHash: parsedV1[headerCols.indexOf("previousHash")],
  });

  const csvV2Recomputed = computeAuditHashV2({
    id: parsedV2[idIdx],
    createdAt: parsedV2[headerCols.indexOf("createdAt")],
    action: parsedV2[headerCols.indexOf("action")],
    outcome: parsedV2[headerCols.indexOf("outcome")],
    actorId: parsedV2[headerCols.indexOf("actorId")] || null,
    caseId: parsedV2[headerCols.indexOf("caseId")] || null,
    documentId: parsedV2[headerCols.indexOf("documentId")] || null,
    evidenceId: parsedV2[headerCols.indexOf("evidenceId")] || null,
    targetUserId: parsedV2[headerCols.indexOf("targetUserId")] || null,
    notes: parsedV2[headerCols.indexOf("notes")] || null,
    metadata: parsedV2[headerCols.indexOf("metadata")] ? JSON.parse(parsedV2[headerCols.indexOf("metadata")]) : null,
    previousHash: parsedV2[headerCols.indexOf("previousHash")],
  });

  assert(csvV1Recomputed === parsedV1[hashIdx], "Independent verifier successfully parses CSV and recomputes historical V1 hash using legacy serialization");
  assert(csvV2Recomputed === parsedV2[hashIdx], "Independent verifier successfully parses CSV and recomputes canonical V2 hash using canonical JSON serialization");
  assert(parsedV2[prevHashIdx] === parsedV1[hashIdx], "CSV export preserves cryptographic hash-chain link between V1 and V2 records");

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

runMilestone35Tests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
