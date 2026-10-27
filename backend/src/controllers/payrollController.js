const prisma = require('../utils/db');
const { logActivity } = require('../utils/activityLogger');
const { createNotification } = require('../services/notification');
const { isPayrollEligibleUser } = require('../utils/payrollHelper');
const { getEffectiveOrgId, assertOrganizationAccess } = require('../utils/organizationScope');
const { getEffectiveSettings } = require('../utils/settingsResolver');
const shiftService = require('../services/shiftService');
const crypto = require('crypto');

// Helper to calculate itemized salary for a user in a given month/year
const calculateUserPayroll = async (user, month, year, inputSettings) => {
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59));

  const effectiveSettings = (inputSettings && inputSettings.warningLateLimit !== undefined)
    ? inputSettings
    : await getEffectiveSettings(user.organizationId);

  const settings = inputSettings || effectiveSettings || {};

  // 1. Fetch user's assigned salary structure, holidays (both HolidayCalendar & WorkCalendar), attendances, shift resolver & approved leaves
  const [structure, holidays, workCalendarOverrides, permanentHolidays, attendances, batchShiftResolver, leaves] = await Promise.all([
    prisma.salaryStructure.findUnique({
      where: { userId: user.id },
      include: { template: true }
    }),
    prisma.holidayCalendar.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
        ...(user.organizationId ? { organizationId: user.organizationId } : {})
      }
    }),
    prisma.workCalendar.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
        status: 'HOLIDAY',
        ...(user.organizationId ? {
          OR: [
            { organizationId: user.organizationId },
            { organizationId: null, createdBy: { organizationId: user.organizationId } }
          ]
        } : {})
      }
    }),
    prisma.workCalendar.findMany({
      where: {
        isPermanent: true,
        status: 'HOLIDAY',
        recurrenceMonth: month,
        ...(user.organizationId ? {
          OR: [
            { organizationId: user.organizationId },
            { organizationId: null, createdBy: { organizationId: user.organizationId } }
          ]
        } : {})
      }
    }),
    prisma.attendance.findMany({
      where: {
        userId: user.id,
        date: { gte: startDate, lte: endDate }
      }
    }),
    shiftService.createBatchShiftResolver({
      userIds: [user.id],
      organizationId: user.organizationId,
      startDate,
      endDate,
      client: prisma
    }),
    prisma.leaveRequest.findMany({
      where: {
        userId: user.id,
        status: 'APPROVED',
        AND: [
          { startDate: { lte: endDate } },
          { endDate: { gte: startDate } }
        ]
      }
    })
  ]);

  const holidayDatesStr = new Set([
    ...holidays.map(h => new Date(h.date).toISOString().split('T')[0]),
    ...workCalendarOverrides.map(w => new Date(w.date).toISOString().split('T')[0])
  ]);
  const permDaySet = new Set(permanentHolidays.map(p => p.recurrenceDay));

  const assignedShift = batchShiftResolver.getShift(user.id, startDate);
  const snapshotShiftName = attendances.find(a => a.shiftName)?.shiftName;
  const shiftUsedName = snapshotShiftName || assignedShift?.name || 'Company Default';

  const daysInMonth = endDate.getUTCDate();
  const attendanceMap = new Map();
  attendances.forEach(a => {
    const dStr = new Date(a.date).toISOString().split('T')[0];
    attendanceMap.set(dStr, a);
  });

  // Map approved leaves date-by-date
  const leaveByDateMap = new Map();
  leaves.forEach(l => {
    const lType = (l.leaveType || l.type || 'CASUAL').toUpperCase();
    const isUnpaid = l.payType === 'UNPAID' || ['LOP', 'UNPAID', 'LOSS_OF_PAY'].includes(lType);

    const rawStart = new Date(l.startDate);
    const rawEnd = new Date(l.endDate || l.startDate);

    const lStart = new Date(Math.max(startDate.getTime(), Date.UTC(rawStart.getUTCFullYear(), rawStart.getUTCMonth(), rawStart.getUTCDate())));
    const lEnd = new Date(Math.min(endDate.getTime(), Date.UTC(rawEnd.getUTCFullYear(), rawEnd.getUTCMonth(), rawEnd.getUTCDate())));

    let curr = new Date(lStart);
    while (curr <= lEnd) {
      const dateStr = curr.toISOString().split('T')[0];
      leaveByDateMap.set(dateStr, { leave: l, lType, isUnpaid });
      curr.setUTCDate(curr.getUTCDate() + 1);
    }
  });

  // In-progress payroll period detection
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const todayDateStr = now.toISOString().split('T')[0];
  const isCurrentMonthYear = (year === currentYear && month === currentMonth);
  const isFutureMonth = (year > currentYear || (year === currentYear && month > currentMonth));
  const userJoiningStr = user.joiningDate ? new Date(user.joiningDate).toISOString().split('T')[0] : null;

  let computedWorkingDays = 0;
  let presentDays = 0;
  let lateCount = 0;
  let halfDays = 0;
  let attWfhDays = 0;
  let paidLeaveDays = 0;
  let unpaidLeaveDays = 0;
  let leaveWfhDays = 0;
  let explicitAbsentDays = 0;
  let missingAttendanceDays = 0;
  let futureScheduledDays = 0;

  // Day-by-Day Evaluation of assigned working schedule
  for (let dNum = 1; dNum <= daysInMonth; dNum++) {
    const d = new Date(Date.UTC(year, month - 1, dNum));
    const dStr = d.toISOString().split('T')[0];
    const isCompanyHoliday = holidayDatesStr.has(dStr) || permDaySet.has(dNum);

    const shiftStatusInfo = batchShiftResolver.getDayStatus(user.id, d);
    const isShiftHoliday = shiftStatusInfo.isHoliday;
    const isOffOrHoliday = isCompanyHoliday || isShiftHoliday;

    // Skip dates before employee's joining date (not scheduled to work)
    if (userJoiningStr && dStr < userJoiningStr) {
      continue;
    }

    const dayAtt = attendanceMap.get(dStr);
    const dayLeave = leaveByDateMap.get(dStr);

    let isWorkingDay = false;
    if (!isOffOrHoliday) {
      if (dayAtt) {
        isWorkingDay = (dayAtt.status !== 'HOLIDAY');
      } else {
        isWorkingDay = (shiftStatusInfo.status === 'Working' || shiftStatusInfo.status === 'WFH' || !shiftStatusInfo.shift);
      }
    }

    if (isWorkingDay) {
      computedWorkingDays += 1;
    }

    const isAttWfh = dayAtt && (dayAtt.status === 'WORK_FROM_HOME' || dayAtt.status === 'WFH' || dayAtt.workLocation === 'HOME');
    const isLeaveWfh = dayLeave && (dayLeave.lType === 'WFH' || dayLeave.lType === 'WORK_FROM_HOME');

    // Evaluate attendance, leave, or potential absence for this day
    if (dayAtt) {
      if (dayAtt.status === 'PRESENT') {
        if (isWorkingDay) {
          presentDays += 1;
        }
      } else if (dayAtt.status === 'LATE') {
        if (isWorkingDay) {
          presentDays += 1;
        }
        lateCount += 1;
      } else if (dayAtt.status === 'HALF_DAY') {
        if (isWorkingDay) {
          presentDays += 0.5;
          halfDays += 1;
        }
      } else if (isAttWfh) {
        if (isWorkingDay) {
          presentDays += 1;
          attWfhDays += 1;
        }
      } else if (dayAtt.status === 'LEAVE') {
        if (isWorkingDay) {
          if (isLeaveWfh) {
            presentDays += 1;
            leaveWfhDays += 1;
          } else if (dayLeave?.isUnpaid) {
            unpaidLeaveDays += 1;
          } else {
            paidLeaveDays += 1;
          }
        }
      } else if (dayAtt.status === 'ABSENT') {
        // Check if employee has an approved WFH or approved leave exemption
        if (isWorkingDay) {
          if (isLeaveWfh) {
            presentDays += 1;
            leaveWfhDays += 1;
          } else if (dayLeave) {
            if (dayLeave.isUnpaid) {
              unpaidLeaveDays += 1;
            } else {
              paidLeaveDays += 1;
            }
          } else {
            explicitAbsentDays += 1;
          }
        }
      } else if (dayAtt.clockIn || (dayAtt.workingHours && dayAtt.workingHours > 0)) {
        // Valid clock-in with missing clock-out or custom status
        if (isWorkingDay) {
          presentDays += 1;
        }
      } else {
        // Attendance record without clock-in or custom status
        if (isWorkingDay) {
          if (isLeaveWfh) {
            presentDays += 1;
            leaveWfhDays += 1;
          } else if (dayLeave) {
            if (dayLeave.isUnpaid) {
              unpaidLeaveDays += 1;
            } else {
              paidLeaveDays += 1;
            }
          } else {
            explicitAbsentDays += 1;
          }
        }
      }
    } else if (dayLeave) {
      // Approved leave request without separate attendance record
      if (isWorkingDay) {
        if (isLeaveWfh) {
          presentDays += 1;
          leaveWfhDays += 1;
        } else if (dayLeave.isUnpaid) {
          unpaidLeaveDays += 1;
        } else {
          paidLeaveDays += 1;
        }
      }
    } else {
      // Scheduled working day with no attendance and no approved leave
      if (isWorkingDay) {
        const isFutureDay = isFutureMonth || (isCurrentMonthYear && dStr > todayDateStr);
        if (isFutureDay) {
          // Future date of an in-progress month: do not penalize or mark absent
          futureScheduledDays += 1;
        } else if (isCurrentMonthYear && dStr === todayDateStr) {
          // Current date during an in-progress month: do not prematurely treat as absent
          futureScheduledDays += 1;
        } else {
          // Past scheduled working day without attendance or approved leave: unexcused absence
          missingAttendanceDays += 1;
        }
      }
    }
  }

  const workingDays = computedWorkingDays > 0 ? computedWorkingDays : daysInMonth;
  const wfhDays = attWfhDays + leaveWfhDays;
  const unpaidAbsentDays = Math.round((explicitAbsentDays + (halfDays * 0.5) + unpaidLeaveDays + missingAttendanceDays) * 10) / 10;
  const payableDays = Math.max(0, Math.round((workingDays - unpaidAbsentDays) * 10) / 10);

  if (!structure) {
    return {
      userId: user.id,
      month,
      year,
      basicSalary: 0,
      hra: 0,
      da: 0,
      allowancesJson: {
        structureAssigned: false,
        remark: 'Salary Structure Not Assigned',
        shiftName: shiftUsedName,
        specialAllowance: 0,
        travelAllowance: 0,
        medicalAllowance: 0,
        otherAllowances: 0,
        bonus: 0,
        payableDays: 0,
        hasMissingAttendance: missingAttendanceDays > 0,
        missingAttendanceDays
      },
      deductionsJson: {
        pfDeduction: 0,
        esiDeduction: 0,
        profTax: 0,
        incomeTax: 0,
        otherDeductions: 0,
        leaveDeduction: 0,
        lateDeduction: 0,
        totalLates: 0,
        deductibleLates: 0,
        warningLimit: 3
      },
      grossSalary: 0,
      netSalary: 0,
      workingDays,
      presentDays,
      paidLeaveDays,
      unpaidAbsentDays,
      payableDays,
      missingAttendanceDays,
      wfhDays,
      overtimeHours: 0,
      overtimePay: 0,
      holidayDaysWorked: 0,
      holidayPay: 0,
      lateDeduction: 0,
      qrCodeHash: null
    };
  }

  // 4. Overtime & Holiday Work Calculations (Controlled by Site Settings toggles)
  const isOvertimePayEnabled = Boolean(effectiveSettings.enableOvertimePay);
  const isHolidayPayEnabled = Boolean(effectiveSettings.enableHolidayPay);

  let overtimeHours = 0;
  let holidayDaysWorked = 0;

  if (isOvertimePayEnabled || isHolidayPayEnabled) {
    attendances.forEach(att => {
      const attDateStr = new Date(att.date).toISOString().split('T')[0];
      const attDate = new Date(att.date);
      const attDayNum = attDate.getUTCDate();
      const attShiftStatusInfo = batchShiftResolver.getDayStatus(user.id, attDate);
      const isHolidayOrOff = holidayDatesStr.has(attDateStr) || permDaySet.has(attDayNum) || attShiftStatusInfo.isHoliday;

      // Calculate overtime using Safeguard 2 hierarchy if enabled
      if (isOvertimePayEnabled) {
        if (att.clockIn && att.clockOut) {
          // Priority 1: Attendance record snapshot shiftEndAt
          if (att.shiftEndAt && new Date(att.clockOut) > new Date(att.shiftEndAt)) {
            const otDiff = (new Date(att.clockOut).getTime() - new Date(att.shiftEndAt).getTime()) / (1000 * 60 * 60);
            if (otDiff > 0) overtimeHours += otDiff;
          } else if (att.scheduledStartTime && att.scheduledEndTime && att.workingHours) {
            const [sH, sM] = att.scheduledStartTime.split(':').map(Number);
            const [eH, eM] = att.scheduledEndTime.split(':').map(Number);
            let schedMins = (eH * 60 + eM) - (sH * 60 + sM);
            if (schedMins < 0) schedMins += 1440;
            const schedHrs = schedMins / 60;
            if (att.workingHours > schedHrs) {
              overtimeHours += (att.workingHours - schedHrs);
            }
          } else if (assignedShift?.startTime && assignedShift?.endTime && att.workingHours) {
            // Priority 2: Assigned shift fallback
            const [sH, sM] = assignedShift.startTime.split(':').map(Number);
            const [eH, eM] = assignedShift.endTime.split(':').map(Number);
            let schedMins = (eH * 60 + eM) - (sH * 60 + sM);
            if (schedMins < 0) schedMins += 1440;
            const schedHrs = schedMins / 60;
            if (att.workingHours > schedHrs) {
              overtimeHours += (att.workingHours - schedHrs);
            }
          } else if (att.workingHours && att.workingHours > 8) {
            // Priority 3: Standard company 8h fallback
            overtimeHours += (att.workingHours - 8);
          }
        } else if (att.workingHours && att.workingHours > 8) {
          overtimeHours += (att.workingHours - 8);
        }
      }

      if (isHolidayPayEnabled) {
        if (isHolidayOrOff && ['PRESENT', 'LATE', 'WORK_FROM_HOME'].includes(att.status)) {
          holidayDaysWorked += 1;
        }
      }
    });
  }

  const dailyPay = workingDays > 0 ? (structure.grossSalary / workingDays) : 0;
  const leaveDeduction = Math.min(structure.grossSalary, Math.round(unpaidAbsentDays * dailyPay));

  // Dynamic Late Policy: First 3 warnings (default), 4th late onward starts deduction
  const latePolicyEnabled = effectiveSettings.latePolicyEnabled !== false;
  const warningLateLimit = effectiveSettings.warningLateLimit !== undefined ? Number(effectiveSettings.warningLateLimit) : 3;
  const deductionPerLate = effectiveSettings.deductionPerLate || '1_DAY_SALARY';
  const latePolicyAppliesTo = (effectiveSettings.latePolicyAppliesTo || 'INTERN,EMPLOYEE,TEAM_LEADER')
    .split(',')
    .map(r => r.trim());

  const isRoleApplicable = latePolicyAppliesTo.includes(user.role);

  let deductibleLates = 0;
  let lateDeduction = 0;

  if (latePolicyEnabled && isRoleApplicable) {
    deductibleLates = Math.max(0, lateCount - warningLateLimit);
    if (deductibleLates > 0) {
      if (deductionPerLate === '0.5_DAY_SALARY' || deductionPerLate === 'HALF_DAY') {
        lateDeduction = Math.round(deductibleLates * (dailyPay * 0.5));
      } else if (typeof deductionPerLate === 'number' || (!isNaN(Number(deductionPerLate)) && !String(deductionPerLate).includes('DAY'))) {
        lateDeduction = Math.round(deductibleLates * Number(deductionPerLate));
      } else {
        // Default: 1 Day Salary per deductible late
        lateDeduction = Math.round(deductibleLates * dailyPay);
      }
    }
  }

  const overtimePay = isOvertimePayEnabled ? Math.round(overtimeHours * (settings.overtimeHourlyRate || 150)) : 0;
  const holidayPay = isHolidayPayEnabled ? Math.round(holidayDaysWorked * dailyPay * (settings.holidayPayMultiplier || 2.0)) : 0;

  const totalEarnings = structure.grossSalary + overtimePay + holidayPay;
  const totalDeductions = structure.pfDeduction + structure.esiDeduction + structure.profTax + structure.incomeTax + structure.otherDeductions + leaveDeduction + lateDeduction;
  const finalNetSalary = Math.max(0, Math.round(totalEarnings - totalDeductions));

  const qrCodeHash = crypto.createHash('sha256').update(`${user.id}-${month}-${year}-${finalNetSalary}`).digest('hex').substring(0, 16);

  return {
    userId: user.id,
    month,
    year,
    basicSalary: structure.basicSalary,
    hra: structure.hra,
    da: structure.da,
    allowancesJson: {
      shiftName: shiftUsedName,
      specialAllowance: structure.specialAllowance,
      travelAllowance: structure.travelAllowance,
      medicalAllowance: structure.medicalAllowance,
      otherAllowances: structure.otherAllowances,
      bonus: structure.bonus,
      payableDays,
      hasMissingAttendance: missingAttendanceDays > 0,
      missingAttendanceDays
    },
    deductionsJson: {
      pfDeduction: structure.pfDeduction,
      esiDeduction: structure.esiDeduction,
      profTax: structure.profTax,
      incomeTax: structure.incomeTax,
      otherDeductions: structure.otherDeductions,
      leaveDeduction,
      lateDeduction,
      totalLates: lateCount,
      deductibleLates,
      warningLimit: warningLateLimit,
      missingAttendanceDays,
      explicitAbsentDays,
      unpaidLeaveDays,
      dailyPay: Math.round(dailyPay * 100) / 100
    },
    grossSalary: totalEarnings,
    netSalary: finalNetSalary,
    workingDays,
    presentDays,
    paidLeaveDays,
    unpaidAbsentDays,
    payableDays,
    missingAttendanceDays,
    wfhDays,
    overtimeHours: Math.round(overtimeHours * 10) / 10,
    overtimePay,
    holidayDaysWorked,
    holidayPay,
    lateDeduction,
    qrCodeHash
  };
};

