/**
 * Comprehensive Test Suite: Missing Attendance and Unpaid Leave Deductions in Payroll
 * 
 * Verifies all 10 required test scenarios:
 * 1. One present day and several unexcused scheduled absences
 * 2. No attendance records for a completed payroll month (Full salary MUST NOT be payable)
 * 3. Approved paid leave (No salary deduction)
 * 4. Approved unpaid leave (Correct LOP deduction)
 * 5. Company holidays and weekly offs (Excluded from scheduled working days & not deducted)
 * 6. Employees with rotating or custom working schedules (Correct schedule resolution)
 * 7. Missing clock-out with a valid clock-in (Counts as present, not absent)
 * 8. A payroll month that is still in progress (Future working days not prematurely marked absent)
 * 9. Prevention of duplicate LOP deductions (Absence evaluated once per day)
 * 10. Reconciliation of individual deductions, net salaries, payslips, and batch totals
 */

const prisma = require('d:/P R O J E C T S/Web/MRF-crm/backend/src/utils/db');
const { calculateUserPayroll, processPayrollBatch } = require('d:/P R O J E C T S/Web/MRF-crm/backend/src/controllers/payrollController');
const shiftService = require('d:/P R O J E C T S/Web/MRF-crm/backend/src/services/shiftService');

async function runAttendanceDeductionTestSuite() {
  console.log('=== STARTING PAYROLL ATTENDANCE & LOP DEDUCTION TEST SUITE ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`✗ FAIL: ${testName} - ${details}`);
      failed++;
    }
  }

  // Setup: Create an isolated test organization, shift, and test employee
  const testOrgId = `test-org-payroll-${Date.now()}`;
  let testUser = null;
  let testShift = null;

  try {
    const org = await prisma.organization.create({
      data: {
        id: testOrgId,
        name: 'Payroll Test Corp',
        slug: `payroll-test-${Date.now()}`,
        companyCode: `PTC${Date.now().toString().slice(-4)}`
      }
    });

    testUser = await prisma.user.create({
      data: {
        email: `payroll_test_${Date.now()}@example.com`,
        password: 'hashed_test_password',
        name: 'Payroll Test Employee',
        role: 'EMPLOYEE',
        organizationId: testOrgId,
        employeeId: `TEST-${Date.now().toString().slice(-4)}`,
        status: 'ACTIVE',
        joiningDate: new Date('2026-01-01T00:00:00.000Z')
      }
    });

    // Create a 6-day working shift (Mon-Sat, Sun off)
    testShift = await prisma.shift.create({
      data: {
        name: 'Test General Shift',
        organizationId: testOrgId,
        startTime: '09:00',
        endTime: '18:00',
        workingDays: [
          { day: 'MONDAY', isWorking: true },
          { day: 'TUESDAY', isWorking: true },
          { day: 'WEDNESDAY', isWorking: true },
          { day: 'THURSDAY', isWorking: true },
          { day: 'FRIDAY', isWorking: true },
          { day: 'SATURDAY', isWorking: true },
          { day: 'SUNDAY', isWorking: false }
        ]
      }
    });

    await prisma.shiftMember.create({
      data: {
        shiftId: testShift.id,
        userId: testUser.id
      }
    });

    // Assign a simple, round-number salary structure: Gross ₹26,000, 0 tax for testing
    await prisma.salaryStructure.create({
      data: {
        userId: testUser.id,
        basicSalary: 15000,
        hra: 6000,
        da: 2000,
        specialAllowance: 3000,
        travelAllowance: 0,
        medicalAllowance: 0,
        otherAllowances: 0,
        bonus: 0,
        grossSalary: 26000,
        pfDeduction: 0,
        esiDeduction: 0,
        profTax: 0,
        incomeTax: 0,
        otherDeductions: 0,
        netSalary: 26000
      }
    });

    const completedYear = 2026;
    const completedMonth = 8; // August 2026 (Completed month, 31 days)
    // In August 2026:
    // Aug 1 is Saturday
    // Sundays: Aug 2, 9, 16, 23, 30 (5 Sundays)
    // Total calendar days = 31, Sundays = 5 -> Scheduled working days = 26

    // =========================================================================
    // Scenario 2: No attendance records for a completed payroll month
    // =========================================================================
    console.log('--- Test 1 (Scenario 2): No Attendance in Completed Month ---');
    {
      const res = await calculateUserPayroll(testUser, completedMonth, completedYear);
      assert(res.workingDays === 26, 'Scheduled working days counted as 26', `Got ${res.workingDays}`);
      assert(res.presentDays === 0, 'Present days is 0', `Got ${res.presentDays}`);
      assert(res.unpaidAbsentDays === 26, 'All 26 unrecorded working days counted as unpaid absence', `Got ${res.unpaidAbsentDays}`);
      assert(res.allowancesJson.payableDays === 0, 'Payable days is 0', `Got ${res.allowancesJson.payableDays}`);
      assert(res.deductionsJson.leaveDeduction === 26000, 'Full salary deducted as LOP (₹26,000)', `Got ${res.deductionsJson.leaveDeduction}`);
      assert(res.netSalary === 0, 'Net salary is ₹0 (Employee receives ₹0 instead of full salary)', `Got ${res.netSalary}`);
    }

    // =========================================================================
    // Scenario 1: One present day and several unexcused scheduled absences
    // =========================================================================
    console.log('\n--- Test 2 (Scenario 1): One Present Day & 25 Scheduled Absences ---');
    {
      // Create 1 attendance record for Aug 1, 2026 (Saturday)
      const att1 = await prisma.attendance.create({
        data: {
          userId: testUser.id,
          date: new Date('2026-08-01T00:00:00.000Z'),
          clockIn: new Date('2026-08-01T09:05:00.000Z'),
          clockOut: new Date('2026-08-01T18:00:00.000Z'),
          status: 'PRESENT',
          workingHours: 8.9
        }
      });

      const res = await calculateUserPayroll(testUser, completedMonth, completedYear);
      assert(res.presentDays === 1, 'Present days is exactly 1', `Got ${res.presentDays}`);
      assert(res.unpaidAbsentDays === 25, '25 missing working days counted as unpaid absence', `Got ${res.unpaidAbsentDays}`);
      assert(res.allowancesJson.payableDays === 1, 'Payable days is 1', `Got ${res.allowancesJson.payableDays}`);
      // dailyPay = 26000 / 26 = 1000. 25 days LOP = 25000. Net salary = 1000.
      assert(res.deductionsJson.leaveDeduction === 25000, 'LOP deduction is ₹25,000 (25 * ₹1,000)', `Got ${res.deductionsJson.leaveDeduction}`);
      assert(res.netSalary === 1000, 'Net salary is ₹1,000 (1 day salary paid)', `Got ${res.netSalary}`);

      await prisma.attendance.delete({ where: { id: att1.id } });
    }

    // =========================================================================
    // Scenario 3: Approved paid leave
    // =========================================================================
    console.log('\n--- Test 3 (Scenario 3): Approved Paid Leave ---');
    {
      // Create 10 present days (Aug 1 to Aug 11, skipping Sunday Aug 2 -> 9 working days + 1 = 10 days)
      const createdAtts = [];
      for (let day = 1; day <= 12; day++) {
        const d = new Date(Date.UTC(2026, 7, day));
        if (d.getUTCDay() !== 0) { // Not Sunday
          const a = await prisma.attendance.create({
            data: {
              userId: testUser.id,
              date: d,
              clockIn: d,
              clockOut: d,
              status: 'PRESENT',
              workingHours: 8
            }
          });
          createdAtts.push(a);
        }
      }

      // Approved paid leave for Aug 13 to Aug 15 (3 working days: Thu, Fri, Sat)
      const paidLeave = await prisma.leaveRequest.create({
        data: {
          userId: testUser.id,
          startDate: new Date('2026-08-13T00:00:00.000Z'),
          endDate: new Date('2026-08-15T23:59:59.000Z'),
          leaveType: 'CASUAL',
          payType: 'PAID',
          status: 'APPROVED',
          reason: 'Personal'
        }
      });

      const res = await calculateUserPayroll(testUser, completedMonth, completedYear);
      assert(res.presentDays === 10, 'Present days is 10', `Got ${res.presentDays}`);
      assert(res.paidLeaveDays === 3, 'Paid leave days is 3', `Got ${res.paidLeaveDays}`);
      // Total working days = 26. 10 present + 3 paid leave = 13 covered. Remaining = 13 absent.
      assert(res.unpaidAbsentDays === 13, 'Unpaid absent days is 13 (unexcused)', `Got ${res.unpaidAbsentDays}`);
      assert(res.allowancesJson.payableDays === 13, 'Payable days is 13 (10 present + 3 paid leave)', `Got ${res.allowancesJson.payableDays}`);
      assert(res.deductionsJson.leaveDeduction === 13000, 'LOP deduction is ₹13,000 for 13 absent days', `Got ${res.deductionsJson.leaveDeduction}`);
      assert(res.netSalary === 13000, 'Net salary is ₹13,000 (13 days paid)', `Got ${res.netSalary}`);

      // Cleanup
      for (const a of createdAtts) await prisma.attendance.delete({ where: { id: a.id } });
      await prisma.leaveRequest.delete({ where: { id: paidLeave.id } });
    }

    // =========================================================================
    // Scenario 4: Approved unpaid leave (LOP)
    // =========================================================================
    console.log('\n--- Test 4 (Scenario 4): Approved Unpaid Leave (LOP) ---');
    {
      // 20 present days
      const createdAtts = [];
      let count = 0;
      for (let day = 1; day <= 31 && count < 20; day++) {
        const d = new Date(Date.UTC(2026, 7, day));
        if (d.getUTCDay() !== 0) {
          const a = await prisma.attendance.create({
            data: {
              userId: testUser.id,
              date: d,
              clockIn: d,
              clockOut: d,
              status: 'PRESENT',
              workingHours: 8
            }
          });
          createdAtts.push(a);
          count++;
        }
      }

      // Approved unpaid leave for 2 days
      const unpaidLeave = await prisma.leaveRequest.create({
        data: {
          userId: testUser.id,
          startDate: new Date('2026-08-25T00:00:00.000Z'),
          endDate: new Date('2026-08-26T23:59:59.000Z'),
          leaveType: 'LOSS_OF_PAY',
          payType: 'UNPAID',
          status: 'APPROVED',
          reason: 'Unpaid Leave'
        }
      });

      const res = await calculateUserPayroll(testUser, completedMonth, completedYear);
      assert(res.presentDays === 20, 'Present days is 20', `Got ${res.presentDays}`);
      // 26 working days - 20 present = 6 days not attended.
      // 2 days were approved unpaid leave + 4 days unexcused missing = 6 total unpaid absent days
      assert(res.unpaidAbsentDays === 6, 'Total unpaid absent days is 6', `Got ${res.unpaidAbsentDays}`);
      assert(res.deductionsJson.unpaidLeaveDays === 2, 'Unpaid leave days is 2', `Got ${res.deductionsJson.unpaidLeaveDays}`);
      assert(res.deductionsJson.missingAttendanceDays === 4, 'Missing attendance days is 4', `Got ${res.deductionsJson.missingAttendanceDays}`);
      assert(res.deductionsJson.leaveDeduction === 6000, 'LOP deduction is ₹6,000 for 6 days', `Got ${res.deductionsJson.leaveDeduction}`);
      assert(res.netSalary === 20000, 'Net salary is ₹20,000 (20 payable days)', `Got ${res.netSalary}`);

      for (const a of createdAtts) await prisma.attendance.delete({ where: { id: a.id } });
      await prisma.leaveRequest.delete({ where: { id: unpaidLeave.id } });
    }

    // =========================================================================
    // Scenario 5: Company holidays and weekly offs
    // =========================================================================
    console.log('\n--- Test 5 (Scenario 5): Company Holidays and Weekly Offs ---');
    {
      // Add a company holiday on Aug 15 (Independence Day)
      const holiday = await prisma.holidayCalendar.create({
        data: {
          organizationId: testOrgId,
          title: 'Independence Day',
          date: new Date('2026-08-15T00:00:00.000Z'),
          type: 'NATIONAL'
        }
      });

      const res = await calculateUserPayroll(testUser, completedMonth, completedYear);
      // Scheduled working days should now be 25 (26 - 1 national holiday)
      assert(res.workingDays === 25, 'Scheduled working days reduced to 25 due to company holiday', `Got ${res.workingDays}`);
      assert(res.unpaidAbsentDays === 25, 'Unpaid absent days is 25 (holiday Aug 15 NOT counted as absence)', `Got ${res.unpaidAbsentDays}`);

      await prisma.holidayCalendar.delete({ where: { id: holiday.id } });
    }

    // =========================================================================
    // Scenario 6: Employees with rotating or custom working schedules
    // =========================================================================
    console.log('\n--- Test 6 (Scenario 6): Rotating or Custom Working Schedules ---');
    {
      // Create a 5-day shift (Mon-Fri, Sat & Sun Off)
      const fiveDayShift = await prisma.shift.create({
        data: {
          name: '5-Day Tech Shift',
          organizationId: testOrgId,
          startTime: '10:00',
          endTime: '19:00',
          workingDays: [
            { day: 'MONDAY', isWorking: true },
            { day: 'TUESDAY', isWorking: true },
            { day: 'WEDNESDAY', isWorking: true },
            { day: 'THURSDAY', isWorking: true },
            { day: 'FRIDAY', isWorking: true },
            { day: 'SATURDAY', isWorking: false },
            { day: 'SUNDAY', isWorking: false }
          ]
        }
      });

      // Assign custom shift schedule for August 2026
      const schedule = await prisma.shiftSchedule.create({
        data: {
          organizationId: testOrgId,
          userId: testUser.id,
          shiftId: fiveDayShift.id,
          startDate: new Date('2026-08-01T00:00:00.000Z'),
          endDate: new Date('2026-08-31T23:59:59.000Z'),
          type: 'OVERRIDE',
          status: 'ACTIVE'
        }
      });

      const res = await calculateUserPayroll(testUser, completedMonth, completedYear);
      // In August 2026, there are 21 Mon-Fri weekdays (31 - 5 Sundays - 5 Saturdays = 21)
      assert(res.workingDays === 21, 'Scheduled working days correctly calculated as 21 under 5-day schedule', `Got ${res.workingDays}`);
      assert(res.unpaidAbsentDays === 21, 'Saturdays and Sundays excluded from absence deductions', `Got ${res.unpaidAbsentDays}`);

      await prisma.shiftSchedule.delete({ where: { id: schedule.id } });
      await prisma.shift.delete({ where: { id: fiveDayShift.id } });
    }

    // =========================================================================
    // Scenario 7: Missing clock-out with a valid clock-in
    // =========================================================================
    console.log('\n--- Test 7 (Scenario 7): Missing Clock-Out with Valid Clock-In ---');
    {
      // Create attendance with clockIn but null clockOut
      const attInOnly = await prisma.attendance.create({
        data: {
          userId: testUser.id,
          date: new Date('2026-08-03T00:00:00.000Z'), // Monday
          clockIn: new Date('2026-08-03T09:00:00.000Z'),
          clockOut: null,
          status: 'PRESENT',
          workingHours: null
        }
      });

      const res = await calculateUserPayroll(testUser, completedMonth, completedYear);
      assert(res.presentDays === 1, 'Missing clock-out with valid clock-in counts as Present (1d)', `Got ${res.presentDays}`);
      assert(res.unpaidAbsentDays === 25, 'Only the other 25 unrecorded days are marked absent', `Got ${res.unpaidAbsentDays}`);

      await prisma.attendance.delete({ where: { id: attInOnly.id } });
    }

    // =========================================================================
    // Scenario 8: A payroll month that is still in progress
    // =========================================================================
    console.log('\n--- Test 8 (Scenario 8): Payroll Month In-Progress ---');
    {
      const now = new Date();
      const curYear = now.getUTCFullYear();
      const curMonth = now.getUTCMonth() + 1;
      const todayDateStr = now.toISOString().split('T')[0];

      // Run calculateUserPayroll for the CURRENT month (in-progress)
      const res = await calculateUserPayroll(testUser, curMonth, curYear);
      
      // The scheduled working days for the whole month is computed (e.g. ~26)
      // BUT future working days MUST NOT be treated as absences!
      console.log(`Current month: ${curMonth}/${curYear}, workingDays: ${res.workingDays}, unpaidAbsentDays: ${res.unpaidAbsentDays}`);
      assert(res.unpaidAbsentDays <= res.workingDays, 'Unpaid absent days does not exceed working days');
      // In an in-progress month, the unrecorded past days up to today are absent, but future days are NOT!
      // Therefore, if today is day 22 of a 31-day month, unpaidAbsentDays must be <= 22!
      assert(res.unpaidAbsentDays < res.workingDays, 'Future scheduled working days are NOT marked as absences', `unpaidAbsent: ${res.unpaidAbsentDays}, workingDays: ${res.workingDays}`);
    }

    // =========================================================================
    // Scenario 9: Prevention of duplicate LOP deductions
    // =========================================================================
    console.log('\n--- Test 9 (Scenario 9): Prevention of Duplicate LOP Deductions ---');
    {
      // Create explicit ABSENT record on Aug 3
      const explicitAbs = await prisma.attendance.create({
        data: {
          userId: testUser.id,
          date: new Date('2026-08-03T00:00:00.000Z'),
          status: 'ABSENT'
        }
      });

      // Create an unpaid leave on Aug 4
      const unpaidLeave2 = await prisma.leaveRequest.create({
        data: {
          userId: testUser.id,
          startDate: new Date('2026-08-04T00:00:00.000Z'),
          endDate: new Date('2026-08-04T23:59:59.000Z'),
          leaveType: 'LOP',
          payType: 'UNPAID',
          status: 'APPROVED',
          reason: 'LOP'
        }
      });

      const res = await calculateUserPayroll(testUser, completedMonth, completedYear);
      // Working days = 26.
      // Explicit absent = 1 (Aug 3)
      // Unpaid leave = 1 (Aug 4)
      // Missing attendance = 24 (the remaining 24 working days)
      // Total unpaid absent days = exactly 26! Not 27, not duplicated!
      assert(res.deductionsJson.explicitAbsentDays === 1, 'Explicit absent days is exactly 1', `Got ${res.deductionsJson.explicitAbsentDays}`);
      assert(res.deductionsJson.unpaidLeaveDays === 1, 'Unpaid leave days is exactly 1', `Got ${res.deductionsJson.unpaidLeaveDays}`);
      assert(res.deductionsJson.missingAttendanceDays === 24, 'Missing attendance days is exactly 24', `Got ${res.deductionsJson.missingAttendanceDays}`);
      assert(res.unpaidAbsentDays === 26, 'Total unpaid absences is exactly 26 (no double deduction)', `Got ${res.unpaidAbsentDays}`);
      assert(res.deductionsJson.leaveDeduction === 26000, 'Leave deduction equals exactly ₹26,000 without duplication', `Got ${res.deductionsJson.leaveDeduction}`);

      await prisma.attendance.delete({ where: { id: explicitAbs.id } });
      await prisma.leaveRequest.delete({ where: { id: unpaidLeave2.id } });
    }

    // =========================================================================
    // Scenario 10: Reconciliation of deductions, net salaries, and batch totals
    // =========================================================================
    console.log('\n--- Test 10 (Scenario 10): Batch Reconciliation ---');
    {
      // Create Employee 2 in the same organization with salary structure
      const emp2 = await prisma.user.create({
        data: {
          email: `payroll_test_emp2_${Date.now()}@example.com`,
          password: 'password',
          name: 'Employee Two',
          role: 'EMPLOYEE',
          organizationId: testOrgId,
          employeeId: `TEST2-${Date.now().toString().slice(-4)}`,
          status: 'ACTIVE',
          joiningDate: new Date('2026-01-01T00:00:00.000Z')
        }
      });

      await prisma.shiftMember.create({
        data: {
          shiftId: testShift.id,
          userId: emp2.id
        }
      });

      await prisma.salaryStructure.create({
        data: {
          userId: emp2.id,
          basicSalary: 15000,
          hra: 6000,
          da: 2000,
          specialAllowance: 3000,
          travelAllowance: 0,
          medicalAllowance: 0,
          otherAllowances: 0,
          bonus: 0,
          grossSalary: 26000,
          pfDeduction: 0,
          esiDeduction: 0,
          profTax: 0,
          incomeTax: 0,
          otherDeductions: 0,
          netSalary: 26000
        }
      });

      // Employee 1 has 13 present days in August 2026 (50% pay = ₹13,000)
      const emp1Atts = [];
      let c = 0;
      for (let day = 1; day <= 31 && c < 13; day++) {
        const d = new Date(Date.UTC(2026, 7, day));
        if (d.getUTCDay() !== 0) {
          const a = await prisma.attendance.create({
            data: {
              userId: testUser.id,
              date: d,
              clockIn: d,
              clockOut: d,
              status: 'PRESENT',
              workingHours: 8
            }
          });
          emp1Atts.push(a);
          c++;
        }
      }

      // Employee 2 has 26 present days (Full pay = ₹26,000)
      const emp2Atts = [];
      let c2 = 0;
      for (let day = 1; day <= 31 && c2 < 26; day++) {
        const d = new Date(Date.UTC(2026, 7, day));
        if (d.getUTCDay() !== 0) {
          const a = await prisma.attendance.create({
            data: {
              userId: emp2.id,
              date: d,
              clockIn: d,
              clockOut: d,
              status: 'PRESENT',
              workingHours: 8
            }
          });
          emp2Atts.push(a);
          c2++;
        }
      }

      // Run batch calculation for the organization
      const req = {
        user: { id: testUser.id, role: 'ADMIN', organizationId: testOrgId },
        body: { month: completedMonth, year: completedYear, userIds: [testUser.id, emp2.id] }
      };

      let jsonResult = null;
      const res = {
        status: (code) => ({
          json: (data) => { jsonResult = { statusCode: code, ...data }; return jsonResult; }
        }),
        json: (data) => { jsonResult = { statusCode: 200, ...data }; return jsonResult; }
      };

      await processPayrollBatch(req, res);
      assert(jsonResult && jsonResult.success, 'processPayrollBatch completed successfully', jsonResult?.message);

      const batch = jsonResult.batch;
      // Emp 1: Gross 26,000, 13 absent days (-13,000) -> Net 13,000
      // Emp 2: Gross 26,000, 0 absent days (-0) -> Net 26,000
      // Batch Total Gross: 52,000
      // Batch Total Deductions: 13,000
      // Batch Total Net: 39,000
      assert(batch.totalGross === 52000, 'Batch total gross is ₹52,000', `Got ${batch.totalGross}`);
      assert(batch.totalDeductions === 13000, 'Batch total deductions is ₹13,000', `Got ${batch.totalDeductions}`);
      assert(batch.totalNet === 39000, 'Batch total net is ₹39,000 (Exact sum of net salaries)', `Got ${batch.totalNet}`);

      // Verify individual payslips in DB match
      const payslips = await prisma.payslip.findMany({ where: { batchId: batch.id } });
      const p1 = payslips.find(p => p.userId === testUser.id);
      const p2 = payslips.find(p => p.userId === emp2.id);

      assert(p1.presentDays === 13 && p1.unpaidAbsentDays === 13 && p1.netSalary === 13000, 'Employee 1 payslip accurately reconciled (13d present, 13d absent, ₹13,000 net)');
      assert(p2.presentDays === 26 && p2.unpaidAbsentDays === 0 && p2.netSalary === 26000, 'Employee 2 payslip accurately reconciled (26d present, 0d absent, ₹26,000 net)');

      // Cleanup
      for (const a of emp1Atts) await prisma.attendance.delete({ where: { id: a.id } });
      for (const a of emp2Atts) await prisma.attendance.delete({ where: { id: a.id } });
      await prisma.payslip.deleteMany({ where: { batchId: batch.id } });
      await prisma.payrollBatch.delete({ where: { id: batch.id } });
      await prisma.salaryStructure.deleteMany({ where: { userId: emp2.id } });
      await prisma.shiftMember.deleteMany({ where: { userId: emp2.id } });
      await prisma.user.delete({ where: { id: emp2.id } });
    }

  } finally {
    // Complete tear-down of test data
    console.log('\n--- Cleaning up test environment ---');
    if (testUser) {
      await prisma.payslip.deleteMany({ where: { userId: testUser.id } }).catch(() => {});
      await prisma.salaryStructure.deleteMany({ where: { userId: testUser.id } }).catch(() => {});
      await prisma.shiftMember.deleteMany({ where: { userId: testUser.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    }
    if (testShift) {
      await prisma.shift.delete({ where: { id: testShift.id } }).catch(() => {});
    }
    await prisma.organization.delete({ where: { id: testOrgId } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(`\n======================================================`);
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runAttendanceDeductionTestSuite().catch(err => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
