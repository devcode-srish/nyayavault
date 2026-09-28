const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

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

async function runHttpTests() {
  console.log('=== NYAYAVAULT HTTP API END-TO-END SUITE FOR MILESTONE 3.2 ===\n');

  try {
    const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    const advocateUser = await prisma.user.findFirst({ where: { role: 'LEGAL_OFFICER' } });
    const supervisorUser = await prisma.user.findFirst({ where: { role: 'SENIOR_OFFICER' } });

    const adminToken = createToken(adminUser);
    const advocateToken = createToken(advocateUser);

    // 1. Create a test case and confidential document
    const testCase = await prisma.case.create({
      data: {
        caseNumber: `HTTP-TEST-${Date.now()}`,
        title: 'HTTP Access Control Test Case',
        description: 'Case for testing API granular access control',
        status: 'OPEN',
      }
    });

    const testDoc = await prisma.document.create({
      data: {
        name: 'RESTRICTED_EVIDENCE.pdf',
        type: 'OTHER',
        classification: 'CONFIDENTIAL',
        caseId: testCase.id,
        uploadedById: adminUser.id,
      }
    });

    console.log(`Setup test case: ${testCase.caseNumber}, document: ${testDoc.id}`);

    // HTTP TEST 1: Unauthorized access check to document metadata
    console.log('\n--- HTTP TEST 1: Unauthorized access without grant ---');
    const docRes1 = await fetch(`${API_URL}/documents/${testDoc.id}`, {
      headers: { Authorization: `Bearer ${advocateToken}` }
    });
    console.log(`Status returned for unauthorized document access: ${docRes1.status}`);
    if (docRes1.status !== 403) {
      throw new Error(`Expected status 403 for unauthorized access, got ${docRes1.status}`);
    }
    console.log('[PASS] Unauthorized access blocked with HTTP 403');

    // HTTP TEST 2: Submit Access Request via POST /api/access-requests
    console.log('\n--- HTTP TEST 2: Submit Access Request via HTTP API ---');
    const reqRes = await fetch(`${API_URL}/access-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${advocateToken}`
      },
      body: JSON.stringify({
        documentId: testDoc.id,
        reason: 'Preparing defense affidavit',
        requestedScopes: ['VIEW_METADATA', 'PREVIEW'],
        durationHours: 12,
        courtOrderRef: 'DELHI-HC-ORDER-441'
      })
    });
    const reqJson = await reqRes.json();
    console.log(`Access Request creation response:`, reqJson);
    if (!reqJson.request || !reqJson.request.id) {
      throw new Error('Failed to create access request via HTTP API');
    }
    const accessRequestId = reqJson.request.id;
    console.log('[PASS] Access Request created with ID:', accessRequestId);

    // HTTP TEST 3: Approve Access Request via POST /api/access-requests/:id/approve
    console.log('\n--- HTTP TEST 3: Approve Access Request via HTTP API ---');
    const approveRes = await fetch(`${API_URL}/access-requests/${accessRequestId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        decisionNotes: 'Approved under high court directive'
      })
    });
    const approveJson = await approveRes.json();
    console.log(`Approval response:`, approveJson);
    if (!approveJson.ok || !approveJson.grantId) {
      throw new Error('Failed to approve access request via HTTP API');
    }
    const grantId = approveJson.grantId;
    console.log('[PASS] Access Request approved; Grant ID:', grantId);

    // HTTP TEST 4: Authorized access check with newly granted VIEW_METADATA scope
    console.log('\n--- HTTP TEST 4: Authorized metadata access after grant ---');
    const docRes2 = await fetch(`${API_URL}/documents/${testDoc.id}`, {
      headers: { Authorization: `Bearer ${advocateToken}` }
    });
    console.log(`Status returned for authorized document access: ${docRes2.status}`);
    if (docRes2.status !== 200) {
      throw new Error(`Expected status 200 for authorized access, got ${docRes2.status}`);
    }
    console.log('[PASS] Authorized metadata access succeeded with HTTP 200');

    // HTTP TEST 5: Download attempt without DOWNLOAD scope
    console.log('\n--- HTTP TEST 5: Download attempt without DOWNLOAD scope ---');
    const downloadRes = await fetch(`${API_URL}/documents/${testDoc.id}/download`, {
      headers: { Authorization: `Bearer ${advocateToken}` }
    });
    console.log(`Status returned for ungranted download: ${downloadRes.status}`);
    if (downloadRes.status !== 403) {
      throw new Error(`Expected status 403 for download without DOWNLOAD scope, got ${downloadRes.status}`);
    }
    console.log('[PASS] Download blocked with HTTP 403 due to missing DOWNLOAD scope');

    // HTTP TEST 6: Revoke Access Grant via POST /api/access-requests/grants/:id/revoke
    console.log('\n--- HTTP TEST 6: Revoke Access Grant via HTTP API ---');
    const revokeRes = await fetch(`${API_URL}/access-requests/grants/${grantId}/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        reason: 'Revoked by judicial review'
      })
    });
    const revokeJson = await revokeRes.json();
    console.log(`Revoke response:`, revokeJson);
    if (!revokeJson.ok) {
      throw new Error('Failed to revoke access grant via HTTP API');
    }
    console.log('[PASS] Access Grant revoked successfully');

    // HTTP TEST 7: Immediate denial after revocation
    console.log('\n--- HTTP TEST 7: Immediate denial following revocation ---');
    const docRes3 = await fetch(`${API_URL}/documents/${testDoc.id}`, {
      headers: { Authorization: `Bearer ${advocateToken}` }
    });
    console.log(`Status returned after revocation: ${docRes3.status}`);
    if (docRes3.status !== 403) {
      throw new Error(`Expected status 403 after revocation, got ${docRes3.status}`);
    }
    console.log('[PASS] Access immediately revoked and returned HTTP 403');

    // Cleanup
    console.log('\n--- Cleaning up HTTP test records ---');
    await prisma.documentAccess.deleteMany({ where: { documentId: testDoc.id } });
    await prisma.accessRequest.deleteMany({ where: { documentId: testDoc.id } });
    await prisma.document.delete({ where: { id: testDoc.id } });
    await prisma.case.delete({ where: { id: testCase.id } });

    console.log('\n======================================================');
    console.log('ALL HTTP INTEGRATION TESTS PASSED FOR MILESTONE 3.2!');
    console.log('======================================================\n');
  } catch (err) {
    console.error('HTTP Test Suite Failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runHttpTests();