// 1. Process Monthly Payroll (Draft / Preview)
const processPayrollBatch = async (req, res) => {
  try {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only Administrators can process payroll.' });
    }

    const { month, year, userIds } = req.body;
    const targetOrgId = getEffectiveOrgId(req);

    if (!month || !year) {
      return res.status(400).json({ success: false, message: 'Month and year parameters are required.' });
    }

    const m = Number(month);
    const y = Number(year);

    const settings = await getEffectiveSettings(targetOrgId);

    let targetUsers = [];
    if (Array.isArray(userIds) && userIds.length > 0) {
      targetUsers = await prisma.user.findMany({
        where: {
          id: { in: userIds },
          ...(targetOrgId ? { organizationId: targetOrgId } : {})
        }
      });
    } else {
      const allActive = await prisma.user.findMany({
        where: {
          status: 'ACTIVE',
          ...(targetOrgId ? { organizationId: targetOrgId } : {})
        }
      });
      targetUsers = allActive.filter(isPayrollEligibleUser);
    }

    // Check existing batch for month, year, and organizationId
    let batch = await prisma.payrollBatch.findFirst({
      where: {
        month: m,
        year: y,
        ...(targetOrgId ? { organizationId: targetOrgId } : {})
      }
    });

    if (batch && ['LOCKED', 'PUBLISHED', 'COMPLETED'].includes(batch.status)) {
      return res.status(400).json({ success: false, message: `Payroll batch for ${m}/${y} is locked or published (${batch.status}). Unlock or Rollback first.` });
    }

    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;
    const payslipsData = [];

    for (const u of targetUsers) {
      const ps = await calculateUserPayroll(u, m, y, settings);
      // Skip users without an assigned salary structure (prevent zero-salary placeholder payslips)
      if (ps.allowancesJson?.structureAssigned === false || (ps.basicSalary === 0 && ps.grossSalary === 0 && ps.netSalary === 0)) {
        continue;
      }
      totalGross += ps.grossSalary;
      totalDeductions += (ps.grossSalary - ps.netSalary);
      totalNet += ps.netSalary;
      payslipsData.push(ps);
    }

    if (!batch) {
      batch = await prisma.payrollBatch.create({
        data: {
          organizationId: targetOrgId || null,
          month: m,
          year: y,
          status: 'PREVIEW',
          totalEmployees: payslipsData.length,
          totalGross: Math.round(totalGross),
          totalDeductions: Math.round(totalDeductions),
          totalNet: Math.round(totalNet),
          processedById: req.user.id
        }
      });
    } else {
      batch = await prisma.payrollBatch.update({
        where: { id: batch.id },
        data: {
          status: 'PREVIEW',
          totalEmployees: payslipsData.length,
          totalGross: Math.round(totalGross),
          totalDeductions: Math.round(totalDeductions),
          totalNet: Math.round(totalNet),
          processedById: req.user.id
        }
      });
    }

    // Upsert payslip items
    for (const psData of payslipsData) {
      const { totalLates, deductibleLates, warningLimit, payableDays, missingAttendanceDays, ...payload } = psData;
      await prisma.payslip.upsert({
        where: { batchId_userId: { batchId: batch.id, userId: payload.userId } },
        update: { ...payload, organizationId: targetOrgId || null, status: 'PREVIEW' },
        create: { ...payload, batchId: batch.id, organizationId: targetOrgId || null, status: 'PREVIEW' }
      });
    }

    await logActivity({
      userId: req.user.id,
      organizationId: targetOrgId,
      action: 'PAYROLL_GENERATE',
      details: `Processed payroll preview batch for ${m}/${y} (${targetUsers.length} employees, Net: ₹${Math.round(totalNet)})`
    });

    const fullBatch = await prisma.payrollBatch.findUnique({
      where: { id: batch.id },
      include: {
        processedBy: { select: { id: true, name: true, role: true } },
        payslips: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                employeeId: true,
                role: true,
                department: true,
                shiftAssignment: { include: { shift: true } }
              }
            }
          }
        }
      }
    });

    res.json({
      success: true,
      batch: fullBatch,
      ...fullBatch
    });
  } catch (error) {
    console.error('Process payroll batch error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to process payroll batch.' });
  }
};

