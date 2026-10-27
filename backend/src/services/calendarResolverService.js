const prisma = require('../utils/db');
const shiftService = require('./shiftService');

/**
 * Helper to format Date object or components into YYYY-MM-DD string
 */
const formatDateStr = (year, month, day) => {
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
};

/**
 * Resolves calendar statuses for a given month and year for a specific user.
 * 
 * Resolution Order:
 * 1. Sunday -> Holiday (isSunday = true, fixed & locked)
 * 2. Company Holiday -> Holiday (date override or recurring permanent rule)
 * 3. User Approved Leave -> MY_LEAVE (for non-admin users on working/WFH days)
 * 4. Manual Override -> WFH / Working (specific date admin override)
 * 5. Assigned Shift Schedule -> Working / WFH / Holiday (via getShiftDayStatus)
 */
const resolveMonthlyCalendar = async ({ user, month, year, organizationId }) => {
  const targetYear = parseInt(year, 10);
  const targetMonth = parseInt(month, 10); // 1-12
  let targetOrgId = organizationId || user?.organizationId;
  if (!targetOrgId || targetOrgId === 'undefined' || targetOrgId === 'null' || (typeof targetOrgId === 'string' && targetOrgId.trim() === '')) {
    targetOrgId = user?.organizationId || null;
  }

  const timeZone = 'Asia/Kolkata';

  // Resolve user's assigned shift (Priority: Assigned Shift -> Company Default Shift -> Settings)
  let userShift = null;
  if (user?.id) {
    userShift = await shiftService.getEmployeeShiftWithSchedule(
      user.id,
      new Date(targetYear, targetMonth - 1, 1),
      timeZone,
      prisma
    );
  }

  // Fallback for Admin/Super Admin viewing specific organization without personal shift assignment
  if (!userShift && targetOrgId) {
    userShift = await shiftService.createDefaultShift(targetOrgId, prisma);
  }

  const shiftName = userShift?.name || userShift?.shiftName || 'Company Default';
  const startTime = userShift?.startTime || '09:00';
  const endTime = userShift?.endTime || '18:00';

  // Determine number of days in the month
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();

  const startDateStr = formatDateStr(targetYear, targetMonth, 1);
  const endDateStr = formatDateStr(targetYear, targetMonth, daysInMonth);

  const startRange = new Date(`${startDateStr}T00:00:00.000Z`);
  const endRange = new Date(`${endDateStr}T23:59:59.999Z`);

  // 1. Fetch all specific date overrides for this month
  const overrideWhere = {
    date: {
      gte: startRange,
      lte: endRange
    }
  };
  if (targetOrgId) {
    overrideWhere.OR = [
      { organizationId: targetOrgId },
      { organizationId: null, createdBy: { organizationId: targetOrgId } }
    ];
  }

  const dateOverrides = await prisma.workCalendar.findMany({
    where: overrideWhere,
    include: {
      createdBy: {
        select: { id: true, name: true, email: true, organizationId: true }
      }
    }
  });

  // Map specific date overrides by YYYY-MM-DD
  const specificOverridesMap = new Map();
  dateOverrides.forEach((item) => {
    if (item.date) {
      const dStr = item.date.toISOString().split('T')[0];
      specificOverridesMap.set(dStr, item);
    }
  });

  // 2. Fetch all permanent recurring rules for this month
  const permWhere = {
    isPermanent: true,
    recurrenceMonth: targetMonth
  };
  if (targetOrgId) {
    permWhere.OR = [
      { organizationId: targetOrgId },
      { organizationId: null, createdBy: { organizationId: targetOrgId } }
    ];
  }

  const permanentHolidays = await prisma.workCalendar.findMany({
    where: permWhere,
    include: {
      createdBy: {
        select: { id: true, name: true, email: true, organizationId: true }
      }
    }
  });

  // Map permanent rules by day of month (1-31)
  const permanentRulesMap = new Map();
  permanentHolidays.forEach((item) => {
    if (item.recurrenceDay) {
      permanentRulesMap.set(item.recurrenceDay, item);
    }
  });

  // 3. Fetch user approved leaves
  const isNonAdminUser = ['INTERN', 'EMPLOYEE', 'TEAM_LEADER'].includes(user?.role);
  let approvedLeaves = [];

  if (isNonAdminUser && user?.id) {
    approvedLeaves = await prisma.leaveRequest.findMany({
      where: {
        userId: user.id,
        status: 'APPROVED',
        startDate: { lte: endRange },
        endDate: { gte: startRange }
      }
    });
  } else if (targetOrgId) {
    approvedLeaves = await prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        startDate: { lte: endRange },
        endDate: { gte: startRange },
        user: { organizationId: targetOrgId }
      }
    });
  }

  // 4. Fetch approved Comp-Off work dates (strictly approved, deduplicated across requests/sessions/credits)
  const compOffWhere = {
    workDate: {
      gte: startRange,
      lte: endRange
    }
  };
  if (targetOrgId) {
    compOffWhere.organizationId = targetOrgId;
  }
  if (isNonAdminUser && user?.id) {
    compOffWhere.userId = user.id;
  }

  const [approvedPermissions, approvedSessions, approvedCredits] = await Promise.all([
    prisma.compOffPermissionRequest.findMany({
      where: {
        ...compOffWhere,
        status: 'APPROVED'
      },
      include: {
        user: { select: { id: true, name: true, employeeId: true } },
        approvedBy: { select: { id: true, name: true } }
      }
    }),
    prisma.compOffSession.findMany({
      where: {
        ...compOffWhere,
        approvalStatus: 'APPROVED'
      },
      include: {
        user: { select: { id: true, name: true, employeeId: true } }
      }
    }),
    prisma.compOffCredit.findMany({
      where: {
        ...compOffWhere,
        status: { in: ['APPROVED', 'EXHAUSTED'] }
      },
      include: {
        user: { select: { id: true, name: true, employeeId: true } }
      }
    })
  ]);

  // Aggregate and deduplicate by YYYY-MM-DD
  const compOffMap = new Map();

  const registerCompOff = (workDate, data) => {
    if (!workDate) return;
    const dStr = workDate instanceof Date ? workDate.toISOString().split('T')[0] : String(workDate).split('T')[0];
    if (!compOffMap.has(dStr)) {
      compOffMap.set(dStr, {
        workDate: dStr,
        items: [],
        primaryReason: data.reason || 'Approved Comp-Off Work',
        primaryTitle: 'Comp-Off Work',
        primaryUser: data.user,
        approvedBy: data.approvedBy || 'Admin'
      });
    }
    const entry = compOffMap.get(dStr);
    if (!entry.items.some(i => i.id === data.id && i.source === data.source)) {
      entry.items.push(data);
    }
  };

  approvedPermissions.forEach(p => {
    registerCompOff(p.workDate, {
      id: p.id,
      source: 'PERMISSION',
      title: 'Comp-Off Work',
      reason: p.reason || 'Approved advance Comp-Off work',
      holidayType: p.holidayType,
      user: p.user,
      approvedBy: p.approvedBy?.name || 'Admin',
      status: 'APPROVED'
    });
  });

  approvedSessions.forEach(s => {
    registerCompOff(s.workDate, {
      id: s.id,
      source: 'SESSION',
      title: 'Comp-Off Work',
      reason: s.locationReason || 'Completed & verified off-day session',
      durationHours: s.durationHours,
      calculatedCredit: s.calculatedCredit,
      user: s.user,
      status: 'APPROVED'
    });
  });

  approvedCredits.forEach(c => {
    registerCompOff(c.workDate, {
      id: c.id,
      source: 'CREDIT',
      title: 'Comp-Off Work',
      reason: c.reason || 'Sanctioned Comp-Off credit',
      creditDays: c.creditDays,
      user: c.user,
      status: c.status
    });
  });

  const isAdminOrSuperAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role);

  const resolvedDays = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = formatDateStr(targetYear, targetMonth, day);
    const currentDate = new Date(targetYear, targetMonth - 1, day);
    const dayOfWeek = currentDate.getDay(); // 0 = Sunday, 6 = Saturday
    const dayName = shiftService.getDayName(currentDate, timeZone);

    const specificOverride = specificOverridesMap.get(dateStr);
    const permanentRule = permanentRulesMap.get(day);
    const compOffInfo = compOffMap.get(dateStr);

    let resolvedStatus = 'Working';
    let title = 'Working Day';
    let reason = '';
    let overrideId = null;
    let isPermanent = false;
    let isSunday = false;
    let canEdit = isAdminOrSuperAdmin && dayOfWeek !== 0;
    let createdBy = null;
    let compOffDetails = null;

    if (compOffInfo) {
      compOffDetails = {
        workDate: dateStr,
        status: 'APPROVED',
        title: compOffInfo.items.length > 1 && !isNonAdminUser
          ? `${compOffInfo.items.length} Comp-Off Workers`
          : 'Comp-Off Work',
        reason: compOffInfo.primaryReason,
        approvedBy: compOffInfo.approvedBy,
        itemsCount: compOffInfo.items.length
      };
    }

    // STEP 1: Sunday is fixed HOLIDAY (locked)
    if (dayOfWeek === 0) {
      isSunday = true;
      canEdit = false;

      if (compOffDetails) {
        resolvedStatus = 'COMP_OFF';
        title = 'Comp-Off Work';
        reason = compOffDetails.reason || 'Approved Comp-Off work on Sunday';
      } else {
        resolvedStatus = 'Holiday';
        title = 'Sunday';
        reason = 'Fixed Weekly Holiday';
      }
    }
    // STEP 2: Company Holiday (Specific date override or Permanent Rule)
    else if (specificOverride && specificOverride.status === 'HOLIDAY') {
      overrideId = specificOverride.id;
      isPermanent = specificOverride.isPermanent;
      createdBy = specificOverride.createdBy?.name || null;

      if (compOffDetails) {
        resolvedStatus = 'COMP_OFF';
        title = 'Comp-Off Work';
        reason = compOffDetails.reason || `Approved Comp-Off work on ${specificOverride.title || 'Company Holiday'}`;
        canEdit = false;
      } else {
        resolvedStatus = 'Holiday';
        title = specificOverride.title || 'Company Holiday';
        reason = specificOverride.reason || 'Company Holiday';
      }
    } else if (!specificOverride && permanentRule && permanentRule.status === 'HOLIDAY') {
      overrideId = permanentRule.id;
      isPermanent = true;
      createdBy = permanentRule.createdBy?.name || null;

      if (compOffDetails) {
        resolvedStatus = 'COMP_OFF';
        title = 'Comp-Off Work';
        reason = compOffDetails.reason || `Approved Comp-Off work on ${permanentRule.title || 'Company Holiday'}`;
        canEdit = false;
      } else {
        resolvedStatus = 'Holiday';
        title = permanentRule.title || 'Company Holiday';
        reason = permanentRule.reason || 'Annual Permanent Holiday';
      }
    }
    // STEP 3: User Approved Leave (for non-admin users on non-company-holiday days)
    else if (
      isNonAdminUser &&
      approvedLeaves.some((leave) => {
        const lStart = new Date(leave.startDate).toISOString().split('T')[0];
        const lEnd = new Date(leave.endDate).toISOString().split('T')[0];
        return dateStr >= lStart && dateStr <= lEnd;
      })
    ) {
      const userLeave = approvedLeaves.find((leave) => {
        const lStart = new Date(leave.startDate).toISOString().split('T')[0];
        const lEnd = new Date(leave.endDate).toISOString().split('T')[0];
        return dateStr >= lStart && dateStr <= lEnd;
      });

      resolvedStatus = 'MY_LEAVE';
      title = userLeave.leaveType ? `${userLeave.leaveType.toUpperCase()} LEAVE` : userLeave.subject || 'Approved Leave';
      reason = userLeave.reason || 'User Approved Leave';
      canEdit = false;
    }
    // STEP 4: Manual WFH or Working Day Specific Override
    else if (specificOverride) {
      resolvedStatus = specificOverride.status === 'WORKING_DAY' ? 'Working' : specificOverride.status;
      title = specificOverride.title || (resolvedStatus === 'WFH' ? 'Work From Home' : 'Working Day');
      reason = specificOverride.reason || '';
      overrideId = specificOverride.id;
      isPermanent = specificOverride.isPermanent;
      createdBy = specificOverride.createdBy?.name || null;
    }
    // STEP 5: Dynamic Shift Engine Integration (getShiftDayStatus)
    else {
      const shiftStatus = shiftService.getShiftDayStatus(userShift, dayName, currentDate);
      if (shiftStatus === 'Holiday' && compOffDetails) {
        resolvedStatus = 'COMP_OFF';
        title = 'Comp-Off Work';
        reason = compOffDetails.reason || `Approved Comp-Off work on ${shiftName} off-day`;
        canEdit = false;
      } else {
        resolvedStatus = shiftStatus || 'Working';
        title = resolvedStatus === 'Working' ? 'Working Day' : resolvedStatus === 'WFH' ? 'Work From Home' : 'Holiday';
        reason = `${shiftName} Schedule`;
      }
    }

    resolvedDays.push({
      date: dateStr,
      dayOfWeek,
      status: resolvedStatus,
      title,
      reason,
      overrideId,
      isPermanent,
      isSunday,
      canEdit,
      createdBy: isAdminOrSuperAdmin ? createdBy : undefined,
      compOffDetails: compOffDetails || undefined
    });
  }

  return {
    shiftName,
    startTime,
    endTime,
    formattedStart: shiftService.formatTime12h(startTime),
    formattedEnd: shiftService.formatTime12h(endTime),
    days: resolvedDays
  };
};

module.exports = {
  resolveMonthlyCalendar,
  formatDateStr
};
