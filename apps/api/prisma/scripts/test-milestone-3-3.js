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

async function runMilestone33Tests() {
  console.log('=== NYAYAVAULT MILESTONE 3.3: CUSTODY HANDSHAKE & CHAIN OF CUSTODY SUITE ===\n');
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
    console.log('--- 1. Setting up test actors & isolated case ---');
    const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    const ioUser = await prisma.user.findFirst({ where: { role: 'INVESTIGATING_OFFICER' } });
    const forensicUser = await prisma.user.findFirst({ where: { role: 'FORENSIC_OFFICER' } });
    const seniorUser = await prisma.user.findFirst({ where: { role: 'SENIOR_OFFICER' } });
    const legalUser = await prisma.user.findFirst({ where: { role: 'LEGAL_OFFICER' } });

    assert(adminUser && ioUser && forensicUser && seniorUser && legalUser, 'All required test roles present in DB');

    const adminToken = createToken(adminUser);
    const ioToken = createToken(ioUser);
    const forensicToken = createToken(forensicUser);
    const legalToken = createToken(legalUser);

    const testCase = await prisma.case.create({
      data: {
        caseNumber: `CUSTODY-TEST-${Date.now()}`,
        title: 'Custody Handshake Test Case',
        description: 'Case for testing Milestone 3.3 two-step transfer workflow',
        status: 'OPEN',
        members: {
          create: [
            { userId: ioUser.id, roleInCase: 'LEAD_INVESTIGATOR' },
            { userId: forensicUser.id, roleInCase: 'FORENSIC_ANALYST' },
          ],
        },
      },
    });

    // Create an evidence item initially logged by IO
    const evidenceItem = await prisma.evidenceItem.create({
      data: {
        caseId: testCase.id,
        name: 'Recovered Mobile Device (Samsung S23)',
        description: 'Found at crime scene, sealed in anti-static evidence bag',
        status: 'COLLECTED',
        currentCustodianId: ioUser.id,
        transfers: {
          create: {
            fromUserId: null,
            toUserId: ioUser.id,
            status: 'COMPLETED',
            packageCondition: 'SEALED_INTACT',
            notes: 'Evidence logged - initial custody',
          },
        },
      },
    });

    console.log(`Created test evidence: ${evidenceItem.name} (${evidenceItem.id}) with initial custodian: ${ioUser.name}`);

    // TEST 1: Unauthorized Initiation Blocked
    console.log('\n--- TEST 1: Unauthorized initiation by non-custodian ---');
    const unauthInitiate = await fetch(`${API_URL}/evidence/${evidenceItem.id}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${legalToken}` },
      body: JSON.stringify({
        toUserId: forensicUser.id,
        purpose: 'Attempted unauthorized transfer',
      }),
    });
    assert(unauthInitiate.status === 403, 'Non-custodian non-admin is blocked from initiating transfer (HTTP 403)');

    // TEST 2: Self-Transfer Prevention
    console.log('\n--- TEST 2: Prevent self-transfer ---');
    const selfTransfer = await fetch(`${API_URL}/evidence/${evidenceItem.id}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ioToken}` },
      body: JSON.stringify({
        toUserId: ioUser.id,
        purpose: 'Self transfer',
      }),
    });
    assert(selfTransfer.status === 400, 'Self-transfer rejected with HTTP 400');

    // TEST 3: Authorized Initiation (Two-Step Handshake Step 1)
    console.log('\n--- TEST 3: Custody transfer initiation (Step 1) ---');
    const initiateRes = await fetch(`${API_URL}/evidence/${evidenceItem.id}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ioToken}` },
      body: JSON.stringify({
        toUserId: forensicUser.id,
        purpose: 'Digital Forensics Extraction',
        sealNumber: 'SEAL-DL-2026-9901',
        packageCondition: 'SEALED_INTACT',
        location: 'Cyber Forensics Lab, Delhi',
        notes: 'Handing over for chip-off extraction',
      }),
    });
    const initiateJson = await initiateRes.json();
    assert(initiateRes.status === 201 && initiateJson.ok === true, 'Transfer initiated successfully with HTTP 201');
    const transfer1Id = initiateJson.transfer.id;
    assert(initiateJson.transfer.status === 'PENDING', 'Transfer status is PENDING');
    assert(initiateJson.transfer.sealNumber === 'SEAL-DL-2026-9901', 'Seal number recorded');
    assert(initiateJson.transfer.packageCondition === 'SEALED_INTACT', 'Package condition recorded');

    // TEST 4: INVARIANT - Custody does NOT change upon initiation
    console.log('\n--- TEST 4: Invariant check - sender remains custodian during PENDING ---');
    const checkEvPending = await prisma.evidenceItem.findUnique({ where: { id: evidenceItem.id } });
    assert(checkEvPending.currentCustodianId === ioUser.id, 'Sender remains accountable custodian while transfer is PENDING');

    // TEST 5: Multiple Concurrent Pending Transfers Blocked
    console.log('\n--- TEST 5: Prevent duplicate pending transfers ---');
    const dupPending = await fetch(`${API_URL}/evidence/${evidenceItem.id}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ioToken}` },
      body: JSON.stringify({
        toUserId: forensicUser.id,
        purpose: 'Second transfer attempt while one is already pending',
      }),
    });
    assert(dupPending.status === 409, 'Duplicate pending transfer rejected with HTTP 409 Conflict');

    // TEST 6: Pending Transfers Listing API
    console.log('\n--- TEST 6: Pending transfers listing ---');
    const pendingListRes = await fetch(`${API_URL}/evidence/transfers/pending`, {
      headers: { Authorization: `Bearer ${forensicToken}` },
    });
    const pendingListJson = await pendingListRes.json();
    assert(
      pendingListJson.transfers.some((t) => t.id === transfer1Id),
      'Pending transfer appears in recipient pending queue'
    );

    // TEST 7: Unauthorized Acceptance Blocked
    console.log('\n--- TEST 7: Unauthorized user cannot accept transfer ---');
    const unauthAccept = await fetch(`${API_URL}/evidence/transfers/${transfer1Id}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${legalToken}` },
    });
    assert(unauthAccept.status === 403, 'Unauthorized user blocked from accepting (HTTP 403)');

    // TEST 8: Recipient Explicit Acceptance (Two-Step Handshake Step 2)
    console.log('\n--- TEST 8: Recipient acceptance (Step 2) & atomic custody handoff ---');
    const acceptRes = await fetch(`${API_URL}/evidence/transfers/${transfer1Id}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${forensicToken}` },
    });
    const acceptJson = await acceptRes.json();
    assert(acceptRes.status === 200 && acceptJson.ok === true && acceptJson.status === 'ACCEPTED', 'Recipient acceptance succeeded');

    const checkEvAccepted = await prisma.evidenceItem.findUnique({ where: { id: evidenceItem.id } });
    assert(checkEvAccepted.currentCustodianId === forensicUser.id, 'Custody successfully transferred to Forensic Officer');

    // TEST 9: Duplicate Decision Guard
    console.log('\n--- TEST 9: Guard against duplicate acceptance on completed transfer ---');
    const dupAccept = await fetch(`${API_URL}/evidence/transfers/${transfer1Id}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${forensicToken}` },
    });
    assert(dupAccept.status === 409, 'Duplicate decision blocked with HTTP 409 Conflict');

    // TEST 10: Rejection Workflow
    console.log('\n--- TEST 10: Rejection workflow ---');
    // Forensic initiates return transfer to IO
    const returnInitRes = await fetch(`${API_URL}/evidence/${evidenceItem.id}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${forensicToken}` },
      body: JSON.stringify({
        toUserId: ioUser.id,
        purpose: 'Returning after examination',
        sealNumber: 'SEAL-LAB-4481',
        packageCondition: 'RE_SEALED',
      }),
    });
    const returnInitJson = await returnInitRes.json();
    const returnTransferId = returnInitJson.transfer.id;

    // IO rejects the transfer because seal was reported broken or discrepancy found
    const rejectRes = await fetch(`${API_URL}/evidence/transfers/${returnTransferId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ioToken}` },
      body: JSON.stringify({
        reason: 'Seal tape shows tampering signs - rejecting custody pending supervisor review',
      }),
    });
    const rejectJson = await rejectRes.json();
    assert(rejectRes.status === 200 && rejectJson.status === 'REJECTED', 'Transfer rejected successfully');

    const checkEvRejected = await prisma.evidenceItem.findUnique({ where: { id: evidenceItem.id } });
    assert(
      checkEvRejected.currentCustodianId === forensicUser.id,
      'Custody remains with Forensic Officer following rejection'
    );

    const checkRejectRecord = await prisma.evidenceTransfer.findUnique({ where: { id: returnTransferId } });
    assert(
      checkRejectRecord.status === 'REJECTED' &&
      checkRejectRecord.rejectionReason.includes('tampering signs'),
      'Rejection reason and status persisted in transfer record'
    );

    // TEST 11: Cancellation Workflow
    console.log('\n--- TEST 11: Sender cancellation workflow ---');
    const cancelInitRes = await fetch(`${API_URL}/evidence/${evidenceItem.id}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${forensicToken}` },
      body: JSON.stringify({
        toUserId: seniorUser.id,
        purpose: 'Escalation transfer',
      }),
    });
    const cancelInitJson = await cancelInitRes.json();
    const cancelTransferId = cancelInitJson.transfer.id;

    const cancelRes = await fetch(`${API_URL}/evidence/transfers/${cancelTransferId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${forensicToken}` },
    });
    assert(cancelRes.status === 200, 'Sender cancelled pending transfer successfully');

    const checkCancelRecord = await prisma.evidenceTransfer.findUnique({ where: { id: cancelTransferId } });
    assert(checkCancelRecord.status === 'CANCELLED', 'Transfer marked as CANCELLED');

    // TEST 12: Chain of Custody History Completeness & Non-Destruction
    console.log('\n--- TEST 12: Chain of custody history preservation ---');
    const evDetailRes = await fetch(`${API_URL}/evidence/${evidenceItem.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const evDetailJson = await evDetailRes.json();
    const allTransfers = evDetailJson.evidence.transfers;

    // Expected: 1 initial + 1 accepted + 1 rejected + 1 cancelled = 4 total historical records
    assert(allTransfers.length === 4, `All 4 custody events preserved in chain of custody history (got: ${allTransfers.length})`);
    assert(allTransfers.some((t) => t.status === 'ACCEPTED'), 'Accepted event in history');
    assert(allTransfers.some((t) => t.status === 'REJECTED'), 'Rejected event in history');
    assert(allTransfers.some((t) => t.status === 'CANCELLED'), 'Cancelled event in history');

    // Cleanup
    console.log('\n--- Cleaning up test records ---');
    // Keep evidence record to prevent foreign key cascade on audit logs


    console.log('\n======================================================');
    console.log(`ALL MILESTONE 3.3 TESTS PASSED! (${passed}/${total})`);
    console.log('======================================================\n');
  } catch (err) {
    console.error('Milestone 3.3 Suite Failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMilestone33Tests();