// 2. Get All Payroll Batches (Admin / Super Admin Only)
const getPayrollBatches = async (req, res) => {
  try {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    const { month, year } = req.query;
    const targetOrgId = getEffectiveOrgId(req);

    const where = {};
    if (month) where.month = Number(month);
    if (year) where.year = Number(year);

    if (targetOrgId) {
      where.organizationId = targetOrgId;
    }

    const batches = await prisma.payrollBatch.findMany({
      where,
      include: {
        processedBy: { select: { id: true, name: true, role: true, organizationId: true } }
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }]
    });

    res.json(batches);
  } catch (error) {
    console.error('Get payroll batches error:', error);
    res.status(500).json({ message: 'Failed to retrieve payroll batches.' });
  }
};

// 3. Get Single Payroll Batch by ID (Admin / Super Admin Only)
const getPayrollBatchById = async (req, res) => {
  try {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    const { id } = req.params;
    const batch = await prisma.payrollBatch.findUnique({
      where: { id },
      include: {
        processedBy: { select: { id: true, name: true, role: true } },
        payslips: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                employeeId: true,
                role: true,
                department: true,
                shiftAssignment: { include: { shift: true } }
              }
            }
          }
        }
      }
    });

    if (!batch) {
      return res.status(404).json({ message: 'Payroll batch not found.' });
    }

    assertOrganizationAccess(batch, req);

    res.json(batch);
  } catch (error) {
    if (error.statusCode === 403) return res.status(403).json({ message: error.message });
    console.error('Get payroll batch error:', error);
    res.status(500).json({ message: 'Failed to retrieve payroll batch.' });
  }
};

