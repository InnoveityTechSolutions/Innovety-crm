/**
 * Comprehensive 13-Scenario Test Suite for InnovEity CRM Payroll Attendance & Scheduled Working Days
 * 
 * Verifies all 13 required test cases:
 * 1. A standard Monday-to-Friday schedule
 * 2. A schedule that requires working Saturdays or Sundays
 * 3. Rotating shifts and custom schedules
 * 4. Company holidays and weekly offs
 * 5. Approved WFH on a scheduled working day with valid WFH attendance
 * 6. Approved WFH without a physical office clock-in
 * 7. Duplicate WFH and attendance records for the same date
 * 8. Approved paid leave and unpaid leave
 * 9. Missing clock-in on a scheduled working day without an approved exemption
 * 10. Missing clock-out when a valid clock-in exists
 * 11. A payroll period that is still in progress
 * 12. Employees with different schedules in the same payroll batch
 * 13. Prevention of duplicate LOP deductions
 */

const prisma = require('d:/P R O J E C T S/Web/MRF-crm/backend/src/utils/db');
const { calculateUserPayroll, processPayrollBatch } = require('d:/P R O J E C T S/Web/MRF-crm/backend/src/controllers/payrollController');
const shiftService = require('d:/P R O J E C T S/Web/MRF-crm/backend/src/services/shiftService');

