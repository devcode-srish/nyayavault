const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const API_URL = 'http://localhost:4000/api';
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'nyayavault-access-secret-dev-key-change-in-prod';

function createToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    ACCESS_SECRET,
    { expiresIn: '1h' }
  );
}

async function runMilestone34Tests() {
  console.log('=== NYAYAVAULT MILESTONE 3.4: SECURE SHARE TOKEN MIGRATION SUITE ===\n');
  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  try {
    console.log('--- 1. Setting up test documents and actors ---');
    const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    const seniorUser = await prisma.user.findFirst({ where: { role: 'SENIOR_OFFICER' } });
    const ioUser = await prisma.user.findFirst({ where: { role: 'INVESTIGATING_OFFICER' } });

    assert(adminUser && seniorUser && ioUser, 'Test actors present in database');

    const adminToken = createToken(adminUser);
    const seniorToken = createToken(seniorUser);

    const testCase = await prisma.case.create({
      data: {
        caseNumber: `SHARE-TEST-${Date.now()}`,
        title: 'Share Security Test Case',
        description: 'Case for testing Milestone 3.4 token hashing and PIN security',
        status: 'OPEN',
        members: {
          create: [{ userId: seniorUser.id, roleInCase: 'SUPERVISOR' }],
        },
      },
    });

    // Create physical dummy storage file in storage directories
    const storageDir1 = path.resolve(process.cwd(), './storage');
    const storageDir2 = path.resolve(__dirname, '../../storage');
    [storageDir1, storageDir2].forEach((dir) => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
    const sampleStorageKey = `test-file-${Date.now()}.pdf`;
    const sampleContent = 'NyayaVault Secure Evidence Document for Court Submission';
    fs.writeFileSync(path.join(storageDir1, sampleStorageKey), sampleContent);
    fs.writeFileSync(path.join(storageDir2, sampleStorageKey), sampleContent);
    const sampleSha256 = crypto.createHash('sha256').update(sampleContent).digest('hex');

    const testDoc = await prisma.document.create({
      data: {
        name: 'FORENSIC_EXPERT_REPORT.pdf',
        type: 'OTHER',
        classification: 'INTERNAL',
        caseId: testCase.id,
        uploadedById: seniorUser.id,
        latestVersionNo: 1,
        versions: {
          create: {
            versionNo: 1,
            originalName: 'FORENSIC_EXPERT_REPORT.pdf',
            storageKey: sampleStorageKey,
            sizeBytes: Buffer.byteLength(sampleContent),
            mimeType: 'application/pdf',
            sha256: sampleSha256,
            createdById: seniorUser.id,
          },
        },
      },
    });

    console.log(`Created test document: ${testDoc.name} (${testDoc.id})`);

    // TEST 1: Creation of Hashed-Only Share Link
    console.log('\n--- TEST 1: Create hashed-only share link ---');
    const createRes = await fetch(`${API_URL}/documents/${testDoc.id}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seniorToken}` },
      body: JSON.stringify({ expiresInHours: 24, maxUses: 3 }),
    });
    const createJson = await createRes.json();
    assert(createRes.status === 201 && createJson.share.token, 'Share link created with raw token returned in response');
    const rawToken1 = createJson.share.token;
    const shareId1 = createJson.share.id;

    // Verify DB storage: plaintext token is null, tokenHash is populated
    const dbLink1 = await prisma.shareLink.findUnique({ where: { id: shareId1 } });
    assert(dbLink1.token === null, 'Plaintext token is NOT stored in the database (token is null)');
    assert(dbLink1.tokenHash !== null && dbLink1.tokenHash.length === 64, 'SHA-256 tokenHash is stored in the database');
    assert(
      dbLink1.tokenHash === crypto.createHash('sha256').update(rawToken1).digest('hex'),
      'Stored tokenHash matches SHA-256 digest of rawToken'
    );

    // TEST 2: Valid Access & Download using Hashed Token Lookup
    console.log('\n--- TEST 2: Access & download via raw token (hashed lookup) ---');
    const metaRes1 = await fetch(`${API_URL}/share/${rawToken1}`);
    const metaJson1 = await metaRes1.json();
    assert(metaRes1.status === 200 && metaJson1.share.name === testDoc.name, 'Metadata retrieved successfully via hashed lookup');

    const dlRes1 = await fetch(`${API_URL}/share/${rawToken1}/download`);
    const dlText1 = await dlRes1.text();
    assert(dlRes1.status === 200 && dlText1 === sampleContent, 'Shared file downloaded successfully');

    // TEST 3: Invalid Token Rejection
    console.log('\n--- TEST 3: Invalid/tampered token rejection ---');
    const invalidToken = '0000000000000000000000000000000000000000000000000000000000000000';
    const invalidRes = await fetch(`${API_URL}/share/${invalidToken}`);
    assert(invalidRes.status === 404, 'Invalid token rejected with HTTP 404');

    // TEST 4: PIN-Protected Share Link & Query-Param Removal
    console.log('\n--- TEST 4: PIN-protected share link & header-only enforcement ---');
    const pinSecret = '749215';
    const createPinRes = await fetch(`${API_URL}/documents/${testDoc.id}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seniorToken}` },
      body: JSON.stringify({ expiresInHours: 12, maxUses: 5, pin: pinSecret }),
    });
    const createPinJson = await createPinRes.json();
    assert(createPinRes.status === 201 && createPinJson.share.hasPin === true, 'PIN-protected share link created');
    const rawPinToken = createPinJson.share.token;
    const sharePinId = createPinJson.share.id;

    // Verify DB storage: pinHash exists, no plaintext PIN in DB
    const dbPinLink = await prisma.shareLink.findUnique({ where: { id: sharePinId } });
    assert(dbPinLink.pinHash !== null && dbPinLink.pinHash.startsWith('$argon2'), 'PIN stored as Argon2 hash');

    // 4a. Access without PIN should require PIN
    const pinReqRes = await fetch(`${API_URL}/share/${rawPinToken}`);
    const pinReqJson = await pinReqRes.json();
    assert(pinReqRes.status === 401 && pinReqJson.requiresPin === true, 'Access without PIN rejected with HTTP 401 (requiresPin: true)');

    // 4b. Security check: query-param PIN (?pin=...) MUST BE REJECTED
    const queryPinRes = await fetch(`${API_URL}/share/${rawPinToken}?pin=${pinSecret}`);
    assert(queryPinRes.status === 401, 'Query-parameter PIN (?pin=...) is rejected with HTTP 401 (header-only requirement enforced)');

    // 4c. Access with incorrect PIN in header
    const wrongPinRes = await fetch(`${API_URL}/share/${rawPinToken}`, {
      headers: { 'x-share-pin': '111111' },
    });
    assert(wrongPinRes.status === 401, 'Access with incorrect PIN rejected with HTTP 401');

    // 4d. Access with correct PIN in header
    const correctPinRes = await fetch(`${API_URL}/share/${rawPinToken}`, {
      headers: { 'x-share-pin': pinSecret },
    });
    assert(correctPinRes.status === 200, 'Access with correct PIN in x-share-pin header succeeds with HTTP 200');

    // 4e. Download with correct PIN in header
    const dlPinRes = await fetch(`${API_URL}/share/${rawPinToken}/download`, {
      headers: { 'x-share-pin': pinSecret },
    });
    const dlPinText = await dlPinRes.text();
    assert(dlPinRes.status === 200 && dlPinText === sampleContent, 'Download with valid x-share-pin header succeeds');

    // TEST 5: Download Usage Accounting for Failed Downloads
    console.log('\n--- TEST 5: Usage accounting policy on failed downloads ---');
    const failTestRes = await fetch(`${API_URL}/documents/${testDoc.id}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seniorToken}` },
      body: JSON.stringify({ expiresInHours: 24, maxUses: 3 }),
    });
    const failTestJson = await failTestRes.json();
    const failRawToken = failTestJson.share.token;
    const failShareId = failTestJson.share.id;

    // Intentionally attempt download with wrong PIN to trigger failure
    const pinFailRes = await fetch(`${API_URL}/share/${rawPinToken}/download`, {
      headers: { 'x-share-pin': '999999' },
    });
    assert(pinFailRes.status === 401, 'Download attempt with bad PIN fails (HTTP 401)');

    const checkPinUsage = await prisma.shareLink.findUnique({ where: { id: sharePinId } });
    assert(checkPinUsage.useCount === 1, 'Failed download attempt does NOT increment useCount');

    // TEST 6: Expired Share Links
    console.log('\n--- TEST 6: Expired share link handling ---');
    const expiredRawToken = crypto.randomBytes(32).toString('hex');
    const expiredTokenHash = crypto.createHash('sha256').update(expiredRawToken).digest('hex');
    await prisma.shareLink.create({
      data: {
        documentId: testDoc.id,
        token: null,
        tokenHash: expiredTokenHash,
        createdById: seniorUser.id,
        expiresAt: new Date(Date.now() - 3600 * 1000), // 1 hr in past
        maxUses: 5,
        useCount: 0,
      },
    });

    const expRes = await fetch(`${API_URL}/share/${expiredRawToken}`);
    assert(expRes.status === 410, 'Expired link rejected with HTTP 410');

    // TEST 7: Revoked Share Links
    console.log('\n--- TEST 7: Revocation workflow & enforcement ---');
    const revokeRes = await fetch(`${API_URL}/documents/${testDoc.id}/shares/${shareId1}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${seniorToken}` },
    });
    assert(revokeRes.status === 200, 'Share link revoked by supervisor');

    const revAccessRes = await fetch(`${API_URL}/share/${rawToken1}`);
    assert(revAccessRes.status === 410, 'Accessing revoked link returns HTTP 410');

    // Duplicate revoke guard
    const dupRevokeRes = await fetch(`${API_URL}/documents/${testDoc.id}/shares/${shareId1}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${seniorToken}` },
    });
    assert(dupRevokeRes.status === 409, 'Duplicate revoke attempt rejected with HTTP 409 Conflict');

    // TEST 8: Concurrency & Max Usage Limits
    console.log('\n--- TEST 8: Concurrency & maximum usage limit enforcement ---');
    const limitCreateRes = await fetch(`${API_URL}/documents/${testDoc.id}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seniorToken}` },
      body: JSON.stringify({ expiresInHours: 24, maxUses: 2 }),
    });
    const limitJson = await limitCreateRes.json();
    const limitRawToken = limitJson.share.token;

    // Fire 6 concurrent download requests
    const concurrentDownloads = await Promise.all(
      [1, 2, 3, 4, 5, 6].map(() => fetch(`${API_URL}/share/${limitRawToken}/download`))
    );

    const successfulDownloads = concurrentDownloads.filter((r) => r.status === 200).length;
    const rejectedDownloads = concurrentDownloads.filter((r) => r.status === 410).length;

    assert(successfulDownloads === 2, `Exactly maxUses (2) downloads succeeded under high concurrency (got: ${successfulDownloads})`);
    assert(rejectedDownloads === 4, `All excess (4) concurrent downloads rejected with HTTP 410 (got: ${rejectedDownloads})`);

    // TEST 9: Token & PIN Leakage Prevention in Audit and Listing APIs
    console.log('\n--- TEST 9: Token and PIN leakage prevention ---');
    const sharesListRes = await fetch(`${API_URL}/documents/${testDoc.id}/shares`, {
      headers: { Authorization: `Bearer ${seniorToken}` },
    });
    const sharesListJson = await sharesListRes.json();
    const hashedItem = sharesListJson.shares.find((s) => s.id === sharePinId);
    assert(hashedItem && hashedItem.path === undefined, 'Raw path/token is NOT exposed in shares listing for hashed-only links');
    assert(hashedItem && hashedItem.hasPin === true, 'hasPin flag is exposed without leaking PIN hash or value');

    // Audit logs inspection
    const auditLogs = await prisma.auditLog.findMany({
      where: { documentId: testDoc.id },
    });
    const leakedTokens = auditLogs.some((l) => (l.notes && l.notes.includes(rawPinToken)) || (l.notes && l.notes.includes(pinSecret)));
    assert(!leakedTokens, 'Audit logs contain zero raw tokens or PIN values');

    // TEST 10: Backward-Compatibility with Legacy Plaintext Tokens
    console.log('\n--- TEST 10: Legacy share-link compatibility ---');
    const legacyRawToken = `legacy-token-${Date.now()}`;
    const legacyTokenHash = crypto.createHash('sha256').update(legacyRawToken).digest('hex');
    await prisma.shareLink.create({
      data: {
        documentId: testDoc.id,
        token: legacyRawToken,
        tokenHash: legacyTokenHash,
        createdById: seniorUser.id,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        maxUses: 5,
        useCount: 0,
      },
    });

    const legacyRes = await fetch(`${API_URL}/share/${legacyRawToken}`);
    assert(legacyRes.status === 200, 'Legacy share link successfully resolved via tokenHash');

    // Cleanup
    console.log('\n--- Cleaning up test records ---');
    await prisma.shareLink.deleteMany({ where: { documentId: testDoc.id } });
    await prisma.documentVersion.deleteMany({ where: { documentId: testDoc.id } });
    await prisma.document.delete({ where: { id: testDoc.id } });
    await prisma.caseMember.deleteMany({ where: { caseId: testCase.id } });
    await prisma.case.delete({ where: { id: testCase.id } });
    [storageDir1, storageDir2].forEach((dir) => {
      const p = path.join(dir, sampleStorageKey);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });

    console.log('\n======================================================');
    console.log(`ALL MILESTONE 3.4 TESTS PASSED! (${passed}/${total})`);
    console.log('======================================================\n');
  } catch (err) {
    console.error('Milestone 3.4 Suite Failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMilestone34Tests();
