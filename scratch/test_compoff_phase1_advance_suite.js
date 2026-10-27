const path = require('path');
module.paths.push(path.resolve(__dirname, '..', 'backend', 'node_modules'));

const prisma = require('../backend/src/utils/db');
const {
  validateClaimWindow,
  validateEligibleDay,
  getCompOffPolicySettings,
  updateCompOffPolicySettings,
  createCompOffPermissionRequest,
  getCompOffPermissionRequests,
  reviewCompOffPermissionRequest,
  getEligibleFutureDates,
  getUserCompOffLedgerBalance
} = require('../backend/src/services/compOffService');

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

async function runPhase1AdvanceTestSuite() {
  console.log('========================================================================');
  console.log('  InnovEity CRM — Comp-Off Phase 1: Advance Permission Workflow');
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
  const employee1 = await prisma.user.findFirst({
    where: { role: 'EMPLOYEE', organizationId: org1.id }
  });

  assert(Boolean(org1 && org2 && adminUser && superAdminUser && employee1), 'Fixtures loaded successfully');

  // Setup temporary Team Leader and out-of-team Team Leader for testing
  let testTL = null;
  let testTeam = null;
  let outOfTeamTL = null;
  let org2Employee = null;
  const createdRequestIds = [];

  try {
    testTL = await prisma.user.create({
      data: {
        name: 'Phase1 Test TL',
        email: `phase1_tl_${Date.now()}@test.com`,
        employeeId: `TL1-${Date.now()}`,
        password: 'hashedpassword',
        role: 'TEAM_LEADER',
        organizationId: org1.id,
        status: 'ACTIVE'
      }
    });

    outOfTeamTL = await prisma.user.create({
      data: {
        name: 'Phase1 Out of Team TL',
        email: `phase1_out_tl_${Date.now()}@test.com`,
        employeeId: `OUT1-${Date.now()}`,
        password: 'hashedpassword',
        role: 'TEAM_LEADER',
        organizationId: org1.id,
        status: 'ACTIVE'
      }
    });

    testTeam = await prisma.team.create({
      data: {
        name: `Phase1 Team ${Date.now()}`,
        organizationId: org1.id,
        leaderId: testTL.id,
        members: {
          create: [{ userId: employee1.id }]
        }
      }
    });

    org2Employee = await prisma.user.create({
      data: {
        name: 'Org2 Phase1 Employee',
        email: `org2_p1_${Date.now()}@test.com`,
        employeeId: `EMP2-P1-${Date.now()}`,
        password: 'hashedpassword',
        role: 'EMPLOYEE',
        organizationId: org2.id,
        status: 'ACTIVE'
      }
    });

    // Helper dates relative to today
    const now = new Date();
    // Find next Sunday (strictly in the future)
    const nextSunday = new Date();
    nextSunday.setDate(nextSunday.getDate() + 1);
    while (nextSunday.getUTCDay() !== 0) {
      nextSunday.setDate(nextSunday.getDate() + 1);
    }
    const nextSundayStr = nextSunday.toISOString().split('T')[0];

    // Find next Wednesday (ordinary working day)
    const nextWednesday = new Date();
    nextWednesday.setDate(nextWednesday.getDate() + 1);
    while (nextWednesday.getUTCDay() !== 3) {
      nextWednesday.setDate(nextWednesday.getDate() + 1);
    }
    const nextWednesdayStr = nextWednesday.toISOString().split('T')[0];

    // -------------------------------------------------------------
    // Test Group 1: Eligible Future Dates Scanning
    // -------------------------------------------------------------
    console.log('--- Test Group 1: Scanning Eligible Future Dates ---');
    const futureDates = await getEligibleFutureDates({
      userId: employee1.id,
      organizationId: org1.id,
      daysAhead: 30
    });
    assert(Array.isArray(futureDates), 'getEligibleFutureDates returns an array');
    assert(futureDates.length > 0, 'Found at least one eligible off-day in next 30 days');
    const sundayFound = futureDates.find(d => d.date === nextSundayStr);
    assert(Boolean(sundayFound), `Next Sunday (${nextSundayStr}) is listed in eligible future dates`);
    assert(sundayFound?.holidayType === 'WEEKLY_OFF', 'Next Sunday identified as WEEKLY_OFF');
    const wednesdayFound = futureDates.find(d => d.date === nextWednesdayStr);
    assert(!wednesdayFound, `Ordinary Wednesday (${nextWednesdayStr}) is NOT in eligible dates list`);

    // -------------------------------------------------------------
    // Test Group 2: Advance Permission Request Creation & Validation
    // -------------------------------------------------------------
    console.log('\n--- Test Group 2: Advance Permission Request Creation & Validation ---');

    // 1. Employee creates a valid request for future Sunday
    const validReq = await createCompOffPermissionRequest({
      organizationId: org1.id,
      userId: employee1.id,
      workDate: nextSundayStr,
      reason: 'Critical database server migration during scheduled weekly maintenance window.'
    });
    createdRequestIds.push(validReq.id);
    assert(validReq.id !== undefined, 'Advance permission request created successfully');
    assert(validReq.status === 'PENDING', 'Request status is PENDING');
    assert(validReq.holidayType === 'WEEKLY_OFF', 'holidayType is WEEKLY_OFF');
    assert(validReq.userId === employee1.id, 'userId matches employee');

    // 2. Reject request for past date or today
    let pastCaught = false;
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      await createCompOffPermissionRequest({
        organizationId: org1.id,
        userId: employee1.id,
        workDate: yesterday.toISOString().split('T')[0],
        reason: 'Attempting to request for past date'
      });
    } catch (err) {
      pastCaught = true;
      assert(err.message.includes('future dates'), 'Past date request rejected with clear message');
    }
    assert(pastCaught, 'Request for past date is rejected');

    // 3. Reject request for ordinary working day
    let wedCaught = false;
    try {
      await createCompOffPermissionRequest({
        organizationId: org1.id,
        userId: employee1.id,
        workDate: nextWednesdayStr,
        reason: 'Attempting to request on Wednesday working day'
      });
    } catch (err) {
      wedCaught = true;
      assert(err.message.includes('ordinary scheduled working day') || err.message.includes('regular scheduled working day'), 'Ordinary working day rejected with explanation');
    }
    assert(wedCaught, 'Request for ordinary working day is rejected');

    // 4. Duplicate request prevention for same employee and date
    let dupCaught = false;
    try {
      await createCompOffPermissionRequest({
        organizationId: org1.id,
        userId: employee1.id,
        workDate: nextSundayStr,
        reason: 'Duplicate request on same Sunday'
      });
    } catch (err) {
      dupCaught = true;
      assert(err.statusCode === 409 || err.message.includes('already pending'), 'Duplicate request returns 409 Conflict');
    }
    assert(dupCaught, 'Duplicate advance permission request is blocked');

    // -------------------------------------------------------------
    // Test Group 3: Scoping, Listing & Access Boundaries
    // -------------------------------------------------------------
    console.log('\n--- Test Group 3: Scoping & Listing Boundaries ---');

    // 1. Employee only sees their own requests
    const empListing = await getCompOffPermissionRequests({
      organizationId: org1.id,
      userRole: 'EMPLOYEE',
      currentUserId: employee1.id
    });
    assert(empListing.requests.every(r => r.userId === employee1.id), 'Employee only sees their own permission requests');
    assert(empListing.requests.some(r => r.id === validReq.id), 'Employee can see their pending request');

    // 2. Team Leader can view team member requests
    const tlListing = await getCompOffPermissionRequests({
      organizationId: org1.id,
      userRole: 'TEAM_LEADER',
      currentUserId: testTL.id
    });
    assert(tlListing.requests.some(r => r.id === validReq.id), 'Team Leader can view assigned team member request');

    // 3. Out-of-team Team Leader blocked from targeted user request
    let outTLBlocked = false;
    try {
      await getCompOffPermissionRequests({
        organizationId: org1.id,
        userRole: 'TEAM_LEADER',
        currentUserId: outOfTeamTL.id,
        targetUserId: employee1.id
      });
    } catch (err) {
      outTLBlocked = true;
      assert(err.statusCode === 403, 'Out-of-team TL blocked with 403');
    }
    assert(outTLBlocked, 'Out-of-team TL cannot access out-of-team employee requests');

    // 4. Tenant Isolation: Org2 cannot view Org1 requests
    const org2Listing = await getCompOffPermissionRequests({
      organizationId: org2.id,
      userRole: 'ADMIN',
      currentUserId: org2Employee.id
    });
    assert(!org2Listing.requests.some(r => r.id === validReq.id), 'Cross-tenant request access strictly excluded');

    // -------------------------------------------------------------
    // Test Group 4: Super Admin & Role Safeguards
    // -------------------------------------------------------------
    console.log('\n--- Test Group 4: Super Admin & Self-Approval Safeguards ---');

    // 1. Super Admin is strictly read-only
    let saBlocked = false;
    try {
      await reviewCompOffPermissionRequest({
        requestId: validReq.id,
        reviewerUser: superAdminUser,
        action: 'APPROVE',
        organizationId: org1.id
      });
    } catch (err) {
      saBlocked = true;
      assert(err.statusCode === 403 && err.message.includes('strictly read-only'), 'Super Admin approval attempt rejected with 403');
    }
    assert(saBlocked, 'Super Admin is forbidden from approving requests');

    // 2. Employee cannot approve requests
    let empApproveBlocked = false;
    try {
      await reviewCompOffPermissionRequest({
        requestId: validReq.id,
        reviewerUser: employee1,
        action: 'APPROVE',
        organizationId: org1.id
      });
    } catch (err) {
      empApproveBlocked = true;
      assert(err.statusCode === 403, 'Regular employee review rejected with 403');
    }
    assert(empApproveBlocked, 'Employees cannot approve requests');

    // -------------------------------------------------------------
    // Test Group 5: Admin Approval Workflow & Zero Credit Grant
    // -------------------------------------------------------------
    console.log('\n--- Test Group 5: Admin Approval & Zero Credit Verification ---');

    // Check pre-approval Comp-Off ledger balance for employee1
    const preBalance = await getUserCompOffLedgerBalance(employee1.id);
    const preCreditCount = await prisma.compOffCredit.count({
      where: { userId: employee1.id }
    });

    // Admin approves the advance request
    const approvedReq = await reviewCompOffPermissionRequest({
      requestId: validReq.id,
      reviewerUser: adminUser,
      action: 'APPROVE',
      remarks: 'Permission granted by Admin for upcoming migration work.',
      organizationId: org1.id
    });

    assert(approvedReq.status === 'APPROVED', 'Request status transitioned to APPROVED');
    assert(approvedReq.approvedById === adminUser.id, 'approvedById records Admin ID');
    assert(approvedReq.approvedAt !== null, 'approvedAt records approval timestamp');
    assert(approvedReq.adminRemarks.includes('migration work'), 'adminRemarks preserved');

    // CRITICAL REQUIREMENT: Advance permission approval MUST NOT create a Comp-Off credit!
    const postCreditCount = await prisma.compOffCredit.count({
      where: { userId: employee1.id }
    });
    assert(postCreditCount === preCreditCount, 'Zero CompOffCredit rows created upon advance permission approval');

    const postBalance = await getUserCompOffLedgerBalance(employee1.id);
    assert(postBalance.totalAvailable === preBalance.totalAvailable, 'Available Comp-Off ledger balance remains UNCHANGED');
    assert(postBalance.totalEarned === preBalance.totalEarned, 'Total earned Comp-Off days remains UNCHANGED');

    // Duplicate approval attempt rejected
    let repeatApproveCaught = false;
    try {
      await reviewCompOffPermissionRequest({
        requestId: validReq.id,
        reviewerUser: adminUser,
        action: 'APPROVE',
        organizationId: org1.id
      });
    } catch (err) {
      repeatApproveCaught = true;
      assert(err.statusCode === 400 && err.message.includes('already been approved'), 'Repeat approval rejected with 400');
    }
    assert(repeatApproveCaught, 'Repeat approval on already approved request is blocked');

    // -------------------------------------------------------------
    // Test Group 6: Admin Rejection Workflow
    // -------------------------------------------------------------
    console.log('\n--- Test Group 6: Admin Rejection Workflow ---');

    // Find next-next Sunday for rejection test
    const nextNextSunday = new Date(nextSunday.getTime() + 7 * 24 * 60 * 60 * 1000);
    const nextNextSundayStr = nextNextSunday.toISOString().split('T')[0];

    const reqToReject = await createCompOffPermissionRequest({
      organizationId: org1.id,
      userId: employee1.id,
      workDate: nextNextSundayStr,
      reason: 'Requesting permission to work on future Sunday for documentation.'
    });
    createdRequestIds.push(reqToReject.id);

    // Rejection without reason fails
    let emptyReasonBlocked = false;
    try {
      await reviewCompOffPermissionRequest({
        requestId: reqToReject.id,
        reviewerUser: adminUser,
        action: 'REJECT',
        rejectionReason: '',
        organizationId: org1.id
      });
    } catch (err) {
      emptyReasonBlocked = true;
      assert(err.statusCode === 400 && err.message.includes('rejection reason'), 'Rejection without reason is rejected with 400');
    }
    assert(emptyReasonBlocked, 'Admin rejection requires mandatory rejection reason');

    // Rejection with reason succeeds
    const rejectedReq = await reviewCompOffPermissionRequest({
      requestId: reqToReject.id,
      reviewerUser: adminUser,
      action: 'REJECT',
      rejectionReason: 'Adequate documentation can be completed during regular working hours.',
      organizationId: org1.id
    });

    assert(rejectedReq.status === 'REJECTED', 'Request status transitioned to REJECTED');
    assert(rejectedReq.rejectionReason.includes('regular working hours'), 'Rejection reason is recorded');
    assert(rejectedReq.approvedById === adminUser.id, 'Reviewer ID recorded');

    // -------------------------------------------------------------
    // Test Group 7: Configurable 30-Day Retrospective Claim Rule
    // -------------------------------------------------------------
    console.log('\n--- Test Group 7: Configurable 30-Day Retrospective Claim Rule ---');

    // 1. Verify default policy: claimWindowEnabled is true
    const currentPolicy = await getCompOffPolicySettings(org1.id);
    assert(currentPolicy.claimWindowEnabled === true, 'Default policy has claimWindowEnabled = true');
    assert(currentPolicy.claimWindowDays === 30, 'Default retrospective claim window is 30 days');

    // 2. Evaluate claim for work completed 35 days ago (should FAIL when enabled)
    const work35DaysAgo = new Date();
    work35DaysAgo.setDate(work35DaysAgo.getDate() - 35);
    const checkWhenEnabled = validateClaimWindow(work35DaysAgo, currentPolicy.claimWindowDays, new Date(), currentPolicy.claimWindowEnabled);
    assert(checkWhenEnabled.isValid === false, 'Claim 35 days ago is REJECTED when rule is enabled');
    assert(checkWhenEnabled.error.includes('Claim window expired'), 'Explanation provided for expired window');

    // 3. Disable the retrospective rule
    const disabledPolicy = await updateCompOffPolicySettings({
      organizationId: org1.id,
      claimWindowEnabled: false
    });
    assert(disabledPolicy.claimWindowEnabled === false, 'claimWindowEnabled successfully updated to false');

    // 4. Evaluate claim for work completed 35 days ago (should SUCCEED when disabled)
    const checkWhenDisabled = validateClaimWindow(work35DaysAgo, disabledPolicy.claimWindowDays, new Date(), disabledPolicy.claimWindowEnabled);
    assert(checkWhenDisabled.isValid === true, 'Claim 35 days ago is ACCEPTED when rule is disabled (no retrospective cutoff)');
    assert(checkWhenDisabled.claimWindowEnabled === false, 'Validation response notes claimWindowEnabled = false');

    // 5. Verify future date claim in validateClaimWindow is ALWAYS blocked even if retrospective rule is disabled
    const futureCheck = validateClaimWindow(nextSunday, disabledPolicy.claimWindowDays, new Date(), disabledPolicy.claimWindowEnabled);
    assert(futureCheck.isValid === false, 'Future date is ALWAYS rejected for retrospective claims (belongs to Advance Permission workflow)');

    // 6. Restore policy back to enabled for clean test isolation
    await updateCompOffPolicySettings({
      organizationId: org1.id,
      claimWindowEnabled: true,
      claimWindowDays: 30
    });
    const restoredPolicy = await getCompOffPolicySettings(org1.id);
    assert(restoredPolicy.claimWindowEnabled === true, 'Policy cleanly restored to claimWindowEnabled = true');

  } finally {
    console.log('\n--- Teardown: Cleaning Phase 1 Fixtures ---');
    if (createdRequestIds.length > 0) {
      await prisma.compOffPermissionRequest.deleteMany({
        where: { id: { in: createdRequestIds } }
      });
    }
    if (testTeam) {
      await prisma.teamMember.deleteMany({ where: { teamId: testTeam.id } });
      await prisma.team.delete({ where: { id: testTeam.id } });
    }
    if (testTL) await prisma.user.delete({ where: { id: testTL.id } });
    if (outOfTeamTL) await prisma.user.delete({ where: { id: outOfTeamTL.id } });
    if (org2Employee) await prisma.user.delete({ where: { id: org2Employee.id } });
    console.log('Phase 1 test fixtures cleaned up successfully.');
  }

  console.log('\n========================================================================');
  console.log(`  PHASE 1 ADVANCE TEST SUITE COMPLETED: ${passedTests} / ${totalTests} TESTS PASSED`);
  console.log('========================================================================\n');
}

runPhase1AdvanceTestSuite().catch(err => {
  console.error('FATAL ERROR in Phase 1 test suite:', err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
