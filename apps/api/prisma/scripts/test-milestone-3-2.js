const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function runTests() {
  console.log('=== NYAYAVAULT MILESTONE 3.2 VERIFICATION SUITE ===\n');
  let testPassCount = 0;
  let testTotalCount = 0;

  function assert(condition, message) {
    testTotalCount++;
    if (condition) {
      console.log(`[PASS] ${message}`);
      testPassCount++;
    } else {
      console.error(`[FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  try {
    // 1. Setup test fixture data
    console.log('--- Setting up test users & records ---');
    const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    const advocateUser = await prisma.user.findFirst({ where: { role: 'LEGAL_OFFICER' } });
    const investigatorUser = await prisma.user.findFirst({ where: { role: 'INVESTIGATING_OFFICER' } });
    const supervisorUser = await prisma.user.findFirst({ where: { role: 'SENIOR_OFFICER' } });

    assert(adminUser && advocateUser && investigatorUser, 'Required test users exist in database');

    // Create a temporary case & restricted document
    const testCase = await prisma.case.create({
      data: {
        caseNumber: `TEST-CASE-${Date.now()}`,
        title: 'Milestone 3.2 Access Control Test Case',
        description: 'Case for testing granular access control',
        status: 'OPEN',
      }
    });

    const testDoc = await prisma.document.create({
      data: {
        name: 'Confidential Evidence Document',
        type: 'OTHER',
        classification: 'CONFIDENTIAL',
        caseId: testCase.id,
        uploadedById: adminUser.id,
      }
    });

    console.log(`Created test case: ${testCase.caseNumber} and doc: ${testDoc.id}`);

    // TEST 1: Unauthorized user has no access grants
    console.log('\n--- TEST 1: Baseline / Unauthorized check ---');
    const initialGrant = await prisma.documentAccess.findFirst({
      where: {
        documentId: testDoc.id,
        userId: advocateUser.id,
        isActive: true,
      }
    });
    assert(initialGrant === null, 'Advocate has no active grant initially');

    // TEST 2: Create Granular Access Request with scopes and court order
    console.log('\n--- TEST 2: Create Access Request with Granular Scopes ---');
    const requestedScopes = ['VIEW_METADATA', 'PREVIEW'];
    const accessReq = await prisma.accessRequest.create({
      data: {
        documentId: testDoc.id,
        requestedById: advocateUser.id,
        reason: 'Authorized defence review for upcoming hearing',
        requestedScopes: requestedScopes,
        durationHours: 24,
        courtOrderRef: 'ORDER/2026/HC/981',
        status: 'PENDING'
      }
    });

    assert(accessReq.id && accessReq.status === 'PENDING', 'Access request created in PENDING status');
    assert(JSON.stringify(accessReq.requestedScopes) === JSON.stringify(requestedScopes), 'Requested scopes properly stored in access request');
    assert(accessReq.courtOrderRef === 'ORDER/2026/HC/981', 'Court order reference properly stored');
    assert(accessReq.durationHours === 24, 'Duration hours properly stored');

    // TEST 3: Approve Access Request Transactionally
    console.log('\n--- TEST 3: Approve Access Request & Generate DocumentAccess ---');
    const expiresAt = new Date(Date.now() + (accessReq.durationHours || 24) * 60 * 60 * 1000);
    
    const [updatedReq, createdGrant] = await prisma.$transaction(async (tx) => {
      const grant = await tx.documentAccess.create({
        data: {
          documentId: accessReq.documentId,
          userId: accessReq.requestedById,
          scopes: accessReq.requestedScopes,
          grantedById: adminUser.id,
          expiresAt: expiresAt,
          isActive: true,
        }
      });

      const req = await tx.accessRequest.update({
        where: { id: accessReq.id },
        data: {
          status: 'APPROVED',
          decidedById: adminUser.id,
          decidedAt: new Date(),
          accessGrantId: grant.id,
        }
      });

      return [req, grant];
    });

    assert(updatedReq.status === 'APPROVED', 'Access request status updated to APPROVED');
    assert(updatedReq.accessGrantId === createdGrant.id, 'Access request linked to generated grant');
    assert(createdGrant.isActive === true, 'Grant is marked isActive: true');
    assert(createdGrant.scopes.includes('VIEW_METADATA') && createdGrant.scopes.includes('PREVIEW'), 'Grant contains all requested scopes');
    assert(!createdGrant.scopes.includes('DOWNLOAD'), 'Grant does NOT include unrequested DOWNLOAD scope');

    // TEST 4: Scope Evaluation Check
    console.log('\n--- TEST 4: Scope Evaluation (VIEW_METADATA vs DOWNLOAD) ---');
    const hasViewMetadata = createdGrant.isActive && (new Date(createdGrant.expiresAt) > new Date()) && createdGrant.scopes.includes('VIEW_METADATA');
    const hasDownload = createdGrant.isActive && (new Date(createdGrant.expiresAt) > new Date()) && createdGrant.scopes.includes('DOWNLOAD');
    const hasTransfer = createdGrant.isActive && (new Date(createdGrant.expiresAt) > new Date()) && createdGrant.scopes.includes('TRANSFER_CUSTODY');

    assert(hasViewMetadata === true, 'VIEW_METADATA permission granted');
    assert(hasDownload === false, 'DOWNLOAD permission correctly denied');
    assert(hasTransfer === false, 'TRANSFER_CUSTODY permission correctly denied');

    // TEST 5: Grant Revocation
    console.log('\n--- TEST 5: Revoke Active Grant ---');
    const revokedGrant = await prisma.documentAccess.update({
      where: { id: createdGrant.id },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokedById: adminUser.id,
        revokeReason: 'Case moved to different bench',
      }
    });

    assert(revokedGrant.isActive === false, 'Grant isActive flipped to false');
    assert(revokedGrant.revokedAt !== null, 'revokedAt timestamp recorded');
    assert(revokedGrant.revokeReason === 'Case moved to different bench', 'Revocation reason recorded');

    // Re-evaluating permission after revocation
    const activeGrantAfterRevocation = await prisma.documentAccess.findFirst({
      where: {
        documentId: testDoc.id,
        userId: advocateUser.id,
        isActive: true,
        expiresAt: { gt: new Date() }
      }
    });
    assert(activeGrantAfterRevocation === null, 'Revoked grant immediately stops authorizing user');

    // TEST 6: Multiple Grants for Same User/Document without Overwriting History
    console.log('\n--- TEST 6: Multiple Grant History Preservation ---');
    const secondReq = await prisma.accessRequest.create({
      data: {
        documentId: testDoc.id,
        requestedById: advocateUser.id,
        reason: 'Subsequent special court order for full download',
        requestedScopes: ['VIEW_METADATA', 'PREVIEW', 'DOWNLOAD'],
        durationHours: 48,
        status: 'PENDING'
      }
    });

    const [secondReqApproved, secondGrant] = await prisma.$transaction(async (tx) => {
      const grant = await tx.documentAccess.create({
        data: {
          documentId: secondReq.documentId,
          userId: secondReq.requestedById,
          scopes: secondReq.requestedScopes,
          grantedById: adminUser.id,
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
          isActive: true,
        }
      });

      const req = await tx.accessRequest.update({
        where: { id: secondReq.id },
        data: {
          status: 'APPROVED',
          decidedById: adminUser.id,
          decidedAt: new Date(),
          accessGrantId: grant.id,
        }
      });

      return [req, grant];
    });

    const allUserGrantsForDoc = await prisma.documentAccess.findMany({
      where: {
        documentId: testDoc.id,
        userId: advocateUser.id,
      },
      orderBy: { grantedAt: 'asc' }
    });

    assert(allUserGrantsForDoc.length === 2, `Both grant records preserved in history (count: ${allUserGrantsForDoc.length})`);
    assert(allUserGrantsForDoc[0].id === createdGrant.id && allUserGrantsForDoc[0].isActive === false, 'First grant remains in DB as inactive/revoked');
    assert(allUserGrantsForDoc[1].id === secondGrant.id && allUserGrantsForDoc[1].isActive === true, 'Second grant is active');

    // TEST 7: Expired Grants Stop Authorizing
    console.log('\n--- TEST 7: Expired Grants Handling ---');
    const expiredGrant = await prisma.documentAccess.create({
      data: {
        documentId: testDoc.id,
        userId: investigatorUser.id,
        scopes: ['VIEW_METADATA'],
        grantedById: adminUser.id,
        expiresAt: new Date(Date.now() - 3600 * 1000), // 1 hour in the past
        isActive: true,
      }
    });

    const validInvestigatorGrant = await prisma.documentAccess.findFirst({
      where: {
        documentId: testDoc.id,
        userId: investigatorUser.id,
        isActive: true,
        expiresAt: { gt: new Date() }
      }
    });

    assert(validInvestigatorGrant === null, 'Expired grant does not match active unexpired grant query');

    // TEST 8: Rejection Workflow
    console.log('\n--- TEST 8: Rejection Workflow ---');
    const rejectedReq = await prisma.accessRequest.create({
      data: {
        documentId: testDoc.id,
        requestedById: investigatorUser.id,
        reason: 'Investigative cross reference without supervisor signoff',
        requestedScopes: ['DOWNLOAD'],
        status: 'PENDING'
      }
    });

    const finalRejectedReq = await prisma.accessRequest.update({
      where: { id: rejectedReq.id },
      data: {
        status: 'REJECTED',
        decidedById: adminUser.id,
        decidedAt: new Date(),
        decisionNotes: 'Missing judicial warrant'
      }
    });

    assert(finalRejectedReq.status === 'REJECTED', 'Request marked as REJECTED');
    assert(finalRejectedReq.decisionNotes === 'Missing judicial warrant', 'Rejection reason persisted');
    assert(finalRejectedReq.accessGrantId === null, 'No grant generated for rejected request');

    // Cleanup test data
    console.log('\n--- Cleaning up test records ---');
    await prisma.documentAccess.deleteMany({ where: { documentId: testDoc.id } });
    await prisma.accessRequest.deleteMany({ where: { documentId: testDoc.id } });
    await prisma.document.delete({ where: { id: testDoc.id } });
    await prisma.case.delete({ where: { id: testCase.id } });

    console.log('\n======================================================');
    console.log(`ALL MILESTONE 3.2 TESTS PASSED! (${testPassCount}/${testTotalCount})`);
    console.log('======================================================\n');
  } catch (err) {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