// 4. Lock Payroll Batch (Admin / Super Admin Only)
const lockPayrollBatch = async (req, res) => {
  try {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only Administrators can lock payroll.' });
    }

    const { id } = req.params;
    const batch = await prisma.payrollBatch.findUnique({ where: { id } });
    if (!batch) return res.status(404).json({ message: 'Batch not found.' });

    assertOrganizationAccess(batch, req);

    const updated = await prisma.payrollBatch.update({
      where: { id },
      data: {
        status: 'LOCKED',
        lockedAt: new Date()
      }
    });

    await prisma.payslip.updateMany({
      where: { batchId: id },
      data: { status: 'LOCKED' }
    });

    await logActivity({
      userId: req.user.id,
      organizationId: batch.organizationId,
      action: 'PAYROLL_LOCK',
      details: `Locked payroll batch for ${batch.month}/${batch.year}`
    });

    res.json(updated);
  } catch (error) {
    if (error.statusCode === 403) return res.status(403).json({ message: error.message });
    console.error('Lock payroll batch error:', error);
    res.status(500).json({ message: 'Failed to lock payroll batch.' });
  }
};

// 5. Review Payroll Batch (Admin / Super Admin Only)
const reviewPayrollBatch = async (req, res) => {
  try {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only Administrators can review payroll.' });
    }

    const { id } = req.params;
    const batch = await prisma.payrollBatch.findUnique({ where: { id } });
    if (!batch) return res.status(404).json({ message: 'Batch not found.' });

    assertOrganizationAccess(batch, req);

    const updated = await prisma.payrollBatch.update({
      where: { id },
      data: { status: 'REVIEW' }
    });

    res.json(updated);
  } catch (error) {
    if (error.statusCode === 403) return res.status(403).json({ message: error.message });
    console.error('Review payroll batch error:', error);
    res.status(500).json({ message: 'Failed to update review status.' });
  }
};

