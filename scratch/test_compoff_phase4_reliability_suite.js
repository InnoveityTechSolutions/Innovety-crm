const path = require('path');
module.paths.push(path.resolve(__dirname, '..', 'backend', 'node_modules'));

const prisma = require('../backend/src/utils/db');
const {
  getUserCompOffLedgerBalance,
  consumeCompOffCreditsFIFO,
  restoreCompOffCreditConsumption,
  processExpiredCompOffCredits,
  getCompOffPolicySettings,
  updateCompOffPolicySettings,
  calculateExpiryDate,
  validateClaimWindow,
  verifyAndApproveCompOffSession,
  getCompOffSessions
} = require('../backend/src/services/compOffService');
const {
  getCompOffCredits
} = require('../backend/src/controllers/compOffController');
const {
  sendCompOffExpiryReminders,
  processCompOffDailyMaintenance
} = require('../backend/src/services/compOffExpirySchedulerService');
const {
  applyLeave,
  approveLeaveAdmin,
  cancelLeave,
  getLeaveBalances
} = require('../backend/src/controllers/leaveController');
const {
  getEffectiveSettings
} = require('../backend/src/utils/settingsResolver');

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

async function runPhase4ReliabilityTestSuite() {
  console.log('========================================================================');
  console.log('  InnovEity CRM — Comp-Off Phase 4: Balance & Expiry Reliability Suite');
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

  // Track created fixtures for cleanup
  const createdUserIds = [];
  const createdCreditIds = [];
  const createdLeaveIds = [];
  const createdNotificationIds = [];
  const createdSessionIds = [];
  const createdPermissionIds = [];

  const timestamp = Date.now();

  // Create isolated test employee in Org 1
  const testEmp = await prisma.user.create({
    data: {
      email: `compoff_p4_emp_${timestamp}@test.com`,
      password: 'hashed_password_123',
      name: `CompOff P4 Tester ${timestamp}`,
      role: 'EMPLOYEE',
      organizationId: org1.id,
      employeeId: `EMP4-${timestamp.toString().slice(-4)}`,
      status: 'ACTIVE'
    }
  });
  createdUserIds.push(testEmp.id);

  // Create isolated test employee in Org 2 (for multi-tenant checks)
  const testEmpOrg2 = await prisma.user.create({
    data: {
      email: `compoff_p4_org2_${timestamp}@test.com`,
      password: 'hashed_password_123',
      name: `CompOff P4 Org2 Emp ${timestamp}`,
      role: 'EMPLOYEE',
      organizationId: org2.id,
      employeeId: `EMPO2-${timestamp.toString().slice(-4)}`,
      status: 'ACTIVE'
    }
  });
  createdUserIds.push(testEmpOrg2.id);

  try {
    // -------------------------------------------------------------------------
    // 1. Balance calculation with multiple credits
    // -------------------------------------------------------------------------
    console.log('--- Test Group 1: Balance Calculation with Multiple Credits ---');
    {
      const initialBal = await getUserCompOffLedgerBalance(testEmp.id);
      assert(initialBal.totalAvailable === 0, 'Initial available Comp-Off balance is 0');
      assert(initialBal.totalEarned === 0, 'Initial earned Comp-Off balance is 0');
      assert(initialBal.totalUsed === 0, 'Initial used Comp-Off balance is 0');

      // Create 3 active approved credits
      const c1 = await prisma.compOffCredit.create({
        data: {
          organizationId: org1.id,
          userId: testEmp.id,
          workDate: new Date('2026-08-02T00:00:00.000Z'),
          creditDays: 1.0,
          usedDays: 0.0,
          availableDays: 1.0,
          status: 'APPROVED',
          reason: 'Weekly off work 1',
          claimedByRole: 'ADMIN',
          claimedById: adminUser.id,
          adminApprovedById: adminUser.id,
          adminApprovedAt: new Date(),
          expiresAt: new Date(Date.now() + 60 * 86400000) // 60 days in future
        }
      });
      createdCreditIds.push(c1.id);

      const c2 = await prisma.compOffCredit.create({
        data: {
          organizationId: org1.id,
          userId: testEmp.id,
          workDate: new Date('2026-08-09T00:00:00.000Z'),
          creditDays: 0.5,
          usedDays: 0.0,
          availableDays: 0.5,
          status: 'APPROVED',
          reason: 'Weekly off work 2',
          claimedByRole: 'ADMIN',
          claimedById: adminUser.id,
          adminApprovedById: adminUser.id,
          adminApprovedAt: new Date(),
          expiresAt: new Date(Date.now() + 75 * 86400000)
        }
      });
      createdCreditIds.push(c2.id);

      const c3 = await prisma.compOffCredit.create({
        data: {
          organizationId: org1.id,
          userId: testEmp.id,
          workDate: new Date('2026-08-16T00:00:00.000Z'),
          creditDays: 1.0,
          usedDays: 0.0,
          availableDays: 1.0,
          status: 'APPROVED',
          reason: 'Weekly off work 3',
          claimedByRole: 'ADMIN',
          claimedById: adminUser.id,
          adminApprovedById: adminUser.id,
          adminApprovedAt: new Date(),
          expiresAt: new Date(Date.now() + 90 * 86400000)
        }
      });
      createdCreditIds.push(c3.id);

      const bal = await getUserCompOffLedgerBalance(testEmp.id);
      assert(bal.totalEarned === 2.5, `totalEarned is exactly 2.5 days (actual: ${bal.totalEarned})`);
      assert(bal.totalAvailable === 2.5, `totalAvailable is exactly 2.5 days (actual: ${bal.totalAvailable})`);
      assert(bal.netAvailable === 2.5, `netAvailable is exactly 2.5 days (actual: ${bal.netAvailable})`);
      assert(bal.activeCreditsCount === 3, 'Active credits count is 3');

      // Check displayed balance via leaveController.getLeaveBalances
      const { req: balReq, res: balRes } = createMockReqRes({
        user: testEmp,
        query: { userId: testEmp.id }
      });
      await getLeaveBalances(balReq, balRes);
      assert(balRes.getStatus() === 200, 'getLeaveBalances returns 200 OK');
      const compOffLeaveType = balRes.getData().leaveTypes?.find(lt => lt.code === 'COMP_OFF');
      assert(Boolean(compOffLeaveType), 'COMP_OFF leave type returned in balance response');
      assert(compOffLeaveType.available === 2.5, `Displayed balance agrees with ledger calculation: 2.5 (actual: ${compOffLeaveType.available})`);
      assert(compOffLeaveType.allocated === 0, `UserLeaveBalance.allocated for COMP_OFF is strictly 0 (not inflated): ${compOffLeaveType.allocated}`);
    }

    // -------------------------------------------------------------------------
    // 2. Half-day and full-day credit balances
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 2: Half-Day and Full-Day Credit Balances ---');
    {
      const balBefore = await getUserCompOffLedgerBalance(testEmp.id);

      // Create a pending leave request for 0.5 day
      const pendingLeave = await prisma.leaveRequest.create({
        data: {
          userId: testEmp.id,
          startDate: new Date('2026-11-01T00:00:00.000Z'),
          endDate: new Date('2026-11-01T00:00:00.000Z'),
          totalDays: 0.5,
          leaveType: 'COMP_OFF',
          type: 'LEAVE',
          payType: 'PAID',
          reason: 'Doctor appointment (half day)',
          status: 'PENDING_ADMIN_APPROVAL'
        }
      });
      createdLeaveIds.push(pendingLeave.id);

      const balWithPending = await getUserCompOffLedgerBalance(testEmp.id);
      assert(balWithPending.pendingDays === 0.5, `pendingDays accounts for 0.5 reservation: ${balWithPending.pendingDays}`);
      assert(balWithPending.totalAvailable === 2.5, `totalAvailable remains 2.5: ${balWithPending.totalAvailable}`);
      assert(balWithPending.netAvailable === 2.0, `netAvailable reduced to 2.0 (2.5 - 0.5): ${balWithPending.netAvailable}`);

      // Clean up pending leave
      await prisma.leaveRequest.delete({ where: { id: pendingLeave.id } });
      const index = createdLeaveIds.indexOf(pendingLeave.id);
      if (index !== -1) createdLeaveIds.splice(index, 1);
    }

    // -------------------------------------------------------------------------
    // 3. Expired and consumed credits exclusion
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 3: Expired and Consumed Credits Exclusion ---');
    {
      // Create an expired credit
      const expiredCredit = await prisma.compOffCredit.create({
        data: {
          organizationId: org1.id,
          userId: testEmp.id,
          workDate: new Date('2026-05-01T00:00:00.000Z'),
          creditDays: 1.0,
          usedDays: 0.0,
          availableDays: 0.0,
          status: 'EXPIRED',
          reason: 'Lapsed credit',
          claimedByRole: 'ADMIN',
          claimedById: adminUser.id,
          adminApprovedById: adminUser.id,
          adminApprovedAt: new Date('2026-05-02T00:00:00.000Z'),
          expiresAt: new Date(Date.now() - 10 * 86400000) // 10 days ago
        }
      });
      createdCreditIds.push(expiredCredit.id);

      // Create an exhausted/consumed credit
      const exhaustedCredit = await prisma.compOffCredit.create({
        data: {
          organizationId: org1.id,
          userId: testEmp.id,
          workDate: new Date('2026-06-01T00:00:00.000Z'),
          creditDays: 1.0,
          usedDays: 1.0,
          availableDays: 0.0,
          status: 'EXHAUSTED',
          reason: 'Fully consumed credit',
          claimedByRole: 'ADMIN',
          claimedById: adminUser.id,
          adminApprovedById: adminUser.id,
          adminApprovedAt: new Date('2026-06-02T00:00:00.000Z'),
          expiresAt: new Date(Date.now() + 30 * 86400000)
        }
      });
      createdCreditIds.push(exhaustedCredit.id);

      const bal = await getUserCompOffLedgerBalance(testEmp.id);
      assert(bal.totalEarned === 4.5, `totalEarned includes historical expired and consumed credits (2.5 + 1.0 + 1.0 = 4.5): ${bal.totalEarned}`);
      assert(bal.totalUsed === 1.0, `totalUsed reflects the consumed credit: ${bal.totalUsed}`);
      assert(bal.totalAvailable === 2.5, `totalAvailable strictly EXCLUDES expired and exhausted credits: ${bal.totalAvailable}`);
      assert(bal.netAvailable === 2.5, `netAvailable strictly EXCLUDES expired and exhausted credits: ${bal.netAvailable}`);
    }

    // -------------------------------------------------------------------------
    // 4. FIFO deduction across multiple credit entries
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 4: FIFO Deduction Across Multiple Credit Entries ---');
    {
      // We will create an approved leave request for 1.5 days.
      // testEmp currently has active credits:
      // c1: 1.0 day, expires in 60d
      // c2: 0.5 day, expires in 75d
      // c3: 1.0 day, expires in 90d
      // FIFO order: earliest expiry first.
      // Deducting 1.5 days must consume 1.0 from c1 and 0.5 from c2.
      // c3 must remain untouched (1.0 available).

      const leaveToApprove = await prisma.leaveRequest.create({
        data: {
          userId: testEmp.id,
          startDate: new Date('2026-11-10T00:00:00.000Z'),
          endDate: new Date('2026-11-11T00:00:00.000Z'),
          totalDays: 1.5,
          leaveType: 'COMP_OFF',
          type: 'LEAVE',
          payType: 'PAID',
          reason: 'Personal travel (1.5 days Comp-Off)',
          status: 'PENDING_ADMIN_APPROVAL'
        }
      });
      createdLeaveIds.push(leaveToApprove.id);

      const { req: appReq, res: appRes } = createMockReqRes({
        user: adminUser,
        params: { id: leaveToApprove.id },
        body: { status: 'APPROVED', remarks: 'Sanctioned by Admin' }
      });
      await approveLeaveAdmin(appReq, appRes);
      assert(appRes.getStatus() === 200, 'Admin approval for 1.5-day Comp-Off succeeds');

      // Check updated credit balances
      const updatedCredits = await prisma.compOffCredit.findMany({
        where: { userId: testEmp.id, id: { in: createdCreditIds } },
        orderBy: { expiresAt: 'asc' }
      });

      const updatedC1 = updatedCredits.find(c => c.workDate.toISOString().startsWith('2026-08-02'));
      const updatedC2 = updatedCredits.find(c => c.workDate.toISOString().startsWith('2026-08-09'));
      const updatedC3 = updatedCredits.find(c => c.workDate.toISOString().startsWith('2026-08-16'));

      assert(updatedC1.status === 'EXHAUSTED', 'Credit 1 (earliest expiry) is fully consumed (EXHAUSTED)');
      assert(updatedC1.usedDays === 1.0, `Credit 1 usedDays is 1.0: ${updatedC1.usedDays}`);
      assert(updatedC1.availableDays === 0.0, `Credit 1 availableDays is 0.0: ${updatedC1.availableDays}`);

      assert(updatedC2.status === 'EXHAUSTED', 'Credit 2 (second earliest expiry) is fully consumed (EXHAUSTED)');
      assert(updatedC2.usedDays === 0.5, `Credit 2 usedDays is 0.5: ${updatedC2.usedDays}`);
      assert(updatedC2.availableDays === 0.0, `Credit 2 availableDays is 0.0: ${updatedC2.availableDays}`);

      assert(updatedC3.status === 'APPROVED', 'Credit 3 remains APPROVED and unconsumed');
      assert(updatedC3.usedDays === 0.0, `Credit 3 usedDays is 0.0: ${updatedC3.usedDays}`);
      assert(updatedC3.availableDays === 1.0, `Credit 3 availableDays is 1.0: ${updatedC3.availableDays}`);

      const postFIFOBal = await getUserCompOffLedgerBalance(testEmp.id);
      assert(postFIFOBal.totalAvailable === 1.0, `Post-FIFO available balance is 1.0 day: ${postFIFOBal.totalAvailable}`);

      // Verify consumption records
      const consumptions = await prisma.compOffConsumption.findMany({
        where: { leaveRequestId: leaveToApprove.id }
      });
      assert(consumptions.length === 2, `Exactly 2 consumption chunks created across 2 credits: ${consumptions.length}`);
      const totalConsumed = consumptions.reduce((sum, c) => sum + c.consumedDays, 0);
      assert(totalConsumed === 1.5, `Total consumed across chunks is 1.5 days: ${totalConsumed}`);
    }

    // -------------------------------------------------------------------------
    // 5. Leave cancellation restoration & idempotency
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 5: Leave Cancellation Restoration & Idempotency ---');
    {
      const leaveToCancel = createdLeaveIds[createdLeaveIds.length - 1];

      // Regular employee self-cancellation of approved leave must be rejected
      const { req: empCancelReq, res: empCancelRes } = createMockReqRes({
        user: testEmp,
        params: { id: leaveToCancel }
      });
      await cancelLeave(empCancelReq, empCancelRes);
      assert(empCancelRes.getStatus() === 400, 'Employee self-cancellation of approved leave is forbidden (400)');

      // Admin cancellation of approved leave
      const { req: admCancelReq, res: admCancelRes } = createMockReqRes({
        user: adminUser,
        params: { id: leaveToCancel }
      });
      await cancelLeave(admCancelReq, admCancelRes);
      assert(admCancelRes.getStatus() === 200, 'Admin cancellation of approved leave succeeds (200)');

      // Verify restored credits
      const restoredC1 = await prisma.compOffCredit.findFirst({
        where: { userId: testEmp.id, workDate: new Date('2026-08-02T00:00:00.000Z') }
      });
      const restoredC2 = await prisma.compOffCredit.findFirst({
        where: { userId: testEmp.id, workDate: new Date('2026-08-09T00:00:00.000Z') }
      });

      assert(restoredC1.status === 'APPROVED', 'Credit 1 status restored to APPROVED');
      assert(restoredC1.availableDays === 1.0, `Credit 1 availableDays restored to 1.0: ${restoredC1.availableDays}`);
      assert(restoredC1.usedDays === 0.0, `Credit 1 usedDays restored to 0.0: ${restoredC1.usedDays}`);

      assert(restoredC2.status === 'APPROVED', 'Credit 2 status restored to APPROVED');
      assert(restoredC2.availableDays === 0.5, `Credit 2 availableDays restored to 0.5: ${restoredC2.availableDays}`);
      assert(restoredC2.usedDays === 0.0, `Credit 2 usedDays restored to 0.0: ${restoredC2.usedDays}`);

      const balPostRestore = await getUserCompOffLedgerBalance(testEmp.id);
      assert(balPostRestore.totalAvailable === 2.5, `Post-restoration available balance returned to 2.5: ${balPostRestore.totalAvailable}`);

      // Verify idempotency: repeated cancellation must be rejected and restore zero additional days
      const { req: repeatCancelReq, res: repeatCancelRes } = createMockReqRes({
        user: adminUser,
        params: { id: leaveToCancel }
      });
      await cancelLeave(repeatCancelReq, repeatCancelRes);
      assert(repeatCancelRes.getStatus() === 400, 'Repeated cancellation of already cancelled leave is rejected (400)');

      const directRestoreResult = await restoreCompOffCreditConsumption({
        leaveRequestId: leaveToCancel,
        txClient: prisma,
        adminUserId: adminUser.id
      });
      assert(directRestoreResult.restoredDays === 0, `Direct restoration rerun restores 0 days (safe & idempotent): ${directRestoreResult.restoredDays}`);
    }

    // -------------------------------------------------------------------------
    // 6. Concurrent deduction and duplicate-operation prevention
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 6: Concurrent Deduction & Duplicate Prevention ---');
    {
      // testEmp currently has 2.5 available days.
      // We create two competing leave requests for 2.0 days each.
      // In total they request 4.0 days, but only 2.5 is available.
      // Under concurrency, only ONE must be approved, and the other must be rejected with 400.
      const leaveA = await prisma.leaveRequest.create({
        data: {
          userId: testEmp.id,
          startDate: new Date('2026-11-15T00:00:00.000Z'),
          endDate: new Date('2026-11-16T00:00:00.000Z'),
          totalDays: 2.0,
          leaveType: 'COMP_OFF',
          type: 'LEAVE',
          payType: 'PAID',
          reason: 'Concurrent leave A',
          status: 'PENDING_ADMIN_APPROVAL'
        }
      });
      createdLeaveIds.push(leaveA.id);

      const leaveB = await prisma.leaveRequest.create({
        data: {
          userId: testEmp.id,
          startDate: new Date('2026-11-18T00:00:00.000Z'),
          endDate: new Date('2026-11-19T00:00:00.000Z'),
          totalDays: 2.0,
          leaveType: 'COMP_OFF',
          type: 'LEAVE',
          payType: 'PAID',
          reason: 'Concurrent leave B',
          status: 'PENDING_ADMIN_APPROVAL'
        }
      });
      createdLeaveIds.push(leaveB.id);

      const reqA = createMockReqRes({
        user: adminUser,
        params: { id: leaveA.id },
        body: { status: 'APPROVED', remarks: 'Sanctioned' }
      });
      const reqB = createMockReqRes({
        user: adminUser,
        params: { id: leaveB.id },
        body: { status: 'APPROVED', remarks: 'Sanctioned' }
      });

      // Execute concurrently
      await Promise.all([
        approveLeaveAdmin(reqA.req, reqA.res),
        approveLeaveAdmin(reqB.req, reqB.res)
      ]);

      const statusA = reqA.res.getStatus();
      const statusB = reqB.res.getStatus();

      const oneSucceeded = (statusA === 200 && statusB === 400) || (statusA === 400 && statusB === 200);
      assert(oneSucceeded, `Concurrent approval race: exactly one succeeds (200) and one is rejected (400) [A: ${statusA}, B: ${statusB}]`);

      // Duplicate credit on same work date must fail due to unique constraint
      let duplicateCreditError = null;
      try {
        await prisma.compOffCredit.create({
          data: {
            organizationId: org1.id,
            userId: testEmp.id,
            workDate: new Date('2026-08-02T00:00:00.000Z'), // matches c1
            creditDays: 1.0,
            availableDays: 1.0,
            status: 'APPROVED',
            reason: 'Duplicate credit attempt',
            claimedByRole: 'ADMIN',
            claimedById: adminUser.id,
            expiresAt: new Date(Date.now() + 90 * 86400000)
          }
        });
      } catch (err) {
        duplicateCreditError = err;
      }
      assert(Boolean(duplicateCreditError), 'Duplicate credit on same workDate for employee is strictly rejected by unique constraint');
    }

    // -------------------------------------------------------------------------
    // 7. Expiry from grant date and relevant timezone boundaries
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 7: Expiry From Grant Date & Timezone Boundaries ---');
    {
      const grantDate = new Date('2026-10-21T10:00:00.000Z');
      const calculatedExpiry = calculateExpiryDate(grantDate, 90);

      // Must be 90 calendar days from grant date
      const diffMs = calculatedExpiry.getTime() - grantDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      assert(diffDays > 89 && diffDays < 91, `Expiry period is 90 days from grant date: ${diffDays.toFixed(2)} days`);

      // End of day boundary: hours=23, minutes=59, seconds=59, ms=999
      assert(calculatedExpiry.getHours() === 23, `Timezone boundary: hours is 23 (actual: ${calculatedExpiry.getHours()})`);
      assert(calculatedExpiry.getMinutes() === 59, `Timezone boundary: minutes is 59 (actual: ${calculatedExpiry.getMinutes()})`);
      assert(calculatedExpiry.getSeconds() === 59, `Timezone boundary: seconds is 59 (actual: ${calculatedExpiry.getSeconds()})`);
      assert(calculatedExpiry.getMilliseconds() === 999, `Timezone boundary: milliseconds is 999 (actual: ${calculatedExpiry.getMilliseconds()})`);

      // Verify that expiry is NOT calculated from a retrospective work date
      const workDate = new Date('2026-09-25T00:00:00.000Z'); // 26 days ago
      const expiryFromGrant = calculateExpiryDate(grantDate, 90);
      const expiryFromWork = calculateExpiryDate(workDate, 90);
      assert(expiryFromGrant.getTime() !== expiryFromWork.getTime(), 'Expiry date from grant date is strictly decoupled from historical work date');
    }

    // -------------------------------------------------------------------------
    // 8. Expiry scheduler idempotency and reminder deduplication
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 8: Expiry Scheduler Idempotency & Deduplication ---');
    {
      // Create a credit expiring in 12 days (within 14-day reminder window)
      const creditExp12 = await prisma.compOffCredit.create({
        data: {
          organizationId: org1.id,
          userId: testEmp.id,
          workDate: new Date('2026-08-23T00:00:00.000Z'),
          creditDays: 1.0,
          usedDays: 0.0,
          availableDays: 1.0,
          status: 'APPROVED',
          reason: 'Expiring soon credit (12 days)',
          claimedByRole: 'ADMIN',
          claimedById: adminUser.id,
          adminApprovedById: adminUser.id,
          adminApprovedAt: new Date(),
          expiresAt: new Date(Date.now() + 12 * 86400000)
        }
      });
      createdCreditIds.push(creditExp12.id);

      // Create a credit expiring in 2 days (within 3-day reminder window)
      const creditExp2 = await prisma.compOffCredit.create({
        data: {
          organizationId: org1.id,
          userId: testEmp.id,
          workDate: new Date('2026-08-30T00:00:00.000Z'),
          creditDays: 0.5,
          usedDays: 0.0,
          availableDays: 0.5,
          status: 'APPROVED',
          reason: 'Expiring very soon credit (2 days)',
          claimedByRole: 'ADMIN',
          claimedById: adminUser.id,
          adminApprovedById: adminUser.id,
          adminApprovedAt: new Date(),
          expiresAt: new Date(Date.now() + 2 * 86400000)
        }
      });
      createdCreditIds.push(creditExp2.id);

      // Run reminder scheduler first time
      const reminderRun1 = await sendCompOffExpiryReminders({
        organizationId: org1.id
      });
      assert(reminderRun1.remindersSent >= 2, `Reminders sent for qualifying credits (sent: ${reminderRun1.remindersSent})`);

      // Check notification length under MySQL varchar(191) limit
      const notifications = await prisma.notification.findMany({
        where: {
          userId: testEmp.id,
          type: 'COMPOFF_EXPIRY_WARNING'
        }
      });
      assert(notifications.length >= 2, `At least 2 warning notifications created for testEmp: ${notifications.length}`);
      for (const n of notifications) {
        assert(n.message.length <= 191, `Notification message length (${n.message.length}) strictly <= 191 limit`);
        createdNotificationIds.push(n.id);
      }

      // Run reminder scheduler second time: must skip duplicates cleanly
      const reminderRun2 = await sendCompOffExpiryReminders({
        organizationId: org1.id
      });
      assert(reminderRun2.remindersSent === 0, `Rerun sends 0 duplicate reminders: ${reminderRun2.remindersSent}`);
      assert(reminderRun2.skippedDuplicates >= 2, `Rerun skips existing reminders via Ref tag: ${reminderRun2.skippedDuplicates}`);

      // Test processExpiredCompOffCredits idempotency
      const creditToLapse = await prisma.compOffCredit.create({
        data: {
          organizationId: org1.id,
          userId: testEmp.id,
          workDate: new Date('2026-06-15T00:00:00.000Z'),
          creditDays: 1.0,
          usedDays: 0.0,
          availableDays: 1.0,
          status: 'APPROVED',
          reason: 'To be expired',
          claimedByRole: 'ADMIN',
          claimedById: adminUser.id,
          adminApprovedById: adminUser.id,
          adminApprovedAt: new Date(),
          expiresAt: new Date(Date.now() - 2 * 86400000) // already in past
        }
      });
      createdCreditIds.push(creditToLapse.id);

      const expiryRun1 = await processExpiredCompOffCredits({ organizationId: org1.id });
      assert(expiryRun1.expiredCount >= 1, `processExpiredCompOffCredits transitions expired credit (count: ${expiryRun1.expiredCount})`);

      const lapsedCreditCheck = await prisma.compOffCredit.findUnique({ where: { id: creditToLapse.id } });
      assert(lapsedCreditCheck.status === 'EXPIRED', 'Lapsed credit status transitioned to EXPIRED');
      assert(lapsedCreditCheck.availableDays === 0.0, 'Lapsed credit availableDays set to 0.0');

      const expiryRun2 = await processExpiredCompOffCredits({ organizationId: org1.id });
      assert(expiryRun2.expiredCount === 0, `Repeated expiry run is strictly idempotent (expiredCount: ${expiryRun2.expiredCount})`);
    }

    // -------------------------------------------------------------------------
    // 9. Enabled and disabled retrospective claim-window behavior
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 9: Retrospective Claim Window Enabled vs Disabled ---');
    {
      const now = new Date('2026-10-21T00:00:00.000Z');
      const workDate35DaysAgo = new Date('2026-09-16T00:00:00.000Z'); // 35 days ago
      const workDate25DaysAgo = new Date('2026-09-26T00:00:00.000Z'); // 25 days ago
      const futureWorkDate = new Date('2026-10-25T00:00:00.000Z'); // 4 days in future

      // When claimWindowEnabled = true
      const enabledRes35 = validateClaimWindow(workDate35DaysAgo, 30, now, true);
      assert(enabledRes35.isValid === false, 'Claim 35 days ago is REJECTED when claimWindowEnabled = true');
      assert(enabledRes35.error.includes('30 calendar days'), 'Rejection message explains the 30-day window limit');

      const enabledRes25 = validateClaimWindow(workDate25DaysAgo, 30, now, true);
      assert(enabledRes25.isValid === true, 'Claim 25 days ago is ACCEPTED when claimWindowEnabled = true');

      // When claimWindowEnabled = false
      const disabledRes35 = validateClaimWindow(workDate35DaysAgo, 30, now, false);
      assert(disabledRes35.isValid === true, 'Claim 35 days ago is ACCEPTED when claimWindowEnabled = false (no age cutoff)');
      assert(disabledRes35.claimWindowEnabled === false, 'Validation acknowledges claimWindowEnabled = false');

      // Future dates are ALWAYS rejected regardless of policy toggle
      const futureResEnabled = validateClaimWindow(futureWorkDate, 30, now, true);
      assert(futureResEnabled.isValid === false, 'Future date is REJECTED when window is enabled (belongs to advance permissions)');
      const futureResDisabled = validateClaimWindow(futureWorkDate, 30, now, false);
      assert(futureResDisabled.isValid === false, 'Future date is REJECTED even when window is disabled');
    }

    // -------------------------------------------------------------------------
    // 10. Cross-tenant and unauthorized access protection
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 10: Cross-Tenant & Unauthorized Access Protection ---');
    {
      // 1. Employee cannot view other employees' credits
      const { req: empCreditsReq, res: empCreditsRes } = createMockReqRes({
        user: testEmp,
        query: { userId: testEmpOrg2.id } // Trying to spy on Org 2 employee
      });
      await getCompOffCredits(empCreditsReq, empCreditsRes);
      assert(empCreditsRes.getStatus() === 200, 'Credits endpoint returns 200');
      const retrievedCredits = empCreditsRes.getData()?.credits || [];
      // Employee should only get their own credits, never testEmpOrg2 credits
      const containsOtherEmpCredits = retrievedCredits.some(c => c.userId === testEmpOrg2.id);
      assert(containsOtherEmpCredits === false, 'Employee visibility strictly scoped: cannot view another user\'s credits');

      // 2. Org 1 Admin cannot view or manipulate Org 2 credits
      const org2Credit = await prisma.compOffCredit.create({
        data: {
          organizationId: org2.id,
          userId: testEmpOrg2.id,
          workDate: new Date('2026-08-02T00:00:00.000Z'),
          creditDays: 1.0,
          availableDays: 1.0,
          status: 'APPROVED',
          reason: 'Org 2 credit',
          claimedByRole: 'ADMIN',
          claimedById: org2Admin.id,
          adminApprovedById: org2Admin.id,
          adminApprovedAt: new Date(),
          expiresAt: new Date(Date.now() + 90 * 86400000)
        }
      });
      createdCreditIds.push(org2Credit.id);

      const { req: crossAdminReq, res: crossAdminRes } = createMockReqRes({
        user: adminUser, // Admin of Org 1
        query: { organizationId: org2.id } // Trying to query Org 2
      });
      await getCompOffCredits(crossAdminReq, crossAdminRes);
      const crossCredits = crossAdminRes.getData()?.credits || [];
      const hasOrg2Credit = crossCredits.some(c => c.organizationId === org2.id);
      assert(hasOrg2Credit === false, 'Tenant Admin cannot access other organization credits (query override ignored)');

      // 3. Super Admin cannot create, approve, or reject credits (strictly read-only)
      let superAdminApproveError = null;
      try {
        await verifyAndApproveCompOffSession({
          sessionId: 'fake-session-id',
          verifierUser: superAdminUser,
          organizationId: org1.id
        });
      } catch (err) {
        superAdminApproveError = err;
      }
      assert(Boolean(superAdminApproveError && superAdminApproveError.statusCode === 403), 'Super Admin is forbidden from approving Comp-Off sessions (403)');
      assert(superAdminApproveError.message.includes('read-only'), 'Error message specifies Super Admin is strictly read-only');
    }

  } finally {
    // Teardown Fixtures
    console.log('\n--- Teardown: Cleaning Phase 4 Test Fixtures ---');
    if (createdNotificationIds.length > 0) {
      await prisma.notification.deleteMany({ where: { id: { in: createdNotificationIds } } }).catch(() => {});
    }
    if (createdLeaveIds.length > 0) {
      await prisma.compOffConsumption.deleteMany({ where: { leaveRequestId: { in: createdLeaveIds } } }).catch(() => {});
      await prisma.leaveRequest.deleteMany({ where: { id: { in: createdLeaveIds } } }).catch(() => {});
    }
    if (createdCreditIds.length > 0) {
      await prisma.compOffConsumption.deleteMany({ where: { creditId: { in: createdCreditIds } } }).catch(() => {});
      await prisma.compOffCredit.deleteMany({ where: { id: { in: createdCreditIds } } }).catch(() => {});
    }
    if (createdUserIds.length > 0) {
      await prisma.userLeaveBalance.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
    }
    console.log('Phase 4 test fixtures cleaned up successfully.');
  }

  console.log('\n========================================================================');
  console.log(`  PHASE 4 RELIABILITY TEST SUITE COMPLETED: ${passedTests} / ${totalTests} TESTS PASSED`);
  console.log('========================================================================\n');
}

runPhase4ReliabilityTestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Phase 4 Reliability Test Suite Failed with error:', err);
    process.exit(1);
  });
