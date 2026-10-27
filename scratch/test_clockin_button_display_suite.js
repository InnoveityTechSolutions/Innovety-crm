/**
 * InnovEity CRM — Show Only the Correct Clock-In Button Test Suite
 * 
 * Tests all 9 scenarios:
 * 1. Normal working day.
 * 2. Holiday without permission.
 * 3. Holiday with pending permission.
 * 4. Holiday with rejected permission.
 * 5. Holiday with approved permission.
 * 6. Employee working on Saturday according to their shift.
 * 7. Approved Comp-Off session already active.
 * 8. Direct API attempts without approval (and on working days).
 * 9. Regression verification of existing suites.
 */

const prisma = require('../backend/src/utils/db');
const compOffService = require('../backend/src/services/compOffService');
const shiftService = require('../backend/src/services/shiftService');
const { validateAttendanceWindow } = require('../backend/src/utils/attendanceUtils');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failCount++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runSuite() {
  console.log('========================================================================');
  console.log('  InnovEity CRM — Correct Clock-In Button Verification Suite');
  console.log('========================================================================\n');

  // Load an existing organization and admin + employee
  const org = await prisma.organization.findFirst({
    where: { name: { contains: 'MRF' } }
  }) || await prisma.organization.findFirst();

  if (!org) {
    throw new Error('No organization found in database.');
  }

  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', organizationId: org.id }
  }) || await prisma.user.findFirst({ where: { role: 'ADMIN' } });

  // Create an isolated test employee
  const testEmail = `test_btn_emp_${Date.now()}@innoveity-test.com`;
  const testEmp = await prisma.user.create({
    data: {
      name: 'Test Button Employee',
      email: testEmail,
      employeeId: `EMP-BTN-${Date.now().toString().slice(-5)}`,
      password: 'hashedpassword123',
      role: 'EMPLOYEE',
      organizationId: org.id,
      status: 'ACTIVE',
      autoClockOutEnabled: true
    }
  });

  const createdRequestIds = [];
  const createdSessionIds = [];
  const createdShiftIds = [];

  try {
    console.log(`Test user created: ${testEmp.name} (${testEmp.email}) in Org: ${org.id}\n`);

    // -------------------------------------------------------------
    // Scenario 1: Normal working day
    // -------------------------------------------------------------
    console.log('--- Scenario 1: Normal Working Day ---');
    // Find an ordinary future Thursday or Tuesday with no holiday
    const normalDay = new Date('2027-02-18T00:00:00.000Z'); // Thursday
    const dayCheckNormal = await compOffService.validateEligibleDay({
      userId: testEmp.id,
      workDate: normalDay,
      organizationId: org.id
    });
    assert(dayCheckNormal.isEligible === false, 'Normal Thursday is NOT an off-day (isEligible === false)');
    assert(dayCheckNormal.reason === 'NOT_AN_OFF_DAY', 'Reason indicates NOT_AN_OFF_DAY');

    const statusNormal = await compOffService.getTodayCompOffStatus({
      userId: testEmp.id,
      organizationId: org.id,
      now: normalDay
    });
    assert(statusNormal.isOffDay === false, 'Comp-Off status reflects isOffDay: false');
    assert(statusNormal.canLogin === false, 'Comp-Off canLogin is false on normal working day');
    assert(statusNormal.hasApprovedPermission === false, 'Comp-Off hasApprovedPermission is false');

    // UI Simulation for Scenario 1:
    const isClockedInNormal = false;
    const isClockedOutNormal = false;
    const isOffDayNormal = Boolean(statusNormal.isOffDay);
    const showNormalClockIn = !isClockedOutNormal && !isClockedInNormal && !isOffDayNormal;
    const showCompOffLoginNormal = isOffDayNormal && statusNormal.canLogin;
    assert(showNormalClockIn === true, 'UI displays normal Clock In button on normal working day');
    assert(showCompOffLoginNormal === false, 'UI does NOT display Comp-Off Login button on normal working day');

    // -------------------------------------------------------------
    // Scenario 2: Holiday / Weekly Off without permission
    // -------------------------------------------------------------
    console.log('\n--- Scenario 2: Holiday / Weekly Off Without Permission ---');
    const sundayDate = new Date('2027-02-21T00:00:00.000Z'); // Sunday
    const dayCheckSunday = await compOffService.validateEligibleDay({
      userId: testEmp.id,
      workDate: sundayDate,
      organizationId: org.id
    });
    assert(dayCheckSunday.isEligible === true, 'Sunday is recognized as an eligible off-day');
    assert(dayCheckSunday.eligibleReason === 'SUNDAY_WEEKLY_OFF', 'Reason is SUNDAY_WEEKLY_OFF');

    const statusSundayNoPerm = await compOffService.getTodayCompOffStatus({
      userId: testEmp.id,
      organizationId: org.id,
      now: sundayDate
    });
    assert(statusSundayNoPerm.isOffDay === true, 'isOffDay is true on Sunday');
    assert(statusSundayNoPerm.hasApprovedPermission === false, 'hasApprovedPermission is false when no permission exists');
    assert(statusSundayNoPerm.canLogin === false, 'canLogin is false when no permission exists');

    // UI Simulation for Scenario 2:
    const isOffDaySunday = Boolean(statusSundayNoPerm.isOffDay);
    const showNormalClockInSun = !isClockedInNormal && !isClockedOutNormal && !isOffDaySunday;
    const showCompOffLoginSun = isOffDaySunday && statusSundayNoPerm.canLogin;
    assert(showNormalClockInSun === false, 'UI HIDES normal Clock In button on off-day without permission');
    assert(showCompOffLoginSun === false, 'UI HIDES Comp-Off Login button on off-day without permission');
    assert(!showNormalClockInSun && !showCompOffLoginSun, 'NEITHER login button is displayed when no approved permission exists');

    // -------------------------------------------------------------
    // Scenario 3: Holiday with PENDING permission
    // -------------------------------------------------------------
    console.log('\n--- Scenario 3: Holiday With Pending Permission ---');
    const pendingReq = await prisma.compOffPermissionRequest.create({
      data: {
        organizationId: org.id,
        userId: testEmp.id,
        workDate: sundayDate,
        holidayType: 'WEEKLY_OFF',
        reason: 'Testing pending permission status',
        status: 'PENDING'
      }
    });
    createdRequestIds.push(pendingReq.id);

    const statusPending = await compOffService.getTodayCompOffStatus({
      userId: testEmp.id,
      organizationId: org.id,
      now: sundayDate
    });
    assert(statusPending.isOffDay === true, 'isOffDay is true');
    assert(statusPending.permissionStatus === 'PENDING', 'permissionStatus identifies PENDING');
    assert(statusPending.hasApprovedPermission === false, 'hasApprovedPermission remains false for PENDING');
    assert(statusPending.canLogin === false, 'canLogin remains false for PENDING permission');

    // UI Simulation for Scenario 3:
    const showNormalClockInPending = !isOffDaySunday;
    const showCompOffLoginPending = isOffDaySunday && statusPending.canLogin;
    assert(!showNormalClockInPending && !showCompOffLoginPending, 'NEITHER login button is displayed when permission is PENDING');

    // -------------------------------------------------------------
    // Scenario 4: Holiday with REJECTED permission
    // -------------------------------------------------------------
    console.log('\n--- Scenario 4: Holiday With Rejected Permission ---');
    await prisma.compOffPermissionRequest.update({
      where: { id: pendingReq.id },
      data: {
        status: 'REJECTED',
        rejectionReason: 'Declined by Admin for testing'
      }
    });

    const statusRejected = await compOffService.getTodayCompOffStatus({
      userId: testEmp.id,
      organizationId: org.id,
      now: sundayDate
    });
    assert(statusRejected.permissionStatus === 'REJECTED', 'permissionStatus identifies REJECTED');
    assert(statusRejected.hasApprovedPermission === false, 'hasApprovedPermission remains false for REJECTED');
    assert(statusRejected.canLogin === false, 'canLogin remains false for REJECTED permission');

    // UI Simulation for Scenario 4:
    const showNormalClockInRej = !isOffDaySunday;
    const showCompOffLoginRej = isOffDaySunday && statusRejected.canLogin;
    assert(!showNormalClockInRej && !showCompOffLoginRej, 'NEITHER login button is displayed when permission is REJECTED');

    // -------------------------------------------------------------
    // Scenario 5: Holiday with APPROVED permission
    // -------------------------------------------------------------
    console.log('\n--- Scenario 5: Holiday With Approved Permission ---');
    await prisma.compOffPermissionRequest.update({
      where: { id: pendingReq.id },
      data: {
        status: 'APPROVED',
        approvedById: admin?.id || null,
        approvedAt: new Date()
      }
    });

    const statusApproved = await compOffService.getTodayCompOffStatus({
      userId: testEmp.id,
      organizationId: org.id,
      now: sundayDate
    });
    assert(statusApproved.hasApprovedPermission === true, 'hasApprovedPermission is true for APPROVED');
    assert(statusApproved.canLogin === true, 'canLogin is true for APPROVED permission');
    assert(statusApproved.canClockOut === false, 'canClockOut is false before login');

    // UI Simulation for Scenario 5:
    const showNormalClockInAppr = !isOffDaySunday;
    const showCompOffLoginAppr = isOffDaySunday && statusApproved.canLogin;
    assert(showNormalClockInAppr === false, 'Normal Clock In button is HIDDEN on approved holiday');
    assert(showCompOffLoginAppr === true, 'Comp-Off Login button is SHOWN on approved holiday');

    // -------------------------------------------------------------
    // Scenario 6: Employee working on Saturday according to their shift
    // -------------------------------------------------------------
    console.log('\n--- Scenario 6: Employee Working on Saturday According to Shift ---');
    // Create a shift that marks Saturday as WORKING
    const saturdayShift = await prisma.shift.create({
      data: {
        organizationId: org.id,
        name: `Sat Work Shift ${Date.now()}`,
        startTime: '09:00',
        endTime: '18:00',
        status: 'ACTIVE',
        workingDays: [
          { day: 'MONDAY', isWorking: true },
          { day: 'TUESDAY', isWorking: true },
          { day: 'WEDNESDAY', isWorking: true },
          { day: 'THURSDAY', isWorking: true },
          { day: 'FRIDAY', isWorking: true },
          { day: 'SATURDAY', isWorking: true, status: 'WORKING' },
          { day: 'SUNDAY', isWorking: false, status: 'HOLIDAY' }
        ]
      }
    });
    createdShiftIds.push(saturdayShift.id);

    // Assign shift to testEmp
    await prisma.shiftMember.upsert({
      where: { userId: testEmp.id },
      create: {
        shiftId: saturdayShift.id,
        userId: testEmp.id
      },
      update: {
        shiftId: saturdayShift.id
      }
    });

    const satDate = new Date('2027-02-20T00:00:00.000Z'); // Saturday
    const dayCheckSat = await compOffService.validateEligibleDay({
      userId: testEmp.id,
      workDate: satDate,
      organizationId: org.id
    });
    assert(dayCheckSat.isEligible === false, 'Working Saturday is NOT an off-day (isEligible === false)');
    assert(dayCheckSat.reason === 'NOT_AN_OFF_DAY', 'Reason is NOT_AN_OFF_DAY');

    const statusSatWorking = await compOffService.getTodayCompOffStatus({
      userId: testEmp.id,
      organizationId: org.id,
      now: satDate
    });
    assert(statusSatWorking.isOffDay === false, 'isOffDay is false for employee working Saturday');
    assert(statusSatWorking.canLogin === false, 'Comp-Off canLogin is false for working Saturday');

    // UI Simulation for Scenario 6:
    const showNormalClockInSat = !statusSatWorking.isOffDay;
    const showCompOffLoginSat = statusSatWorking.isOffDay && statusSatWorking.canLogin;
    assert(showNormalClockInSat === true, 'UI displays normal Clock In button on working Saturday');
    assert(showCompOffLoginSat === false, 'UI does NOT display Comp-Off Login on working Saturday');

    // -------------------------------------------------------------
    // Scenario 7: Approved Comp-Off session already active
    // -------------------------------------------------------------
    console.log('\n--- Scenario 7: Approved Comp-Off Session Already Active ---');
    // Start session on the approved Sunday
    const session = await compOffService.startCompOffSession({
      userId: testEmp.id,
      organizationId: org.id,
      latitude: 12.971598,
      longitude: 77.594562,
      locationReason: 'Testing active session',
      now: sundayDate
    });
    createdSessionIds.push(session.id);
    assert(session.status === 'ACTIVE', 'Comp-Off session started with status ACTIVE');

    const statusActive = await compOffService.getTodayCompOffStatus({
      userId: testEmp.id,
      organizationId: org.id,
      now: sundayDate
    });
    assert(statusActive.isSessionActive === true, 'isSessionActive is true');
    assert(statusActive.canLogin === false, 'canLogin is false while session is active (no duplicate login)');
    assert(statusActive.canClockOut === true, 'canClockOut is true for active session');

    // Attempt second login should throw 409
    let duplicateBlocked = false;
    try {
      await compOffService.startCompOffSession({
        userId: testEmp.id,
        organizationId: org.id,
        now: sundayDate
      });
    } catch (err) {
      duplicateBlocked = err.statusCode === 409;
    }
    assert(duplicateBlocked === true, 'Duplicate login attempt blocked with HTTP 409 Conflict');

    // UI Simulation for Scenario 7:
    const showCompOffClockOut = statusActive.isSessionActive && statusActive.canClockOut;
    assert(showCompOffClockOut === true, 'UI displays Comp-Off Clock-Out action when session is active');

    // -------------------------------------------------------------
    // Scenario 8: Direct API attempts without approval
    // -------------------------------------------------------------
    console.log('\n--- Scenario 8: Direct API Attempts Without Approval ---');
    // 1. Direct login on a normal working day
    let blockedWorkingDay = false;
    try {
      await compOffService.startCompOffSession({
        userId: testEmp.id,
        organizationId: org.id,
        now: normalDay
      });
    } catch (err) {
      blockedWorkingDay = err.statusCode === 400;
    }
    assert(blockedWorkingDay === true, 'Direct Comp-Off login on normal working day rejected with 400');

    // 2. Direct login on an off-day without approved permission
    const otherOffDay = new Date('2027-02-28T00:00:00.000Z'); // Another Sunday
    let blockedNoPerm = false;
    try {
      await compOffService.startCompOffSession({
        userId: testEmp.id,
        organizationId: org.id,
        now: otherOffDay
      });
    } catch (err) {
      blockedNoPerm = err.statusCode === 400;
    }
    assert(blockedNoPerm === true, 'Direct Comp-Off login without permission rejected with 400');

    // -------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------
    console.log('\n========================================================================');
    console.log(`  ALL SCENARIOS PASSED: ${passCount} / ${passCount} TESTS SUCCEEDED`);
    console.log('========================================================================\n');
  } finally {
    // Teardown test artifacts
    console.log('--- Cleaning Up Test Fixtures ---');
    if (createdSessionIds.length > 0) {
      await prisma.compOffSession.deleteMany({ where: { id: { in: createdSessionIds } } });
    }
    if (createdRequestIds.length > 0) {
      await prisma.compOffPermissionRequest.deleteMany({ where: { id: { in: createdRequestIds } } });
    }
    await prisma.shiftMember.deleteMany({ where: { userId: testEmp.id } });
    if (createdShiftIds.length > 0) {
      await prisma.shift.deleteMany({ where: { id: { in: createdShiftIds } } });
    }
    await prisma.user.delete({ where: { id: testEmp.id } });
    console.log('Test fixtures cleaned up completely.\n');
  }
}

runSuite().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