// 6. Publish Payroll Batch & Payslips (Admin / Super Admin Only)
const publishPayrollBatch = async (req, res) => {
  try {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only Administrators can publish payroll.' });
    }

    const { id } = req.params;
    const batch = await prisma.payrollBatch.findUnique({
      where: { id },
      include: { payslips: { include: { user: true } } }
    });

    if (!batch) return res.status(404).json({ message: 'Batch not found.' });

    assertOrganizationAccess(batch, req);

    const targetOrgId = getEffectiveOrgId(req) || batch.organizationId;

    const updated = await prisma.payrollBatch.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        organizationId: targetOrgId || null
      }
    });

    await prisma.payslip.updateMany({
      where: { batchId: id },
      data: {
        status: 'PUBLISHED',
        organizationId: targetOrgId || null
      }
    });

    // Notify all affected users
    for (const ps of batch.payslips) {
      await createNotification({
        userId: ps.userId,
        title: 'Payslip Available',
        message: `Your payslip for ${batch.month}/${batch.year} has been published. Net Pay: ₹${ps.netSalary.toLocaleString()}`,
        type: 'PAYSLIP_AVAILABLE'
      });
    }

    await logActivity({
      userId: req.user.id,
      organizationId: targetOrgId,
      action: 'PAYROLL_PUBLISH',
      details: `Published payroll batch for ${batch.month}/${batch.year} (${batch.totalEmployees} payslips)`
    });

    res.json(updated);
  } catch (error) {
    if (error.statusCode === 403) return res.status(403).json({ message: error.message });
    console.error('Publish payroll batch error:', error);
    res.status(500).json({ message: 'Failed to publish payroll batch.' });
  }
};

