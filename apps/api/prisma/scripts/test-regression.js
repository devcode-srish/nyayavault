const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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

async function runRegressionSuite() {
  console.log('=== NYAYAVAULT COMPLETE REGRESSION & VERIFICATION SUITE ===\n');
  let passed = 0;
  let total = 0;

  function check(cond, msg) {
    total++;
    if (cond) {
      console.log(`[PASS] ${msg}`);
      passed++;
    } else {
      console.error(`[FAIL] ${msg}`);
      throw new Error(`Assertion failed: ${msg}`);
    }
  }

  try {
    // Phase 1 verification
    console.log('--- Phase 1: Auth, Roles & Case Boundaries ---');
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    const senior = await prisma.user.findFirst({ where: { role: 'SENIOR_OFFICER' } });
    const io = await prisma.user.findFirst({ where: { role: 'INVESTIGATING_OFFICER' } });
    const legal = await prisma.user.findFirst({ where: { role: 'LEGAL_OFFICER' } });

    check(admin && senior && io && legal, 'All key roles present in database');

    const adminToken = createToken(admin);
    const ioToken = createToken(io);
    const legalToken = createToken(legal);
    const seniorToken = createToken(senior);

    // Create a private case with membership restricted to `senior` and `io`
    const p1Case = await prisma.case.create({
      data: {
        caseNumber: `REG-CASE-${Date.now()}`,
        title: 'Regression Verification Case',
        description: 'Testing RBAC and Phase 1-3.2 compatibility',
        status: 'OPEN',
        members: {
          create: [
            { userId: senior.id, roleInCase: 'SUPERVISOR' },
            { userId: io.id, roleInCase: 'LEAD_INVESTIGATOR' },
          ]
        }
      }
    });
    check(p1Case.id, 'Created isolated test case with explicit memberships');

    // Legal officer (not a member, non-admin) should receive 403 on case
    const caseResLegal = await fetch(`${API_URL}/cases/${p1Case.id}`, {
      headers: { Authorization: `Bearer ${legalToken}` }
    });
    check(caseResLegal.status === 403, 'Non-member LEGAL_OFFICER blocked from case (HTTP 403)');

    // Senior officer (member) should receive 200
    const caseResSenior = await fetch(`${API_URL}/cases/${p1Case.id}`, {
      headers: { Authorization: `Bearer ${seniorToken}` }
    });
    check(caseResSenior.status === 200, 'Assigned SUPERVISOR allowed access to case (HTTP 200)');

    // Phase 2 verification
    console.log('\n--- Phase 2: Document Management, Integrity & Share Links ---');
    const p2Doc = await prisma.document.create({
      data: {
        name: 'CRIME_SCENE_FORENSICS.pdf',
        type: 'OTHER',
        classification: 'CONFIDENTIAL',
        caseId: p1Case.id,
        uploadedById: io.id,
        latestVersionNo: 1,
        versions: {
          create: {
            versionNo: 1,
            originalName: 'CRIME_SCENE_FORENSICS.pdf',
            storageKey: 'mock-storage-key.pdf',
            sizeBytes: 2048,
            mimeType: 'application/pdf',
            sha256: crypto.createHash('sha256').update('sample evidence content').digest('hex'),
            createdById: io.id,
          }
        }
      }
    });
    check(p2Doc.id, 'Document with version created successfully');

    // Verify share link creation on CONFIDENTIAL doc by SENIOR_OFFICER
    const shareRes = await fetch(`${API_URL}/documents/${p2Doc.id}/share`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${seniorToken}`
      },
      body: JSON.stringify({ expiresInHours: 12, maxUses: 2 })
    });
    const shareJson = await shareRes.json();
    check(shareRes.status === 201 && shareJson.share.token, 'Supervisor can generate share link for confidential doc');

    // Phase 3.2 verification: Granular Scopes, Multiple Grants, Concurrent Approval & Revocation
    console.log('\n--- Phase 3.2: Granular Access Control & Concurrent Safety ---');
    
    // 1. Submit access request for legal officer
    const arRes = await fetch(`${API_URL}/access-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${legalToken}`
      },
      body: JSON.stringify({
        documentId: p2Doc.id,
        reason: 'Preparing bail objection application',
        requestedScopes: ['VIEW_METADATA', 'PREVIEW'],
        durationHours: 6,
        courtOrderRef: 'BAIL/2026/DELHI/51'
      })
    });
    const arJson = await arRes.json();
    const arId = arJson.request.id;
    check(arId && arJson.request.status === 'PENDING', 'Granular access request created');

    // 2. Test concurrent approval safety: two supervisors try to approve the exact same pending request simultaneously
    const [app1, app2] = await Promise.all([
      fetch(`${API_URL}/access-requests/${arId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seniorToken}` },
        body: JSON.stringify({ decisionNotes: 'Supervisor A approval' })
      }),
      fetch(`${API_URL}/access-requests/${arId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ decisionNotes: 'Admin approval' })
      })
    ]);

    const statuses = [app1.status, app2.status].sort();
    check(statuses[0] === 200 && statuses[1] === 409, 'Concurrent approval race condition handled cleanly (1 winner 200, 1 conflict 409)');

    // 3. Verify Active Grants API endpoint boundaries
    const activeGrantsLegal = await fetch(`${API_URL}/access-requests/grants/active`, {
      headers: { Authorization: `Bearer ${legalToken}` }
    });
    const activeGrantsLegalJson = await activeGrantsLegal.json();
    check(activeGrantsLegalJson.grants.length === 1 && activeGrantsLegalJson.grants[0].documentId === p2Doc.id, 'Active grants endpoint returns user grants properly');

    const grantId = activeGrantsLegalJson.grants[0].id;

    // 4. Verify scope enforcement
    const docMetaRes = await fetch(`${API_URL}/documents/${p2Doc.id}`, {
      headers: { Authorization: `Bearer ${legalToken}` }
    });
    check(docMetaRes.status === 200, 'Granted VIEW_METADATA allows metadata inspection');

    const docDlRes = await fetch(`${API_URL}/documents/${p2Doc.id}/download`, {
      headers: { Authorization: `Bearer ${legalToken}` }
    });
    check(docDlRes.status === 403, 'Missing DOWNLOAD scope blocks file download (HTTP 403)');

    // 5. Test Revocation
    const revRes = await fetch(`${API_URL}/access-requests/grants/${grantId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seniorToken}` },
      body: JSON.stringify({ reason: 'Investigation stage closed' })
    });
    check(revRes.status === 200, 'Grant revoked by Supervisor');

    // 6. Test Double-Revoke Conflict Guard
    const revRes2 = await fetch(`${API_URL}/access-requests/grants/${grantId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seniorToken}` },
      body: JSON.stringify({ reason: 'Duplicate revoke attempt' })
    });
    check(revRes2.status === 409, 'Double-revocation guarded with HTTP 409 conflict');

    // Cleanup
    console.log('\n--- Cleaning up regression test fixtures ---');
    await prisma.shareLink.deleteMany({ where: { documentId: p2Doc.id } });
    await prisma.documentAccess.deleteMany({ where: { documentId: p2Doc.id } });
    await prisma.accessRequest.deleteMany({ where: { documentId: p2Doc.id } });
    await prisma.documentVersion.deleteMany({ where: { documentId: p2Doc.id } });
    await prisma.document.delete({ where: { id: p2Doc.id } });
    await prisma.caseMember.deleteMany({ where: { caseId: p1Case.id } });
    await prisma.case.delete({ where: { id: p1Case.id } });

    console.log('\n======================================================');
    console.log(`ALL REGRESSION TESTS PASSED! (${passed}/${total})`);
    console.log('======================================================\n');
  } catch (err) {
    console.error('Regression suite failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runRegressionSuite();
