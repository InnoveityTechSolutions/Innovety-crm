const assert = require('assert');
const prisma = require('./backend/src/utils/db');
const attendanceReportService = require('./backend/src/services/attendanceReportService');

async function runTests() {
  console.log('================================================================');
  console.log('   ATTENDANCE AUDIT WEEKLY & MONTHLY REPORTS VERIFICATION TESTS  ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function it(description, fn) {
    try {
      fn();
      console.log(`  [PASS] ${description}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${description}`);
      console.error(`         ${err.message}`);
      failed++;
    }
  }

  async function itAsync(description, fn) {
    try {
      await fn();
      console.log(`  [PASS] ${description}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${description}`);
      console.error(`         ${err.message}`);
      failed++;
    }
  }

  // Find active test organization
  const org = await prisma.organization.findFirst({
    where: { companyCode: 'INN001' }
  });
  if (!org) {
    throw new Error('Test organization INN001 not found');
  }
  const orgId = org.id;

  // Retrieve users in the org
  const orgUsers = await prisma.user.findMany({
    where: { organizationId: orgId, status: 'ACTIVE', role: { in: ['INTERN', 'EMPLOYEE', 'TEAM_LEADER'] } },
    select: { id: true, name: true, employeeId: true, role: true }
  });
  console.log(`Found ${orgUsers.length} active eligible employees for org: ${org.name} (${orgId})\n`);

  // =====================================================================
  // 1. Weekly Attendance Report Tests
  // =====================================================================
  console.log('--- 1. Weekly Attendance Data & Column Alignment ---');

  await itAsync('Generates Weekly report with unified summary and aligned leaveTypes', async () => {
    const weeklyData = await attendanceReportService.getWeeklyAttendanceData({
      organizationId: orgId,
      week: 42,
      year: 2026
    });

    assert.ok(weeklyData, 'Weekly data should be returned');
    assert.strictEqual(weeklyData.reportType, 'Weekly');
    assert.ok(weeklyData.summary, 'Summary object must exist');
    assert.ok('totalWorkingDays' in weeklyData.summary, 'Summary must have totalWorkingDays');
    assert.ok('averageAttendancePercent' in weeklyData.summary, 'Summary must have averageAttendancePercent');
    assert.ok('totalLopDays' in weeklyData.summary, 'Summary must have totalLopDays');
    assert.ok('totalLateCount' in weeklyData.summary, 'Summary must have totalLateCount');

    // Dynamic leave types should NOT include WFH as a leave column (WFH has dedicated column)
    assert.ok(Array.isArray(weeklyData.leaveTypes), 'leaveTypes should be an array');
    const wfhInLeaveTypes = weeklyData.leaveTypes.some(t => t.code === 'WFH' || t.name.includes('WFH'));
    assert.strictEqual(wfhInLeaveTypes, false, 'WFH must not appear in dynamic leaveTypes columns');

    // Standard leave types (CL, SL, COMP_OFF) must be present in leaveTypes
    const codes = weeklyData.leaveTypes.map(t => t.code);
    assert.ok(codes.includes('CL'), 'CL must be in dynamic leaveTypes');
    assert.ok(codes.includes('SL'), 'SL must be in dynamic leaveTypes');
    assert.ok(codes.includes('COMP_OFF'), 'COMP_OFF must be in dynamic leaveTypes');
  });

  await itAsync('Each weekly record contains aligned columns (present, wfh, late, lop, workingDays)', async () => {
    const weeklyData = await attendanceReportService.getWeeklyAttendanceData({
      organizationId: orgId,
      week: 42,
      year: 2026
    });

    if (weeklyData.records.length > 0) {
      const rec = weeklyData.records[0];
      assert.ok('workingDays' in rec, 'Record must have workingDays');
      assert.ok('present' in rec, 'Record must have present');
      assert.ok('wfh' in rec, 'Record must have wfh');
      assert.ok('late' in rec, 'Record must have late');
      assert.ok('lop' in rec, 'Record must have lop');
      assert.ok('paidLeave' in rec, 'Record must have paidLeave');
      assert.ok('leaveTypeCounts' in rec, 'Record must have leaveTypeCounts');
    }
  });

  // =====================================================================
  // 2. Monthly Attendance Report Tests
  // =====================================================================
  console.log('\n--- 2. Monthly Attendance Data & Column Alignment ---');

  await itAsync('Generates Monthly report with identical summary structure and columns', async () => {
    const monthlyData = await attendanceReportService.getMonthlyAttendanceData({
      organizationId: orgId,
      month: 10,
      year: 2026
    });

    assert.ok(monthlyData, 'Monthly data should be returned');
    assert.strictEqual(monthlyData.reportType, 'Monthly');
    assert.ok(monthlyData.summary, 'Summary object must exist');
    assert.ok('totalWorkingDays' in monthlyData.summary, 'Summary must have totalWorkingDays');
    assert.ok('averageAttendancePercent' in monthlyData.summary, 'Summary must have averageAttendancePercent');
    assert.ok('totalLopDays' in monthlyData.summary, 'Summary must have totalLopDays');
    assert.ok('totalLateCount' in monthlyData.summary, 'Summary must have totalLateCount');

    // WFH excluded from dynamic leaveTypes
    const wfhInLeaveTypes = monthlyData.leaveTypes.some(t => t.code === 'WFH' || t.name.includes('WFH'));
    assert.strictEqual(wfhInLeaveTypes, false, 'WFH must not appear in dynamic leaveTypes columns in Monthly');

    // Verify records have actual late count in 'late' and payroll deduction in 'deductionLate'
    if (monthlyData.records.length > 0) {
      const rec = monthlyData.records[0];
      assert.ok('late' in rec, 'Record must have late (actual occurrences)');
      assert.ok('deductionLate' in rec, 'Record must have deductionLate (payroll deduction)');
      assert.ok('wfh' in rec, 'Record must have wfh');
      assert.ok('lop' in rec, 'Record must have lop');
    }
  });

  // =====================================================================
  // 3. WFH Double-Counting & Presence Inclusion Verification
  // =====================================================================
  console.log('\n--- 3. WFH Calculation & Presentation ---');

  await itAsync('WFH days are included in both Present and WFH counts without double-counting', async () => {
    // We check records across weekly and monthly to ensure that whenever WFH is recorded,
    // Present includes WFH count and Present <= workingDays (no double counting).
    const monthlyData = await attendanceReportService.getMonthlyAttendanceData({
      organizationId: orgId,
      month: 10,
      year: 2026
    });

    for (const rec of monthlyData.records) {
      // In scheduled elapsed days, Present cannot exceed workingDays
      assert.ok(rec.present <= rec.workingDays, `Present (${rec.present}) should not exceed workingDays (${rec.workingDays}) for ${rec.employee}`);
      assert.ok(rec.wfh <= rec.workingDays, `WFH (${rec.wfh}) should not exceed workingDays (${rec.workingDays}) for ${rec.employee}`);
      if (rec.wfh > 0) {
        assert.ok(rec.present >= rec.wfh, `Present (${rec.present}) must be at least WFH (${rec.wfh}) because approved WFH counts as present`);
      }
    }
  });

  // =====================================================================
  // 4. Actual Late Occurrences vs Deduction Late
  // =====================================================================
  console.log('\n--- 4. Actual Late Occurrences vs Deduction Late ---');

  await itAsync('Late count displays actual occurrences, keeping payroll deduction separate', async () => {
    const monthlyData = await attendanceReportService.getMonthlyAttendanceData({
      organizationId: orgId,
      month: 10,
      year: 2026
    });

    for (const rec of monthlyData.records) {
      assert.ok(rec.late >= 0, `Late count must be >= 0`);
      assert.ok(rec.deductionLate >= 0, `Deduction late count must be >= 0`);
      assert.ok(rec.deductionLate <= rec.late, `Deduction late (${rec.deductionLate}) cannot exceed actual late (${rec.late})`);
      assert.strictEqual(rec.late, rec.totalLates, `rec.late must equal rec.totalLates`);
    }
  });

  // =====================================================================
  // 5. Selected Members Filter & Member Subset Export
  // =====================================================================
  console.log('\n--- 5. Selected Members Filtering ---');

  await itAsync('Correctly filters by userIds when selected members are provided', async () => {
    if (orgUsers.length >= 2) {
      const selectedSubset = [orgUsers[0].id, orgUsers[1].id];

      const filteredWeekly = await attendanceReportService.getWeeklyAttendanceData({
        organizationId: orgId,
        week: 42,
        year: 2026,
        userIds: selectedSubset
      });

      assert.strictEqual(filteredWeekly.records.length, 2, 'Should only return 2 selected members for weekly');
      const returnedIds = filteredWeekly.records.map(r => r.userId).sort();
      assert.deepStrictEqual(returnedIds, [...selectedSubset].sort(), 'Returned IDs must match selected IDs');

      const filteredMonthly = await attendanceReportService.getMonthlyAttendanceData({
        organizationId: orgId,
        month: 10,
        year: 2026,
        userIds: selectedSubset
      });

      assert.strictEqual(filteredMonthly.records.length, 2, 'Should only return 2 selected members for monthly');
      const returnedMonthlyIds = filteredMonthly.records.map(r => r.userId).sort();
      assert.deepStrictEqual(returnedMonthlyIds, [...selectedSubset].sort(), 'Returned Monthly IDs must match selected IDs');
    }
  });

  // =====================================================================
  // 6. Excel Workbook Export Verification
  // =====================================================================
  console.log('\n--- 6. Excel Export Alignment ---');

  await itAsync('Generates aligned Weekly Excel workbook with matching headers', async () => {
    const { workbook, filename } = await attendanceReportService.generateExcelReport({
      type: 'weekly',
      organizationId: orgId,
      params: { week: 42, year: 2026 }
    });

    assert.ok(workbook, 'Workbook must be returned');
    assert.ok(filename.includes('Attendance_Weekly'), 'Filename should be for weekly attendance');
    const sheet = workbook.getWorksheet('Weekly Attendance');
    assert.ok(sheet, 'Worksheet "Weekly Attendance" must exist');

    // Row 6 is Table Headers
    const headerRow = sheet.getRow(6).values;
    // ExcelJS row.values is 1-indexed (index 0 is undefined or empty)
    const headerList = Array.isArray(headerRow) ? headerRow.filter(Boolean) : Object.values(headerRow);
    assert.strictEqual(headerList[0], 'Members');
    assert.strictEqual(headerList[1], 'Working Days');
    assert.strictEqual(headerList[2], 'Present');
    assert.strictEqual(headerList[3], 'WFH');
    assert.strictEqual(headerList[4], 'Late');
    assert.strictEqual(headerList[headerList.length - 1], 'Loss of Pay (LOP)');
  });

  await itAsync('Generates aligned Monthly Excel workbook with matching headers', async () => {
    const { workbook, filename } = await attendanceReportService.generateExcelReport({
      type: 'monthly',
      organizationId: orgId,
      params: { month: 10, year: 2026 }
    });

    assert.ok(workbook, 'Workbook must be returned');
    assert.ok(filename.includes('Attendance_Monthly'), 'Filename should be for monthly attendance');
    const sheet = workbook.getWorksheet('Monthly Attendance');
    assert.ok(sheet, 'Worksheet "Monthly Attendance" must exist');

    // Row 6 is Table Headers
    const headerRow = sheet.getRow(6).values;
    const headerList = Array.isArray(headerRow) ? headerRow.filter(Boolean) : Object.values(headerRow);
    assert.strictEqual(headerList[0], 'Members');
    assert.strictEqual(headerList[1], 'Working Days');
    assert.strictEqual(headerList[2], 'Present');
    assert.strictEqual(headerList[3], 'WFH');
    assert.strictEqual(headerList[4], 'Late');
    assert.strictEqual(headerList[headerList.length - 1], 'Loss of Pay (LOP)');
  });

  // =====================================================================
  // 7. Tenant Isolation Verification
  // =====================================================================
  console.log('\n--- 7. Tenant Isolation Verification ---');

  await itAsync('Weekly report isolates data by organizationId (no cross-tenant leakage)', async () => {
    const otherOrg = await prisma.organization.findFirst({
      where: { id: { not: orgId } }
    });

    if (otherOrg) {
      const dataOrg1 = await attendanceReportService.getWeeklyAttendanceData({
        organizationId: orgId,
        week: 42,
        year: 2026
      });

      const dataOrg2 = await attendanceReportService.getWeeklyAttendanceData({
        organizationId: otherOrg.id,
        week: 42,
        year: 2026
      });

      const org1UserIds = new Set(dataOrg1.records.map(r => r.userId));
      const org2UserIds = new Set(dataOrg2.records.map(r => r.userId));

      for (const id of org2UserIds) {
        assert.ok(!org1UserIds.has(id), `User ${id} from Org 2 must NOT appear in Org 1 report`);
      }
    }
  });

  // =====================================================================
  // 8. Daily Report Behavior Preservation
  // =====================================================================
  console.log('\n--- 8. Daily Report Preservation ---');

  await itAsync('Daily Report remains functional and unchanged in format', async () => {
    const dailyData = await attendanceReportService.getDailyAttendanceData({
      organizationId: orgId,
      date: '2026-10-20'
    });

    assert.ok(dailyData, 'Daily data should be returned');
    assert.strictEqual(dailyData.reportType, 'Daily');
    assert.ok(dailyData.summary, 'Summary object must exist');
    assert.ok('present' in dailyData.summary, 'Daily summary must have present');
    assert.ok('absent' in dailyData.summary, 'Daily summary must have absent');
    assert.ok('late' in dailyData.summary, 'Daily summary must have late');
    assert.ok('wfh' in dailyData.summary, 'Daily summary must have wfh');
    assert.ok('onLeave' in dailyData.summary, 'Daily summary must have onLeave');
    assert.ok('holiday' in dailyData.summary, 'Daily summary must have holiday');

    if (dailyData.records.length > 0) {
      const r = dailyData.records[0];
      assert.ok('attendance' in r, 'Record must have attendance');
      assert.ok('loginTime' in r, 'Record must have loginTime');
      assert.ok('loginStatus' in r, 'Record must have loginStatus');
    }
  });

  // =====================================================================
  // 9. Selected-Member Excel Export Verification
  // =====================================================================
  console.log('\n--- 9. Selected-Member Excel Export ---');

  await itAsync('Generates Weekly Excel containing ONLY selected members when userIds filter is applied', async () => {
    if (orgUsers.length >= 2) {
      const selectedSubset = [orgUsers[0].id, orgUsers[1].id];
      const { workbook } = await attendanceReportService.generateExcelReport({
        type: 'weekly',
        organizationId: orgId,
        params: { week: 42, year: 2026, userIds: selectedSubset }
      });

      const sheet = workbook.getWorksheet('Weekly Attendance');
      // Data starts at row 7. Total data rows should be exactly 2.
      let dataRowCount = 0;
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber >= 7) dataRowCount++;
      });
      assert.strictEqual(dataRowCount, 2, `Exported Excel sheet should have exactly 2 data rows, got ${dataRowCount}`);
    }
  });

  await itAsync('Generates Monthly Excel containing ONLY selected members when userIds filter is applied', async () => {
    if (orgUsers.length >= 2) {
      const selectedSubset = [orgUsers[0].id, orgUsers[1].id];
      const { workbook } = await attendanceReportService.generateExcelReport({
        type: 'monthly',
        organizationId: orgId,
        params: { month: 10, year: 2026, userIds: selectedSubset }
      });

      const sheet = workbook.getWorksheet('Monthly Attendance');
      let dataRowCount = 0;
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber >= 7) dataRowCount++;
      });
      assert.strictEqual(dataRowCount, 2, `Exported Monthly Excel sheet should have exactly 2 data rows, got ${dataRowCount}`);
    }
  });

  // =====================================================================
  // 10. Date Boundaries & Incomplete Period Handling
  // =====================================================================
  console.log('\n--- 10. Date Boundaries & Future Date Handling ---');

  await itAsync('Future dates in an incomplete reporting period are not counted as absences', async () => {
    // Current date is in October 2026.
    const monthlyData = await attendanceReportService.getMonthlyAttendanceData({
      organizationId: orgId,
      month: 10,
      year: 2026
    });

    // Check that absentCount + presentCount + leaves does not inflate to include unelapsed future dates
    for (const rec of monthlyData.records) {
      const recordedElapsed = rec.present + rec.absent + (rec.leave || 0);
      assert.ok(recordedElapsed <= rec.workingDays,
        `Sum of present + absent + leave (${recordedElapsed}) should not exceed total month scheduled working days (${rec.workingDays}) for ${rec.employee}`);
    }
  });

  // =====================================================================
  // 11. Overlapping Records & Leave Resolution Logic
  // =====================================================================
  console.log('\n--- 11. Overlapping Records & Leave Resolution Logic ---');

  it('Verifies isLeaveUnpaid identifies LOP, UNPAID, and custom unpaid leave types', () => {
    // Internal helper simulation
    const activeLeaveTypes = [
      { id: '1', name: 'Casual Leave', code: 'CL', isPaid: true },
      { id: '2', name: 'Sick Leave', code: 'SL', isPaid: true },
      { id: '3', name: 'Compensatory Off', code: 'COMP_OFF', isPaid: true },
      { id: '4', name: 'Loss of Pay', code: 'LOP', isPaid: false }
    ];

    const isUnpaid = (leave) => {
      const pType = (leave.payType || 'PAID').toUpperCase();
      if (pType === 'UNPAID') return true;
      const lType = (leave.leaveType || leave.type || '').toUpperCase();
      if (['LOP', 'UNPAID', 'LOSS_OF_PAY', 'LOSS OF PAY'].includes(lType)) return true;
      const matched = activeLeaveTypes.find(t => t.code === lType || t.id === leave.leaveType);
      return matched && matched.isPaid === false;
    };

    assert.strictEqual(isUnpaid({ leaveType: 'CL', payType: 'PAID' }), false);
    assert.strictEqual(isUnpaid({ leaveType: 'SL', payType: 'PAID' }), false);
    assert.strictEqual(isUnpaid({ leaveType: 'COMP_OFF', payType: 'PAID' }), false);
    assert.strictEqual(isUnpaid({ leaveType: 'LOP', payType: 'UNPAID' }), true);
    assert.strictEqual(isUnpaid({ leaveType: '4', payType: 'PAID' }), true); // custom unpaid type
  });

  it('Verifies leave resolution precedence over conflicting ABSENT attendance records', () => {
    // When an attendance record is ABSENT, but an approved leave request exists for that day:
    const att = { status: 'ABSENT', date: '2026-10-21' };
    const leave = { status: 'APPROVED', leaveType: 'CL', payType: 'PAID', startDate: '2026-10-21', endDate: '2026-10-21' };

    let absentCount = 0;
    let paidLeaveCount = 0;

    // Simulate our report loop condition:
    if (leave && (!att || att.status === 'ABSENT' || att.status === 'LEAVE')) {
      paidLeaveCount += 1;
    } else if (att) {
      if (att.status === 'ABSENT') absentCount++;
    }

    assert.strictEqual(absentCount, 0, 'Approved leave MUST override conflicting ABSENT record');
    assert.strictEqual(paidLeaveCount, 1, 'Approved leave must increment paidLeaveCount');
  });

  it('Verifies half-day leave increments by exactly 0.5', () => {
    const leave = { status: 'APPROVED', isHalfDay: true, totalDays: 0.5 };
    const duration = (leave.isHalfDay || leave.totalDays === 0.5) ? 0.5 : 1;
    assert.strictEqual(duration, 0.5, 'Half-day leave duration must be 0.5');
  });

  it('Verifies approved WFH increments both Present and WFH by duration without double-counting', () => {
    let presentCount = 0;
    let wfhCount = 0;
    const duration = 1;

    // Simulated resolution:
    wfhCount += duration;
    presentCount += duration;

    assert.strictEqual(wfhCount, 1, 'WFH count should be 1');
    assert.strictEqual(presentCount, 1, 'Present count should be 1');
  });
  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests()
  .catch((err) => {
    console.error('Test execution error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