// 7. Rollback Payroll Batch (Admin / Super Admin Only)
const rollbackPayrollBatch = async (req, res) => {
  try {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only Administrators can rollback payroll.' });
    }

    const { id } = req.params;
    const batch = await prisma.payrollBatch.findUnique({ where: { id } });
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found.' });

    assertOrganizationAccess(batch, req);

    if (batch.status === 'PUBLISHED') {
      return res.status(400).json({ success: false, message: 'Published payroll batches cannot be rolled back.' });
    }

    await prisma.payrollBatch.update({
      where: { id },
      data: { status: 'ROLLED_BACK' }
    });

    await prisma.payslip.updateMany({
      where: { batchId: id },
      data: { status: 'ROLLED_BACK' }
    });

    await logActivity({
      userId: req.user.id,
      organizationId: batch.organizationId,
      action: 'PAYROLL_ROLLBACK',
      details: `Rolled back payroll batch for ${batch.month}/${batch.year}`
    });

    const fullBatch = await prisma.payrollBatch.findUnique({
      where: { id: batch.id },
      include: {
        processedBy: { select: { id: true, name: true, role: true } },
        payslips: {
          include: {
            user: { select: { id: true, name: true, email: true, employeeId: true, role: true, department: true } }
          }
        }
      }
    });

    res.json({
      success: true,
      message: `Payroll batch for ${batch.month}/${batch.year} rolled back successfully.`,
      batch: fullBatch,
      ...fullBatch
    });
  } catch (error) {
    if (error.statusCode === 403) return res.status(403).json({ success: false, message: error.message });
    console.error('Rollback payroll batch error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to rollback payroll batch.' });
  }
};

