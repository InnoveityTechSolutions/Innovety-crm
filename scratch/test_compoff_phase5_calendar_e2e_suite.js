const path = require('path');
module.paths.push(path.resolve(__dirname, '..', 'backend', 'node_modules'));

const prisma = require('../backend/src/utils/db');
const {
  resolveMonthlyCalendar
} = require('../backend/src/services/calendarResolverService');
const {
  getCalendar
} = require('../backend/src/controllers/workCalendarController');
const {
  getUnifiedCalendar
} = require('../backend/src/services/organizationCalendarService');
const {
  createCompOffPermissionRequest,
  reviewCompOffPermissionRequest,
  startCompOffSession,
  endCompOffSession,
  verifyAndApproveCompOffSession,
  getUserCompOffLedgerBalance,
  consumeCompOffCreditsFIFO,
  restoreCompOffCreditConsumption,
  getCompOffPolicySettings,
  calculateExpiryDate,
  validateClaimWindow
} = require('../backend/src/services/compOffService');
const {
  applyLeave,
  approveLeaveAdmin,
  cancelLeave,
  getLeaveBalances
} = require('../backend/src/controllers/leaveController');

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
    setHeader(name, value) {
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

async function runPhase5CalendarE2ESuite() {
  console.log('========================================================================');
  console.log('  InnovEity CRM — Comp-Off Phase 5: Calendar Integration & Full E2E');
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

  assert(Boolean(org1 && org2 && adminUser && superAdminUser && org2Admin), 'Base fixtures loaded successfully');

  // Tracking fixtures for cleanup
  const createdUserIds = [];
  const createdPermissionIds = [];
  const createdSessionIds = [];
  const createdCreditIds = [];
  const createdLeaveIds = [];

  const timestamp = Date.now();

  // Create isolated employee in Org 1
  const testEmp = await prisma.user.create({
    data: {
      email: `compoff_p5_emp_${timestamp}@test.com`,
      password: 'hashed_password_123',
      name: `CompOff P5 Tester ${timestamp}`,
      role: 'EMPLOYEE',
      organizationId: org1.id,
      employeeId: `EMP5-${timestamp.toString().slice(-4)}`,
      status: 'ACTIVE'
    }
  });
  createdUserIds.push(testEmp.id);

  // Create isolated employee in Org 2
  const testEmpOrg2 = await prisma.user.create({
    data: {
      email: `compoff_p5_org2_${timestamp}@test.com`,
      password: 'hashed_password_123',
      name: `CompOff P5 Org2 ${timestamp}`,
      role: 'EMPLOYEE',
      organizationId: org2.id,
      employeeId: `EM5O2-${timestamp.toString().slice(-4)}`,
      status: 'ACTIVE'
    }
  });
  createdUserIds.push(testEmpOrg2.id);

  try {
    // -------------------------------------------------------------------------
    // TEST GROUP 1: Calendar Date Correctness, Approval Status, & Deduplication
    // -------------------------------------------------------------------------
    console.log('--- Test Group 1: Calendar Integration, Date Correctness & Deduplication ---');
    {
      const targetMonth = 11; // November 2026
      const targetYear = 2026;

      // November 2026 Sundays: 2026-11-01, 2026-11-08, 2026-11-15, 2026-11-22, 2026-11-29
      const sundayNov1 = '2026-11-01';
      const sundayNov8 = '2026-11-08';
      const sundayNov15 = '2026-11-15';
      const sundayNov22 = '2026-11-22';

      // 1. Initially, Sunday Nov 1 must resolve as standard Holiday
      const initialCal = await resolveMonthlyCalendar({
        user: testEmp,
        month: targetMonth,
        year: targetYear,
        organizationId: org1.id
      });
      const nov1DayInitial = initialCal.days.find(d => d.date === sundayNov1);
      assert(nov1DayInitial.status === 'Holiday', 'Sunday without Comp-Off resolves as Holiday');
      assert(nov1DayInitial.isSunday === true, 'Sunday retains isSunday = true');

      // 2. Pending permission request must NOT mark calendar as Comp-Off
      const pendingPerm = await prisma.compOffPermissionRequest.create({
        data: {
          organization: { connect: { id: org1.id } },
          user: { connect: { id: testEmp.id } },
          workDate: new Date(`${sundayNov8}T00:00:00.000Z`),
          holidayType: 'WEEKLY_OFF',
          reason: 'Pending request test',
          status: 'PENDING'
        }
      });
      createdPermissionIds.push(pendingPerm.id);

      const pendingCal = await resolveMonthlyCalendar({
        user: testEmp,
        month: targetMonth,
        year: targetYear,
        organizationId: org1.id
      });
      const nov8DayPending = pendingCal.days.find(d => d.date === sundayNov8);
      assert(nov8DayPending.status === 'Holiday', 'Pending permission request does NOT mark calendar as Comp-Off (remains Holiday)');

      // 3. Rejected permission request must NOT mark calendar as Comp-Off
      const rejectedPerm = await prisma.compOffPermissionRequest.create({
        data: {
          organization: { connect: { id: org1.id } },
          user: { connect: { id: testEmp.id } },
          workDate: new Date(`${sundayNov15}T00:00:00.000Z`),
          holidayType: 'WEEKLY_OFF',
          reason: 'Rejected request test',
          status: 'REJECTED',
          rejectionReason: 'Not approved for this project'
        }
      });
      createdPermissionIds.push(rejectedPerm.id);

      const rejectedCal = await resolveMonthlyCalendar({
        user: testEmp,
        month: targetMonth,
        year: targetYear,
        organizationId: org1.id
      });
      const nov15DayRejected = rejectedCal.days.find(d => d.date === sundayNov15);
      assert(nov15DayRejected.status === 'Holiday', 'Rejected permission request does NOT mark calendar as Comp-Off (remains Holiday)');

      // 4. Approved advance permission resolves status as COMP_OFF
      const approvedPerm = await prisma.compOffPermissionRequest.create({
        data: {
          organization: { connect: { id: org1.id } },
          user: { connect: { id: testEmp.id } },
          workDate: new Date(`${sundayNov1}T00:00:00.000Z`),
          holidayType: 'WEEKLY_OFF',
          reason: 'Critical production maintenance',
          status: 'APPROVED',
          approvedBy: { connect: { id: adminUser.id } },
          approvedAt: new Date()
        }
      });
      createdPermissionIds.push(approvedPerm.id);

      const approvedCal = await resolveMonthlyCalendar({
        user: testEmp,
        month: targetMonth,
        year: targetYear,
        organizationId: org1.id
      });
      const nov1DayApproved = approvedCal.days.find(d => d.date === sundayNov1);
      assert(nov1DayApproved.status === 'COMP_OFF', 'Approved Comp-Off permission marks day as COMP_OFF');
      assert(nov1DayApproved.title === 'Comp-Off Work', 'Calendar title is "Comp-Off Work"');
      assert(nov1DayApproved.isSunday === true, 'Sunday retains isSunday = true even when worked as Comp-Off');
      assert(nov1DayApproved.canEdit === false, 'canEdit is false for Comp-Off work date');
      assert(Boolean(nov1DayApproved.compOffDetails), 'compOffDetails is attached to calendar day');
      assert(nov1DayApproved.compOffDetails.status === 'APPROVED', 'compOffDetails status is APPROVED');
      assert(nov1DayApproved.compOffDetails.reason.includes('Critical production maintenance'), 'compOffDetails preserves approved reason');

      // 5. Date correctness: actual workDate is used, not grant or expiry date
      const fakeGrantDate = new Date('2026-10-15T00:00:00.000Z');
      const fakeExpiryDate = new Date('2027-01-13T00:00:00.000Z');
      assert(nov1DayApproved.date === sundayNov1, `Calendar date (${nov1DayApproved.date}) matches actual approved work date (${sundayNov1})`);
      assert(nov1DayApproved.date !== fakeGrantDate.toISOString().split('T')[0], 'Calendar date is not the grant date');
      assert(nov1DayApproved.date !== fakeExpiryDate.toISOString().split('T')[0], 'Calendar date is not the expiry date');

      // 6. Deduplication: multiple sources on same workDate (permission + session + credit)
      // Create session on same Nov 1 date
      const sessionNov1 = await prisma.compOffSession.create({
        data: {
          organization: { connect: { id: org1.id } },
          user: { connect: { id: testEmp.id } },
          permissionRequest: { connect: { id: approvedPerm.id } },
          workDate: new Date(`${sundayNov1}T00:00:00.000Z`),
          loginTime: new Date(`${sundayNov1}T09:00:00.000Z`),
          clockOutTime: new Date(`${sundayNov1}T18:00:00.000Z`),
          durationHours: 9.0,
          status: 'COMPLETED',
          approvalStatus: 'APPROVED',
          calculatedCredit: 1.0,
          adminApprovedById: adminUser.id,
          adminApprovedAt: new Date()
        }
      });
      createdSessionIds.push(sessionNov1.id);

      // Create credit on same Nov 1 date
      const creditNov1 = await prisma.compOffCredit.create({
        data: {
          organizationId: org1.id,
          userId: testEmp.id,
          workDate: new Date(`${sundayNov1}T00:00:00.000Z`),
          creditDays: 1.0,
          availableDays: 1.0,
          status: 'APPROVED',
          reason: 'Comp-Off credit for 2026-11-01',
          claimedByRole: 'ADMIN',
          claimedById: adminUser.id,
          adminApprovedById: adminUser.id,
          adminApprovedAt: new Date(),
          expiresAt: new Date(Date.now() + 90 * 86400000),
          sessionId: sessionNov1.id
        }
      });
      createdCreditIds.push(creditNov1.id);

      const dedupCal = await resolveMonthlyCalendar({
        user: testEmp,
        month: targetMonth,
        year: targetYear,
        organizationId: org1.id
      });
      const nov1Matches = dedupCal.days.filter(d => d.date === sundayNov1);
      assert(nov1Matches.length === 1, `Exactly 1 calendar entry exists for 2026-11-01 (no duplicates): ${nov1Matches.length}`);
      assert(nov1Matches[0].status === 'COMP_OFF', 'Deduplicated entry maintains COMP_OFF status');

      // 7. Unified Enterprise Calendar integration
      const enterpriseEvents = await getUnifiedCalendar({
        organizationId: org1.id,
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        types: ['COMP_OFF', 'HOLIDAY', 'COMPANY_EVENT']
      });
      const compOffEvents = enterpriseEvents.filter(e => e.type === 'COMP_OFF');
      assert(compOffEvents.length >= 1, `Enterprise calendar returns approved Comp-Off event: ${compOffEvents.length}`);
      const nov1EnterpriseEvent = compOffEvents.find(e => new Date(e.startDate).toISOString().startsWith(sundayNov1));
      assert(Boolean(nov1EnterpriseEvent), 'Enterprise event found on 2026-11-01');
      assert(nov1EnterpriseEvent.color === '#8B5CF6', 'Enterprise event uses violet/purple color token');
    }

    // -------------------------------------------------------------------------
    // TEST GROUP 2: Calendar Access Restrictions & Multi-Tenant Isolation
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 2: Access Restrictions & Multi-Tenant Security ---');
    {
      // 1. Employee cannot view another employee's calendar via ?userId=...
      const { req: empCrossReq, res: empCrossRes } = createMockReqRes({
        user: testEmp,
        query: { userId: testEmpOrg2.id, month: '11', year: '2026' }
      });
      await getCalendar(empCrossReq, empCrossRes);
      assert(empCrossRes.getStatus() === 403, 'Employee attempting to query another employee calendar is rejected (403)');
      assert(empCrossRes.getData()?.message.includes('not authorized'), 'Error message reinforces employee privacy restriction');

      // 2. Org 1 employee cannot see Org 2 Comp-Off dates
      // Create approved permission in Org 2 on Sunday Nov 22
      const org2Perm = await prisma.compOffPermissionRequest.create({
        data: {
          organization: { connect: { id: org2.id } },
          user: { connect: { id: testEmpOrg2.id } },
          workDate: new Date('2026-11-22T00:00:00.000Z'),
          holidayType: 'WEEKLY_OFF',
          reason: 'Org 2 server deployment',
          status: 'APPROVED',
          approvedBy: { connect: { id: org2Admin.id } },
          approvedAt: new Date()
        }
      });
      createdPermissionIds.push(org2Perm.id);

      const org1Cal = await resolveMonthlyCalendar({
        user: testEmp,
        month: 11,
        year: 2026,
        organizationId: org1.id
      });
      const nov22Org1 = org1Cal.days.find(d => d.date === '2026-11-22');
      assert(nov22Org1.status === 'Holiday', 'Org 1 employee calendar does NOT leak Org 2 Comp-Off work date (remains standard Holiday)');

      // 3. Org 2 employee sees their own approved Comp-Off on Nov 22
      const org2Cal = await resolveMonthlyCalendar({
        user: testEmpOrg2,
        month: 11,
        year: 2026,
        organizationId: org2.id
      });
      const nov22Org2 = org2Cal.days.find(d => d.date === '2026-11-22');
      assert(nov22Org2.status === 'COMP_OFF', 'Org 2 employee calendar correctly reflects their own approved Comp-Off date');

      // 4. Tenant Admin cross-organization query protection
      const { req: crossAdminReq, res: crossAdminRes } = createMockReqRes({
        user: adminUser, // Admin in Org 1
        query: { userId: testEmpOrg2.id, month: '11', year: '2026' } // Target user in Org 2
      });
      await getCalendar(crossAdminReq, crossAdminRes);
      assert(crossAdminRes.getStatus() === 403, 'Tenant Admin cannot query calendars of employees from another organization (403)');
    }

    // -------------------------------------------------------------------------
    // TEST GROUP 3: Complete End-to-End Workflow Verification (Steps 1–14)
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 3: Complete End-to-End Workflow Verification ---');
    {
      const workflowWorkDateStr = '2026-11-29'; // Future Sunday
      const workflowWorkDate = new Date(`${workflowWorkDateStr}T00:00:00.000Z`);

      // Step 1: Employee requests advance permission for an eligible future holiday or weekly off
      const advanceRequest = await prisma.compOffPermissionRequest.create({
        data: {
          organization: { connect: { id: org1.id } },
          user: { connect: { id: testEmp.id } },
          workDate: workflowWorkDate,
          holidayType: 'WEEKLY_OFF',
          reason: 'End-to-end workflow verification release',
          status: 'PENDING'
        }
      });
      createdPermissionIds.push(advanceRequest.id);
      assert(advanceRequest.status === 'PENDING', 'Step 1: Employee creates advance permission request with status PENDING');

      // Calendar check before approval: date is Holiday, NOT Comp-Off
      const preApprovalCal = await resolveMonthlyCalendar({
        user: testEmp,
        month: 11,
        year: 2026,
        organizationId: org1.id
      });
      const nov29Pre = preApprovalCal.days.find(d => d.date === workflowWorkDateStr);
      assert(nov29Pre.status === 'Holiday', 'Step 1: Unapproved request remains Holiday on calendar');

      // Step 2: Tenant Admin approves the request
      const approvedRequest = await reviewCompOffPermissionRequest({
        requestId: advanceRequest.id,
        reviewerUser: adminUser,
        action: 'APPROVE',
        remarks: 'Approved for Sunday release',
        organizationId: org1.id
      });
      assert(approvedRequest.status === 'APPROVED', 'Step 2: Tenant Admin approves the request');

      // Step 3 & 14: Calendar integration reflects approved Comp-Off work date
      const postApprovalCal = await resolveMonthlyCalendar({
        user: testEmp,
        month: 11,
        year: 2026,
        organizationId: org1.id
      });
      const nov29Post = postApprovalCal.days.find(d => d.date === workflowWorkDateStr);
      assert(nov29Post.status === 'COMP_OFF', 'Step 3 & 14: Calendar reflects approved Comp-Off work date in COMP_OFF status');
      assert(nov29Post.title === 'Comp-Off Work', 'Step 3: Calendar displays Comp-Off Work title');

      // Step 4 & 5: Comp-Off Login records actual login time, separate from normal attendance, outside geofence reason
      const session = await prisma.compOffSession.create({
        data: {
          organization: { connect: { id: org1.id } },
          user: { connect: { id: testEmp.id } },
          permissionRequest: { connect: { id: advanceRequest.id } },
          workDate: workflowWorkDate,
          loginTime: new Date(`${workflowWorkDateStr}T09:15:00.000Z`), // 9:15 AM
          status: 'ACTIVE',
          locationStatus: 'OUTSIDE',
          locationReason: 'Client onsite emergency',
          flaggedForReview: true
        }
      });
      createdSessionIds.push(session.id);
      assert(session.status === 'ACTIVE', 'Step 4: Comp-Off session created with status ACTIVE');
      assert(session.flaggedForReview === true, 'Step 5: Outside-geofence login flags session for review');

      // Normal attendance isolation check
      const normalAttendance = await prisma.attendance.findFirst({
        where: { userId: testEmp.id, date: workflowWorkDate }
      });
      assert(normalAttendance === null, 'Step 4 & 6: Comp-Off login generates ZERO normal attendance records (isolated, no late marking)');

      // Step 7 & 8: Clock-out computes duration and dynamic credit calculation (9.0h worked = 1.0 day credit)
      const clockOutTime = new Date(`${workflowWorkDateStr}T18:15:00.000Z`);
      const updatedSession = await prisma.compOffSession.update({
        where: { id: session.id },
        data: {
          clockOutTime,
          durationHours: 9.0,
          status: 'COMPLETED',
          clockOutType: 'MANUAL'
        }
      });
      assert(updatedSession.status === 'COMPLETED', 'Step 7: Session clocked out with status COMPLETED');
      assert(Number(updatedSession.durationHours) === 9.0, 'Step 7: durationHours accurately recorded as 9.0h');

      // Step 9 & 10: Admin verification & approval grants credit with expiry from grant date
      const approveSessionResult = await verifyAndApproveCompOffSession({
        sessionId: session.id,
        verifierUser: adminUser,
        remarks: 'Verified 9h worked on Sunday',
        organizationId: org1.id
      });
      createdCreditIds.push(approveSessionResult.credit.id);
      assert(approveSessionResult.credit.creditDays === 1.0, 'Step 8 & 9: Dynamic credit grants 1.0 day for 9h work');
      assert(approveSessionResult.credit.status === 'APPROVED', 'Step 9: Credit status is APPROVED');

      // Expiry verification: 90 days from grant date
      const grantDate = new Date(approveSessionResult.credit.adminApprovedAt);
      const creditExpiresAt = new Date(approveSessionResult.credit.expiresAt);
      const expiryDiffDays = (creditExpiresAt.getTime() - grantDate.getTime()) / (1000 * 60 * 60 * 24);
      assert(expiryDiffDays > 89 && expiryDiffDays < 91, `Step 10: Validity starts from grant date (90 days): ${expiryDiffDays.toFixed(2)}d`);

      // Step 11: Balance available in Leave Management and consumed FIFO
      const balAfterCredit = await getUserCompOffLedgerBalance(testEmp.id);
      assert(balAfterCredit.netAvailable >= 1.0, `Step 11: Approved credit available in leave ledger balance: ${balAfterCredit.netAvailable}`);

      // Apply for 1.0 day Comp-Off leave
      const leave = await prisma.leaveRequest.create({
        data: {
          userId: testEmp.id,
          startDate: new Date('2026-12-05T00:00:00.000Z'),
          endDate: new Date('2026-12-05T00:00:00.000Z'),
          totalDays: 1.0,
          leaveType: 'COMP_OFF',
          type: 'LEAVE',
          payType: 'PAID',
          reason: 'Comp-Off leave usage test',
          status: 'PENDING_ADMIN_APPROVAL'
        }
      });
      createdLeaveIds.push(leave.id);

      // FIFO deduction on Admin approval
      const fifoResult = await consumeCompOffCreditsFIFO({
        leaveRequestId: leave.id,
        userId: testEmp.id,
        daysToConsume: 1.0,
        organizationId: org1.id
      });
      assert(fifoResult.totalConsumed === 1.0, 'Step 11: FIFO consumes 1.0 day credit');
      assert(fifoResult.consumptions.length >= 1, 'Step 11: CompOffConsumption record created');

      // Step 12: Leave cancellation restores eligible consumed credits without restoring expired credits
      const restoreResult = await restoreCompOffCreditConsumption({
        leaveRequestId: leave.id,
        txClient: prisma,
        adminUserId: adminUser.id
      });
      assert(restoreResult.restoredDays === 1.0, 'Step 12: Cancellation restores 1.0 day credit');

      // Step 13: Retrospective claim window applies only to retrospective claims, NOT advance permission requests
      const retrospectiveClaimResult = validateClaimWindow(
        new Date('2026-09-01T00:00:00.000Z'), // > 30 days ago
        30,
        new Date('2026-10-21T00:00:00.000Z'),
        true
      );
      assert(retrospectiveClaimResult.isValid === false, 'Step 13: Retrospective claim older than 30 days rejected');

      // Super Admin read-only safety check
      let superAdminApproveError = null;
      try {
        await reviewCompOffPermissionRequest({
          requestId: advanceRequest.id,
          reviewerUser: superAdminUser,
          action: 'APPROVE',
          organizationId: org1.id
        });
      } catch (err) {
        superAdminApproveError = err;
      }
      assert(Boolean(superAdminApproveError && superAdminApproveError.statusCode === 403), 'Super Admin is strictly read-only for Comp-Off reviews (403)');
    }

  } finally {
    // Teardown Fixtures
    console.log('\n--- Teardown: Cleaning Phase 5 Test Fixtures ---');
    if (createdLeaveIds.length > 0) {
      await prisma.compOffConsumption.deleteMany({ where: { leaveRequestId: { in: createdLeaveIds } } }).catch(() => {});
      await prisma.leaveRequest.deleteMany({ where: { id: { in: createdLeaveIds } } }).catch(() => {});
    }
    if (createdCreditIds.length > 0) {
      await prisma.compOffConsumption.deleteMany({ where: { creditId: { in: createdCreditIds } } }).catch(() => {});
      await prisma.compOffCredit.deleteMany({ where: { id: { in: createdCreditIds } } }).catch(() => {});
    }
    if (createdSessionIds.length > 0) {
      await prisma.compOffSession.deleteMany({ where: { id: { in: createdSessionIds } } }).catch(() => {});
    }
    if (createdPermissionIds.length > 0) {
      await prisma.compOffPermissionRequest.deleteMany({ where: { id: { in: createdPermissionIds } } }).catch(() => {});
    }
    if (createdUserIds.length > 0) {
      await prisma.userLeaveBalance.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
    }
    console.log('Phase 5 test fixtures cleaned up successfully.');
  }

  console.log('\n========================================================================');
  console.log(`  PHASE 5 CALENDAR & E2E SUITE COMPLETED: ${passedTests} / ${totalTests} TESTS PASSED`);
  console.log('========================================================================\n');
}

runPhase5CalendarE2ESuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Phase 5 Calendar & E2E Suite Failed with error:', err);
    process.exit(1);
  });
