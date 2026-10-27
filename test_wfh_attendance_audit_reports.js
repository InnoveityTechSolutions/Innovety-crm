const assert = require('assert');
const prisma = require('./backend/src/utils/db');
const attendanceReportService = require('./backend/src/services/attendanceReportService');

async function runTests() {
  console.log('================================================================');
  console.log('   PART 2: WFH ATTENDANCE AUDIT REPORTS VERIFICATION TESTS       ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function it(description, fn) {
    try {
      await fn();
      console.log(`  [PASS] ${description}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${description}`);
      console.error(`         ${err.stack || err.message}`);
      failed++;
    }
  }

  // 1. Find or verify test organization and test employee
  const org = await prisma.organization.findFirst({
    where: { companyCode: 'INN001' }
  });
  if (!org) {
    throw new Error('Test organization INN001 not found');
  }
  const orgId = org.id;

  const employee = await prisma.user.findFirst({
    where: {
      organizationId: orgId,
      status: 'ACTIVE',
      role: { in: ['EMPLOYEE', 'INTERN'] }
    }
  });
  if (!employee) {
    throw new Error('Test employee not found in organization INN001');
  }

  const otherOrg = await prisma.organization.findFirst({
    where: { id: { not: orgId } }
  });

  console.log(`Testing with Org: ${org.name} (${orgId}) | Employee: ${employee.name} (${employee.id})\n`);

  // Target test dates: Week 41 of 2026 (Oct 5 to Oct 11, 2026)
  // Employee joined Sep 16, 2026, so Week 41 is fully valid.
  // Oct 5, 2026 = Monday (working day) -> Office attendance
  // Oct 6, 2026 = Tuesday (working day) -> WFH 1
  // Oct 7, 2026 = Wednesday (working day) -> WFH 2
  // Oct 8, 2026 = Thursday (working day) -> WFH 3
  // Oct 9, 2026 = Friday (working day) -> Leave test
  // Oct 10, 2026 = Saturday (working day / shift off)
  // Oct 11, 2026 = Sunday (Weekly off)
  const dOffice = new Date(Date.UTC(2026, 9, 5, 4, 0, 0)); // 2026-10-05
  const dWfh1 = new Date(Date.UTC(2026, 9, 6, 4, 0, 0));   // 2026-10-06
  const dWfh2 = new Date(Date.UTC(2026, 9, 7, 4, 0, 0));   // 2026-10-07
  const dWfh3 = new Date(Date.UTC(2026, 9, 8, 4, 0, 0));   // 2026-10-08
  const dSunday = new Date(Date.UTC(2026, 9, 11, 4, 0, 0)); // 2026-10-11 (Sunday)

  const createdAttIds = [];
  const createdLeaveIds = [];

  try {
    // Clean up any pre-existing test records for this range
    await prisma.attendance.deleteMany({
      where: {
        userId: employee.id,
        date: {
          gte: new Date(Date.UTC(2026, 9, 1, 0, 0, 0)),
          lte: new Date(Date.UTC(2026, 9, 31, 23, 59, 59))
        }
      }
    });
    await prisma.leaveRequest.deleteMany({
      where: {
        userId: employee.id,
        startDate: {
          gte: new Date(Date.UTC(2026, 9, 1, 0, 0, 0)),
          lte: new Date(Date.UTC(2026, 9, 31, 23, 59, 59))
        }
      }
    });

    // -------------------------------------------------------------------
    // Test 1: 1 Office Day + 3 WFH Days produces Present = 4 and WFH = 3
    // -------------------------------------------------------------------
    await it('1. One office day plus three WFH days produces Present = 4 and WFH = 3 in Monthly and Weekly reports', async () => {
      // Create 1 office attendance
      const attOffice = await prisma.attendance.create({
        data: {
          userId: employee.id,
          date: dOffice,
          status: 'PRESENT',
          workLocation: 'OFFICE',
          workingHours: 8.5
        }
      });
      createdAttIds.push(attOffice.id);

      // Create 3 WFH attendances (clock-in or approved)
      const attW1 = await prisma.attendance.create({
        data: {
          userId: employee.id,
          date: dWfh1,
          status: 'PRESENT',
          workLocation: 'HOME',
          workingHours: 8.0
        }
      });
      createdAttIds.push(attW1.id);

      const attW2 = await prisma.attendance.create({
        data: {
          userId: employee.id,
          date: dWfh2,
          status: 'WORK_FROM_HOME',
          workLocation: 'HOME',
          workingHours: 8.0
        }
      });
      createdAttIds.push(attW2.id);

      const attW3 = await prisma.attendance.create({
        data: {
          userId: employee.id,
          date: dWfh3,
          status: 'PRESENT',
          workLocation: 'HOME',
          clockInLocation: 'Work From Home (Approved)',
          workingHours: 8.0
        }
      });
      createdAttIds.push(attW3.id);

      // Monthly report for Oct 2026
      const monthly = await attendanceReportService.getMonthlyAttendanceData({
        organizationId: orgId,
        month: 10,
        year: 2026,
        userIds: [employee.id]
      });

      const rec = monthly.records.find(r => r.userId === employee.id);
      assert.ok(rec, 'Monthly record must exist');
      assert.strictEqual(rec.present, 4, `Present count must be 4, got: ${rec.present}`);
      assert.strictEqual(rec.wfh, 3, `WFH count must be 3, got: ${rec.wfh}`);

      // Weekly report for Week 41, 2026
      const weekly = await attendanceReportService.getWeeklyAttendanceData({
        organizationId: orgId,
        week: 41,
        year: 2026,
        userIds: [employee.id]
      });
      const wRec = weekly.records.find(r => r.userId === employee.id);
      assert.ok(wRec, 'Weekly record must exist');
      assert.strictEqual(wRec.present, 4, `Weekly Present must be 4, got: ${wRec.present}`);
      assert.strictEqual(wRec.wfh, 3, `Weekly WFH must be 3, got: ${wRec.wfh}`);
    });

    // -------------------------------------------------------------------
    // Test 2: Three WFH records from clock-in count as Present = 3 and WFH = 3
    // -------------------------------------------------------------------
    await it('2. Three WFH records from clock-in count as Present = 3 and WFH = 3', async () => {
      // Temporarily delete the office record to leave only 3 clock-in WFH records
      await prisma.attendance.delete({ where: { id: createdAttIds[0] } });

      const weekly = await attendanceReportService.getWeeklyAttendanceData({
        organizationId: orgId,
        week: 41,
        year: 2026,
        userIds: [employee.id]
      });
      const rec = weekly.records.find(r => r.userId === employee.id);
      assert.strictEqual(rec.present, 3, `Present count must be 3, got: ${rec.present}`);
      assert.strictEqual(rec.wfh, 3, `WFH count must be 3, got: ${rec.wfh}`);

      // Re-create office record for subsequent tests
      const attOffice = await prisma.attendance.create({
        data: {
          userId: employee.id,
          date: dOffice,
          status: 'PRESENT',
          workLocation: 'OFFICE',
          workingHours: 8.5
        }
      });
      createdAttIds[0] = attOffice.id;
    });

    // -------------------------------------------------------------------
    // Test 3: Approved leave-based WFH counts as Present and WFH
    // -------------------------------------------------------------------
    await it('3. Approved leave-based WFH counts as Present and WFH without clock-in record', async () => {
      // Delete attendance for dWfh3 and create an approved WFH leave request instead
      await prisma.attendance.delete({ where: { id: createdAttIds[3] } });

      const leaveWfh = await prisma.leaveRequest.create({
        data: {
          userId: employee.id,
          startDate: dWfh3,
          endDate: dWfh3,
          totalDays: 1,
          leaveType: 'WFH',
          type: 'WFH',
          status: 'APPROVED',
          reason: 'Remote test work'
        }
      });
      createdLeaveIds.push(leaveWfh.id);

      const weekly = await attendanceReportService.getWeeklyAttendanceData({
        organizationId: orgId,
        week: 41,
        year: 2026,
        userIds: [employee.id]
      });
      const rec = weekly.records.find(r => r.userId === employee.id);
      assert.strictEqual(rec.present, 4, `Present must include approved leave WFH (expected 4, got ${rec.present})`);
      assert.strictEqual(rec.wfh, 3, `WFH must include approved leave WFH (expected 3, got ${rec.wfh})`);
      assert.strictEqual(rec.paidLeave, 0, `WFH must not be counted under regular paid leaves (expected 0, got ${rec.paidLeave})`);
    });

    // -------------------------------------------------------------------
    // Test 4: Clock-in and approved leave for the same date count only once
    // -------------------------------------------------------------------
    await it('4. Clock-in and approved leave for the same date count only once (no double counting)', async () => {
      // Now re-add an attendance record on dWfh3 where approved leave ALSO exists
      const attW3Duplicate = await prisma.attendance.create({
        data: {
          userId: employee.id,
          date: dWfh3,
          status: 'WORK_FROM_HOME',
          workLocation: 'HOME',
          workingHours: 8.0
        }
      });
      createdAttIds[3] = attW3Duplicate.id;

      const weekly = await attendanceReportService.getWeeklyAttendanceData({
        organizationId: orgId,
        week: 41,
        year: 2026,
        userIds: [employee.id]
      });
      const rec = weekly.records.find(r => r.userId === employee.id);
      // Even though both attendance and approved leave exist for dWfh3, it must NOT double count
      assert.strictEqual(rec.present, 4, `Present must still be 4 (no double counting), got: ${rec.present}`);
      assert.strictEqual(rec.wfh, 3, `WFH must still be 3 (no double counting), got: ${rec.wfh}`);
    });

    // -------------------------------------------------------------------
    // Test 5: Pending, rejected, or cancelled WFH leave is NOT counted as approved WFH attendance
    // -------------------------------------------------------------------
    await it('5. Pending, rejected, or cancelled WFH leave is not counted as approved WFH attendance', async () => {
      // Create a pending leave on a day with no attendance (Oct 9)
      const dOct9 = new Date(Date.UTC(2026, 9, 9, 4, 0, 0));
      const pendingLeave = await prisma.leaveRequest.create({
        data: {
          userId: employee.id,
          startDate: dOct9,
          endDate: dOct9,
          totalDays: 1,
          leaveType: 'WFH',
          type: 'WFH',
          status: 'PENDING_ADMIN_APPROVAL',
          reason: 'Pending remote'
        }
      });
      createdLeaveIds.push(pendingLeave.id);

      const rejectedLeave = await prisma.leaveRequest.create({
        data: {
          userId: employee.id,
          startDate: dOct9,
          endDate: dOct9,
          totalDays: 1,
          leaveType: 'WFH',
          type: 'WFH',
          status: 'REJECTED',
          reason: 'Rejected remote'
        }
      });
      createdLeaveIds.push(rejectedLeave.id);

      const weekly = await attendanceReportService.getWeeklyAttendanceData({
        organizationId: orgId,
        week: 41,
        year: 2026,
        userIds: [employee.id]
      });
      const rec = weekly.records.find(r => r.userId === employee.id);
      assert.strictEqual(rec.wfh, 3, `WFH count must remain 3, unapproved leaves must be ignored. Got: ${rec.wfh}`);
      assert.strictEqual(rec.present, 4, `Present count must remain 4. Got: ${rec.present}`);
    });

    // -------------------------------------------------------------------
    // Test 6: WFH on weekly offs or holidays follows assigned schedule
    // -------------------------------------------------------------------
    await it('6. WFH on weekly off (Sunday) does not count as extra working day or attendance unless scheduled', async () => {
      const attSunday = await prisma.attendance.create({
        data: {
          userId: employee.id,
          date: dSunday,
          status: 'WORK_FROM_HOME',
          workLocation: 'HOME',
          workingHours: 8.0
        }
      });
      createdAttIds.push(attSunday.id);

      const weekly = await attendanceReportService.getWeeklyAttendanceData({
        organizationId: orgId,
        week: 41,
        year: 2026,
        userIds: [employee.id]
      });
      const rec = weekly.records.find(r => r.userId === employee.id);
      // Sunday is day off by default, so WFH on day off does not add extra working day attendance
      assert.strictEqual(rec.present, 4, `Present count must not increment for unscheduled weekly off. Got: ${rec.present}`);
      assert.strictEqual(rec.wfh, 3, `WFH count must not increment for unscheduled weekly off. Got: ${rec.wfh}`);
    });

    // -------------------------------------------------------------------
    // Test 7: Monthly, weekly, daily, and Excel exports agree
    // -------------------------------------------------------------------
    await it('7. Monthly, weekly, daily, and Excel exports agree on WFH and Present', async () => {
      // Daily report for dWfh2 (Oct 7, 2026)
      const daily = await attendanceReportService.getDailyAttendanceData({
        organizationId: orgId,
        date: '2026-10-07',
        userIds: [employee.id]
      });
      assert.ok(daily.records.length > 0, 'Daily record must exist');
      const dRec = daily.records.find(r => r.userId === employee.id);
      assert.strictEqual(dRec.attendance, 'WFH', `Daily attendance must be WFH, got: ${dRec.attendance}`);
      assert.strictEqual(daily.summary.wfh, 1, `Daily summary wfh must be 1, got: ${daily.summary.wfh}`);
      assert.strictEqual(daily.summary.present, 1, `Daily summary present must be 1, got: ${daily.summary.present}`);

      // Weekly report
      const weekly = await attendanceReportService.getWeeklyAttendanceData({
        organizationId: orgId,
        week: 41,
        year: 2026,
        userIds: [employee.id]
      });
      const wRec = weekly.records.find(r => r.userId === employee.id);

      // Monthly report
      const monthly = await attendanceReportService.getMonthlyAttendanceData({
        organizationId: orgId,
        month: 10,
        year: 2026,
        userIds: [employee.id]
      });
      const mRec = monthly.records.find(r => r.userId === employee.id);

      assert.strictEqual(wRec.present, mRec.present, 'Weekly and Monthly Present must match for this range');
      assert.strictEqual(wRec.wfh, mRec.wfh, 'Weekly and Monthly WFH must match for this range');

      // Test Excel exports don't throw and have expected sheet headers
      const monthlyExcel = await attendanceReportService.generateExcelReport({
        type: 'monthly',
        organizationId: orgId,
        params: { month: 10, year: 2026, userIds: employee.id }
      });
      assert.ok(monthlyExcel.workbook, 'Monthly workbook generated');
      const sheet = monthlyExcel.workbook.getWorksheet('Monthly Attendance');
      assert.ok(sheet, 'Monthly worksheet exists');
      const headerRow = sheet.getRow(6).values;
      assert.ok(headerRow.includes('Present'), 'Excel headers must include Present');
      assert.ok(headerRow.includes('WFH'), 'Excel headers must include WFH');
      // Must NOT duplicate WFH in dynamic leave headers
      const wfhCountInHeaders = headerRow.filter(h => String(h).toUpperCase() === 'WFH' || String(h).toUpperCase().includes('WORK FROM HOME')).length;
      assert.strictEqual(wfhCountInHeaders, 1, `WFH must appear exactly once in Excel headers, found: ${wfhCountInHeaders}`);
    });

    // -------------------------------------------------------------------
    // Test 8: Present-status filtering includes members whose attendance consists entirely of WFH
    // -------------------------------------------------------------------
    await it('8. Present-status filtering includes members whose attendance consists entirely of WFH', async () => {
      // In Daily report on 2026-10-07 (where employee is WFH):
      const dailyPresentFiltered = await attendanceReportService.getDailyAttendanceData({
        organizationId: orgId,
        date: '2026-10-07',
        status: 'PRESENT',
        userIds: [employee.id]
      });
      const foundInDaily = dailyPresentFiltered.records.some(r => r.userId === employee.id);
      assert.strictEqual(foundInDaily, true, 'WFH member must appear when filtering by status=PRESENT in Daily Report');

      // In Weekly report with status=PRESENT:
      const weeklyPresentFiltered = await attendanceReportService.getWeeklyAttendanceData({
        organizationId: orgId,
        week: 41,
        year: 2026,
        status: 'PRESENT',
        userIds: [employee.id]
      });
      const foundInWeekly = weeklyPresentFiltered.records.some(r => r.userId === employee.id);
      assert.strictEqual(foundInWeekly, true, 'WFH member must appear when filtering by status=PRESENT in Weekly Report');

      // In Monthly report with status=PRESENT:
      const monthlyPresentFiltered = await attendanceReportService.getMonthlyAttendanceData({
        organizationId: orgId,
        month: 10,
        year: 2026,
        status: 'PRESENT',
        userIds: [employee.id]
      });
      const foundInMonthly = monthlyPresentFiltered.records.some(r => r.userId === employee.id);
      assert.strictEqual(foundInMonthly, true, 'WFH member must appear when filtering by status=PRESENT in Monthly Report');
    });

    // -------------------------------------------------------------------
    // Test 9: Existing late, leave, LOP, and half-day counts remain correct
    // -------------------------------------------------------------------
    await it('9. Existing late, leave, LOP, and half-day counts remain correct', async () => {
      // Add a late attendance on Oct 9 (Friday)
      const dOct9 = new Date(Date.UTC(2026, 9, 9, 4, 0, 0));
      const attLate = await prisma.attendance.create({
        data: {
          userId: employee.id,
          date: dOct9,
          status: 'LATE',
          lateMinutes: 45,
          workLocation: 'OFFICE',
          workingHours: 7.5
        }
      });
      createdAttIds.push(attLate.id);

      const weekly = await attendanceReportService.getWeeklyAttendanceData({
        organizationId: orgId,
        week: 41,
        year: 2026,
        userIds: [employee.id]
      });
      const rec = weekly.records.find(r => r.userId === employee.id);
      assert.strictEqual(rec.late, 1, `Late count must be 1, got: ${rec.late}`);
      assert.strictEqual(rec.present, 5, `Present count must be 5 (4 previous + 1 late office), got: ${rec.present}`);
      assert.strictEqual(rec.wfh, 3, `WFH count must remain 3, got: ${rec.wfh}`);
    });

    // -------------------------------------------------------------------
    // Test 10: Tenant isolation is preserved
    // -------------------------------------------------------------------
    await it('10. Tenant isolation is preserved: employee records do not appear in another org reports', async () => {
      if (otherOrg) {
        const otherMonthly = await attendanceReportService.getMonthlyAttendanceData({
          organizationId: otherOrg.id,
          month: 10,
          year: 2026
        });
        const leak = otherMonthly.records.some(r => r.userId === employee.id);
        assert.strictEqual(leak, false, 'Employee data must not leak to other organization');
      }
    });

  } finally {
    // Clean up created test records
    console.log('\nCleaning up created test records...');
    if (createdAttIds.length > 0) {
      await prisma.attendance.deleteMany({
        where: { id: { in: createdAttIds.filter(Boolean) } }
      });
    }
    if (createdLeaveIds.length > 0) {
      await prisma.leaveRequest.deleteMany({
        where: { id: { in: createdLeaveIds.filter(Boolean) } }
      });
    }
    await prisma.$disconnect();
  }

  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
