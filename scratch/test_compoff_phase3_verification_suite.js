const path = require('path');
module.paths.push(path.resolve(__dirname, '..', 'backend', 'node_modules'));

const prisma = require('../backend/src/utils/db');
const {
  resolveAuthoritativeDailyDurationHours,
  calculateDynamicCompOffCredit,
  verifyAndApproveCompOffSession,
  rejectCompOffSession,
  getCompOffSessions,
  getCompOffPolicySettings,
  getUserCompOffLedgerBalance,
  calculateExpiryDate
} = require('../backend/src/services/compOffService');
const {
  approveCompOffSessionEndpoint,
  rejectCompOffSessionEndpoint
} = require('../backend/src/controllers/compOffController');
const { getTodayZonedDate } = require('../backend/src/utils/attendanceUtils');
const { getEffectiveSettings } = require('../backend/src/utils/settingsResolver');

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

async function runPhase3VerificationTestSuite() {
  console.log('========================================================================');
  console.log('  InnovEity CRM — Comp-Off Phase 3: Dynamic Credit & Admin Verification');
  console.log('========================================================================\n');

  // Load Fixtures
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

  assert(Boolean(org1 && org2 && adminUser && superAdminUser && org2Admin), 'Fixtures loaded successfully');

  // Fixture containers for cleanup
  const createdUserIds = [];
  const createdSessionIds = [];
  const createdCreditIds = [];
  const createdPermissionIds = [];

  const timestamp = Date.now();

  // Helper to create valid session connected to permission request
  async function createTestSession({
    userId,
    organizationId = org1.id,
    workDate,
    loginTime,
    clockOutTime = null,
    durationHours = null,
    status = 'ACTIVE',
    approvalStatus = 'PENDING',
    locationStatus = 'INSIDE',
    flaggedForReview = false,
    locationReason = null
  }) {
    const perm = await prisma.compOffPermissionRequest.create({
      data: {
        organization: { connect: { id: organizationId } },
        user: { connect: { id: userId } },
        workDate,
        holidayType: 'WEEKLY_OFF',
        reason: 'Test advance permission for session',
        status: 'APPROVED',
        approvedBy: { connect: { id: adminUser.id } },
        approvedAt: new Date()
      }
    });
    createdPermissionIds.push(perm.id);

    const session = await prisma.compOffSession.create({
      data: {
        organization: { connect: { id: organizationId } },
        user: { connect: { id: userId } },
        permissionRequest: { connect: { id: perm.id } },
        workDate,
        loginTime,
        clockOutTime,
        durationHours: durationHours !== null ? durationHours : 0.0,
        status,
        approvalStatus,
        locationStatus,
        flaggedForReview,
        locationReason
      }
    });
    createdSessionIds.push(session.id);
    return session;
  }

  try {
    // Create dedicated test employee
    const testEmployee = await prisma.user.create({
      data: {
        name: `Phase 3 Test Employee ${timestamp}`,
        email: `phase3_emp_${timestamp}@test.com`,
        employeeId: `EMP3-${timestamp}`,
        password: 'hashedpassword',
        role: 'EMPLOYEE',
        organizationId: org1.id,
        status: 'ACTIVE'
      }
    });
    createdUserIds.push(testEmployee.id);

    // Create a second test employee for concurrency tests
    const testEmployee2 = await prisma.user.create({
      data: {
        name: `Phase 3 Concurrent Employee ${timestamp}`,
        email: `phase3_emp2_${timestamp}@test.com`,
        employeeId: `EMP3-CONC-${timestamp}`,
        password: 'hashedpassword',
        role: 'EMPLOYEE',
        organizationId: org1.id,
        status: 'ACTIVE'
      }
    });
    createdUserIds.push(testEmployee2.id);

    // Create an employee in Org 2 for cross-tenant testing
    const org2Employee = await prisma.user.create({
      data: {
        name: `Phase 3 Org2 Employee ${timestamp}`,
        email: `phase3_org2_${timestamp}@test.com`,
        employeeId: `EMP3-ORG2-${timestamp}`,
        password: 'hashedpassword',
        role: 'EMPLOYEE',
        organizationId: org2.id,
        status: 'ACTIVE'
      }
    });
    createdUserIds.push(org2Employee.id);

    // -------------------------------------------------------------------------
    // Test Group 1: Dynamic Thresholds with Multiple Daily Working Durations
    // -------------------------------------------------------------------------
    console.log('--- Test Group 1: Dynamic Thresholds with Multiple Daily Working Durations ---');

    // Case 1A: 8.0 hours daily target
    const target8h = 8.0;
    const calc8_below = calculateDynamicCompOffCredit(3.9, target8h);
    assert(calc8_below.eligibleCredit === 0, '8h target: 3.9h (<50%) yields 0 credit');
    assert(calc8_below.isEligible === false, '8h target: 3.9h is marked ineligible');
    assert(calc8_below.thresholdMet === 'BELOW_MINIMUM', '8h target: threshold is BELOW_MINIMUM');

    const calc8_half = calculateDynamicCompOffCredit(4.0, target8h);
    assert(calc8_half.eligibleCredit === 0.5, '8h target: 4.0h (exact 50%) yields 0.5 credit');
    assert(calc8_half.isEligible === true, '8h target: 4.0h is marked eligible');
    assert(calc8_half.thresholdMet === 'HALF_DAY', '8h target: threshold is HALF_DAY');

    const calc8_just_under = calculateDynamicCompOffCredit(7.99, target8h);
    assert(calc8_just_under.eligibleCredit === 0.5, '8h target: 7.99h (just under 100%) yields 0.5 credit');
    assert(calc8_just_under.thresholdMet === 'HALF_DAY', '8h target: threshold is HALF_DAY for 7.99h');

    const calc8_full = calculateDynamicCompOffCredit(8.0, target8h);
    assert(calc8_full.eligibleCredit === 1.0, '8h target: 8.0h (exact 100%) yields 1.0 credit');
    assert(calc8_full.thresholdMet === 'FULL_DAY', '8h target: threshold is FULL_DAY');

    const calc8_over = calculateDynamicCompOffCredit(9.5, target8h);
    assert(calc8_over.eligibleCredit === 1.0, '8h target: 9.5h (>100%) yields 1.0 credit (capped at 1.0)');

    // Case 1B: 7.5 hours daily target
    const target75h = 7.5;
    const calc75_below = calculateDynamicCompOffCredit(3.74, target75h);
    assert(calc75_below.eligibleCredit === 0, '7.5h target: 3.74h (<3.75h) yields 0 credit');

    const calc75_half = calculateDynamicCompOffCredit(3.75, target75h);
    assert(calc75_half.eligibleCredit === 0.5, '7.5h target: 3.75h (exact 50%) yields 0.5 credit');

    const calc75_just_under = calculateDynamicCompOffCredit(7.49, target75h);
    assert(calc75_just_under.eligibleCredit === 0.5, '7.5h target: 7.49h (just under 100%) yields 0.5 credit');

    const calc75_full = calculateDynamicCompOffCredit(7.5, target75h);
    assert(calc75_full.eligibleCredit === 1.0, '7.5h target: 7.5h (exact 100%) yields 1.0 credit');

    // Case 1C: 9.0 hours daily target
    const target9h = 9.0;
    const calc9_below = calculateDynamicCompOffCredit(4.49, target9h);
    assert(calc9_below.eligibleCredit === 0, '9.0h target: 4.49h (<4.5h) yields 0 credit');

    const calc9_half = calculateDynamicCompOffCredit(4.5, target9h);
    assert(calc9_half.eligibleCredit === 0.5, '9.0h target: 4.5h (exact 50%) yields 0.5 credit');

    const calc9_just_under = calculateDynamicCompOffCredit(8.99, target9h);
    assert(calc9_just_under.eligibleCredit === 0.5, '9.0h target: 8.99h (just under 100%) yields 0.5 credit');

    const calc9_full = calculateDynamicCompOffCredit(9.0, target9h);
    assert(calc9_full.eligibleCredit === 1.0, '9.0h target: 9.0h (exact 100%) yields 1.0 credit');

    // Case 1D: Configured daily duration resolution
    const resolvedDuration = await resolveAuthoritativeDailyDurationHours(testEmployee.id, org1.id);
    assert(typeof resolvedDuration === 'number' && resolvedDuration > 0, `Authoritative duration resolved: ${resolvedDuration}h`);

    // -------------------------------------------------------------------------
    // Test Group 2: Boundary Cases: Active or Incomplete Sessions Cannot Be Approved
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 2: Incomplete / Active Sessions Cannot Grant Credit ---');

    // Create an active (incomplete) session
    const workDate1 = new Date(Date.UTC(2026, 9, 11)); // Sunday Oct 11, 2026
    const activeSession = await createTestSession({
      userId: testEmployee.id,
      workDate: workDate1,
      loginTime: new Date('2026-10-11T09:00:00Z'),
      clockOutTime: null,
      durationHours: null,
      status: 'ACTIVE',
      approvalStatus: 'PENDING'
    });

    let activeApprovalError = null;
    try {
      await verifyAndApproveCompOffSession(activeSession.id, adminUser.id, org1.id, 'Approve active session');
    } catch (err) {
      activeApprovalError = err;
    }
    assert(activeApprovalError !== null, 'Attempting to approve an ACTIVE session throws an error');
    assert(activeApprovalError.message.includes('incomplete') || activeApprovalError.message.includes('active'), 'Error explains session is active or incomplete');

    // Verify zero credits exist for active session
    const creditsForActive = await prisma.compOffCredit.count({
      where: { userId: testEmployee.id, workDate: workDate1 }
    });
    assert(creditsForActive === 0, 'Zero credits created for active session');

    // -------------------------------------------------------------------------
    // Test Group 3: Below Minimum Threshold Session (<50%) Grants Zero Credit
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 3: Below Minimum Duration (<50%) Session ---');

    const workDate2 = new Date(Date.UTC(2026, 9, 18)); // Sunday Oct 18, 2026
    const shortSession = await createTestSession({
      userId: testEmployee.id,
      workDate: workDate2,
      loginTime: new Date('2026-10-18T09:00:00Z'),
      clockOutTime: new Date('2026-10-18T11:00:00Z'),
      durationHours: 2.0, // 2h < 50% of 8h
      status: 'COMPLETED',
      approvalStatus: 'PENDING'
    });

    let shortApprovalError = null;
    try {
      await verifyAndApproveCompOffSession(
        shortSession.id,
        adminUser.id,
        org1.id,
        'Approved short session'
      );
    } catch (err) {
      shortApprovalError = err;
    }
    assert(shortApprovalError !== null, 'Approval fails for <50% session');
    assert(shortApprovalError.code === 'BELOW_MINIMUM_DURATION', 'Rejection code is BELOW_MINIMUM_DURATION');
    assert(shortApprovalError.message.includes('below the minimum 50% threshold'), 'Explains below 50% threshold');

    const creditsForShort = await prisma.compOffCredit.count({
      where: { userId: testEmployee.id, workDate: workDate2 }
    });
    assert(creditsForShort === 0, 'Zero credit rows created for session below minimum duration');

    // -------------------------------------------------------------------------
    // Test Group 4: Admin Approval & Half-Day (0.5) Credit Creation
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 4: Admin Approval & Half-Day (0.5) Credit Creation ---');

    const workDate3 = new Date(Date.UTC(2026, 9, 25)); // Sunday Oct 25, 2026
    const halfDaySession = await createTestSession({
      userId: testEmployee.id,
      workDate: workDate3,
      loginTime: new Date('2026-10-25T09:00:00Z'),
      clockOutTime: new Date('2026-10-25T13:30:00Z'),
      durationHours: 4.5, // 4.5h is >= 4.0h and < 8.0h -> 0.5 credit
      status: 'COMPLETED',
      approvalStatus: 'PENDING',
      locationStatus: 'INSIDE',
      flaggedForReview: false
    });

    // Initial check: zero credit before approval
    const preApprovalCredit = await prisma.compOffCredit.count({
      where: { userId: testEmployee.id, workDate: workDate3 }
    });
    assert(preApprovalCredit === 0, 'Zero credit exists BEFORE Admin approval');

    // Admin approves half-day session
    const approvalBeforeDate = new Date();
    const halfDayApprovalResult = await verifyAndApproveCompOffSession(
      halfDaySession.id,
      adminUser.id,
      org1.id,
      'Good work on half-day Comp-Off'
    );
    assert(halfDayApprovalResult.success === true, 'Admin approval succeeds for half-day session');
    assert(halfDayApprovalResult.grantedCredit === 0.5, 'Granted credit is exactly 0.5 day');

    const createdHalfCredit = halfDayApprovalResult.credit;
    createdCreditIds.push(createdHalfCredit.id);

    // Verify session updated in database
    const updatedHalfSession = await prisma.compOffSession.findUnique({
      where: { id: halfDaySession.id }
    });
    assert(updatedHalfSession.approvalStatus === 'APPROVED', 'Session approvalStatus transitioned to APPROVED');
    assert(updatedHalfSession.adminApprovedById === adminUser.id, 'Session records adminApprovedById');
    assert(Number(updatedHalfSession.calculatedCredit) === 0.5, 'Session records calculatedCredit = 0.5');
    assert(updatedHalfSession.creditId === createdHalfCredit.id, 'Session links to created creditId');
    assert(updatedHalfSession.adminRemarks === 'Good work on half-day Comp-Off', 'Session records adminRemarks');

    // Verify credit ledger record
    assert(createdHalfCredit.creditDays === 0.5, 'CompOffCredit has creditDays = 0.5');
    assert(createdHalfCredit.availableDays === 0.5, 'CompOffCredit has availableDays = 0.5');
    assert(createdHalfCredit.status === 'APPROVED', 'CompOffCredit status is APPROVED');
    assert(createdHalfCredit.sessionId === halfDaySession.id, 'CompOffCredit links back to sessionId');

    // -------------------------------------------------------------------------
    // Test Group 5: Expiry Base Date Begins on Grant/Approval Date (90 Days from Approval)
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 5: Expiry Base Date Begins on Grant/Approval Date ---');

    // Check credit.expiresAt:
    const creditExpiresAt = new Date(createdHalfCredit.expiresAt);
    const expectedExpiryFromApproval = calculateExpiryDate(new Date(), 90);
    const expectedExpiryFromWorkDate = calculateExpiryDate(workDate3, 90);

    const diffDaysFromApproval = Math.round(Math.abs(creditExpiresAt - expectedExpiryFromApproval) / (1000 * 60 * 60 * 24));
    console.log(`    Credit expiresAt: ${creditExpiresAt.toISOString()}`);
    console.log(`    Expected from approval: ${expectedExpiryFromApproval.toISOString()}`);
    console.log(`    Expected from workDate: ${expectedExpiryFromWorkDate.toISOString()}`);

    assert(diffDaysFromApproval <= 1, 'Credit expiry date is computed from approval date (90 days from grant), not work date');

    // -------------------------------------------------------------------------
    // Test Group 6: Admin Approval & Full-Day (1.0) Credit Creation
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 6: Admin Approval & Full-Day (1.0) Credit Creation ---');

    const workDate4 = new Date(Date.UTC(2026, 10, 1)); // Sunday Nov 1, 2026
    const fullDaySession = await createTestSession({
      userId: testEmployee.id,
      workDate: workDate4,
      loginTime: new Date('2026-11-01T09:00:00Z'),
      clockOutTime: new Date('2026-11-01T18:30:00Z'),
      durationHours: Math.max(8.5, resolvedDuration + 0.5), // >= 100% of daily duration -> 1.0 credit
      status: 'COMPLETED',
      approvalStatus: 'PENDING',
      locationStatus: 'INSIDE',
      flaggedForReview: false
    });

    const fullDayApprovalResult = await verifyAndApproveCompOffSession(
      fullDaySession.id,
      adminUser.id,
      org1.id,
      'Approved full-day session'
    );
    assert(fullDayApprovalResult.success === true, 'Admin approval succeeds for full-day session');
    assert(fullDayApprovalResult.grantedCredit === 1.0, 'Granted credit is exactly 1.0 day');

    const createdFullCredit = fullDayApprovalResult.credit;
    createdCreditIds.push(createdFullCredit.id);

    assert(createdFullCredit.creditDays === 1.0, 'CompOffCredit has creditDays = 1.0');
    assert(createdFullCredit.availableDays === 1.0, 'CompOffCredit has availableDays = 1.0');
    assert(createdFullCredit.sessionId === fullDaySession.id, 'CompOffCredit links back to sessionId');

    // Check user's cumulative ledger balance
    const userBalance = await getUserCompOffLedgerBalance(testEmployee.id, org1.id);
    assert(userBalance.totalAvailable === 1.5, `User total available balance is 1.5 days (0.5 + 1.0), actual: ${userBalance.totalAvailable}`);

    // -------------------------------------------------------------------------
    // Test Group 7: Duplicate and Concurrent Approvals Create Zero Duplicate Credits
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 7: Duplicate & Concurrent Approval Prevention ---');

    // 7A: Repeated approval call on already approved session
    let repeatApprovalError = null;
    try {
      await verifyAndApproveCompOffSession(fullDaySession.id, adminUser.id, org1.id, 'Duplicate approval attempt');
    } catch (err) {
      repeatApprovalError = err;
    }
    assert(repeatApprovalError !== null, 'Repeat approval on already approved session is rejected');
    assert(repeatApprovalError.message.includes('already been approved'), 'Error explains session has already been approved');

    // Verify credit count for workDate4 remains exactly 1
    const creditCount4 = await prisma.compOffCredit.count({
      where: { userId: testEmployee.id, workDate: workDate4 }
    });
    assert(creditCount4 === 1, 'Exactly 1 CompOffCredit exists for workDate4 after repeat attempt');

    // 7B: Concurrent approvals
    const workDate5 = new Date(Date.UTC(2026, 10, 8)); // Sunday Nov 8, 2026
    const concurrentSession = await createTestSession({
      userId: testEmployee2.id,
      workDate: workDate5,
      loginTime: new Date('2026-11-08T09:00:00Z'),
      clockOutTime: new Date('2026-11-08T18:30:00Z'),
      durationHours: Math.max(8.0, resolvedDuration + 0.5),
      status: 'COMPLETED',
      approvalStatus: 'PENDING'
    });

    const [res1, res2] = await Promise.allSettled([
      verifyAndApproveCompOffSession(concurrentSession.id, adminUser.id, org1.id, 'Concurrent 1'),
      verifyAndApproveCompOffSession(concurrentSession.id, adminUser.id, org1.id, 'Concurrent 2')
    ]);

    const fulfilledCount = [res1, res2].filter(r => r.status === 'fulfilled' && r.value?.success === true).length;
    const rejectedCount = [res1, res2].filter(r => r.status === 'rejected' || r.value?.success === false).length;

    assert(fulfilledCount === 1, `Exactly ONE concurrent approval succeeded (fulfilledCount: ${fulfilledCount})`);
    assert(rejectedCount === 1, `The concurrent race attempt was cleanly rejected (rejectedCount: ${rejectedCount})`);

    const concCreditCount = await prisma.compOffCredit.count({
      where: { userId: testEmployee2.id, workDate: workDate5 }
    });
    assert(concCreditCount === 1, 'Exactly ONE credit row created under concurrent approval race');

    // -------------------------------------------------------------------------
    // Test Group 8: Admin Rejection Workflow
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 8: Admin Rejection Workflow ---');

    const workDate6 = new Date(Date.UTC(2026, 10, 15)); // Sunday Nov 15, 2026
    const rejectSession = await createTestSession({
      userId: testEmployee.id,
      workDate: workDate6,
      loginTime: new Date('2026-11-15T09:00:00Z'),
      clockOutTime: new Date('2026-11-15T18:00:00Z'),
      durationHours: Math.max(8.0, resolvedDuration),
      status: 'COMPLETED',
      approvalStatus: 'PENDING',
      locationStatus: 'OUTSIDE',
      flaggedForReview: true,
      locationReason: 'Remote work'
    });

    // 8A: Rejection without reason fails
    let emptyReasonError = null;
    try {
      await rejectCompOffSession(rejectSession.id, adminUser.id, org1.id, '');
    } catch (err) {
      emptyReasonError = err;
    }
    assert(emptyReasonError !== null, 'Rejection without reason is rejected');
    assert(emptyReasonError.message.includes('valid rejection reason is required'), 'Error explains rejection reason is required');

    // 8B: Valid rejection
    const rejectResult = await rejectCompOffSession(
      rejectSession.id,
      adminUser.id,
      org1.id,
      'Unauthorized remote work location during Comp-Off'
    );
    assert(rejectResult.success === true, 'Rejection succeeds with valid reason');

    const updatedRejectSession = await prisma.compOffSession.findUnique({
      where: { id: rejectSession.id }
    });
    assert(updatedRejectSession.approvalStatus === 'REJECTED', 'Session status is REJECTED');
    assert(updatedRejectSession.rejectionReason === 'Unauthorized remote work location during Comp-Off', 'rejectionReason recorded');
    assert(updatedRejectSession.adminApprovedById === adminUser.id, 'Reviewer admin ID recorded');

    // Verify zero credits created for rejected session
    const creditsForRejected = await prisma.compOffCredit.count({
      where: { userId: testEmployee.id, workDate: workDate6 }
    });
    assert(creditsForRejected === 0, 'Zero credits created for rejected session');

    // -------------------------------------------------------------------------
    // Test Group 9: Role, Tenant & Self-Approval Security Safeguards (HTTP Controllers)
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 9: Security Safeguards (Controller Endpoints) ---');

    const workDate7 = new Date(Date.UTC(2026, 10, 22)); // Sunday Nov 22, 2026
    const securitySession = await createTestSession({
      userId: testEmployee.id,
      workDate: workDate7,
      loginTime: new Date('2026-11-22T09:00:00Z'),
      clockOutTime: new Date('2026-11-22T18:00:00Z'),
      durationHours: Math.max(8.0, resolvedDuration),
      status: 'COMPLETED',
      approvalStatus: 'PENDING'
    });

    // 9A: Super Admin is strictly read-only
    const { req: superReq, res: superRes } = createMockReqRes({
      params: { id: securitySession.id },
      body: { remarks: 'Super Admin approval attempt' },
      user: { id: superAdminUser.id, role: 'SUPER_ADMIN', organizationId: null }
    });
    await approveCompOffSessionEndpoint(superReq, superRes);
    assert(superRes.getStatus() === 403, 'Super Admin approval returns 403 Forbidden');
    assert(superRes.getData()?.message?.includes('read-only'), 'Message explains Super Admin is strictly read-only');

    // 9B: Regular employee cannot approve sessions
    const { req: empReq, res: empRes } = createMockReqRes({
      params: { id: securitySession.id },
      body: { remarks: 'Employee approval attempt' },
      user: { id: testEmployee2.id, role: 'EMPLOYEE', organizationId: org1.id }
    });
    await approveCompOffSessionEndpoint(empReq, empRes);
    assert(empRes.getStatus() === 403, 'Regular employee approval returns 403 Forbidden');

    // 9C: Employee cannot approve their own session
    const { req: selfReq, res: selfRes } = createMockReqRes({
      params: { id: securitySession.id },
      body: { remarks: 'Self approval attempt' },
      user: { id: testEmployee.id, role: 'ADMIN', organizationId: org1.id }
    });
    await approveCompOffSessionEndpoint(selfReq, selfRes);
    assert(selfRes.getStatus() === 403, 'Employee self-approval attempt returns 403 Forbidden');
    assert(selfRes.getData()?.message?.includes('cannot approve their own'), 'Explains cannot approve own session');

    // 9D: Cross-tenant approval attempt
    const { req: crossReq, res: crossRes } = createMockReqRes({
      params: { id: securitySession.id },
      body: { remarks: 'Cross-tenant approval attempt' },
      user: { id: org2Admin.id, role: 'ADMIN', organizationId: org2.id }
    });
    await approveCompOffSessionEndpoint(crossReq, crossRes);
    assert(crossRes.getStatus() === 404 || crossRes.getStatus() === 403, 'Cross-tenant approval returns 403 or 404');

    // -------------------------------------------------------------------------
    // Test Group 10: getCompOffSessions Enrichment & Filtering
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 10: getCompOffSessions Enrichment & Filtering ---');

    const allSessions = await getCompOffSessions({
      user: adminUser,
      organizationId: org1.id,
      filters: {}
    });
    assert(Array.isArray(allSessions.sessions), 'getCompOffSessions returns an array of sessions');
    const enrichedSession = allSessions.sessions.find(s => s.id === halfDaySession.id);
    assert(Boolean(enrichedSession), 'halfDaySession is found in listing');
    assert(typeof enrichedSession.configuredDailyDuration === 'number', 'Session has configuredDailyDuration');
    assert(enrichedSession.calculatedCredit === 0.5, 'Session has calculatedCredit = 0.5');
    assert(enrichedSession.creditEligibility?.thresholdMet === 'HALF_DAY', 'Session has creditEligibility');

    // Filter by approvalStatus: APPROVED
    const approvedOnly = await getCompOffSessions({
      user: adminUser,
      organizationId: org1.id,
      filters: { approvalStatus: 'APPROVED' }
    });
    assert(approvedOnly.sessions.every(s => s.approvalStatus === 'APPROVED'), 'All returned sessions have approvalStatus = APPROVED');

    // Filter by approvalStatus: REJECTED
    const rejectedOnly = await getCompOffSessions({
      user: adminUser,
      organizationId: org1.id,
      filters: { approvalStatus: 'REJECTED' }
    });
    assert(rejectedOnly.sessions.every(s => s.approvalStatus === 'REJECTED'), 'All returned sessions have approvalStatus = REJECTED');

    console.log('\n--- Teardown: Cleaning Phase 3 Test Fixtures ---');
    // Clean up created records
    await prisma.compOffCredit.deleteMany({
      where: { userId: { in: createdUserIds } }
    });
    await prisma.compOffSession.deleteMany({
      where: { userId: { in: createdUserIds } }
    });
    await prisma.compOffPermissionRequest.deleteMany({
      where: { userId: { in: createdUserIds } }
    });
    await prisma.user.deleteMany({
      where: { id: { in: createdUserIds } }
    });
    console.log('Phase 3 test fixtures cleaned up successfully.');

    console.log('\n========================================================================');
    console.log(`  PHASE 3 VERIFICATION TEST SUITE COMPLETED: ${passedTests} / ${totalTests} TESTS PASSED`);
    console.log('========================================================================\n');

  } catch (error) {
    console.error('Test Suite encountered an unhandled error:', error);
    // Cleanup fixtures on failure
    if (createdUserIds.length > 0) {
      await prisma.compOffCredit.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await prisma.compOffSession.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await prisma.compOffPermissionRequest.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
    }
    throw error;
  }
}

runPhase3VerificationTestSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal test failure:', err);
    process.exit(1);
  });
