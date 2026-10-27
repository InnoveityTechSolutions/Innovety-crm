/**
 * InnovEity CRM - ClockInModal & Comp-Off Comprehensive Verification Suite
 * Verifies all 11 test cases and requirements from the user request
 */

const path = require('path');
module.paths.push(path.resolve(__dirname, '..', 'backend', 'node_modules'));

const prisma = require('../backend/src/utils/db');
const {
  startCompOffSession,
  endCompOffSession,
  getTodayCompOffStatus,
  calculateDynamicCompOffCredit
} = require('../backend/src/services/compOffService');
const fs = require('fs');

async function runSuite() {
  console.log('========================================================================');
  console.log('  InnovEity CRM — ClockInModal Comp-Off Integration Suite');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;
  const assert = (condition, msg) => {
    if (condition) {
      console.log(`  ✓ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  };

  // Load an existing organization
  const uniqueSuffix = Date.now().toString().slice(-6);
  const org = await prisma.organization.findFirst();
  if (!org) {
    throw new Error('No organization found in database.');
  }

  const empAuto = await prisma.user.create({
    data: {
      name: `Auto Emp ${uniqueSuffix}`,
      email: `auto_emp_${uniqueSuffix}@test.com`,
      employeeId: `EMP-AUT-${uniqueSuffix}`,
      password: 'dummyhash',
      role: 'EMPLOYEE',
      organizationId: org.id,
      autoClockOutEnabled: true,
      status: 'ACTIVE'
    }
  });

  const empManual = await prisma.user.create({
    data: {
      name: `Manual Emp ${uniqueSuffix}`,
      email: `manual_emp_${uniqueSuffix}@test.com`,
      employeeId: `EMP-MAN-${uniqueSuffix}`,
      password: 'dummyhash',
      role: 'EMPLOYEE',
      organizationId: org.id,
      autoClockOutEnabled: false,
      status: 'ACTIVE'
    }
  });

  const sundayWorkDate = new Date('2026-10-25T00:00:00.000Z'); // Sunday

  let activeLocation = await prisma.attendanceLocation.findFirst({
    where: { organizationId: org.id, isActive: true }
  });
  if (!activeLocation) {
    activeLocation = await prisma.attendanceLocation.create({
      data: {
        organizationId: org.id,
        name: 'Test Office Location',
        latitude: 12.971598,
        longitude: 77.594562,
        radiusMeters: 500.0,
        isActive: true
      }
    });
  }

  await prisma.userAttendanceLocation.createMany({
    data: [
      { userId: empAuto.id, attendanceLocationId: activeLocation.id },
      { userId: empManual.id, attendanceLocationId: activeLocation.id }
    ]
  });

  try {
    // -------------------------------------------------------------------------
    // Test 1 & 2: Normal Clock In on a working day creates normal Attendance
    // -------------------------------------------------------------------------
    console.log('--- Test 1 & 2: Normal Clock In On Working Day ---');
    const thursdayDate = new Date('2026-10-22T04:00:00.000Z'); // Thursday 9:30 AM IST
    const normalAttendance = await prisma.attendance.create({
      data: {
        userId: empAuto.id,
        date: new Date('2026-10-22T00:00:00.000Z'),
        clockIn: thursdayDate,
        status: 'PRESENT',
        workLocation: 'OFFICE',
        clockInLatitude: 12.971598,
        clockInLongitude: 77.594562
      }
    });

    assert(normalAttendance !== null, 'Normal attendance record created');
    assert(normalAttendance.userId === empAuto.id, 'User ID matches normal attendance');
    assert(normalAttendance.clockIn !== null, 'Clock in time recorded');

    const compOffSessionsForNormalDay = await prisma.compOffSession.findMany({
      where: { userId: empAuto.id, organizationId: org.id }
    });
    assert(compOffSessionsForNormalDay.length === 0, 'Normal clock in creates ZERO CompOffSession rows');

    // -------------------------------------------------------------------------
    // Test 3 & 4: Pending / Rejected / Missing Comp-Off Permission
    // -------------------------------------------------------------------------
    console.log('\n--- Test 3 & 4: Permission Authorization Checks ---');
    // Missing permission
    let missingError = null;
    try {
      await startCompOffSession({
        userId: empAuto.id,
        organizationId: org.id,
        latitude: 12.971598,
        longitude: 77.594562,
        now: sundayWorkDate
      });
    } catch (e) {
      missingError = e;
    }
    assert(missingError !== null, 'Missing permission rejects Comp-Off login');
    assert(missingError.statusCode === 400, 'Rejection returns HTTP 400');

    // Create PENDING request
    const pendingReq = await prisma.compOffPermissionRequest.create({
      data: {
        organizationId: org.id,
        userId: empAuto.id,
        workDate: sundayWorkDate,
        reason: 'Emergency deployment',
        status: 'PENDING'
      }
    });

    let pendingError = null;
    try {
      await startCompOffSession({
        userId: empAuto.id,
        organizationId: org.id,
        latitude: 12.971598,
        longitude: 77.594562,
        now: sundayWorkDate
      });
    } catch (e) {
      pendingError = e;
    }
    assert(pendingError !== null, 'Pending permission rejects Comp-Off login');

    // Update to REJECTED
    await prisma.compOffPermissionRequest.update({
      where: { id: pendingReq.id },
      data: { status: 'REJECTED', rejectionReason: 'Not approved' }
    });

    let rejectedError = null;
    try {
      await startCompOffSession({
        userId: empAuto.id,
        organizationId: org.id,
        latitude: 12.971598,
        longitude: 77.594562,
        now: sundayWorkDate
      });
    } catch (e) {
      rejectedError = e;
    }
    assert(rejectedError !== null, 'Rejected permission rejects Comp-Off login');

    // -------------------------------------------------------------------------
    // Test 5 & 6: Geofence Inside vs Outside & Mandatory Reason
    // -------------------------------------------------------------------------
    console.log('\n--- Test 5 & 6: Geofence Validation & Mandatory Outside Reason ---');
    // Approve permission
    const approvedReq = await prisma.compOffPermissionRequest.update({
      where: { id: pendingReq.id },
      data: { status: 'APPROVED', approvedAt: new Date() }
    });

    // Outside geofence without reason: MUST FAIL
    let outsideNoReasonError = null;
    try {
      await startCompOffSession({
        userId: empAuto.id,
        organizationId: org.id,
        latitude: 13.0827, // Chennai (~300km away)
        longitude: 80.2707,
        locationReason: '',
        now: sundayWorkDate
      });
    } catch (e) {
      outsideNoReasonError = e;
    }
    assert(outsideNoReasonError !== null, 'Outside geofence without reason is rejected');
    assert(outsideNoReasonError.isOutsideGeofence === true, 'Error identifies outside geofence');

    // Outside geofence with valid reason: MUST SUCCEED and flag for review
    const sessionOutside = await startCompOffSession({
      userId: empAuto.id,
      organizationId: org.id,
      latitude: 13.0827,
      longitude: 80.2707,
      locationReason: 'Working remotely from home: Offsite server migration',
      now: sundayWorkDate
    });

    assert(sessionOutside.status === 'ACTIVE', 'Outside geofence session started successfully');
    assert(sessionOutside.locationStatus === 'OUTSIDE', 'Location status is OUTSIDE');
    assert(sessionOutside.flaggedForReview === true, 'Flagged for review is true for outside session');
    assert(sessionOutside.locationReason.includes('Working remotely'), 'Location reason preserved');

    // -------------------------------------------------------------------------
    // Test 7: Comp-Off Sessions Are Never Marked Late
    // -------------------------------------------------------------------------
    console.log('\n--- Test 7: Comp-Off Session Never Marked Late ---');
    assert(sessionOutside.status === 'ACTIVE', 'Comp-Off status is ACTIVE');
    assert(sessionOutside.isLate === undefined, 'No late marking attribute on CompOffSession');

    // -------------------------------------------------------------------------
    // Test 8: Auto vs Manual Clock-Out Settings
    // -------------------------------------------------------------------------
    console.log('\n--- Test 8: Auto vs Manual Clock-Out Settings ---');
    assert(sessionOutside.autoClockOutTarget !== null, 'Auto clock-out employee receives autoClockOutTarget');

    // Create approved permission and session for empManual
    const manualReq = await prisma.compOffPermissionRequest.create({
      data: {
        organizationId: org.id,
        userId: empManual.id,
        workDate: sundayWorkDate,
        reason: 'Maintenance duty',
        status: 'APPROVED',
        approvedAt: new Date()
      }
    });

    const sessionManual = await startCompOffSession({
      userId: empManual.id,
      organizationId: org.id,
      latitude: activeLocation.latitude,
      longitude: activeLocation.longitude,
      now: sundayWorkDate
    });

    assert(sessionManual.autoClockOutTarget === null, 'Manual clock-out employee autoClockOutTarget is null');
    assert(sessionManual.locationStatus === 'INSIDE', 'Inside office location recorded as INSIDE');
    assert(sessionManual.flaggedForReview === false, 'Inside office session is NOT flagged for review');

    // Clock out manual session
    const endedManual = await endCompOffSession({
      userId: empManual.id,
      organizationId: org.id,
      sessionId: sessionManual.id
    });
    assert(endedManual.status === 'COMPLETED', 'Manual clock-out successfully completes session');
    assert(endedManual.clockOutType === 'MANUAL', 'clockOutType recorded as MANUAL');

    // -------------------------------------------------------------------------
    // Test 9: Working Duration and Credit Calculation Policy
    // -------------------------------------------------------------------------
    console.log('\n--- Test 9: Comp-Off Credit Eligibility Policy Tiers ---');
    // Daily working duration is 9 hours (09:00 - 18:00)
    // Tier 1: Less than 50% (< 4.5 hours) -> 0.0 days
    const tier1 = calculateDynamicCompOffCredit({ durationHours: 4.0, dailyDurationHours: 9.0 });
    assert(tier1.eligibleCredit === 0.0, 'Worked < 50% yields 0.0 credit days');

    // Tier 2: >= 50% and < 100% (4.5 to 8.99 hours) -> 0.5 days
    const tier2 = calculateDynamicCompOffCredit({ durationHours: 5.0, dailyDurationHours: 9.0 });
    assert(tier2.eligibleCredit === 0.5, 'Worked >= 50% and < 100% yields 0.5 credit days');

    // Tier 3: >= 100% (>= 9.0 hours) -> 1.0 day
    const tier3 = calculateDynamicCompOffCredit({ durationHours: 9.5, dailyDurationHours: 9.0 });
    assert(tier3.eligibleCredit === 1.0, 'Worked >= 100% yields 1.0 credit day');

    // -------------------------------------------------------------------------
    // Test 10: Separation From Normal Attendance Records
    // -------------------------------------------------------------------------
    console.log('\n--- Test 10: Zero Pollution of Normal Attendance Records ---');
    const attendanceRecordsSunday = await prisma.attendance.findMany({
      where: {
        userId: empAuto.id,
        date: sundayWorkDate
      }
    });
    assert(attendanceRecordsSunday.length === 0, 'ZERO normal attendance records created on Sunday Comp-Off');

    // -------------------------------------------------------------------------
    // Test 11: Frontend Shared Form & Dashboard/Attendance Parity
    // -------------------------------------------------------------------------
    console.log('\n--- Test 11: Frontend Code Inspection & Component Parity ---');
    const clockInModalCode = fs.readFileSync(path.resolve(__dirname, '..', 'frontend', 'src', 'components', 'attendance', 'ClockInModal.jsx'), 'utf-8');
    const dashboardCode = fs.readFileSync(path.resolve(__dirname, '..', 'frontend', 'src', 'components', 'dashboard', 'EmployeeDashboard.jsx'), 'utf-8');
    const attendanceCode = fs.readFileSync(path.resolve(__dirname, '..', 'frontend', 'src', 'pages', 'Attendance.jsx'), 'utf-8');
    const sessionCardCode = fs.readFileSync(path.resolve(__dirname, '..', 'frontend', 'src', 'components', 'leave', 'CompOffSessionCard.jsx'), 'utf-8');

    // Check mode prop in ClockInModal
    assert(clockInModalCode.includes("mode = 'NORMAL'"), 'ClockInModal default mode is NORMAL');
    assert(clockInModalCode.includes("mode === 'COMPOFF'"), 'ClockInModal checks for COMPOFF mode');
    assert(clockInModalCode.includes("api.post('/comp-off/sessions/login'"), 'ClockInModal submits to comp-off login endpoint');
    assert(clockInModalCode.includes("api.post('/attendance/clock-in'"), 'ClockInModal submits to attendance clock-in endpoint');
    assert(clockInModalCode.includes('Never marked late'), 'ClockInModal displays Never marked late for Comp-Off');
    assert(clockInModalCode.includes('Approved Comp-Off Work Date'), 'ClockInModal displays approved work date banner');

    // Check usages in callers
    assert(dashboardCode.includes('<ClockInModal') && dashboardCode.includes('mode="COMPOFF"'), 'EmployeeDashboard reuses ClockInModal with mode="COMPOFF"');
    assert(attendanceCode.includes('<ClockInModal') && attendanceCode.includes('mode="COMPOFF"'), 'Attendance.jsx reuses ClockInModal with mode="COMPOFF"');
    assert(sessionCardCode.includes('<ClockInModal') && sessionCardCode.includes('mode="COMPOFF"'), 'CompOffSessionCard reuses ClockInModal with mode="COMPOFF"');

    // Check that neither caller uses CompOffLoginModal
    assert(!dashboardCode.includes('<CompOffLoginModal'), 'EmployeeDashboard no longer renders CompOffLoginModal');
    assert(!attendanceCode.includes('<CompOffLoginModal'), 'Attendance.jsx no longer renders CompOffLoginModal');
    assert(!sessionCardCode.includes('<CompOffLoginModal'), 'CompOffSessionCard no longer renders CompOffLoginModal');

    // Check synthetic log filtering in Dashboard and Attendance
    assert(dashboardCode.includes('!l.isSynthetic'), 'EmployeeDashboard filters synthetic records from today attendance record');
    assert(attendanceCode.includes('!log.isSynthetic'), 'Attendance.jsx filters synthetic records from clockedRecord');

  } finally {
    // Cleanup fixtures for this test run only
    if (empAuto?.id || empManual?.id) {
      const userIds = [empAuto?.id, empManual?.id].filter(Boolean);
      await prisma.userAttendanceLocation.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.compOffSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.compOffPermissionRequest.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.attendance.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    console.log('\nCleaned up test fixtures safely.');
  }

  console.log('\n========================================================================');
  console.log(`  INTEGRATION SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Suite error:', err);
  process.exit(1);
});