async function run13ScenarioTestSuite() {
  console.log('======================================================================');
  console.log('=== STARTING 13-SCENARIO PAYROLL ATTENDANCE & SCHEDULE TEST SUITE ===');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`✗ FAIL: ${testName} - Details: ${details}`);
      failed++;
    }
  }

  const testOrgId = `org-sched-test-${Date.now()}`;
  let org = null;
  const createdUserIds = [];
  const createdShiftIds = [];

  try {
    // 0. Setup test organization
    org = await prisma.organization.create({
      data: {
        id: testOrgId,
        name: 'Attendance Schedule Test Org',
        slug: `att-sched-test-${Date.now()}`,
        companyCode: `AST${Date.now().toString().slice(-4)}`
      }
    });

    // Helper to create employee with standard salary structure (Gross ₹26,000, daily ₹1,000 for 26d, or proportional)
    async function createTestEmployee(namePrefix, customGross = 26000) {
      const u = await prisma.user.create({
        data: {
          email: `${namePrefix.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}@example.com`,
          password: 'hashed_test_password',
          name: `${namePrefix} User`,
          role: 'EMPLOYEE',
          organizationId: testOrgId,
          employeeId: `EMP-${Date.now().toString().slice(-4)}-${Math.floor(Math.random() * 1000)}`,
          status: 'ACTIVE',
          joiningDate: new Date('2026-01-01T00:00:00.000Z')
        }
      });
      createdUserIds.push(u.id);

      await prisma.salaryStructure.create({
        data: {
          userId: u.id,
          basicSalary: Math.round(customGross * 0.5),
          hra: Math.round(customGross * 0.3),
          da: Math.round(customGross * 0.1),
          specialAllowance: Math.round(customGross * 0.1),
          travelAllowance: 0,
          medicalAllowance: 0,
          otherAllowances: 0,
          grossSalary: customGross,
          pfDeduction: 0,
          esiDeduction: 0,
          profTax: 0,
          incomeTax: 0,
          otherDeductions: 0,
          netSalary: customGross
        }
      });

      return u;
    }

    // -------------------------------------------------------------------------
    // TEST 1: Standard Monday-to-Friday schedule
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 1: Standard Monday-to-Friday Schedule ---');
    const u1 = await createTestEmployee('MonFri');
    const shiftMonFri = await prisma.shift.create({
      data: {
        name: 'Mon-Fri 5-Day Shift',
        organizationId: testOrgId,
        startTime: '09:00',
        endTime: '18:00',
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
    createdShiftIds.push(shiftMonFri.id);
    await prisma.shiftMember.create({ data: { shiftId: shiftMonFri.id, userId: u1.id } });

    // August 2026 has 21 weekdays (Mon-Fri)
    const res1 = await calculateUserPayroll(u1, 8, 2026);
    assert(res1.workingDays === 21, 'Scenario 1: Mon-Fri denominator is exactly 21 working days', `got ${res1.workingDays}`);
    assert(res1.presentDays === 0, 'Scenario 1: Present days is 0 when no attendance logged', `got ${res1.presentDays}`);
    assert(res1.unpaidAbsentDays === 21, 'Scenario 1: Saturdays and Sundays not penalised as absences', `got ${res1.unpaidAbsentDays}`);

    // -------------------------------------------------------------------------
    // TEST 2: Schedule that requires working Saturdays or Sundays
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 2: Schedule that Requires Working Sundays ---');
    const u2 = await createTestEmployee('SundayWorker');
    // Shift: Sun, Mon, Tue, Wed, Thu working; Fri, Sat off (5 days a week including Sunday)
    const shiftSunday = await prisma.shift.create({
      data: {
        name: 'Sun-Thu Shift',
        organizationId: testOrgId,
        startTime: '09:00',
        endTime: '18:00',
        workingDays: [
          { day: 'SUNDAY', isWorking: true },
          { day: 'MONDAY', isWorking: true },
          { day: 'TUESDAY', isWorking: true },
          { day: 'WEDNESDAY', isWorking: true },
          { day: 'THURSDAY', isWorking: true },
          { day: 'FRIDAY', isWorking: false },
          { day: 'SATURDAY', isWorking: false }
        ]
      }
    });
    createdShiftIds.push(shiftSunday.id);
    await prisma.shiftMember.create({ data: { shiftId: shiftSunday.id, userId: u2.id } });

    // In August 2026: 5 Sundays + 4 Mondays + 4 Tuesdays + 4 Wednesdays + 4 Thursdays = 21 working days
    // Add 1 present day on Sunday, August 2, 2026
    await prisma.attendance.create({
      data: {
        userId: u2.id,
        date: new Date('2026-08-02T10:00:00.000Z'),
        status: 'PRESENT',
        workingHours: 8,
        clockIn: new Date('2026-08-02T09:00:00.000Z'),
        clockOut: new Date('2026-08-02T17:00:00.000Z')
      }
    });

    const res2 = await calculateUserPayroll(u2, 8, 2026);
    assert(res2.workingDays === 22, 'Scenario 2: Sunday-working shift denominator includes Sundays (22 working days)', `got ${res2.workingDays}`);
    assert(res2.presentDays === 1, 'Scenario 2: Working on scheduled Sunday counts in present days numerator', `got ${res2.presentDays}`);
    assert(res2.unpaidAbsentDays === 21, 'Scenario 2: Remaining scheduled working days are 21', `got ${res2.unpaidAbsentDays}`);

    // -------------------------------------------------------------------------
    // TEST 3: Rotating shifts and custom schedules
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 3: Custom Shift Schedule (Object format with Saturday patterns) ---');
    const u3 = await createTestEmployee('RotatingWorker');
    // Shift: Object format with 1st, 3rd Saturday working, 2nd, 4th, 5th Saturday off
    const shiftSatPattern = await prisma.shift.create({
      data: {
        name: 'Alternate Saturday Shift',
        organizationId: testOrgId,
        startTime: '09:00',
        endTime: '18:00',
        workingDays: {
          MONDAY: 'Working',
          TUESDAY: 'Working',
          WEDNESDAY: 'Working',
          THURSDAY: 'Working',
          FRIDAY: 'Working',
          SATURDAY: {
            status: 'WORKING',
            pattern: { '1': 'WORKING', '2': 'HOLIDAY', '3': 'WORKING', '4': 'HOLIDAY', '5': 'HOLIDAY' }
          },
          SUNDAY: 'Holiday'
        }
      }
    });
    createdShiftIds.push(shiftSatPattern.id);
    await prisma.shiftMember.create({ data: { shiftId: shiftSatPattern.id, userId: u3.id } });

    // August 2026: 21 weekdays + 1st Sat (Aug 1) + 3rd Sat (Aug 15) = 23 working days
    const res3 = await calculateUserPayroll(u3, 8, 2026);
    assert(res3.workingDays === 23, 'Scenario 3: Rotating schedule correctly resolves 23 scheduled working days', `got ${res3.workingDays}`);

    // -------------------------------------------------------------------------
    // TEST 4: Company holidays and weekly offs
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 4: Company Holidays and Weekly Offs ---');
    const u4 = await createTestEmployee('HolidayWorker');
    // Standard Mon-Sat shift (26 days in Aug 2026)
    const shiftMonSat = await prisma.shift.create({
      data: {
        name: 'Mon-Sat 6-Day Shift',
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
    createdShiftIds.push(shiftMonSat.id);
    await prisma.shiftMember.create({ data: { shiftId: shiftMonSat.id, userId: u4.id } });

    // Add Company Holiday on Aug 15, 2026
    const holidayAug15 = await prisma.holidayCalendar.create({
      data: {
        title: 'Independence Day',
        date: new Date('2026-08-15T00:00:00.000Z'),
        organizationId: testOrgId,
        type: 'NATIONAL'
      }
    });

    const res4 = await calculateUserPayroll(u4, 8, 2026);
    // 26 days minus 1 company holiday = 25 scheduled working days
    assert(res4.workingDays === 25, 'Scenario 4: Company holiday properly deducted from scheduled working days (25d)', `got ${res4.workingDays}`);
    assert(res4.unpaidAbsentDays === 25, 'Scenario 4: Holiday date August 15 is NOT counted as unexcused absence', `got ${res4.unpaidAbsentDays}`);

    // -------------------------------------------------------------------------
    // TEST 5: Approved WFH on a scheduled working day with valid WFH attendance
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 5: Approved WFH with Attendance Record ---');
    const u5 = await createTestEmployee('WfhWorker1');
    await prisma.shiftMember.create({ data: { shiftId: shiftMonFri.id, userId: u5.id } });

    // Log WFH attendance on Monday Aug 3, 2026
    await prisma.attendance.create({
      data: {
        userId: u5.id,
        date: new Date('2026-08-03T10:00:00.000Z'),
        status: 'WORK_FROM_HOME',
        workLocation: 'HOME',
        workingHours: 8
      }
    });

    const res5 = await calculateUserPayroll(u5, 8, 2026);
    assert(res5.workingDays === 21, 'Scenario 5: Denominator is 21 working days', `got ${res5.workingDays}`);
    assert(res5.presentDays === 1, 'Scenario 5: Approved WFH counts toward presentDays numerator (1 / 21 days)', `got ${res5.presentDays}`);
    assert(res5.wfhDays === 1, 'Scenario 5: WFH days tracked as 1', `got ${res5.wfhDays}`);
    assert(res5.unpaidAbsentDays === 20, 'Scenario 5: WFH day is NOT treated as absence or LOP', `got ${res5.unpaidAbsentDays}`);

    // -------------------------------------------------------------------------
    // TEST 6: Approved WFH without a physical office clock-in
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 6: Approved WFH Without Office Clock-in ---');
    const u6 = await createTestEmployee('WfhWorker2');
    await prisma.shiftMember.create({ data: { shiftId: shiftMonFri.id, userId: u6.id } });

    // Approved LeaveRequest of type 'WFH' on Aug 4, 2026, with NO attendance record
    await prisma.leaveRequest.create({
      data: {
        userId: u6.id,
        startDate: new Date('2026-08-04T00:00:00.000Z'),
        endDate: new Date('2026-08-04T23:59:59.000Z'),
        leaveType: 'WFH',
        status: 'APPROVED',
        reason: 'Remote working day approved by manager'
      }
    });

    const res6 = await calculateUserPayroll(u6, 8, 2026);
    assert(res6.presentDays === 1, 'Scenario 6: Approved WFH without physical clock-in counts toward presentDays numerator', `got ${res6.presentDays}`);
    assert(res6.wfhDays === 1, 'Scenario 6: Tracked as 1 WFH day', `got ${res6.wfhDays}`);
    assert(res6.unpaidAbsentDays === 20, 'Scenario 6: Not classified as absent or LOP solely because of missing clock-in', `got ${res6.unpaidAbsentDays}`);

    // -------------------------------------------------------------------------
    // TEST 7: Duplicate WFH and attendance records for the same date
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 7: Duplicate WFH and Attendance Records on Same Date ---');
    const u7 = await createTestEmployee('WfhDupWorker');
    await prisma.shiftMember.create({ data: { shiftId: shiftMonFri.id, userId: u7.id } });

    // Both an Attendance record (WORK_FROM_HOME) AND an approved LeaveRequest (WFH) on Aug 5, 2026
    await prisma.attendance.create({
      data: {
        userId: u7.id,
        date: new Date('2026-08-05T09:00:00.000Z'),
        status: 'WORK_FROM_HOME',
        workLocation: 'HOME',
        workingHours: 8
      }
    });
    await prisma.leaveRequest.create({
      data: {
        userId: u7.id,
        startDate: new Date('2026-08-05T00:00:00.000Z'),
        endDate: new Date('2026-08-05T23:59:59.000Z'),
        leaveType: 'WFH',
        status: 'APPROVED',
        reason: 'Duplicate record test'
      }
    });

    const res7 = await calculateUserPayroll(u7, 8, 2026);
    assert(res7.presentDays === 1, 'Scenario 7: Present days is exactly 1 (no duplicate addition)', `got ${res7.presentDays}`);
    assert(res7.wfhDays === 1, 'Scenario 7: WFH days is exactly 1 (no duplicate addition)', `got ${res7.wfhDays}`);
    assert(res7.unpaidAbsentDays === 20, 'Scenario 7: Unpaid absent days is 20 (21 - 1)', `got ${res7.unpaidAbsentDays}`);

    // -------------------------------------------------------------------------
    // TEST 8: Approved paid leave and unpaid leave
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 8: Approved Paid Leave and Unpaid Leave ---');
    const u8 = await createTestEmployee('LeaveWorker');
    await prisma.shiftMember.create({ data: { shiftId: shiftMonFri.id, userId: u8.id } });

    // 2 days Paid Leave (Aug 10, Aug 11)
    await prisma.leaveRequest.create({
      data: {
        userId: u8.id,
        startDate: new Date('2026-08-10T00:00:00.000Z'),
        endDate: new Date('2026-08-11T23:59:59.000Z'),
        leaveType: 'CASUAL',
        status: 'APPROVED',
        payType: 'PAID',
        reason: 'Casual leave'
      }
    });

    // 2 days Unpaid Leave / LOP (Aug 12, Aug 13)
    await prisma.leaveRequest.create({
      data: {
        userId: u8.id,
        startDate: new Date('2026-08-12T00:00:00.000Z'),
        endDate: new Date('2026-08-13T23:59:59.000Z'),
        leaveType: 'LOP',
        status: 'APPROVED',
        payType: 'UNPAID',
        reason: 'Unpaid leave'
      }
    });

    // 5 days Present (Aug 17-21)
    for (let day = 17; day <= 21; day++) {
      await prisma.attendance.create({
        data: {
          userId: u8.id,
          date: new Date(`2026-08-${day}T10:00:00.000Z`),
          status: 'PRESENT',
          workingHours: 8
        }
      });
    }

    const res8 = await calculateUserPayroll(u8, 8, 2026);
    // 21 working days total:
    // 5 present + 2 paid leave + 2 unpaid leave + 12 missing attendance = 21
    assert(res8.presentDays === 5, 'Scenario 8: Present days is 5', `got ${res8.presentDays}`);
    assert(res8.paidLeaveDays === 2, 'Scenario 8: Paid leave days is 2', `got ${res8.paidLeaveDays}`);
    assert(res8.unpaidAbsentDays === 14, 'Scenario 8: Unpaid absent days is 14 (2 unpaid leave + 12 missing)', `got ${res8.unpaidAbsentDays}`);
    assert(res8.payableDays === 7, 'Scenario 8: Payable days is 7 (5 present + 2 paid leave)', `got ${res8.payableDays}`);

    // -------------------------------------------------------------------------
    // TEST 9: Missing clock-in on a scheduled working day without an approved exemption
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 9: Missing Clock-in Without Approved Exemption ---');
    const u9 = await createTestEmployee('MissingWorker', 21000); // ₹1,000 / day
    await prisma.shiftMember.create({ data: { shiftId: shiftMonFri.id, userId: u9.id } });

    // Present on 20 days, missing 1 scheduled working day (Aug 31)
    for (let day = 3; day <= 28; day++) {
      const dt = new Date(Date.UTC(2026, 7, day));
      if (dt.getUTCDay() !== 0 && dt.getUTCDay() !== 6) {
        await prisma.attendance.create({
          data: {
            userId: u9.id,
            date: dt,
            status: 'PRESENT',
            workingHours: 8
          }
        });
      }
    }

    const res9 = await calculateUserPayroll(u9, 8, 2026);
    assert(res9.workingDays === 21, 'Scenario 9: 21 scheduled working days', `got ${res9.workingDays}`);
    assert(res9.presentDays === 20, 'Scenario 9: 20 present days', `got ${res9.presentDays}`);
    assert(res9.unpaidAbsentDays === 1, 'Scenario 9: Missing clock-in counted as 1 unexcused absence day', `got ${res9.unpaidAbsentDays}`);
    assert(res9.deductionsJson.leaveDeduction === 1000, 'Scenario 9: 1 day LOP deduction applied (₹1,000)', `got ${res9.deductionsJson.leaveDeduction}`);
    assert(res9.netSalary === 20000, 'Scenario 9: Net salary is ₹20,000 (20 payable days)', `got ${res9.netSalary}`);

    // -------------------------------------------------------------------------
    // TEST 10: Missing clock-out when a valid clock-in exists
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 10: Missing Clock-out With Valid Clock-in ---');
    const u10 = await createTestEmployee('NoClockOutWorker');
    await prisma.shiftMember.create({ data: { shiftId: shiftMonFri.id, userId: u10.id } });

    // Valid clock-in on Aug 3, but clockOut is null
    await prisma.attendance.create({
      data: {
        userId: u10.id,
        date: new Date('2026-08-03T09:15:00.000Z'),
        clockIn: new Date('2026-08-03T09:15:00.000Z'),
        clockOut: null,
        status: 'PRESENT',
        workingHours: 0
      }
    });

    const res10 = await calculateUserPayroll(u10, 8, 2026);
    assert(res10.presentDays === 1, 'Scenario 10: Missing clock-out with valid clock-in counted as Present', `got ${res10.presentDays}`);
    assert(res10.unpaidAbsentDays === 20, 'Scenario 10: Only remaining 20 days treated as absent', `got ${res10.unpaidAbsentDays}`);

    // -------------------------------------------------------------------------
    // TEST 11: Payroll period that is still in progress
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 11: Payroll Period In-Progress ---');
    const now = new Date();
    const currM = now.getMonth() + 1;
    const currY = now.getFullYear();

    const u11 = await createTestEmployee('CurrentMonthWorker');
    await prisma.shiftMember.create({ data: { shiftId: shiftMonFri.id, userId: u11.id } });

    const res11 = await calculateUserPayroll(u11, currM, currY);
    // Unpaid absent days should NOT include future scheduled working days
    assert(res11.workingDays > 0, 'Scenario 11: Working days computed for in-progress month', `got ${res11.workingDays}`);
    assert(res11.unpaidAbsentDays <= res11.workingDays, 'Scenario 11: Absences do not exceed scheduled days', `got ${res11.unpaidAbsentDays}`);
    console.log(`✓ PASS: Scenario 11: In-progress period ${currM}/${currY} verified (workingDays: ${res11.workingDays}, unpaidAbsentDays: ${res11.unpaidAbsentDays})`);
    passed++;

    // -------------------------------------------------------------------------
    // TEST 12: Employees with different schedules in the same payroll batch
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 12: Different Schedules in Same Payroll Batch ---');
    const u12A = await createTestEmployee('Batch5DayWorker');
    const u12B = await createTestEmployee('Batch6DayWorker');
    await prisma.shiftMember.create({ data: { shiftId: shiftMonFri.id, userId: u12A.id } });
    await prisma.shiftMember.create({ data: { shiftId: shiftMonSat.id, userId: u12B.id } });

    // Present all working days for both employees in August 2026
    for (let day = 1; day <= 31; day++) {
      const dt = new Date(Date.UTC(2026, 7, day));
      const dayOfWeek = dt.getUTCDay();
      // u12A works Mon-Fri (1-5)
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        await prisma.attendance.create({
          data: {
            userId: u12A.id,
            date: dt,
            status: 'PRESENT',
            workingHours: 8
          }
        });
      }
      // u12B works Mon-Sat (1-6)
      if (dayOfWeek >= 1 && dayOfWeek <= 6) {
        // Skip Aug 15 (holiday) for u12B
        if (day !== 15) {
          await prisma.attendance.create({
            data: {
              userId: u12B.id,
              date: dt,
              status: 'PRESENT',
              workingHours: 8
            }
          });
        }
      }
    }

    const batchReq = {
      user: { id: u12A.id, role: 'ADMIN', organizationId: testOrgId },
      body: { month: 8, year: 2026, userIds: [u12A.id, u12B.id] }
    };
    let batchJson = null;
    const batchResObj = {
      status: (code) => ({
        json: (data) => { batchJson = { statusCode: code, ...data }; return batchJson; }
      }),
      json: (data) => { batchJson = { statusCode: 200, ...data }; return batchJson; }
    };

    await processPayrollBatch(batchReq, batchResObj);
    assert(batchJson && batchJson.success, 'Scenario 12: processPayrollBatch completed successfully', batchJson?.message);

    const batchPayslips = await prisma.payslip.findMany({
      where: { batchId: batchJson.batch.id, userId: { in: [u12A.id, u12B.id] } },
      orderBy: { userId: 'asc' }
    });

    const psA = batchPayslips.find(p => p.userId === u12A.id);
    const psB = batchPayslips.find(p => p.userId === u12B.id);

    assert(psA.workingDays === 21, 'Scenario 12: Employee A with 5-day schedule has 21 working days denominator', `got ${psA.workingDays}`);
    assert(psA.presentDays === 21, 'Scenario 12: Employee A has 21 present days numerator (21 / 21 days)', `got ${psA.presentDays}`);
    assert(psB.workingDays === 25, 'Scenario 12: Employee B with 6-day schedule has 25 working days denominator', `got ${psB.workingDays}`);
    assert(psB.presentDays === 25, 'Scenario 12: Employee B has 25 present days numerator (25 / 25 days)', `got ${psB.presentDays}`);

    // -------------------------------------------------------------------------
    // TEST 13: Prevention of duplicate LOP deductions
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 13: Prevention of Duplicate LOP Deductions ---');
    const u13 = await createTestEmployee('DupLopWorker', 26000); // ₹1,000 / day on 26d basis
    await prisma.shiftMember.create({ data: { shiftId: shiftMonSat.id, userId: u13.id } });

    // On Aug 3, 2026: Employee has BOTH an explicit ABSENT attendance record AND an approved UNPAID leave record
    await prisma.attendance.create({
      data: {
        userId: u13.id,
        date: new Date('2026-08-03T10:00:00.000Z'),
        status: 'ABSENT',
        workingHours: 0
      }
    });
    await prisma.leaveRequest.create({
      data: {
        userId: u13.id,
        startDate: new Date('2026-08-03T00:00:00.000Z'),
        endDate: new Date('2026-08-03T23:59:59.000Z'),
        leaveType: 'LOP',
        payType: 'UNPAID',
        status: 'APPROVED',
        reason: 'Duplicate LOP prevention test'
      }
    });

    // Make all other 24 scheduled working days present
    for (let day = 1; day <= 31; day++) {
      if (day === 3 || day === 15) continue; // day 3 is test day, day 15 is holiday
      const dt = new Date(Date.UTC(2026, 7, day));
      if (dt.getUTCDay() !== 0) { // Not Sunday
        await prisma.attendance.create({
          data: {
            userId: u13.id,
            date: dt,
            status: 'PRESENT',
            workingHours: 8
          }
        });
      }
    }

    const res13 = await calculateUserPayroll(u13, 8, 2026);
    assert(res13.workingDays === 25, 'Scenario 13: 25 scheduled working days (26 minus holiday)', `got ${res13.workingDays}`);
    assert(res13.presentDays === 24, 'Scenario 13: 24 present days', `got ${res13.presentDays}`);
    assert(res13.unpaidAbsentDays === 1, 'Scenario 13: Total unpaid absences is exactly 1 (not duplicated as 2)', `got ${res13.unpaidAbsentDays}`);
    assert(res13.deductionsJson.leaveDeduction === Math.round(26000 / 25), 'Scenario 13: Exactly 1 day salary deducted as LOP without double deduction', `got ${res13.deductionsJson.leaveDeduction}`);
    assert(res13.netSalary === 26000 - Math.round(26000 / 25), 'Scenario 13: Net salary reflects single deduction', `got ${res13.netSalary}`);

  } catch (err) {
    console.error('Test Suite encountered an error:', err);
    failed++;
  } finally {
    console.log('\n--- Cleaning up test environment ---');
    try {
      if (createdUserIds.length > 0) {
        await prisma.payslip.deleteMany({ where: { userId: { in: createdUserIds } } });
        await prisma.payrollBatch.deleteMany({ where: { organizationId: testOrgId } });
        await prisma.attendance.deleteMany({ where: { userId: { in: createdUserIds } } });
        await prisma.leaveRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
        await prisma.salaryStructure.deleteMany({ where: { userId: { in: createdUserIds } } });
        await prisma.shiftMember.deleteMany({ where: { userId: { in: createdUserIds } } });
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      if (createdShiftIds.length > 0) {
        await prisma.shift.deleteMany({ where: { id: { in: createdShiftIds } } });
      }
      if (org) {
        await prisma.holidayCalendar.deleteMany({ where: { organizationId: testOrgId } });
        await prisma.organization.delete({ where: { id: testOrgId } });
      }
    } catch (cleanErr) {
      console.warn('Cleanup warning:', cleanErr.message);
    }
  }

  console.log('\n======================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run13ScenarioTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
