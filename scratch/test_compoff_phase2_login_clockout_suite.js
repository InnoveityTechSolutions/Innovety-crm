const path = require('path');
module.paths.push(path.resolve(__dirname, '..', 'backend', 'node_modules'));

const prisma = require('../backend/src/utils/db');
const {
  getTodayCompOffStatus,
  startCompOffSession,
  endCompOffSession,
  processCompOffAutoClockOut,
  getCompOffSessions,
  getCompOffPolicySettings,
  getUserCompOffLedgerBalance
} = require('../backend/src/services/compOffService');
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

async function runPhase2SessionTestSuite() {
  console.log('========================================================================');
  console.log('  InnovEity CRM — Comp-Off Phase 2: Separate Login and Clock-Out Suite');
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

  // Setup temporary users and records
  let manualUser = null;
  let autoUser = null;
  let org2Employee = null;
  let testOfficeLocation = null;
  const createdSessionIds = [];
  const createdPermissionIds = [];

  const settings = await getEffectiveSettings(org1.id);
  const now = new Date();
  const todayDate = getTodayZonedDate(now, settings?.timezone || 'Asia/Kolkata');

  try {
    // 1. Create a test employee with autoClockOutEnabled = false
    manualUser = await prisma.user.create({
      data: {
        name: 'Phase2 Manual ClockOut User',
        email: `phase2_manual_${Date.now()}@test.com`,
        employeeId: `MAN-${Date.now()}`,
        password: 'hashedpassword',
        role: 'EMPLOYEE',
        organizationId: org1.id,
        autoClockOutEnabled: false,
        status: 'ACTIVE'
      }
    });

    // 2. Create a test employee with autoClockOutEnabled = true
    autoUser = await prisma.user.create({
      data: {
        name: 'Phase2 Auto ClockOut User',
        email: `phase2_auto_${Date.now()}@test.com`,
        employeeId: `AUTO-${Date.now()}`,
        password: 'hashedpassword',
        role: 'EMPLOYEE',
        organizationId: org1.id,
        autoClockOutEnabled: true,
        status: 'ACTIVE'
      }
    });

    // 3. Create test employee in Org 2 for tenant isolation
    org2Employee = await prisma.user.create({
      data: {
        name: 'Phase2 Org2 Employee',
        email: `phase2_org2_${Date.now()}@test.com`,
        employeeId: `ORG2-${Date.now()}`,
        password: 'hashedpassword',
        role: 'EMPLOYEE',
        organizationId: org2.id,
        status: 'ACTIVE'
      }
    });

    // 4. Create an active AttendanceLocation in Org 1
    testOfficeLocation = await prisma.attendanceLocation.create({
      data: {
        organizationId: org1.id,
        name: 'Phase2 Test Tech Park',
        latitude: 12.9716,
        longitude: 77.5946,
        radiusMeters: 200.0,
        isActive: true
      }
    });

    await prisma.userAttendanceLocation.createMany({
      data: [
        { userId: autoUser.id, attendanceLocationId: testOfficeLocation.id },
        { userId: manualUser.id, attendanceLocationId: testOfficeLocation.id }
      ]
    });

    // Clean any pre-existing permissions or sessions for today for autoUser and manualUser
    await prisma.compOffSession.deleteMany({
      where: { userId: { in: [autoUser.id, manualUser.id] }, workDate: todayDate }
    });
    await prisma.compOffPermissionRequest.deleteMany({
      where: { userId: { in: [autoUser.id, manualUser.id] }, workDate: todayDate }
    });

    // =========================================================================
    // TEST GROUP 1: Pre-requisite Permission Checks & Button Visibility
    // =========================================================================
    console.log('--- Test Group 1: Pre-requisite Permission Checks & Button Visibility ---');

    // 1.1 No advance permission exists -> canLogin: false
    const statusNoPerm = await getTodayCompOffStatus({
      userId: autoUser.id,
      organizationId: org1.id,
      now
    });
    assert(statusNoPerm.canLogin === false, 'canLogin is false when no permission request exists');
    assert(statusNoPerm.reason === 'NO_APPROVED_PERMISSION', 'Reason explains no approved permission');

    // 1.2 Pending permission -> canLogin: false
    const pendingPerm = await prisma.compOffPermissionRequest.create({
      data: {
        organizationId: org1.id,
        userId: autoUser.id,
        workDate: todayDate,
        holidayType: 'WEEKLY_OFF',
        reason: 'Weekend release deployment',
        status: 'PENDING'
      }
    });
    createdPermissionIds.push(pendingPerm.id);

    const statusPending = await getTodayCompOffStatus({
      userId: autoUser.id,
      organizationId: org1.id,
      now
    });
    assert(statusPending.canLogin === false, 'canLogin is false when request is PENDING');

    // 1.3 Rejected permission -> canLogin: false
    await prisma.compOffPermissionRequest.update({
      where: { id: pendingPerm.id },
      data: {
        status: 'REJECTED',
        rejectionReason: 'Not approved for this project'
      }
    });

    const statusRejected = await getTodayCompOffStatus({
      userId: autoUser.id,
      organizationId: org1.id,
      now
    });
    assert(statusRejected.canLogin === false, 'canLogin is false when request is REJECTED');

    // 1.4 Approved permission -> canLogin: true
    await prisma.compOffPermissionRequest.update({
      where: { id: pendingPerm.id },
      data: {
        status: 'APPROVED',
        approvedById: adminUser.id,
        approvedAt: new Date()
      }
    });

    const statusApproved = await getTodayCompOffStatus({
      userId: autoUser.id,
      organizationId: org1.id,
      now
    });
    assert(statusApproved.canLogin === true, 'canLogin is true when advance permission is APPROVED for today');
    assert(statusApproved.canClockOut === false, 'canClockOut is false prior to login');
    assert(statusApproved.permissionRequest.id === pendingPerm.id, 'permissionRequest returned in status');

    // =========================================================================
    // TEST GROUP 2: Comp-Off Login & Geofence Validation
    // =========================================================================
    console.log('\n--- Test Group 2: Comp-Off Login & Geofence Validation ---');

    // 2.1 Attempt login outside geofence without reason -> REJECTED (400)
    let rejectedNoReason = false;
    try {
      await startCompOffSession({
        userId: autoUser.id,
        organizationId: org1.id,
        latitude: 13.5000, // ~60 km away from Bangalore office
        longitude: 77.9000,
        locationReason: '', // Empty reason
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
      });
    } catch (err) {
      rejectedNoReason = err.statusCode === 400 && err.isOutsideGeofence === true;
    }
    assert(rejectedNoReason, 'Out-of-geofence login without reason is rejected with 400');

    // 2.2 Attempt login outside geofence with valid reason -> ACCEPTED with flag
    const sessionOutside = await startCompOffSession({
      userId: autoUser.id,
      organizationId: org1.id,
      latitude: 13.5000,
      longitude: 77.9000,
      locationReason: 'Client site emergency support in North Hub',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
    });
    createdSessionIds.push(sessionOutside.id);

    assert(sessionOutside.status === 'ACTIVE', 'Comp-Off session started with status ACTIVE');
    assert(sessionOutside.locationStatus === 'OUTSIDE', 'locationStatus recorded as OUTSIDE');
    assert(sessionOutside.flaggedForReview === true, 'flaggedForReview is true for out-of-geofence session');
    assert(sessionOutside.locationReason === 'Client site emergency support in North Hub', 'locationReason preserved');
    assert(sessionOutside.device === 'Desktop', 'Device correctly parsed from userAgent');
    assert(sessionOutside.browser === 'Chrome', 'Browser correctly parsed from userAgent');

    // 2.3 Status now reflects ACTIVE session
    const statusActive = await getTodayCompOffStatus({
      userId: autoUser.id,
      organizationId: org1.id,
      now
    });
    assert(statusActive.canLogin === false, 'canLogin is false once session is ACTIVE');
    assert(statusActive.canClockOut === true, 'canClockOut is true when session is ACTIVE');
    assert(statusActive.isSessionActive === true, 'isSessionActive flag is set');

    // 2.4 Duplicate login attempt -> REJECTED (409 Conflict)
    let dupRejected = false;
    try {
      await startCompOffSession({
        userId: autoUser.id,
        organizationId: org1.id,
        latitude: 12.9716,
        longitude: 77.5946
      });
    } catch (err) {
      dupRejected = err.statusCode === 409;
    }
    assert(dupRejected, 'Duplicate login for same user and date rejected with 409 Conflict');

    // =========================================================================
    // TEST GROUP 3: Separation From Normal Attendance & No Late Marking
    // =========================================================================
    console.log('\n--- Test Group 3: Separation From Normal Attendance & No Late Marking ---');

    // 3.1 Verify ZERO records exist in attendance table for this user & date
    const attendanceCount = await prisma.attendance.count({
      where: {
        userId: autoUser.id,
        date: todayDate
      }
    });
    assert(attendanceCount === 0, 'Comp-Off login creates ZERO normal attendance records (isolated table)');

    // 3.2 Verify loginTime is preserved as actual start time without late comparison
    const sessionRecord = await prisma.compOffSession.findUnique({
      where: { id: sessionOutside.id }
    });
    assert(Boolean(sessionRecord.loginTime), 'Actual loginTime is recorded');
    // Ensure no attendance status like LATE is attached to session
    assert(sessionRecord.status === 'ACTIVE', 'Session has clean ACTIVE status, no LATE marking');

    // =========================================================================
    // TEST GROUP 4: Manual Clock-Out & Duration Computation
    // =========================================================================
    console.log('\n--- Test Group 4: Manual Clock-Out & Duration Computation ---');

    // 4.1 Clock out after simulated 4.5 hours
    const simulatedClockOutTime = new Date(new Date(sessionRecord.loginTime).getTime() + 4.5 * 3600000);
    const completedSession = await endCompOffSession({
      userId: autoUser.id,
      organizationId: org1.id,
      sessionId: sessionRecord.id,
      now: simulatedClockOutTime
    });

    assert(completedSession.status === 'COMPLETED', 'Session status transitioned to COMPLETED');
    assert(completedSession.clockOutType === 'MANUAL', 'clockOutType is recorded as MANUAL');
    assert(Number(completedSession.durationHours) === 4.5, `durationHours accurately computed as 4.5 (actual: ${completedSession.durationHours})`);
    assert(Boolean(completedSession.clockOutTime), 'clockOutTime recorded');

    // 4.2 Status now reflects COMPLETED
    const statusCompleted = await getTodayCompOffStatus({
      userId: autoUser.id,
      organizationId: org1.id,
      now: simulatedClockOutTime
    });
    assert(statusCompleted.canLogin === false, 'canLogin is false when session is COMPLETED');
    assert(statusCompleted.canClockOut === false, 'canClockOut is false when session is COMPLETED');
    assert(statusCompleted.isSessionCompleted === true, 'isSessionCompleted flag is true');

    // 4.3 Duplicate clock-out on completed session -> REJECTED (404/400)
    let dupClockOutRejected = false;
    try {
      await endCompOffSession({
        userId: autoUser.id,
        organizationId: org1.id,
        sessionId: sessionRecord.id
      });
    } catch (err) {
      dupClockOutRejected = err.statusCode === 404 || err.statusCode === 400;
    }
    assert(dupClockOutRejected, 'Duplicate clock-out attempt on completed session is rejected');

    // =========================================================================
    // TEST GROUP 5: Auto-Clock-Out by Configured Daily Duration
    // =========================================================================
    console.log('\n--- Test Group 5: Auto-Clock-Out by Configured Daily Duration ---');

    // Setup an approved permission for manualUser
    const manualPerm = await prisma.compOffPermissionRequest.create({
      data: {
        organizationId: org1.id,
        userId: manualUser.id,
        workDate: todayDate,
        holidayType: 'COMPANY_HOLIDAY',
        reason: 'Holiday maintenance shift',
        status: 'APPROVED',
        approvedById: adminUser.id,
        approvedAt: new Date()
      }
    });
    createdPermissionIds.push(manualPerm.id);

    // Setup inside geofence session for autoUser on simulated earlier login
    // Let's create an active session for manualUser (autoClockOutEnabled = false)
    const manualLoginSimulated = new Date(todayDate.getTime() + 10 * 3600000);
    const manualSession = await startCompOffSession({
      userId: manualUser.id,
      organizationId: org1.id,
      latitude: 12.9716, // Inside test office location
      longitude: 77.5946,
      now: manualLoginSimulated
    });
    createdSessionIds.push(manualSession.id);

    assert(manualSession.locationStatus === 'INSIDE', 'Inside geofence records locationStatus INSIDE');
    assert(manualSession.flaggedForReview === false, 'Inside geofence flaggedForReview is false');
    assert(manualSession.autoClockOutTarget === null, 'autoClockOutTarget is null when user.autoClockOutEnabled is false');

    // Create an active session with autoClockOutEnabled = true on a different date (or mock user)
    const autoClockPerm = await prisma.compOffPermissionRequest.create({
      data: {
        organizationId: org1.id,
        userId: autoUser.id,
        workDate: new Date('2026-10-25T00:00:00.000Z'),
        holidayType: 'WEEKLY_OFF',
        reason: 'Production upgrade',
        status: 'APPROVED',
        approvedById: adminUser.id,
        approvedAt: new Date()
      }
    });
    createdPermissionIds.push(autoClockPerm.id);

    const loginTime = new Date('2026-10-25T11:00:00.000Z');
    // Daily configured duration: 09:00 to 18:00 = 9 hours (or 8 hours)
    // autoClockOutTarget = loginTime + duration
    const autoSession = await prisma.compOffSession.create({
      data: {
        organizationId: org1.id,
        userId: autoUser.id,
        permissionRequestId: autoClockPerm.id,
        workDate: new Date('2026-10-25T00:00:00.000Z'),
        loginTime,
        status: 'ACTIVE',
        locationStatus: 'INSIDE',
        autoClockOutTarget: new Date(loginTime.getTime() + 8 * 3600000) // 8 hours -> 19:00:00
      }
    });
    createdSessionIds.push(autoSession.id);

    // 5.1 Before target time (e.g. at 6.0 hours into shift, 17:00) -> auto clock-out skips
    const checkBeforeTarget = await processCompOffAutoClockOut(new Date('2026-10-25T17:00:00.000Z'));
    const sessionStillActive = await prisma.compOffSession.findUnique({
      where: { id: autoSession.id }
    });
    assert(sessionStillActive.status === 'ACTIVE', 'Session remains ACTIVE before autoClockOutTarget is reached');

    // 5.2 Manual user session check: passes beyond duration (e.g. 10 hours later) -> still SKIPPED
    const checkManual = await processCompOffAutoClockOut(new Date(todayDate.getTime() + 22 * 3600000));
    const manualStillActive = await prisma.compOffSession.findUnique({
      where: { id: manualSession.id }
    });
    assert(manualStillActive.status === 'ACTIVE', 'Manual clock-out employee session remains ACTIVE past normal duration (not auto-closed)');

    // 5.3 Target reached (e.g. at 19:01, 8h 1min after login) -> auto clocked out!
    const runAutoClockOut = await processCompOffAutoClockOut(new Date('2026-10-25T19:01:00.000Z'));
    assert(runAutoClockOut.autoClockedOutCount >= 1, 'processCompOffAutoClockOut auto-clocked out qualifying session');

    const autoClosedSession = await prisma.compOffSession.findUnique({
      where: { id: autoSession.id }
    });
    assert(autoClosedSession.status === 'COMPLETED', 'Session status is COMPLETED');
    assert(autoClosedSession.clockOutType === 'AUTO', 'clockOutType is recorded as AUTO');
    assert(Number(autoClosedSession.durationHours) >= 8.0, `durationHours recorded (${autoClosedSession.durationHours} hrs)`);

    // 5.4 Re-running scheduler is idempotent
    const recheckAuto = await processCompOffAutoClockOut(new Date('2026-10-25T19:05:00.000Z'));
    const reclosedSessionCount = recheckAuto.results.filter(r => r.id === autoSession.id).length;
    assert(reclosedSessionCount === 0, 'Re-running auto clock-out scheduler is idempotent (zero duplicate closures)');

    // =========================================================================
    // TEST GROUP 6: Admin Visibility, Scoping & Tenant Isolation
    // =========================================================================
    console.log('\n--- Test Group 6: Admin Visibility, Scoping & Tenant Isolation ---');

    // 6.1 Admin can list sessions in Org 1
    const adminListing = await getCompOffSessions({
      organizationId: org1.id,
      requestingUser: adminUser
    });
    assert(Array.isArray(adminListing.sessions), 'Admin listing returns array of sessions');
    assert(adminListing.sessions.some(s => s.id === autoSession.id), 'Admin can view employee Comp-Off sessions');

    // 6.2 Regular Employee can ONLY view their own sessions
    const empListing = await getCompOffSessions({
      organizationId: org1.id,
      requestingUser: autoUser
    });
    assert(empListing.sessions.every(s => s.userId === autoUser.id), 'Employee only sees their own Comp-Off sessions');

    // 6.3 Cross-tenant isolation: Org 2 cannot access Org 1 sessions
    const org2Listing = await getCompOffSessions({
      organizationId: org2.id,
      requestingUser: org2Employee
    });
    const leakCount = org2Listing.sessions.filter(s => s.organizationId === org1.id).length;
    assert(leakCount === 0, 'Cross-tenant access strictly blocked (zero Org 1 sessions visible to Org 2)');

    // =========================================================================
    // TEST GROUP 7: Confirmation of Zero Credit Generation in Phase 2
    // =========================================================================
    console.log('\n--- Test Group 7: Confirmation of Zero Credit Generation in Phase 2 ---');

    // Check CompOffCredit ledger for autoUser
    const creditsCount = await prisma.compOffCredit.count({
      where: { userId: autoUser.id }
    });
    assert(creditsCount === 0, 'ZERO CompOffCredit rows created by Comp-Off Login or Clock-Out');

    const autoUserBalance = await getUserCompOffLedgerBalance(autoUser.id);
    assert(autoUserBalance.netAvailable === 0, 'Comp-Off ledger balance remains 0.0 (no credit issued)');
    assert(autoUserBalance.totalEarned === 0, 'Total earned Comp-Off days remains 0.0');

  } finally {
    // Teardown Fixtures
    console.log('\n--- Teardown: Cleaning Phase 2 Test Fixtures ---');
    if (createdSessionIds.length > 0) {
      await prisma.compOffSession.deleteMany({
        where: { id: { in: createdSessionIds } }
      });
    }
    if (createdPermissionIds.length > 0) {
      await prisma.compOffPermissionRequest.deleteMany({
        where: { id: { in: createdPermissionIds } }
      });
    }
    if (testOfficeLocation) {
      await prisma.userAttendanceLocation.deleteMany({
        where: { attendanceLocationId: testOfficeLocation.id }
      });
      await prisma.attendanceLocation.deleteMany({
        where: { id: testOfficeLocation.id }
      });
    }
    if (manualUser) {
      await prisma.user.deleteMany({ where: { id: manualUser.id } });
    }
    if (autoUser) {
      await prisma.user.deleteMany({ where: { id: autoUser.id } });
    }
    if (org2Employee) {
      await prisma.user.deleteMany({ where: { id: org2Employee.id } });
    }
    console.log('Phase 2 test fixtures cleaned up successfully.');
  }

  console.log('\n========================================================================');
  console.log(`  PHASE 2 SESSION TEST SUITE COMPLETED: ${passedTests} / ${totalTests} TESTS PASSED`);
  console.log('========================================================================\n');
}

runPhase2SessionTestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test Suite Failed with Error:', err);
    process.exit(1);
  });