// Reset payroll module data for current organization
const resetPayrollData = async (req, res) => {
  try {
    const targetOrgId = getEffectiveOrgId(req);
    if (!targetOrgId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required to reset payroll data.' });
    }

    // 1. Delete Payslips for this org
    const deletedPayslips = await prisma.payslip.deleteMany({
      where: { organizationId: targetOrgId }
    });

    // 2. Delete PayrollBatches for this org
    const deletedBatches = await prisma.payrollBatch.deleteMany({
      where: { organizationId: targetOrgId }
    });

    // 3. Delete SalaryRevisions for this org
    const deletedRevisions = await prisma.salaryRevision.deleteMany({
      where: { organizationId: targetOrgId }
    });

    // 4. Delete SalaryStructures for this org
    const deletedStructures = await prisma.salaryStructure.deleteMany({
      where: { organizationId: targetOrgId }
    });

    // 5. Reset PayrollSettings for this org back to default baseline if customized
    const existingSettings = await prisma.payrollSettings.findFirst({
      where: { organizationId: targetOrgId }
    });

    if (existingSettings) {
      await prisma.payrollSettings.update({
        where: { id: existingSettings.id },
        data: {
          cycleStartDay: 1,
          payDay: 30,
          currency: 'INR',
          overtimeHourlyRate: 150.0,
          holidayPayMultiplier: 2.0,
          weekendPayMultiplier: 1.5,
          lateDeductionRule: 'FLAT_RATE',
          lateDeductionRate: 100.0,
          halfDayDeductionRate: 0.5,
          minimumWorkingHours: 4.0,
          roundingRule: 'ROUND_HALF_UP',
          payslipTemplate: 'STANDARD'
        }
      });
    }

    await logActivity({
      userId: req.user.id,
      organizationId: targetOrgId,
      action: 'PAYROLL_RESET',
      details: `Reset payroll data for organization ${targetOrgId}: deleted ${deletedPayslips.count} payslips, ${deletedBatches.count} batches, ${deletedRevisions.count} revisions, ${deletedStructures.count} salary structures.`
    });

    res.json({
      success: true,
      message: 'Payroll module data reset successfully.',
      deleted: {
        payslips: deletedPayslips.count,
        batches: deletedBatches.count,
        revisions: deletedRevisions.count,
        salaryStructures: deletedStructures.count
      }
    });
  } catch (error) {
    console.error('Reset payroll data error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to reset payroll data.' });
  }
};

module.exports = {
  calculateUserPayroll,
  processPayrollBatch,
  getPayrollBatches,
  getPayrollBatchById,
  lockPayrollBatch,
  reviewPayrollBatch,
  publishPayrollBatch,
  rollbackPayrollBatch,
  resetPayrollData
};

