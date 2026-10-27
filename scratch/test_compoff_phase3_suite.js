const path = require('path');
module.paths.push(path.resolve(__dirname, '..', 'backend', 'node_modules'));

const prisma = require('../backend/src/utils/db');
const compOffService = require('../backend/src/services/compOffService');
const leaveController = require('../backend/src/controllers/leaveController');

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

// Mock Express req/res
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

async function runPhase3TestSuite() {
  console.log('================================================================');
  console.log('  InnovEity CRM — Comp-Off Phase 3: Leave Management Integration');
  console.log('================================================================\n');

  // Verify DB targets
  const org1 = await prisma.organization.findFirst({
    where: { id: 'cmu43zvwm0000exne7d53m25e' }
  });
  const org2 = await prisma.organization.findFirst({
    where: { id: 'cmu5e48x30001bv4bpytsye40' }
  });

  const adminUser = await prisma.user.findFirst({
    where: { role: 'ADMIN', organizationId: org1.id }
  });
  const superAdminUser = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' }
  });
  const org2Admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', organizationId: org2.id }
  });

  // Ensure COMP_OFF LeaveType exists
  const compOffLeaveType = await compOffService.ensureCompOffLeaveType(prisma);

  // Fixture containers for tracking and cleanup
  const createdUserIds = [];
  const createdTeamIds = [];
  const createdCreditIds = [];
  const createdLeaveRequestIds = [];
  const createdAttendanceIds = [];

  try {
    // -------------------------------------------------------------------------
    // Setup Test Users & Team in Org 1
    // -------------------------------------------------------------------------
    const timestamp = Date.now();

    const testTL = await prisma.user.create({
      data: {
        name: `Test TL Phase 3 ${timestamp}`,
        email: `tl_p3_${timestamp}@test.com`,
        employeeId: `TLP3-${timestamp}`,
        password: 'hashedpassword',
        role: 'TEAM_LEADER',
        organizationId: org1.id,
        status: 'ACTIVE'
      }
    });
    createdUserIds.push(testTL.id);

    const testEmp = await prisma.user.create({
      data: {
        name: `Test Emp Phase 3 ${timestamp}`,
        email: `emp_p3_${timestamp}@test.com`,
        employeeId: `EMPP3-${timestamp}`,
        password: 'hashedpassword',
        role: 'EMPLOYEE',
        organizationId: org1.id,
        status: 'ACTIVE'
      }
    });
    createdUserIds.push(testEmp.id);

    const testTeam = await prisma.team.create({
      data: {
        name: `Phase 3 Test Team ${timestamp}`,
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

    // Helper: Create Comp-Off Credit
    async function createTestCredit({
      userId = testEmp.id,
      organizationId = org1.id,
      days = 1.0,
      daysAgo = 5,
      expiresInDays = 90,
      status = 'APPROVED'
    }) {
      const workDate = new Date();
      workDate.setDate(workDate.getDate() - daysAgo);
      const dateStr = workDate.toISOString().split('T')[0];
      const targetWorkDate = new Date(`${dateStr}T00:00:00.000Z`);

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
      expiresAt.setHours(23, 59, 59, 999);

      // Create attendance evidence
      const att = await prisma.attendance.create({
        data: {
          userId,
          date: targetWorkDate,
          clockIn: new Date(`${dateStr}T09:00:00.000Z`),
          clockOut: new Date(`${dateStr}T17:00:00.000Z`),
          workingHours: 8.0,
          status: 'PRESENT'
        }
      });
      createdAttendanceIds.push(att.id);

      const credit = await prisma.compOffCredit.create({
        data: {
          organizationId,
          userId,
          workDate: targetWorkDate,
          attendanceId: att.id,
          creditDays: days,
          usedDays: 0.0,
          availableDays: status === 'APPROVED' ? days : 0.0,
          earnedAt: new Date(),
          expiresAt,
          status,
          reason: `Phase 3 Test Credit (${days}d)`,
          claimedByRole: 'ADMIN',
          claimedById: adminUser.id,
          adminApprovedById: status === 'APPROVED' ? adminUser.id : null,
          adminApprovedAt: status === 'APPROVED' ? new Date() : null
        }
      });
      createdCreditIds.push(credit.id);
      return credit;
    }

    // =========================================================================
    // Test 1: Comp-Off Balance Includes Authorized and Unexpired Credits Only
    // =========================================================================
    console.log('--- Test Group 1: Balance Calculation & Expiry Exclusion ---');
    
    // Credit 1: Active 1.0 day credit (valid)
    const credit1 = await createTestCredit({ days: 1.0, daysAgo: 5, expiresInDays: 60 });
    // Credit 2: Expired 1.0 day credit (-10 days expiry)
    const creditExpired = await createTestCredit({ days: 1.0, daysAgo: 105, expiresInDays: -10, status: 'APPROVED' });
    // Credit 3: Pending 1.0 day credit (not yet approved by admin)
    const creditPending = await createTestCredit({ days: 1.0, daysAgo: 2, expiresInDays: 90, status: 'PENDING_ADMIN_APPROVAL' });

    const initialBal = await compOffService.getUserCompOffLedgerBalance(testEmp.id, new Date());
    assert(initialBal.totalEarned === 2.0, 'totalEarned counts authorized credits (2.0 days; pending claim excluded)');
    assert(initialBal.totalAvailable === 1.0, 'totalAvailable counts active approved unexpired credits only (1.0 day)');
    assert(initialBal.pendingDays === 0, 'Initial pendingDays is 0');
    assert(initialBal.netAvailable === 1.0, 'netAvailable is exactly 1.0 (expired and pending excluded)');

    // =========================================================================
    // Test 2 & 4: Half-Day and Full-Day Applications & Pending Reservations
    // =========================================================================
    console.log('\n--- Test Group 2: Leave Application, Half-Day & Pending Reservation ---');

    // Add another 1.0 day credit so total netAvailable = 2.0
    const credit2 = await createTestCredit({ days: 1.0, daysAgo: 3, expiresInDays: 90 });
    const balBeforeApply = await compOffService.getUserCompOffLedgerBalance(testEmp.id, new Date());
    assert(balBeforeApply.netAvailable === 2.0, 'netAvailable is 2.0 before leave application');

    // Submit half-day COMP_OFF leave application (0.5 day)
    const appDate1 = new Date();
    appDate1.setDate(appDate1.getDate() + 10);
    // ensure appDate1 is a weekday (Monday-Friday) to satisfy working day calculation
    while (appDate1.getDay() === 0 || appDate1.getDay() === 6) {
      appDate1.setDate(appDate1.getDate() + 1);
    }
    const appDate1Str = appDate1.toISOString().split('T')[0];

    const { req: applyReq1, res: applyRes1 } = createMockReqRes({
      user: testEmp,
      body: {
        startDate: appDate1Str,
        endDate: appDate1Str,
        leaveType: 'COMP_OFF',
        isHalfDay: true,
        reason: 'Dentist appointment half-day'
      }
    });

    await leaveController.applyLeave(applyReq1, applyRes1);
    assert(applyRes1.getStatus() === 201, 'Half-day Comp-Off application returns 201 Created');
    const leaveApp1 = applyRes1.getData();
    createdLeaveRequestIds.push(leaveApp1.id);
    assert(leaveApp1.totalDays === 0.5, 'Application totalDays is exactly 0.5 for isHalfDay: true');
    assert(leaveApp1.status === 'PENDING_TL_APPROVAL', 'Initial status is PENDING_TL_APPROVAL because employee has TL');

    // Check balance after half-day request: netAvailable must be reduced by 0.5 pending reservation
    const balAfterApply1 = await compOffService.getUserCompOffLedgerBalance(testEmp.id, new Date());
    assert(balAfterApply1.pendingDays === 0.5, 'pendingDays reflects 0.5 pending reservation');
    assert(balAfterApply1.netAvailable === 1.5, 'netAvailable reduced to 1.5 (2.0 - 0.5 pending)');
    assert(balAfterApply1.totalEarned === balBeforeApply.totalEarned, 'totalEarned remains unchanged at 3.0 (credits NOT deducted)');

    // Submit full-day COMP_OFF leave application (1.0 day)
    const appDate2 = new Date(appDate1);
    appDate2.setDate(appDate2.getDate() + 7);
    while (appDate2.getDay() === 0 || appDate2.getDay() === 6) {
      appDate2.setDate(appDate2.getDate() + 1);
    }
    const appDate2Str = appDate2.toISOString().split('T')[0];

    const { req: applyReq2, res: applyRes2 } = createMockReqRes({
      user: testEmp,
      body: {
        startDate: appDate2Str,
        endDate: appDate2Str,
        leaveType: 'COMP_OFF',
        isHalfDay: false,
        reason: 'Family function full-day'
      }
    });

    await leaveController.applyLeave(applyReq2, applyRes2);
    assert(applyRes2.getStatus() === 201, 'Full-day Comp-Off application returns 201 Created');
    const leaveApp2 = applyRes2.getData();
    createdLeaveRequestIds.push(leaveApp2.id);
    assert(leaveApp2.totalDays === 1.0, 'Application totalDays is 1.0');

    // Check balance: pendingDays = 1.5, netAvailable = 0.5
    const balAfterApply2 = await compOffService.getUserCompOffLedgerBalance(testEmp.id, new Date());
    assert(balAfterApply2.pendingDays === 1.5, 'pendingDays reflects 1.5 total pending reservations');
    assert(balAfterApply2.netAvailable === 0.5, 'netAvailable reduced to 0.5 (2.0 - 1.5)');

    // =========================================================================
    // Test 3: Requests Exceeding Available Balance are Rejected
    // =========================================================================
    console.log('\n--- Test Group 3: Balance Overflow Rejection ---');

    const appDate3 = new Date(appDate2);
    appDate3.setDate(appDate3.getDate() + 7);
    while (appDate3.getDay() === 0 || appDate3.getDay() === 6) {
      appDate3.setDate(appDate3.getDate() + 1);
    }
    const appDate3Str = appDate3.toISOString().split('T')[0];

    // Attempt to apply for 1.0 day when netAvailable is only 0.5
    const { req: overflowReq, res: overflowRes } = createMockReqRes({
      user: testEmp,
      body: {
        startDate: appDate3Str,
        endDate: appDate3Str,
        leaveType: 'COMP_OFF',
        isHalfDay: false,
        reason: 'Overdraft attempt'
      }
    });

    await leaveController.applyLeave(overflowReq, overflowRes);
    assert(overflowRes.getStatus() === 400, 'Application exceeding available balance is rejected with 400 Bad Request');
    assert(
      overflowRes.getData().message.includes('exceeds your available'),
      'Rejection message clearly explains balance overdraft'
    );

    // =========================================================================
    // Test 5: Initial Team Leader Approval Does NOT Consume Credits
    // =========================================================================
    console.log('\n--- Test Group 5: Team Leader Review (No Credit Consumption) ---');

    const { req: tlReq, res: tlRes } = createMockReqRes({
      user: testTL,
      params: { id: leaveApp1.id },
      body: { remarks: 'Recommended for dental appointment' }
    });

    await leaveController.approveLeaveTL(tlReq, tlRes);
    assert(tlRes.getStatus() === 200, 'TL approval returns 200 OK');
    const tlApprovedLeave = tlRes.getData();
    assert(tlApprovedLeave.status === 'PENDING_ADMIN_APPROVAL', 'Leave status transitions to PENDING_ADMIN_APPROVAL');
    assert(tlApprovedLeave.tlApprovalStatus === 'APPROVED', 'TL approval status is APPROVED');

    // Confirm credits were NOT touched
    const credit1Fresh = await prisma.compOffCredit.findUnique({ where: { id: credit1.id } });
    assert(credit1Fresh.usedDays === 0, 'Credit usedDays remains 0 after TL approval');
    assert(credit1Fresh.availableDays === 1.0, 'Credit availableDays remains 1.0 after TL approval');
    assert(credit1Fresh.status === 'APPROVED', 'Credit status remains APPROVED after TL approval');

    const consumptionsAfterTL = await prisma.compOffConsumption.findMany({
      where: { leaveRequestId: leaveApp1.id }
    });
    assert(consumptionsAfterTL.length === 0, 'Zero consumption records exist after TL approval');

    // =========================================================================
    // Test 6 & 7: Final Admin Approval Consumes Credits FIFO (Earliest Expiry First)
    // =========================================================================
    console.log('\n--- Test Group 6 & 7: Final Admin Sanction & FIFO Consumption ---');

    // Credit 1 expires in 60 days. Credit 2 expires in 90 days.
    // Approving leaveApp1 (0.5 day) should consume 0.5 from Credit 1 first!
    const { req: adminApproveReq, res: adminApproveRes } = createMockReqRes({
      user: adminUser,
      params: { id: leaveApp1.id },
      body: { remarks: 'Final sanction granted' }
    });

    await leaveController.approveLeaveAdmin(adminApproveReq, adminApproveRes);
    assert(adminApproveRes.getStatus() === 200, 'Admin approval returns 200 OK');
    const adminApprovedLeave = adminApproveRes.getData();
    assert(adminApprovedLeave.status === 'APPROVED', 'Leave status is now APPROVED');

    // Verify consumption record
    const consumptions1 = await prisma.compOffConsumption.findMany({
      where: { leaveRequestId: leaveApp1.id }
    });
    assert(consumptions1.length === 1, 'Exactly one consumption record created');
    assert(consumptions1[0].consumedDays === 0.5, 'Consumed amount is exactly 0.5 day');
    assert(consumptions1[0].creditId === credit1.id, 'FIFO consumed Credit 1 (earliest expiry) first');
    assert(consumptions1[0].status === 'CONSUMED', 'Consumption record status is CONSUMED');

    // Verify Credit 1 state: usedDays = 0.5, availableDays = 0.5, status = APPROVED (retained as active)
    const credit1AfterSanction = await prisma.compOffCredit.findUnique({ where: { id: credit1.id } });
    assert(credit1AfterSanction.usedDays === 0.5, 'Credit 1 usedDays updated to 0.5');
    assert(credit1AfterSanction.availableDays === 0.5, 'Credit 1 availableDays updated to 0.5');
    assert(credit1AfterSanction.status === 'APPROVED', 'Credit 1 remains APPROVED since partially consumed');

    // Attempting to approve again must fail (idempotency guard)
    const { req: reApproveReq, res: reApproveRes } = createMockReqRes({
      user: adminUser,
      params: { id: leaveApp1.id },
      body: { remarks: 'Duplicate approval attempt' }
    });
    await leaveController.approveLeaveAdmin(reApproveReq, reApproveRes);
    assert(reApproveRes.getStatus() === 400, 'Duplicate Admin approval attempt rejected with 400 Bad Request');

    // =========================================================================
    // Test 8: Multi-Credit Spanning Consumption
    // =========================================================================
    console.log('\n--- Test Group 8: Multi-Credit Spanning Consumption ---');

    // Current state:
    // Credit 1: 0.5 available (expires in 60d)
    // Credit 2: 1.0 available (expires in 90d)
    // Total available = 1.5 days.
    // leaveApp2 is for 1.0 day.
    // First approve it through TL:
    const { req: tlReq2, res: tlRes2 } = createMockReqRes({
      user: testTL,
      params: { id: leaveApp2.id },
      body: { remarks: 'TL approved leave 2' }
    });
    await leaveController.approveLeaveTL(tlReq2, tlRes2);

    // Sanction by Admin:
    const { req: adminReq2, res: adminRes2 } = createMockReqRes({
      user: adminUser,
      params: { id: leaveApp2.id },
      body: { remarks: 'Admin approved leave 2' }
    });
    await leaveController.approveLeaveAdmin(adminReq2, adminRes2);
    assert(adminRes2.getStatus() === 200, 'Admin approval for multi-credit leave succeeded');

    // Consumption of 1.0 day must span:
    // 0.5 from Credit 1 (exhausting it)
    // 0.5 from Credit 2 (leaving 0.5 available)
    const consumptions2 = await prisma.compOffConsumption.findMany({
      where: { leaveRequestId: leaveApp2.id },
      orderBy: { createdAt: 'asc' }
    });
    assert(consumptions2.length === 2, 'Consumption spanned across two credits');
    assert(consumptions2[0].creditId === credit1.id, 'First consumption chunk came from Credit 1');
    assert(consumptions2[0].consumedDays === 0.5, 'First chunk was 0.5 day');
    assert(consumptions2[1].creditId === credit2.id, 'Second consumption chunk came from Credit 2');
    assert(consumptions2[1].consumedDays === 0.5, 'Second chunk was 0.5 day');

    const credit1Final = await prisma.compOffCredit.findUnique({ where: { id: credit1.id } });
    assert(credit1Final.usedDays === 1.0, 'Credit 1 usedDays is now 1.0');
    assert(credit1Final.availableDays === 0.0, 'Credit 1 availableDays is now 0.0');
    assert(credit1Final.status === 'EXHAUSTED', 'Credit 1 status is marked EXHAUSTED');

    const credit2AfterLeave2 = await prisma.compOffCredit.findUnique({ where: { id: credit2.id } });
    assert(credit2AfterLeave2.usedDays === 0.5, 'Credit 2 usedDays is now 0.5');
    assert(credit2AfterLeave2.availableDays === 0.5, 'Credit 2 availableDays is now 0.5');
    assert(credit2AfterLeave2.status === 'APPROVED', 'Credit 2 status remains APPROVED');

    // =========================================================================
    // Test 9: Atomic Rollback on Insufficient Balance
    // =========================================================================
    console.log('\n--- Test Group 9: Atomic Transaction Rollback ---');

    // Create a leave request for 1.0 day directly in DB with PENDING_ADMIN_APPROVAL
    // But user only has 0.5 available now!
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 20);
    const leaveOver = await prisma.leaveRequest.create({
      data: {
        userId: testEmp.id,
        startDate: futureDate,
        endDate: futureDate,
        totalDays: 1.0,
        leaveType: 'COMP_OFF',
        type: 'LEAVE',
        payType: 'PAID',
        reason: 'Overdraft test request',
        status: 'PENDING_ADMIN_APPROVAL',
        adminApprovalStatus: 'PENDING'
      }
    });
    createdLeaveRequestIds.push(leaveOver.id);

    const { req: failApproveReq, res: failApproveRes } = createMockReqRes({
      user: adminUser,
      params: { id: leaveOver.id },
      body: { remarks: 'Attempting to approve overdrawn leave' }
    });

    await leaveController.approveLeaveAdmin(failApproveReq, failApproveRes);
    assert(failApproveRes.getStatus() === 400, 'Approval fails with 400 Bad Request');
    assert(failApproveRes.getData().message.includes('Insufficient'), 'Error indicates insufficient credits');

    // Confirm atomic rollback: leave status is NOT approved
    const leaveOverFresh = await prisma.leaveRequest.findUnique({ where: { id: leaveOver.id } });
    assert(leaveOverFresh.status === 'PENDING_ADMIN_APPROVAL', 'Leave status rolled back to PENDING_ADMIN_APPROVAL');

    // Confirm no partial consumption records were left behind
    const orphanConsumptions = await prisma.compOffConsumption.findMany({
      where: { leaveRequestId: leaveOver.id }
    });
    assert(orphanConsumptions.length === 0, 'Zero orphan consumption records created (clean rollback)');

    // Release pending reservation from failed leaveOver request
    await prisma.leaveRequest.delete({ where: { id: leaveOver.id } });
    createdLeaveRequestIds.splice(createdLeaveRequestIds.indexOf(leaveOver.id), 1);

    // =========================================================================
    // Test 10: Concurrency Protection Against Double Consumption
    // =========================================================================
    console.log('\n--- Test Group 10: Concurrency Protection ---');

    // User has 0.5 available in Credit 2.
    // Create two 0.5 leave requests: Req A and Req B
    const dateA = new Date();
    dateA.setDate(dateA.getDate() + 25);
    const dateB = new Date();
    dateB.setDate(dateB.getDate() + 26);

    const reqA = await prisma.leaveRequest.create({
      data: {
        userId: testEmp.id,
        startDate: dateA,
        endDate: dateA,
        totalDays: 0.5,
        leaveType: 'COMP_OFF',
        type: 'LEAVE',
        payType: 'PAID',
        reason: 'Concurrent A',
        status: 'PENDING_ADMIN_APPROVAL',
        adminApprovalStatus: 'PENDING'
      }
    });
    createdLeaveRequestIds.push(reqA.id);

    const reqB = await prisma.leaveRequest.create({
      data: {
        userId: testEmp.id,
        startDate: dateB,
        endDate: dateB,
        totalDays: 0.5,
        leaveType: 'COMP_OFF',
        type: 'LEAVE',
        payType: 'PAID',
        reason: 'Concurrent B',
        status: 'PENDING_ADMIN_APPROVAL',
        adminApprovalStatus: 'PENDING'
      }
    });
    createdLeaveRequestIds.push(reqB.id);

    const preConcurrentCredits = await prisma.compOffCredit.findMany({ where: { userId: testEmp.id } });
    console.log('    --- Pre-concurrent credits ---');
    for (const c of preConcurrentCredits) {
      console.log(`      Credit ${c.id.slice(-6)}: days=${c.creditDays}, used=${c.usedDays}, avail=${c.availableDays}, status=${c.status}, exp=${c.expiresAt.toISOString().split('T')[0]}`);
    }
    const preBal = await compOffService.getUserCompOffLedgerBalance(testEmp.id, new Date());
    console.log(`    preBal: netAvailable=${preBal.netAvailable}, totalAvailable=${preBal.totalAvailable}`);

    // Run both approval calls simultaneously
    const approveA = (async () => {
      const { req, res } = createMockReqRes({ user: adminUser, params: { id: reqA.id }, body: {} });
      await leaveController.approveLeaveAdmin(req, res);
      return res;
    })();

    const approveB = (async () => {
      const { req, res } = createMockReqRes({ user: adminUser, params: { id: reqB.id }, body: {} });
      await leaveController.approveLeaveAdmin(req, res);
      return res;
    })();

    const [resA, resB] = await Promise.all([approveA, approveB]);
    const consA = await prisma.compOffConsumption.findMany({ where: { leaveRequestId: reqA.id } });
    const consB = await prisma.compOffConsumption.findMany({ where: { leaveRequestId: reqB.id } });
    console.log('    consA:', consA);
    console.log('    consB:', consB);
    console.log(`    resA status: ${resA.getStatus()}, message:`, resA.getData()?.message);
    console.log(`    resB status: ${resB.getStatus()}, message:`, resB.getData()?.message);
    const statuses = [resA.getStatus(), resB.getStatus()].sort();
    assert(
      statuses[0] === 200 && statuses[1] === 400,
      'Concurrent approvals: exactly one succeeds (200) and the second is rejected (400) without double spend'
    );

    // Release pending reservation from whichever request failed approval
    const unapprovedReqId = resA.getStatus() === 400 ? reqA.id : reqB.id;
    await prisma.leaveRequest.delete({ where: { id: unapprovedReqId } });
    const unapprovedIdx = createdLeaveRequestIds.indexOf(unapprovedReqId);
    if (unapprovedIdx !== -1) createdLeaveRequestIds.splice(unapprovedIdx, 1);

    // =========================================================================
    // Test 11: Rejection Releases Reservation Without Deducting Credits
    // =========================================================================
    console.log('\n--- Test Group 11: Rejection Releases Reservation ---');

    // Create a 1.0 day credit for fresh testing
    const creditRejection = await createTestCredit({ days: 1.0, daysAgo: 1, expiresInDays: 90 });
    const balBeforeReject = await compOffService.getUserCompOffLedgerBalance(testEmp.id, new Date());
    const netBefore = balBeforeReject.netAvailable;

    // Apply for 1.0 day
    const rejDate = new Date();
    rejDate.setDate(rejDate.getDate() + 30);
    while (rejDate.getDay() === 0 || rejDate.getDay() === 6) rejDate.setDate(rejDate.getDate() + 1);
    const rejDateStr = rejDate.toISOString().split('T')[0];

    const { req: rejAppReq, res: rejAppRes } = createMockReqRes({
      user: testEmp,
      body: {
        startDate: rejDateStr,
        endDate: rejDateStr,
        leaveType: 'COMP_OFF',
        reason: 'To be rejected'
      }
    });
    await leaveController.applyLeave(rejAppReq, rejAppRes);
    console.log('    rejAppRes status:', rejAppRes.getStatus(), 'data:', rejAppRes.getData());
    const leaveToReject = rejAppRes.getData();
    if (leaveToReject?.id) {
      createdLeaveRequestIds.push(leaveToReject.id);
    }

    // Balance should show netAvailable decreased by 1.0
    const balWhilePending = await compOffService.getUserCompOffLedgerBalance(testEmp.id, new Date());
    assert(balWhilePending.netAvailable === netBefore - 1.0, 'netAvailable decreased while request is pending');

    // Admin rejects request
    const { req: rejectReq, res: rejectRes } = createMockReqRes({
      user: adminUser,
      params: { id: leaveToReject.id },
      body: { remarks: 'Insufficient staffing' }
    });
    await leaveController.rejectLeave(rejectReq, rejectRes);
    assert(rejectRes.getStatus() === 200, 'Rejection succeeds');
    assert(rejectRes.getData().status === 'REJECTED', 'Leave status changed to REJECTED');

    // Net available restored immediately
    const balAfterReject = await compOffService.getUserCompOffLedgerBalance(testEmp.id, new Date());
    assert(balAfterReject.netAvailable === netBefore, 'netAvailable restored after rejection (pending reservation released)');

    // Comp-off credit usedDays remains 0
    const creditRejectionFresh = await prisma.compOffCredit.findUnique({ where: { id: creditRejection.id } });
    assert(creditRejectionFresh.usedDays === 0, 'Credit usedDays remains 0 (no deduction occurred)');

    // =========================================================================
    // Test 12 & 13: Approved Leave Cancellation & Idempotent Restoration
    // =========================================================================
    console.log('\n--- Test Group 12 & 13: Approved Leave Cancellation & Idempotency ---');

    // Currently leaveApp1 is APPROVED and consumed 0.5 from credit1.
    // Employee self-cancellation of APPROVED leave must be FORBIDDEN:
    const { req: empCancelReq, res: empCancelRes } = createMockReqRes({
      user: testEmp,
      params: { id: leaveApp1.id }
    });
    await leaveController.cancelLeave(empCancelReq, empCancelRes);
    assert(
      empCancelRes.getStatus() === 400,
      'Employee self-cancellation of approved leave is strictly forbidden (400 Bad Request)'
    );

    // Admin cancellation of APPROVED leave:
    const { req: adminCancelReq, res: adminCancelRes } = createMockReqRes({
      user: adminUser,
      params: { id: leaveApp1.id }
    });
    await leaveController.cancelLeave(adminCancelReq, adminCancelRes);
    assert(adminCancelRes.getStatus() === 200, 'Admin cancellation of approved leave returns 200 OK');
    assert(adminCancelRes.getData().status === 'CANCELLED', 'Leave status changed to CANCELLED');

    // Verify consumption record status updated to RESTORED
    const consumptionsAfterCancel = await prisma.compOffConsumption.findMany({
      where: { leaveRequestId: leaveApp1.id }
    });
    assert(consumptionsAfterCancel[0].status === 'RESTORED', 'Consumption record status marked RESTORED');
    assert(consumptionsAfterCancel[0].restoredById === adminUser.id, 'Restored by records Admin ID');

    // Repeated cancellation attempt must be rejected (idempotency guard)
    const { req: reCancelReq, res: reCancelRes } = createMockReqRes({
      user: adminUser,
      params: { id: leaveApp1.id }
    });
    await leaveController.cancelLeave(reCancelReq, reCancelRes);
    assert(reCancelRes.getStatus() === 400, 'Repeated cancellation of already cancelled leave returns 400');

    // Direct service restoration call idempotency check
    const directRestoreResult = await compOffService.restoreCompOffCreditConsumption({
      leaveRequestId: leaveApp1.id,
      adminUserId: adminUser.id
    });
    assert(directRestoreResult.restoredDays === 0, 'Repeated restore returns 0 days restored (safe & idempotent)');

    // =========================================================================
    // Test 14 & 15: Expired Credits Cannot Be Consumed & Historical Accounting
    // =========================================================================
    console.log('\n--- Test Group 14 & 15: Expiry Boundaries & Partial Credit Preservation ---');

    // Create a credit that is already expired
    const expiredCredit = await createTestCredit({
      days: 1.0,
      daysAgo: 100,
      expiresInDays: -5,
      status: 'APPROVED'
    });

    let consumeExpiredFailed = false;
    let consumeExpiredErrorMsg = '';
    try {
      await compOffService.consumeCompOffCreditsFIFO({
        leaveRequestId: leaveToReject.id,
        userId: testEmp.id,
        daysToConsume: 2.0,
        txClient: prisma
      });
    } catch (err) {
      consumeExpiredFailed = true;
      consumeExpiredErrorMsg = err.message;
    }
    // Since available unexpired credit is only 1.5, attempting to consume 2.0 strictly rejects expired credit
    assert(consumeExpiredFailed, 'Expired credits are strictly excluded from consumption');
    assert(consumeExpiredErrorMsg.includes('Insufficient available Comp-Off credits'), 'Error message confirms expired credits are excluded');

    // Test partial credit expiry preservation:
    // Create a credit with creditDays = 1.0, simulate usedDays = 0.5, availableDays = 0.5, expiresAt in past
    const pastExpiry = new Date();
    pastExpiry.setDate(pastExpiry.getDate() - 1);
    const partialCredit = await prisma.compOffCredit.create({
      data: {
        organizationId: org1.id,
        userId: testEmp.id,
        workDate: new Date('2026-07-01T00:00:00.000Z'),
        creditDays: 1.0,
        usedDays: 0.5,
        availableDays: 0.5,
        earnedAt: new Date('2026-07-01T00:00:00.000Z'),
        expiresAt: pastExpiry,
        status: 'APPROVED',
        reason: 'Partial credit for expiry test',
        claimedByRole: 'ADMIN',
        claimedById: adminUser.id
      }
    });
    createdCreditIds.push(partialCredit.id);

    // =========================================================================
    // Test 16: Safe Idempotent Expiry Processing Engine
    // =========================================================================
    console.log('\n--- Test Group 16: Idempotent Expiry Engine ---');

    const expiryResult1 = await compOffService.processExpiredCompOffCredits({
      organizationId: org1.id
    });
    assert(expiryResult1.expiredCount >= 1, 'processExpiredCompOffCredits transitioned expired credit(s)');

    const partialCreditFresh = await prisma.compOffCredit.findUnique({ where: { id: partialCredit.id } });
    assert(partialCreditFresh.status === 'EXPIRED', 'Partially consumed credit status transitioned to EXPIRED');
    assert(partialCreditFresh.availableDays === 0.0, 'Remaining available days set to 0.0');
    assert(partialCreditFresh.usedDays === 0.5, 'Historical usedDays (0.5) perfectly preserved');
    assert(partialCreditFresh.creditDays === 1.0, 'Historical creditDays (1.0) perfectly preserved');

    // Run again: must be idempotent
    const expiryResult2 = await compOffService.processExpiredCompOffCredits({
      organizationId: org1.id
    });
    assert(expiryResult2.expiredCount === 0, 'Second run does not modify already expired credits (idempotent)');

    // =========================================================================
    // Test 17: Cross-Tenant & Unauthorized Safeguards
    // =========================================================================
    console.log('\n--- Test Group 17: Cross-Tenant & Super Admin Safeguards ---');

    // Create a dedicated Org 1 leave request for security testing
    const crossTenantLeave = await prisma.leaveRequest.create({
      data: {
        userId: testEmp.id,
        startDate: new Date('2026-11-20T00:00:00.000Z'),
        endDate: new Date('2026-11-20T00:00:00.000Z'),
        totalDays: 1.0,
        leaveType: 'COMP_OFF',
        type: 'LEAVE',
        payType: 'PAID',
        reason: 'Cross tenant test',
        status: 'PENDING_ADMIN_APPROVAL',
        adminApprovalStatus: 'PENDING'
      }
    });
    createdLeaveRequestIds.push(crossTenantLeave.id);

    // Org 2 Admin attempts to approve Org 1 leave request
    const { req: crossOrgReq, res: crossOrgRes } = createMockReqRes({
      user: org2Admin,
      params: { id: crossTenantLeave.id },
      body: {}
    });
    await leaveController.approveLeaveAdmin(crossOrgReq, crossOrgRes);
    assert(crossOrgRes.getStatus() === 403, 'Cross-tenant approval attempt returns 403 Forbidden');

    // Super Admin attempts to approve leave request (Super Admin is strictly read-only)
    const { req: saReq, res: saRes } = createMockReqRes({
      user: superAdminUser,
      params: { id: crossTenantLeave.id },
      body: {}
    });
    await leaveController.approveLeaveAdmin(saReq, saRes);
    assert(saRes.getStatus() === 403, 'Super Admin approval attempt returns 403 Forbidden');
    assert(
      saRes.getData().message.includes('Super Admin is strictly read-only'),
      'Message reinforces Super Admin read-only rule'
    );

    // Super Admin attempts to reject leave request
    const { req: saRejReq, res: saRejRes } = createMockReqRes({
      user: superAdminUser,
      params: { id: crossTenantLeave.id },
      body: {}
    });
    await leaveController.rejectLeave(saRejReq, saRejRes);
    assert(saRejRes.getStatus() === 403, 'Super Admin rejection attempt returns 403 Forbidden');

    // =========================================================================
    // Test 18 & 19: Non-Interference with Existing Leave Types & Response Fields
    // =========================================================================
    console.log('\n--- Test Group 18 & 19: Ordinary Leave Types & Balance Compatibility ---');

    const { req: balReq, res: balRes } = createMockReqRes({
      user: testEmp,
      query: { organizationId: org1.id }
    });
    await leaveController.getLeaveBalances(balReq, balRes);
    assert(balRes.getStatus() === 200, 'getLeaveBalances returns 200 OK');
    const balancePayload = balRes.getData();
    assert(Array.isArray(balancePayload.leaveTypes), 'Response contains leaveTypes array');

    const compOffBalType = balancePayload.leaveTypes.find(lt => lt.code === 'COMP_OFF');
    assert(compOffBalType !== undefined, 'COMP_OFF leave type is present in response');
    assert(compOffBalType.allocated === 0, 'UserLeaveBalance.allocated for COMP_OFF is 0 (not added to quota)');
    assert('used' in compOffBalType, 'Response includes standard "used" field');
    assert('pending' in compOffBalType, 'Response includes standard "pending" field');
    assert('available' in compOffBalType, 'Response includes standard "available" field');

    const casualBalType = balancePayload.leaveTypes.find(lt => lt.code === 'CASUAL');
    if (casualBalType) {
      assert('annualDays' in casualBalType, 'Standard CASUAL annualDays preserved');
      assert('allocated' in casualBalType, 'Standard CASUAL allocated preserved');
      assert('available' in casualBalType, 'Standard CASUAL available preserved');
    }

    // Apply for regular CASUAL leave to ensure workflow intact
    const casualDate = new Date();
    casualDate.setDate(casualDate.getDate() + 40);
    while (casualDate.getDay() === 0 || casualDate.getDay() === 6) casualDate.setDate(casualDate.getDate() + 1);
    const casualDateStr = casualDate.toISOString().split('T')[0];

    const { req: casualApplyReq, res: casualApplyRes } = createMockReqRes({
      user: testEmp,
      body: {
        startDate: casualDateStr,
        endDate: casualDateStr,
        leaveType: 'CASUAL',
        reason: 'Casual leave test'
      }
    });
    await leaveController.applyLeave(casualApplyReq, casualApplyRes);
    assert(casualApplyRes.getStatus() === 201, 'Ordinary CASUAL leave application functions normally');
    const casualLeave = casualApplyRes.getData();
    createdLeaveRequestIds.push(casualLeave.id);

  } finally {
    // =========================================================================
    // Teardown & Fixture Cleanup
    // =========================================================================
    console.log('\n--- Teardown: Cleaning Fixtures ---');
    try {
      // 1. Delete Consumptions
      const validLeaveIds = createdLeaveRequestIds.filter(Boolean);
      if (validLeaveIds.length > 0) {
        await prisma.compOffConsumption.deleteMany({
          where: { leaveRequestId: { in: validLeaveIds } }
        });
      }
      // 2. Delete Leave Requests
      if (validLeaveIds.length > 0) {
        await prisma.leaveRequest.deleteMany({
          where: { id: { in: validLeaveIds } }
        });
      }
      // 3. Delete Comp-Off Credits
      if (createdCreditIds.length > 0) {
        await prisma.compOffCredit.deleteMany({
          where: { id: { in: createdCreditIds } }
        });
      }
      // 4. Delete Attendances
      if (createdAttendanceIds.length > 0) {
        await prisma.attendance.deleteMany({
          where: { id: { in: createdAttendanceIds } }
        });
      }
      // 5. Delete Team Members and Teams
      if (createdTeamIds.length > 0) {
        await prisma.teamMember.deleteMany({
          where: { teamId: { in: createdTeamIds } }
        });
        await prisma.team.deleteMany({
          where: { id: { in: createdTeamIds } }
        });
      }
      // 6. Delete User Leave Balances & Users
      if (createdUserIds.length > 0) {
        await prisma.userLeaveBalance.deleteMany({
          where: { userId: { in: createdUserIds } }
        });
        await prisma.notification.deleteMany({
          where: { userId: { in: createdUserIds } }
        });
        await prisma.user.deleteMany({
          where: { id: { in: createdUserIds } }
        });
      }
      console.log('  Cleaned up all Phase 3 test fixtures successfully.');
    } catch (cleanupErr) {
      console.error('  Warning during teardown:', cleanupErr.message);
    }
  }

  console.log('\n================================================================');
  console.log(`  PHASE 3 INTEGRATION TESTS PASSED! (${passedTests} / ${totalTests} assertions passed)`);
  console.log('================================================================\n');
}

runPhase3TestSuite().catch(err => {
  console.error('\nFATAL ERROR in Phase 3 test suite:', err);
  process.exit(1);
});
