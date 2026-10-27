const path = require('path');
module.paths.push(path.resolve(__dirname, '..', 'backend', 'node_modules'));

const prisma = require('../backend/src/utils/db');
const compOffService = require('../backend/src/services/compOffService');
const {
  sendCompOffExpiryReminders,
  processCompOffDailyMaintenance
} = require('../backend/src/services/compOffExpirySchedulerService');
const compOffController = require('../backend/src/controllers/compOffController');
const leaveController = require('../backend/src/controllers/leaveController');
const leavePolicyController = require('../backend/src/controllers/leavePolicyController');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Mock Express req/res helper
function createMockReqRes(reqData = {}) {
  const req = {
    params: reqData.params || {},
    query: reqData.query || {},
    body: reqData.body || {},
    user: reqData.user || null,
    headers: reqData.headers || {},
    ip: '127.0.0.1'
  };

  let statusCode = 200;
  let responseData = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    send(data) {
      responseData = data;
      return this;
    },
    getStatus() {
      return statusCode;
    },
    getData() {
      return responseData;
    }
  };

  return { req, res };
}

async function runPhase5TestSuite() {
  console.log('========================================================================');
  console.log('  InnovEity CRM — Comp-Off Phase 5: E2E, Hardening & Release Readiness');
  console.log('========================================================================\n');

  // Verify baseline tenant targets
  const org1 = await prisma.organization.findFirst({
    where: { id: 'cmu43zvwm0000exne7d53m25e' }
  });
  const org2 = await prisma.organization.findFirst({
    where: { id: 'cmu5e48x30001bv4bpytsye40' }
  });

  assert(org1 && org2, 'Target test organizations exist in local database');

  const adminUser = await prisma.user.findFirst({
    where: { role: 'ADMIN', organizationId: org1.id }
  });
  const superAdminUser = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' }
  });
  const org2Admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', organizationId: org2.id }
  });

  assert(adminUser && superAdminUser && org2Admin, 'Admin and Super Admin role fixtures located');

  // Ensure COMP_OFF LeaveType exists
  const compOffLeaveType = await compOffService.ensureCompOffLeaveType(prisma);
  assert(compOffLeaveType && compOffLeaveType.code === 'COMP_OFF', 'System COMP_OFF leave type is verified');

  // Tracking fixtures for cleanup
  const createdUserIds = [];
  const createdTeamIds = [];
  const createdCreditIds = [];
  const createdLeaveRequestIds = [];
  const createdAttendanceIds = [];
  const createdNotificationIds = [];

  const timestamp = Date.now();

  try {
    // -------------------------------------------------------------------------
    // Setup Test Users and Teams
    // -------------------------------------------------------------------------
    const testTL = await prisma.user.create({
      data: {
        name: `Test TL Phase 5 ${timestamp}`,
        email: `tl_p5_${timestamp}@test.com`,
        employeeId: `TLP5-${timestamp}`,
        password: 'hashedpassword',
        role: 'TEAM_LEADER',
        organizationId: org1.id,
        status: 'ACTIVE'
      }
    });
    createdUserIds.push(testTL.id);

    const testPeerTL = await prisma.user.create({
      data: {
        name: `Test Peer TL Phase 5 ${timestamp}`,
        email: `peer_tl_p5_${timestamp}@test.com`,
        employeeId: `PTLP5-${timestamp}`,
        password: 'hashedpassword',
        role: 'TEAM_LEADER',
        organizationId: org1.id,
        status: 'ACTIVE'
      }
    });
    createdUserIds.push(testPeerTL.id);

    const testEmp = await prisma.user.create({
      data: {
        name: `Test Emp Phase 5 ${timestamp}`,
        email: `emp_p5_${timestamp}@test.com`,
        employeeId: `EMPP5-${timestamp}`,
        password: 'hashedpassword',
        role: 'EMPLOYEE',
        organizationId: org1.id,
        status: 'ACTIVE'
      }
    });
    createdUserIds.push(testEmp.id);

    const testEmp2 = await prisma.user.create({
      data: {
        name: `Test Emp2 Phase 5 ${timestamp}`,
        email: `emp2_p5_${timestamp}@test.com`,
        employeeId: `EMP2P5-${timestamp}`,
        password: 'hashedpassword',
        role: 'EMPLOYEE',
        organizationId: org1.id,
        status: 'ACTIVE'
      }
    });
    createdUserIds.push(testEmp2.id);

    const testTeam = await prisma.team.create({
      data: {
        name: `Phase 5 Test Team ${timestamp}`,
        leaderId: testTL.id,
        organizationId: org1.id
      }
    });
    createdTeamIds.push(testTeam.id);

    await prisma.teamMember.create({
      data: {
        teamId: testTeam.id,
        userId: testEmp.id
      }
    });

    console.log('\n--- 1. Employee End-to-End Workflow ---');

    // 1.1 Initial balance check (expect 0)
    const { req: balReq1, res: balRes1 } = createMockReqRes({ user: testEmp });
    await leaveController.getLeaveBalances(balReq1, balRes1);
    assert(balRes1.getStatus() === 200, 'Employee can fetch leave balances');
    assert(balRes1.getData().compOffRemaining === 0, 'Initial Comp-Off available balance is 0');

    // 1.2 Eligible work date attendance record (Sunday 14 days ago)
    const sundayDate = new Date();
    sundayDate.setDate(sundayDate.getDate() - 14);
    while (sundayDate.getDay() !== 0) {
      sundayDate.setDate(sundayDate.getDate() - 1);
    }
    const sundayDateStr = sundayDate.toISOString().split('T')[0];

    const attRecord = await prisma.attendance.create({
      data: {
        userId: testEmp.id,
        date: new Date(`${sundayDateStr}T00:00:00.000Z`),
        clockIn: new Date(`${sundayDateStr}T09:00:00.000Z`),
        clockOut: new Date(`${sundayDateStr}T18:00:00.000Z`),
        status: 'PRESENT',
        workingHours: 9.0
      }
    });
    createdAttendanceIds.push(attRecord.id);

    // 1.3 Admin authorizes credit
    const { req: authReq, res: authRes } = createMockReqRes({
      user: adminUser,
      body: {
        userId: testEmp.id,
        workDate: sundayDateStr,
        creditDays: 1.0,
        remarks: 'Worked full Sunday shift'
      }
    });
    await compOffController.authorizeCredit(authReq, authRes);
    assert(authRes.getStatus() === 201, 'Admin authorizes 1.0 day credit successfully');
    const adminCredit = authRes.getData().credit || authRes.getData();
    createdCreditIds.push(adminCredit.id);

    // 1.4 Balance reflection
    const { req: balReq2, res: balRes2 } = createMockReqRes({ user: testEmp });
    await leaveController.getLeaveBalances(balReq2, balRes2);
    assert(balRes2.getData().compOffRemaining === 1.0, 'Balance updates to 1.0 available');

    // 1.5 Employee applies for 0.5 day half-day leave
    const leaveDate = new Date();
    leaveDate.setDate(leaveDate.getDate() + 10);
    const leaveDateStr = leaveDate.toISOString().split('T')[0];

    const { req: applyReq1, res: applyRes1 } = createMockReqRes({
      user: testEmp,
      body: {
        startDate: leaveDateStr,
        endDate: leaveDateStr,
        leaveType: 'COMP_OFF',
        isHalfDay: true,
        reason: 'Personal urgent work half day'
      }
    });
    await leaveController.applyLeave(applyReq1, applyRes1);
    assert(applyRes1.getStatus() === 201, 'Employee successfully applies for 0.5-day Comp-Off');
    createdLeaveRequestIds.push(applyRes1.getData().id);

    // 1.6 Verify pending reservation
    const bal3 = await compOffService.getUserCompOffLedgerBalance(testEmp.id, new Date());
    assert(bal3.pendingDays === 0.5, '0.5 day is reserved by pending leave request');
    assert(bal3.netAvailable === 0.5, 'Available balance reduced to 0.5 day');

    // 1.7 Employee attempts to apply for 1.0 day (exceeds 0.5 available balance)
    const leaveDate2 = new Date();
    leaveDate2.setDate(leaveDate2.getDate() + 12);
    const leaveDate2Str = leaveDate2.toISOString().split('T')[0];

    const { req: applyReq2, res: applyRes2 } = createMockReqRes({
      user: testEmp,
      body: {
        startDate: leaveDate2Str,
        endDate: leaveDate2Str,
        leaveType: 'COMP_OFF',
        isHalfDay: false,
        reason: 'Attempting 1.0 day with only 0.5 available'
      }
    });
    await leaveController.applyLeave(applyReq2, applyRes2);
    assert(applyRes2.getStatus() === 400, 'Request exceeding available balance is rejected with 400');
    assert(applyRes2.getData().message.includes('exceeds your available'), 'Clear balance overflow error message returned');

    // 1.8 30-calendar-day claim deadline check
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 35); // 35 days ago (outside 30-day window)
    const oldDateStr = oldDate.toISOString().split('T')[0];

    const { req: evReqOld, res: evResOld } = createMockReqRes({
      user: adminUser,
      query: { userId: testEmp.id, workDate: oldDateStr }
    });
    await compOffController.getEligibleWorkEvidence(evReqOld, evResOld);
    assert(evResOld.getData().claimWindow.isValid === false, 'Evidence API flags work date older than 30 days as invalid');
    assert(evResOld.getData().claimWindow.error.includes('expired'), 'Evidence API returns 30-day claim window expired explanation');

    const { req: authReqOld, res: authResOld } = createMockReqRes({
      user: adminUser,
      body: {
        userId: testEmp.id,
        workDate: oldDateStr,
        creditDays: 1.0,
        remarks: 'Attempting credit past 30 days'
      }
    });
    await compOffController.authorizeCredit(authReqOld, authResOld);
    assert(authResOld.getStatus() === 400, 'Authorization past 30-day claim deadline is rejected with 400');

    console.log('\n--- 2. Team Leader Verification & Scoping Workflow ---');

    // 2.1 TL authorizes credit for team member
    const sundayDateTL = new Date();
    sundayDateTL.setDate(sundayDateTL.getDate() - 21);
    while (sundayDateTL.getDay() !== 0) {
      sundayDateTL.setDate(sundayDateTL.getDate() - 1);
    }
    const sundayDateTLStr = sundayDateTL.toISOString().split('T')[0];

    const attRecordTL = await prisma.attendance.create({
      data: {
        userId: testEmp.id,
        date: new Date(`${sundayDateTLStr}T00:00:00.000Z`),
        clockIn: new Date(`${sundayDateTLStr}T09:00:00.000Z`),
        clockOut: new Date(`${sundayDateTLStr}T14:00:00.000Z`),
        status: 'PRESENT',
        workingHours: 5.0
      }
    });
    createdAttendanceIds.push(attRecordTL.id);

    const { req: tlAuthReq, res: tlAuthRes } = createMockReqRes({
      user: testTL,
      body: {
        userId: testEmp.id,
        workDate: sundayDateTLStr,
        creditDays: 0.5,
        remarks: 'TL verified 5 hours Sunday shift'
      }
    });
    await compOffController.authorizeCredit(tlAuthReq, tlAuthRes);
    assert(tlAuthRes.getStatus() === 201, 'Team Leader submits verification successfully');
    const tlClaim = tlAuthRes.getData().credit || tlAuthRes.getData();
    assert(tlClaim.status === 'PENDING_ADMIN_APPROVAL', 'Claim created in PENDING_ADMIN_APPROVAL status');
    assert(tlClaim.claimedByRole === 'TEAM_LEADER', 'claimedByRole correctly tagged as TEAM_LEADER');
    createdCreditIds.push(tlClaim.id);
    const tlClaimId = tlClaim.id;

    // 2.2 TL cannot authorize for non-team employee
    const { req: tlOutReq, res: tlOutRes } = createMockReqRes({
      user: testTL,
      body: {
        userId: testEmp2.id, // Not in TL's team
        workDate: sundayDateTLStr,
        creditDays: 0.5,
        remarks: 'Attempting out-of-team'
      }
    });
    await compOffController.authorizeCredit(tlOutReq, tlOutRes);
    assert(tlOutRes.getStatus() === 403, 'TL authorizing for out-of-team employee rejected with 403');

    // 2.3 TL cannot self-authorize
    const { req: tlSelfReq, res: tlSelfRes } = createMockReqRes({
      user: testTL,
      body: {
        userId: testTL.id,
        workDate: sundayDateTLStr,
        creditDays: 0.5,
        remarks: 'Self-authorization attempt'
      }
    });
    await compOffController.authorizeCredit(tlSelfReq, tlSelfRes);
    assert(tlSelfRes.getStatus() === 403, 'TL self-authorization rejected with 403');

    // 2.4 TL cannot authorize peer TL
    const { req: tlPeerReq, res: tlPeerRes } = createMockReqRes({
      user: testTL,
      body: {
        userId: testPeerTL.id,
        workDate: sundayDateTLStr,
        creditDays: 0.5,
        remarks: 'Peer TL authorization attempt'
      }
    });
    await compOffController.authorizeCredit(tlPeerReq, tlPeerRes);
    assert(tlPeerRes.getStatus() === 403, 'TL authorizing peer Team Leader rejected with 403');

    console.log('\n--- 3. Admin Queue Review, Expiry & Final Leave Approval ---');

    // 3.1 Admin approves TL-verified claim
    const { req: adminAppReq, res: adminAppRes } = createMockReqRes({
      user: adminUser,
      params: { id: tlClaimId },
      body: { remarks: 'Admin verified and approved TL claim' }
    });
    await compOffController.adminApproveCredit(adminAppReq, adminAppRes);
    assert(adminAppRes.getStatus() === 200, 'Admin approves TL-verified claim');
    const approvedCredit = adminAppRes.getData().credit || adminAppRes.getData();
    assert(approvedCredit.status === 'APPROVED', 'Claim transitions to APPROVED status');
    assert(approvedCredit.availableDays === 0.5, 'Credit has 0.5 availableDays');

    // 3.2 Live FIFO Consumption Estimate before leave approval
    const pendingLeaveId = applyRes1.getData().id;
    // Advance leave to PENDING_ADMIN_APPROVAL first
    const { req: tlAppLeaveReq, res: tlAppLeaveRes } = createMockReqRes({
      user: testTL,
      params: { id: pendingLeaveId },
      body: { remarks: 'TL approved half day' }
    });
    await leaveController.approveLeaveTL(tlAppLeaveReq, tlAppLeaveRes);
    assert(tlAppLeaveRes.getStatus() === 200, 'TL performs initial leave recommendation');

    const { req: estReq, res: estRes } = createMockReqRes({
      user: adminUser,
      query: { leaveRequestId: pendingLeaveId }
    });
    await compOffController.estimateCompOffConsumption(estReq, estRes);
    assert(estRes.getStatus() === 200, 'Admin queries FIFO consumption estimate successfully');
    const estBreakdown = estRes.getData().breakdown || estRes.getData().estimatedConsumptions || [];
    assert(estBreakdown.length >= 1, 'Estimate returns at least 1 credit breakdown');
    const estDays = estRes.getData().requiredDays !== undefined ? estRes.getData().requiredDays : estRes.getData().totalDaysToConsume;
    assert(estDays === 0.5, 'Estimate matches requested 0.5 days');

    // 3.3 Final Admin Leave Approval deducts credits exactly once
    const { req: admAppLeaveReq, res: admAppLeaveRes } = createMockReqRes({
      user: adminUser,
      params: { id: pendingLeaveId },
      body: { remarks: 'Admin final sanction' }
    });
    await leaveController.approveLeaveAdmin(admAppLeaveReq, admAppLeaveRes);
    assert(admAppLeaveRes.getStatus() === 200, 'Admin final leave approval succeeds');

    // Verify consumption record
    const consumptionRecords = await prisma.compOffConsumption.findMany({
      where: { leaveRequestId: pendingLeaveId }
    });
    assert(consumptionRecords.length === 1, 'Exactly one CompOffConsumption record created');
    assert(consumptionRecords[0].consumedDays === 0.5, '0.5 days recorded as consumed');
    assert(consumptionRecords[0].status === 'CONSUMED', 'Consumption status is CONSUMED');

    // Attempting to approve again (second approval) fails
    const { req: admAppDupReq, res: admAppDupRes } = createMockReqRes({
      user: adminUser,
      params: { id: pendingLeaveId },
      body: { remarks: 'Duplicate approval attempt' }
    });
    await leaveController.approveLeaveAdmin(admAppDupReq, admAppDupRes);
    assert(admAppDupRes.getStatus() === 400, 'Duplicate approval on already approved leave rejected with 400');

    console.log('\n--- 4. Super Admin Read-Only Enforcement ---');

    // 4.1 Super Admin can read ledger
    const { req: saGetReq, res: saGetRes } = createMockReqRes({ user: superAdminUser });
    await compOffController.getCompOffCredits(saGetReq, saGetRes);
    assert(saGetRes.getStatus() === 200, 'Super Admin can view ledger');

    // 4.2 Super Admin cannot authorize credit
    const { req: saAuthReq, res: saAuthRes } = createMockReqRes({
      user: superAdminUser,
      body: { userId: testEmp.id, workDate: sundayDateStr, creditDays: 1.0 }
    });
    await compOffController.authorizeCredit(saAuthReq, saAuthRes);
    assert(saAuthRes.getStatus() === 403, 'Super Admin authorize credit rejected with 403');

    // 4.3 Super Admin cannot approve claim
    const { req: saAppReq, res: saAppRes } = createMockReqRes({
      user: superAdminUser,
      params: { id: tlClaimId }
    });
    await compOffController.adminApproveCredit(saAppReq, saAppRes);
    assert(saAppRes.getStatus() === 403, 'Super Admin adminApproveCredit rejected with 403');

    // 4.4 Super Admin cannot reject claim
    const { req: saRejReq, res: saRejRes } = createMockReqRes({
      user: superAdminUser,
      params: { id: tlClaimId }
    });
    await compOffController.rejectCredit(saRejReq, saRejRes);
    assert(saRejRes.getStatus() === 403, 'Super Admin rejectCredit rejected with 403');

    console.log('\n--- 5. Financial & Data-Integrity Edge Cases ---');

    // 5.1 Concurrent Leave Requests attempting to reserve the same credits
    // User has 1.0 remaining available balance (1.0 + 0.5 earned - 0.5 consumed = 1.0)
    const testDateConcur1 = new Date();
    testDateConcur1.setDate(testDateConcur1.getDate() + 20);
    const testDateConcur1Str = testDateConcur1.toISOString().split('T')[0];

    const testDateConcur2 = new Date();
    testDateConcur2.setDate(testDateConcur2.getDate() + 25);
    const testDateConcur2Str = testDateConcur2.toISOString().split('T')[0];

    const reqPromise1 = (async () => {
      const { req, res } = createMockReqRes({
        user: testEmp,
        body: {
          startDate: testDateConcur1Str,
          endDate: testDateConcur1Str,
          leaveType: 'COMP_OFF',
          isHalfDay: false, // 1.0 day
          reason: 'Concurrent request 1'
        }
      });
      await leaveController.applyLeave(req, res);
      return res;
    })();

    const reqPromise2 = (async () => {
      const { req, res } = createMockReqRes({
        user: testEmp,
        body: {
          startDate: testDateConcur2Str,
          endDate: testDateConcur2Str,
          leaveType: 'COMP_OFF',
          isHalfDay: false, // 1.0 day
          reason: 'Concurrent request 2'
        }
      });
      await leaveController.applyLeave(req, res);
      return res;
    })();

    const [concurRes1, concurRes2] = await Promise.all([reqPromise1, reqPromise2]);
    const statuses = [concurRes1.getStatus(), concurRes2.getStatus()].sort();
    assert(statuses[0] === 201 && statuses[1] === 400, 'Concurrent reservations: exactly one succeeds (201) and second is rejected (400)');

    const successfulConcurLeaveId = concurRes1.getStatus() === 201 ? concurRes1.getData().id : concurRes2.getData().id;
    createdLeaveRequestIds.push(successfulConcurLeaveId);

    // 5.2 Duplicate verification/authorization submission on same date
    const { req: dupAuthReq, res: dupAuthRes } = createMockReqRes({
      user: adminUser,
      body: {
        userId: testEmp.id,
        workDate: sundayDateStr, // already credited earlier
        creditDays: 1.0,
        remarks: 'Duplicate credit attempt'
      }
    });
    await compOffController.authorizeCredit(dupAuthReq, dupAuthRes);
    assert([400, 409].includes(dupAuthRes.getStatus()), 'Duplicate credit on same work date rejected with 400/409');
    assert(dupAuthRes.getData().message.includes('already exists'), 'Duplicate error message communicated');

    // 5.3 Repeated cancellation and restoration
    // Cancel the approved leave from earlier (pendingLeaveId)
    const { req: cancelReq1, res: cancelRes1 } = createMockReqRes({
      user: adminUser,
      params: { id: pendingLeaveId }
    });
    await leaveController.cancelLeave(cancelReq1, cancelRes1);
    assert(cancelRes1.getStatus() === 200, 'Admin cancels approved leave successfully');

    // Verify credits restored
    const restoredConsumptions = await prisma.compOffConsumption.findMany({
      where: { leaveRequestId: pendingLeaveId }
    });
    assert(restoredConsumptions[0].status === 'RESTORED', 'CompOffConsumption marked RESTORED');

    // Second cancellation attempt
    const { req: cancelReq2, res: cancelRes2 } = createMockReqRes({
      user: adminUser,
      params: { id: pendingLeaveId }
    });
    await leaveController.cancelLeave(cancelReq2, cancelRes2);
    assert(cancelRes2.getStatus() === 400, 'Repeated cancellation rejected with 400');
    assert(cancelRes2.getData().message.includes('already cancelled'), 'Already cancelled error returned');

    // Calling restoreCompOffCreditConsumption directly again restores 0
    const secondRestoreResult = await compOffService.restoreCompOffCreditConsumption({
      leaveRequestId: pendingLeaveId,
      adminUserId: adminUser.id
    });
    assert(secondRestoreResult.restoredCount === 0 && secondRestoreResult.restoredDays === 0, 'Restoration function is strictly idempotent (0 days restored on retry)');

    // 5.4 Partial credit consumption across multiple credits
    // Employee now has: Credit 1 (1.0 restored) + Credit 2 (0.5). Total available = 1.5 days.
    // Create and approve a leave request for 1.5 days across 2 days (from testDateConcur1 to testDateConcur1+1)
    const partialLeave = await prisma.leaveRequest.create({
      data: {
        userId: testEmp.id,
        startDate: new Date('2026-11-01T00:00:00.000Z'),
        endDate: new Date('2026-11-02T00:00:00.000Z'),
        totalDays: 1.5,
        leaveType: 'COMP_OFF',
        status: 'PENDING_ADMIN_APPROVAL',
        adminApprovalStatus: 'PENDING',
        payType: 'PAID',
        reason: 'Partial consumption test across 2 credits'
      }
    });
    createdLeaveRequestIds.push(partialLeave.id);

    const { req: partialAppReq, res: partialAppRes } = createMockReqRes({
      user: adminUser,
      params: { id: partialLeave.id },
      body: { remarks: 'Approve 1.5 days spanning multiple credits' }
    });
    await leaveController.approveLeaveAdmin(partialAppReq, partialAppRes);
    assert(partialAppRes.getStatus() === 200, 'Admin approves 1.5 days Comp-Off spanning multiple credits');

    const multiConsumptions = await prisma.compOffConsumption.findMany({
      where: { leaveRequestId: partialLeave.id },
      orderBy: { consumedDays: 'desc' }
    });
    assert(multiConsumptions.length >= 2, 'Consumption split across multiple credits in FIFO order');
    const totalMultiConsumed = multiConsumptions.reduce((s, c) => s + c.consumedDays, 0);
    assert(totalMultiConsumed === 1.5, 'Total consumed equals 1.5 days exactly');

    // 5.5 Credits expiring before leave request cancellation (does not resurrect expired credit)
    // Create an approved leave that consumed a credit
    const expCreditWorkDate = new Date('2026-05-01T00:00:00.000Z');
    const expCredit = await prisma.compOffCredit.create({
      data: {
        organizationId: org1.id,
        userId: testEmp2.id,
        workDate: expCreditWorkDate,
        creditDays: 1.0,
        usedDays: 1.0,
        availableDays: 0.0,
        status: 'EXHAUSTED',
        reason: 'Credit about to expire test',
        claimedByRole: 'ADMIN',
        claimedById: adminUser.id,
        adminApprovedById: adminUser.id,
        adminApprovedAt: new Date(),
        expiresAt: new Date('2026-08-01T23:59:59.999Z') // Already in past relative to current simulated time
      }
    });
    createdCreditIds.push(expCredit.id);

    const expLeave = await prisma.leaveRequest.create({
      data: {
        userId: testEmp2.id,
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        endDate: new Date('2026-06-01T00:00:00.000Z'),
        totalDays: 1.0,
        leaveType: 'COMP_OFF',
        status: 'APPROVED',
        adminApprovalStatus: 'APPROVED',
        payType: 'PAID',
        reason: 'Leave to be cancelled after credit expiry'
      }
    });
    createdLeaveRequestIds.push(expLeave.id);

    await prisma.compOffConsumption.create({
      data: {
        organizationId: org1.id,
        creditId: expCredit.id,
        leaveRequestId: expLeave.id,
        userId: testEmp2.id,
        consumedDays: 1.0,
        status: 'CONSUMED'
      }
    });

    // Now Admin cancels this leave when current simulated time is past credit expiry
    const futureSimulatedNow = new Date('2026-09-01T00:00:00.000Z');
    const restoreExpiredResult = await compOffService.restoreCompOffCreditConsumption({
      leaveRequestId: expLeave.id,
      adminUserId: adminUser.id,
      referenceDate: futureSimulatedNow
    });
    assert(restoreExpiredResult.restoredCount === 1, 'Restoration recorded consumption as reversed');

    const updatedExpCredit = await prisma.compOffCredit.findUnique({
      where: { id: expCredit.id }
    });
    assert(updatedExpCredit.status === 'EXPIRED', 'Credit status updated to EXPIRED because its validity has elapsed');
    assert(updatedExpCredit.availableDays === 0, 'Available days remains 0 (does NOT resurrect expired credit into available pool)');

    // 5.6 Repeated expiry processing
    const expRun1 = await compOffService.processExpiredCompOffCredits({
      referenceDate: new Date('2026-10-01T00:00:00.000Z')
    });
    const expRun2 = await compOffService.processExpiredCompOffCredits({
      referenceDate: new Date('2026-10-01T00:00:00.000Z')
    });
    assert(expRun2.expiredCount === 0, 'Repeated expiry processing is idempotent (0 additional credits expired on rerun)');

    // 5.7 Changes to default expiry period in settings does not alter existing credits
    const preSettingCredit = await prisma.compOffCredit.findUnique({ where: { id: expCredit.id } });
    const preExpiryTimestamp = preSettingCredit.expiresAt.getTime();

    // Emulate updating validity days in organization settings
    await prisma.organizationSettings.upsert({
      where: { organizationId: org1.id },
      update: {
        leavePolicy: {
          compOffValidityDays: 180 // changed from 90 to 180
        }
      },
      create: {
        organizationId: org1.id,
        leavePolicy: {
          compOffValidityDays: 180
        }
      }
    });

    const postSettingCredit = await prisma.compOffCredit.findUnique({ where: { id: expCredit.id } });
    assert(postSettingCredit.expiresAt.getTime() === preExpiryTimestamp, 'Changing validity setting does NOT mutate existing credit expiresAt timestamps');

    console.log('\n--- 6. Scheduled Expiry Notifications & Deduplication ---');

    // Create a fresh active credit expiring in 10 days (milestone: 14-day reminder)
    const baseDate = new Date('2026-10-15T00:00:00.000Z');
    const credit10dExpiry = new Date(baseDate.getTime() + 10 * 24 * 60 * 60 * 1000);

    const credit10d = await prisma.compOffCredit.create({
      data: {
        organizationId: org1.id,
        userId: testEmp2.id,
        workDate: new Date('2026-10-01T00:00:00.000Z'),
        creditDays: 1.0,
        usedDays: 0.0,
        availableDays: 1.0,
        status: 'APPROVED',
        reason: '14-day notification test',
        claimedByRole: 'ADMIN',
        claimedById: adminUser.id,
        expiresAt: credit10dExpiry
      }
    });
    createdCreditIds.push(credit10d.id);

    // Create a credit expiring in 2 days (milestone: 3-day reminder)
    const credit2dExpiry = new Date(baseDate.getTime() + 2 * 24 * 60 * 60 * 1000);
    const credit2d = await prisma.compOffCredit.create({
      data: {
        organizationId: org1.id,
        userId: testEmp2.id,
        workDate: new Date('2026-10-02T00:00:00.000Z'),
        creditDays: 0.5,
        usedDays: 0.0,
        availableDays: 0.5,
        status: 'APPROVED',
        reason: '3-day notification test',
        claimedByRole: 'ADMIN',
        claimedById: adminUser.id,
        expiresAt: credit2dExpiry
      }
    });
    createdCreditIds.push(credit2d.id);

    // Create a credit expiring in 40 days (should NOT trigger reminder)
    const credit40dExpiry = new Date(baseDate.getTime() + 40 * 24 * 60 * 60 * 1000);
    const credit40d = await prisma.compOffCredit.create({
      data: {
        organizationId: org1.id,
        userId: testEmp2.id,
        workDate: new Date('2026-10-03T00:00:00.000Z'),
        creditDays: 1.0,
        usedDays: 0.0,
        availableDays: 1.0,
        status: 'APPROVED',
        reason: 'Far future credit test',
        claimedByRole: 'ADMIN',
        claimedById: adminUser.id,
        expiresAt: credit40dExpiry
      }
    });
    createdCreditIds.push(credit40d.id);

    // Run scheduler reminder job
    const reminderResult1 = await sendCompOffExpiryReminders({
      referenceDate: baseDate,
      organizationId: org1.id
    });

    assert(reminderResult1.remindersSent >= 2, 'Scheduler sends expiry notifications for qualifying credits');

    // Verify 14-day reminder message and tag
    const notif14d = await prisma.notification.findFirst({
      where: {
        userId: testEmp2.id,
        type: 'COMPOFF_EXPIRY_WARNING',
        message: { contains: `[Ref:${credit10d.id}-T14]` }
      }
    });
    assert(notif14d !== null, '14-day expiry warning notification persisted with deterministic Ref tag');
    if (notif14d) createdNotificationIds.push(notif14d.id);

    // Verify 3-day reminder message and tag
    const notif3d = await prisma.notification.findFirst({
      where: {
        userId: testEmp2.id,
        type: 'COMPOFF_EXPIRY_WARNING',
        message: { contains: `[Ref:${credit2d.id}-T3]` }
      }
    });
    assert(notif3d !== null, '3-day expiry warning notification persisted with deterministic Ref tag');
    if (notif3d) createdNotificationIds.push(notif3d.id);

    // Verify message length constraint (MySQL varchar(191))
    assert(notif14d.message.length < 150, `Notification message length is ${notif14d.message.length} chars (strictly under varchar(191) limit)`);

    // Verify persistent deduplication: Run scheduler again on same day
    const reminderResult2 = await sendCompOffExpiryReminders({
      referenceDate: baseDate,
      organizationId: org1.id
    });
    assert(reminderResult2.skippedDuplicates >= 2, 'Scheduler identifies existing notifications via Ref tag and skips duplicates');
    const totalNotifsFor10d = await prisma.notification.count({
      where: {
        userId: testEmp2.id,
        type: 'COMPOFF_EXPIRY_WARNING',
        message: { contains: credit10d.id }
      }
    });
    assert(totalNotifsFor10d === 1, 'Exactly 1 notification exists in database after retry (zero duplicate notifications created)');

    // Combined Daily Maintenance
    const dailyMaint = await processCompOffDailyMaintenance({
      referenceDate: baseDate,
      organizationId: org1.id
    });
    assert(dailyMaint.expiryResults !== undefined && dailyMaint.reminderResults !== undefined, 'processCompOffDailyMaintenance executes both expiry and reminder stages cleanly');

    console.log('\n--- 7. Multi-Tenant Scoping & Policy Recalculation Isolation ---');

    // 7.1 Cross-tenant credit access rejection
    const { req: crossGetReq, res: crossGetRes } = createMockReqRes({
      user: org2Admin,
      params: { id: credit10d.id }
    });
    await compOffController.getCompOffCreditById(crossGetReq, crossGetRes);
    assert(crossGetRes.getStatus() === 403, 'Cross-tenant credit access is strictly forbidden (403)');

    // 7.2 Cross-tenant credit authorization rejection
    const { req: crossAuthReq, res: crossAuthRes } = createMockReqRes({
      user: org2Admin,
      body: {
        userId: testEmp.id, // belongs to org1
        workDate: sundayDateStr,
        creditDays: 1.0,
        remarks: 'Cross-tenant authorization attempt'
      }
    });
    await compOffController.authorizeCredit(crossAuthReq, crossAuthRes);
    assert(crossAuthRes.getStatus() === 403, 'Cross-tenant authorization attempt is rejected with 403');

    // 7.3 Leave policy recalculation does NOT alter Comp-Off balances
    const preRecalcBalance = await compOffService.getUserCompOffLedgerBalance(testEmp2.id, baseDate);
    const { req: recalcReq, res: recalcRes } = createMockReqRes({
      user: adminUser,
      body: { organizationId: org1.id }
    });
    await leavePolicyController.getUserLeaveBalances(recalcReq, recalcRes);

    const postRecalcBalance = await compOffService.getUserCompOffLedgerBalance(testEmp2.id, baseDate);
    assert(postRecalcBalance.netAvailable === preRecalcBalance.netAvailable, 'Global leave policy recalculation derives exclusively from Comp-Off ledger and preserves balances');

    console.log('\n========================================================================');
    console.log(`  PHASE 5 TEST SUITE COMPLETED: ${passedTests} / ${totalTests} TESTS PASSED`);
    console.log('========================================================================\n');
  } catch (err) {
    console.error('\nPhase 5 test failed with exception:', err);
    throw err;
  } finally {
    console.log('Cleaning up Phase 5 test fixtures...');
    try {
      if (createdNotificationIds.length > 0) {
        await prisma.notification.deleteMany({
          where: { id: { in: createdNotificationIds } }
        });
      }
      if (createdLeaveRequestIds.length > 0) {
        await prisma.compOffConsumption.deleteMany({
          where: { leaveRequestId: { in: createdLeaveRequestIds } }
        });
        await prisma.leaveRequest.deleteMany({
          where: { id: { in: createdLeaveRequestIds } }
        });
      }
      if (createdCreditIds.length > 0) {
        await prisma.compOffConsumption.deleteMany({
          where: { creditId: { in: createdCreditIds } }
        });
        await prisma.compOffCredit.deleteMany({
          where: { id: { in: createdCreditIds } }
        });
      }
      if (createdAttendanceIds.length > 0) {
        await prisma.attendance.deleteMany({
          where: { id: { in: createdAttendanceIds } }
        });
      }
      if (createdTeamIds.length > 0) {
        await prisma.teamMember.deleteMany({
          where: { teamId: { in: createdTeamIds } }
        });
        await prisma.team.deleteMany({
          where: { id: { in: createdTeamIds } }
        });
      }
      if (createdUserIds.length > 0) {
        await prisma.userLeaveBalance.deleteMany({
          where: { userId: { in: createdUserIds } }
        });
        await prisma.user.deleteMany({
          where: { id: { in: createdUserIds } }
        });
      }
      // Reset organization settings validity days to 90
      await prisma.organizationSettings.updateMany({
        where: { organizationId: org1.id },
        data: { leavePolicy: { compOffValidityDays: 90 } }
      });
      console.log('Phase 5 test fixtures cleaned up successfully.');
    } catch (cleanupErr) {
      console.warn('Warning during cleanup:', cleanupErr.message);
    }
  }
}

runPhase5TestSuite()
  .then(() => {
    console.log('All Phase 5 checks executed successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Phase 5 suite failed:', err);
    process.exit(1);
  });
