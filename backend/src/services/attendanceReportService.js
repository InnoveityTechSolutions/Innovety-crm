const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const prisma = require('../utils/db');
const { getEffectiveSettings } = require('../utils/settingsResolver');
const { getSystemTimeZone, getTodayZonedDate, getZonedParts } = require('../utils/attendanceUtils');
const shiftService = require('./shiftService');

// Helper to resolve company logo path
const getCompanyLogoPath = (organizationId) => {
  try {
    const brandingFile = path.join(__dirname, '../data/company_branding.json');
    if (fs.existsSync(brandingFile)) {
      const brandingData = JSON.parse(fs.readFileSync(brandingFile, 'utf8'));
      const orgBranding = brandingData[organizationId] || brandingData['GLOBAL'];
      if (orgBranding?.companyLogo) {
        const logoRelative = orgBranding.companyLogo.replace(/^\//, '');
        // Check backend/uploads
        const absUploadPath = path.join(__dirname, '../../', logoRelative);
        if (fs.existsSync(absUploadPath)) return absUploadPath;

        // Check backend/src/uploads
        const absSrcUploadPath = path.join(__dirname, '../', logoRelative);
        if (fs.existsSync(absSrcUploadPath)) return absSrcUploadPath;
      }
    }
  } catch (e) {
    // Quiet fail
  }

  // Fallback to frontend public logo
  const frontendLogo = path.join(__dirname, '../../../frontend/public/logo.png');
  if (fs.existsSync(frontendLogo)) return frontendLogo;

  const frontendVLogo = path.join(__dirname, '../../../frontend/public/v-logo.png');
  if (fs.existsSync(frontendVLogo)) return frontendVLogo;

  return null;
};

// Helper: Format Date to DD-MM-YYYY
const formatDDMMYYYY = (dateInput) => {
  if (!dateInput) return '—';
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
};

// Helper: Format Time to 12-hour hh:mm AM/PM
const formatTime12h = (dateInput, timeZone = 'Asia/Kolkata') => {
  if (!dateInput) return '—';
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', {
    timeZone: timeZone || 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

// Helper: Convert 1-based column number to Excel letter (e.g. 1 -> A, 8 -> H, 27 -> AA)
const getColLetter = (colIdx) => {
  let letter = '';
  let temp = colIdx;
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
};

// Helper: Calculate ISO Week Number
const getISOWeekNumber = (d) => {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
};

// Helper: Get Start and End Dates of an ISO Week
const getWeekDatesFromWeekNumber = (week, year) => {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay();
  const ISOweekStart = simple;
  if (dow <= 4) {
    ISOweekStart.setUTCDate(simple.getUTCDate() - simple.getUTCDay() + 1);
  } else {
    ISOweekStart.setUTCDate(simple.getUTCDate() + 8 - simple.getUTCDay());
  }
  const ISOweekEnd = new Date(ISOweekStart);
  ISOweekEnd.setUTCDate(ISOweekStart.getUTCDate() + 6);
  return {
    startDate: ISOweekStart.toISOString().split('T')[0],
    endDate: ISOweekEnd.toISOString().split('T')[0]
  };
};

// Helper: Convert Date or Date string to YYYY-MM-DD
const toDateStr = (dateInput) => {
  if (!dateInput) return '';
  if (typeof dateInput === 'string') {
    return dateInput.split('T')[0];
  }
  if (dateInput instanceof Date) {
    const y = dateInput.getUTCFullYear();
    const m = String(dateInput.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateInput.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '';
};

// Helper to determine if a leave is unpaid based on classification
const isLeaveUnpaid = (leave, activeLeaveTypes = []) => {
  if (!leave) return false;
  const pType = (leave.payType || 'PAID').toUpperCase();
  if (pType === 'UNPAID') return true;
  const lType = (leave.leaveType || leave.type || '').toUpperCase();
  if (['LOP', 'UNPAID', 'LOSS_OF_PAY', 'LOSS OF PAY'].includes(lType)) return true;
  const matchedType = (activeLeaveTypes || []).find(
    t => t.code?.toUpperCase() === lType || t.name?.toUpperCase() === lType || t.id === leave.leaveType
  );
  if (matchedType && matchedType.isPaid === false) return true;
  return false;
};

// Helper to identify if a leave request is for Work From Home (WFH)
const isLeaveRequestWFH = (leave, activeLeaveTypes = []) => {
  if (!leave) return false;
  const rawType = (leave.type || '').toUpperCase();
  if (rawType === 'WFH') return true;
  const raw = (leave.leaveType || '').trim();
  if (!raw) return false;
  const rawUpper = raw.toUpperCase();
  if (['WFH', 'WORK_FROM_HOME', 'WORK FROM HOME', 'REMOTE'].includes(rawUpper)) return true;
  if (rawUpper.includes('WORK FROM HOME')) return true;
  const matched = (activeLeaveTypes || []).find(t =>
    t.id === raw ||
    t.code?.toUpperCase() === rawUpper ||
    t.name?.toUpperCase() === rawUpper
  );
  if (matched) {
    const codeUpper = (matched.code || '').toUpperCase();
    const nameUpper = (matched.name || '').toUpperCase();
    if (codeUpper === 'WFH' || codeUpper === 'WORK_FROM_HOME' || nameUpper.includes('WORK FROM HOME') || nameUpper.includes('WFH')) {
      return true;
    }
  }
  return false;
};

// Helper to match active leave type with alias support
const matchActiveLeaveType = (leave, activeLeaveTypes = []) => {
  if (!leave) return null;
  const raw = (leave.leaveType || leave.type || '').trim();
  if (!raw) return null;
  const rawUpper = raw.toUpperCase();

  // 1. Direct match with activeLeaveTypes by id, code, or name
  const found = (activeLeaveTypes || []).find(t =>
    t.id === raw ||
    t.code?.toUpperCase() === rawUpper ||
    t.name?.toUpperCase() === rawUpper
  );
  if (found) return found;

  // 2. Common aliases
  if (['CL', 'CASUAL', 'CASUAL_LEAVE', 'CASUAL LEAVE'].includes(rawUpper)) {
    return (activeLeaveTypes || []).find(t => t.code?.toUpperCase() === 'CL' || t.name?.toUpperCase().includes('CASUAL'));
  }
  if (['SL', 'SICK', 'SICK_LEAVE', 'SICK LEAVE', 'MEDICAL'].includes(rawUpper)) {
    return (activeLeaveTypes || []).find(t => t.code?.toUpperCase() === 'SL' || t.name?.toUpperCase().includes('SICK'));
  }
  if (['COMP_OFF', 'COMPOFF', 'COMPENSATORY', 'COMPENSATORY_OFF', 'COMPENSATORY OFF'].includes(rawUpper)) {
    return (activeLeaveTypes || []).find(t => t.code?.toUpperCase() === 'COMP_OFF' || t.name?.toUpperCase().includes('COMP'));
  }
  if (['WFH', 'WORK_FROM_HOME', 'WORK FROM HOME', 'REMOTE'].includes(rawUpper)) {
    return (activeLeaveTypes || []).find(t => t.code?.toUpperCase() === 'WFH' || t.name?.toUpperCase().includes('WFH'));
  }
  if (['EMERGENCY', 'EL', 'EMERGENCY_LEAVE'].includes(rawUpper)) {
    return (activeLeaveTypes || []).find(t => t.code?.toUpperCase() === 'EL' || t.name?.toUpperCase().includes('EMERGENCY'));
  }

  return null;
};

// Ensure standard leave types (CL, SL, COMP_OFF) are represented
const ensureStandardLeaveTypes = (types = []) => {
  const result = [...types];
  const hasCL = result.some(t => t.code?.toUpperCase() === 'CL' || t.name?.toUpperCase().includes('CASUAL'));
  if (!hasCL) {
    result.push({ id: 'sys_cl', name: 'Casual Leave', code: 'CL', isPaid: true });
  }
  const hasSL = result.some(t => t.code?.toUpperCase() === 'SL' || t.name?.toUpperCase().includes('SICK'));
  if (!hasSL) {
    result.push({ id: 'sys_sl', name: 'Sick Leave', code: 'SL', isPaid: true });
  }
  const hasComp = result.some(t => t.code?.toUpperCase() === 'COMP_OFF' || t.name?.toUpperCase().includes('COMP'));
  if (!hasComp) {
    result.push({ id: 'sys_comp_off', name: 'Compensatory Off', code: 'COMP_OFF', isPaid: true });
  }
  return result;
};

/**
 * 1. Generate Daily Attendance Report
 */
const getDailyAttendanceData = async ({ organizationId, date, teamId, role, employeeName, status, userIds: filterUserIds }) => {
  const settings = await getEffectiveSettings(organizationId);
  const timeZone = getSystemTimeZone(settings);
  const now = new Date();
  const todayParts = getZonedParts(now, timeZone);

  const targetDateStr = date ? String(date).trim().split('T')[0] : todayParts.dateStr;
  const [tY, tM, tD] = targetDateStr.split('-').map(Number);
  const targetDateObj = new Date(Date.UTC(tY, tM - 1, tD, 0, 0, 0, 0));
  const dayOfWeek = targetDateObj.getUTCDay(); // 0 = Sunday

  // Organization info
  const org = organizationId ? await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true }
  }) : null;
  const companyName = org?.name || 'Innovety Tech';

  // 1. Build User Query
  const userWhere = {
    status: 'ACTIVE',
    role: { in: ['INTERN', 'EMPLOYEE', 'TEAM_LEADER'] }
  };
  if (organizationId) userWhere.organizationId = organizationId;
  if (role && role !== 'ALL') userWhere.role = role;
  if (employeeName && employeeName.trim()) {
    const q = employeeName.trim();
    userWhere.OR = [
      { name: { contains: q } },
      { employeeId: { contains: q } }
    ];
  }

  // Team Filter
  if (teamId && teamId !== 'ALL') {
    const teamMembers = await prisma.teamMember.findMany({
      where: { teamId },
      select: { userId: true }
    });
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { leaderId: true }
    });
    const allowedUserIds = teamMembers.map(m => m.userId);
    if (team?.leaderId) allowedUserIds.push(team.leaderId);
    userWhere.id = { in: [...new Set(allowedUserIds)] };
  }

  // Member selection filter (if provided)
  if (filterUserIds) {
    const allowed = Array.isArray(filterUserIds)
      ? filterUserIds
      : String(filterUserIds).split(',').map(s => s.trim()).filter(Boolean);
    if (allowed.length > 0) {
      if (userWhere.id?.in) {
        userWhere.id = { in: userWhere.id.in.filter(id => allowed.includes(id)) };
      } else {
        userWhere.id = { in: allowed };
      }
    }
  }

  const activeUsers = await prisma.user.findMany({
    where: userWhere,
    select: {
      id: true,
      name: true,
      employeeId: true,
      role: true,
      department: true,
      joiningDate: true
    },
    orderBy: { name: 'asc' }
  });

  // Query ranges
  const minDate = new Date(Date.UTC(tY, tM - 1, tD, 0, 0, 0, 0));
  const maxDate = new Date(Date.UTC(tY, tM - 1, tD, 23, 59, 59, 999));
  const userIds = activeUsers.map(u => u.id);

  const [realAttendances, approvedLeaves, calendarOverrides, permanentHolidays, rawLeaveTypes, batchShiftResolver] = await Promise.all([
    prisma.attendance.findMany({
      where: {
        date: { gte: minDate, lte: maxDate },
        userId: { in: userIds }
      }
    }),
    prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        startDate: { lte: maxDate },
        endDate: { gte: minDate },
        userId: { in: userIds }
      }
    }),
    prisma.workCalendar.findMany({
      where: {
        date: { gte: minDate, lte: maxDate },
        ...(organizationId ? {
          OR: [
            { organizationId },
            { organizationId: null, createdBy: { organizationId } }
          ]
        } : {})
      }
    }),
    prisma.workCalendar.findMany({
      where: {
        isPermanent: true,
        status: 'HOLIDAY',
        ...(organizationId ? {
          OR: [
            { organizationId },
            { organizationId: null, createdBy: { organizationId } }
          ]
        } : {})
      }
    }),
    prisma.leaveType.findMany({
      where: {
        isActive: true,
        NOT: {
          code: { in: ['LOP', 'UNPAID', 'LOSS_OF_PAY'] }
        }
      },
      orderBy: [{ createdAt: 'asc' }]
    }),
    shiftService.createBatchShiftResolver({
      userIds,
      organizationId,
      startDate: minDate,
      endDate: maxDate,
      client: prisma
    })
  ]);

  const activeLeaveTypes = ensureStandardLeaveTypes(rawLeaveTypes);

  // Check Holiday status for target date
  let isHoliday = false;
  if (dayOfWeek === 0) {
    const override = calendarOverrides.find(c => c.status === 'WORKING' || c.status === 'WFH');
    isHoliday = !override;
  } else if (calendarOverrides.some(c => c.status === 'HOLIDAY')) {
    isHoliday = true;
  } else if (permanentHolidays.some(h => h.recurrenceMonth === tM && h.recurrenceDay === tD)) {
    isHoliday = true;
  }

  const attendanceMap = new Map();
  realAttendances.forEach(a => attendanceMap.set(a.userId, a));

  const records = [];

  for (const u of activeUsers) {
    // Only include employee if joiningDate <= targetDate
    if (u.joiningDate) {
      const jDateStr = new Date(u.joiningDate).toISOString().split('T')[0];
      if (jDateStr > targetDateStr) continue;
    }

    const shiftStatusInfo = batchShiftResolver.getDayStatus(u.id, targetDateObj, timeZone);
    const isShiftHoliday = shiftStatusInfo.isHoliday;

    const att = attendanceMap.get(u.id);
    const leave = approvedLeaves.find(l => l.userId === u.id);
    const isLeaveWFH = isLeaveRequestWFH(leave, activeLeaveTypes);
    const isAttWFH = att && (
      att.workLocation === 'HOME' ||
      att.status === 'WORK_FROM_HOME' ||
      att.status === 'WFH' ||
      (att.clockInLocation && att.clockInLocation.toLowerCase().includes('work from home'))
    );
    const isWFH = isAttWFH || (isLeaveWFH && (!att || att.status === 'ABSENT' || att.status === 'WORK_FROM_HOME' || att.status === 'PRESENT'));

    let attendanceVal = 'Absent';
    let loginTimeVal = '—';
    let loginStatusVal = 'Absent';

    if (att && att.clockIn) {
      loginTimeVal = formatTime12h(att.clockIn, timeZone);
    }

    if (att && att.status === 'ABSENT' && !isLeaveWFH && (isHoliday || isShiftHoliday)) {
      attendanceVal = 'Holiday';
      loginStatusVal = 'Holiday';
    } else if (isWFH) {
      attendanceVal = 'WFH';
      const isLate = att && (att.status === 'LATE' || (att.lateMinutes && att.lateMinutes > 0));
      loginStatusVal = isLate ? 'Late' : 'WFH';
    } else if (att) {
      const isLate = att.status === 'LATE' || (att.lateMinutes && att.lateMinutes > 0);
      if (att.status === 'HALF_DAY') {
        attendanceVal = 'Half Day';
        loginStatusVal = isLate ? 'Late' : 'On Time';
      } else if (att.status === 'LATE' || isLate) {
        attendanceVal = 'Present';
        loginStatusVal = 'Late';
      } else if (att.status === 'PRESENT') {
        attendanceVal = 'Present';
        loginStatusVal = 'On Time';
      } else if (att.status === 'LEAVE') {
        attendanceVal = 'On Leave';
        loginStatusVal = 'On Leave';
      } else if (att.status === 'ABSENT') {
        if (leave) {
          attendanceVal = 'On Leave';
          loginStatusVal = 'On Leave';
        } else {
          attendanceVal = 'Absent';
          loginStatusVal = 'Absent';
        }
      } else {
        attendanceVal = 'Present';
        loginStatusVal = 'On Time';
      }
    } else if (leave) {
      attendanceVal = 'On Leave';
      loginStatusVal = 'On Leave';
    } else if (isHoliday || isShiftHoliday) {
      attendanceVal = 'Holiday';
      loginStatusVal = 'Holiday';
    }

    // Apply Status filter if passed
    if (status && status !== 'ALL') {
      const filterUpper = status.toUpperCase();
      let matches = attendanceVal.toUpperCase().includes(filterUpper) || loginStatusVal.toUpperCase().includes(filterUpper);
      if (filterUpper === 'PRESENT' && (attendanceVal === 'WFH' || loginStatusVal === 'WFH' || attendanceVal === 'PRESENT' || loginStatusVal === 'ON TIME' || loginStatusVal === 'LATE')) {
        matches = true;
      }
      if (!matches) continue;
    }

    records.push({
      userId: u.id,
      employee: u.name,
      employeeId: u.employeeId,
      role: u.role,
      department: u.department || '—',
      attendance: attendanceVal,
      loginTime: loginTimeVal,
      loginStatus: loginStatusVal
    });
  }

  const [yearNum, monthNum, dayNum] = targetDateStr.split('-');
  const formattedDate = `${dayNum}-${monthNum}-${yearNum}`;

  const summary = {
    present: 0,
    late: 0,
    absent: 0,
    onLeave: 0,
    wfh: 0,
    holiday: 0,
    total: records.length
  };

  for (const r of records) {
    const isWfh = r.attendance === 'WFH' || r.loginStatus === 'WFH';
    const isLate = r.loginStatus === 'Late' || r.attendance === 'Late';
    const isPresent = r.attendance === 'Present' || r.loginStatus === 'On Time' || isLate || isWfh;
    const isOnLeave = r.attendance === 'On Leave' || r.loginStatus === 'On Leave';
    const isHoliday = r.attendance === 'Holiday' || r.loginStatus === 'Holiday';

    if (isWfh) {
      summary.wfh++;
    }
    if (isLate) {
      summary.late++;
    }
    if (isPresent) {
      summary.present++;
    } else if (isOnLeave) {
      summary.onLeave++;
    } else if (isHoliday) {
      summary.holiday++;
    } else {
      summary.absent++;
    }
  }

  return {
    companyName,
    reportType: 'Daily',
    date: formattedDate,
    targetDateStr,
    recordsCount: records.length,
    summary,
    records
  };
};

/**
 * 2. Generate Weekly Attendance Report
 */
const getWeeklyAttendanceData = async ({ organizationId, week, year, date, teamId, role, employeeName, status, userIds: filterUserIds }) => {
  const settings = await getEffectiveSettings(organizationId);
  const timeZone = getSystemTimeZone(settings);
  const now = new Date();
  const todayParts = getZonedParts(now, timeZone);

  let targetYear = year ? parseInt(year, 10) : todayParts.year;
  let targetWeek = week ? parseInt(week, 10) : null;

  if (!targetWeek) {
    const baseDate = date ? new Date(date) : now;
    targetWeek = getISOWeekNumber(baseDate);
    targetYear = baseDate.getFullYear();
  }

  const { startDate, endDate } = getWeekDatesFromWeekNumber(targetWeek, targetYear);
  const startObj = new Date(`${startDate}T00:00:00.000Z`);
  const endObj = new Date(`${endDate}T23:59:59.999Z`);

  // Organization info
  const org = organizationId ? await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true }
  }) : null;
  const companyName = org?.name || 'Innovety Tech';

  // Build User Query
  const userWhere = {
    status: 'ACTIVE',
    role: { in: ['INTERN', 'EMPLOYEE', 'TEAM_LEADER'] }
  };
  if (organizationId) userWhere.organizationId = organizationId;
  if (role && role !== 'ALL') userWhere.role = role;
  if (employeeName && employeeName.trim()) {
    const q = employeeName.trim();
    userWhere.OR = [
      { name: { contains: q } },
      { employeeId: { contains: q } }
    ];
  }

  // Team Filter
  if (teamId && teamId !== 'ALL') {
    const teamMembers = await prisma.teamMember.findMany({
      where: { teamId },
      select: { userId: true }
    });
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { leaderId: true }
    });
    const allowedUserIds = teamMembers.map(m => m.userId);
    if (team?.leaderId) allowedUserIds.push(team.leaderId);
    userWhere.id = { in: [...new Set(allowedUserIds)] };
  }

  // Member selection filter (if provided)
  if (filterUserIds) {
    const allowed = Array.isArray(filterUserIds)
      ? filterUserIds
      : String(filterUserIds).split(',').map(s => s.trim()).filter(Boolean);
    if (allowed.length > 0) {
      if (userWhere.id?.in) {
        userWhere.id = { in: userWhere.id.in.filter(id => allowed.includes(id)) };
      } else {
        userWhere.id = { in: allowed };
      }
    }
  }

  const activeUsers = await prisma.user.findMany({
    where: userWhere,
    select: {
      id: true,
      name: true,
      employeeId: true,
      role: true,
      department: true,
      joiningDate: true
    },
    orderBy: { name: 'asc' }
  });

  const userIds = activeUsers.map(u => u.id);

  // Fetch attendances, leaves & holidays for the week
  const [attendances, approvedLeaves, calendarOverrides, permanentHolidays, rawLeaveTypes, batchShiftResolver] = await Promise.all([
    prisma.attendance.findMany({
      where: {
        date: { gte: startObj, lte: endObj },
        userId: { in: userIds }
      }
    }),
    prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        startDate: { lte: endObj },
        endDate: { gte: startObj },
        userId: { in: userIds }
      }
    }),
    prisma.workCalendar.findMany({
      where: {
        date: { gte: startObj, lte: endObj },
        ...(organizationId ? {
          OR: [
            { organizationId },
            { organizationId: null, createdBy: { organizationId } }
          ]
        } : {})
      }
    }),
    prisma.workCalendar.findMany({
      where: {
        isPermanent: true,
        status: 'HOLIDAY',
        ...(organizationId ? {
          OR: [
            { organizationId },
            { organizationId: null, createdBy: { organizationId } }
          ]
        } : {})
      }
    }),
    prisma.leaveType.findMany({
      where: {
        isActive: true,
        NOT: {
          code: { in: ['LOP', 'UNPAID', 'LOSS_OF_PAY'] }
        }
      },
      orderBy: [{ createdAt: 'asc' }]
    }),
    shiftService.createBatchShiftResolver({
      userIds,
      organizationId,
      startDate: startObj,
      endDate: endObj,
      client: prisma
    })
  ]);

  const activeLeaveTypes = ensureStandardLeaveTypes(rawLeaveTypes);

  // Construct dates of the week
  const daysInWeek = [];
  const cur = new Date(startObj);
  while (cur <= endObj) {
    const y = cur.getUTCFullYear();
    const m = cur.getUTCMonth() + 1;
    const d = cur.getUTCDate();
    const dStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = cur.getUTCDay();

    // Check holiday
    let isHol = false;
    if (dow === 0) {
      const override = calendarOverrides.find(c => toDateStr(c.date) === dStr && (c.status === 'WORKING' || c.status === 'WFH'));
      isHol = !override;
    } else if (calendarOverrides.some(c => toDateStr(c.date) === dStr && c.status === 'HOLIDAY')) {
      isHol = true;
    } else if (permanentHolidays.some(h => h.recurrenceMonth === m && h.recurrenceDay === d)) {
      isHol = true;
    }

    daysInWeek.push({ dateStr: dStr, isHoliday: isHol, dayOfWeek: dow, dateObj: new Date(cur) });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const workingDaysInWeekCount = daysInWeek.filter(d => !d.isHoliday).length || 5;

  let totalAttendedCountAll = 0;
  let totalPossibleDaysAll = 0;
  let totalLateCountAll = 0;
  const records = [];

  for (const u of activeUsers) {
    let presentCount = 0;
    let lateCount = 0;
    let absentCount = 0;
    let wfhCount = 0;
    let paidLeaveCount = 0;
    let unpaidLeaveCount = 0;
    let employeeWorkingDays = 0;
    let totalWorkingHours = 0;

    const leaveTypeCounts = {};
    activeLeaveTypes.forEach(t => {
      leaveTypeCounts[t.name] = 0;
      leaveTypeCounts[t.code] = 0;
    });

    const uJoiningStr = u.joiningDate ? toDateStr(u.joiningDate) : null;

    for (const { dateStr, isHoliday, dateObj } of daysInWeek) {
      if (uJoiningStr && dateStr < uJoiningStr) continue; // Skip days prior to joining

      const shiftStatusInfo = batchShiftResolver.getDayStatus(u.id, dateObj, timeZone);
      const isShiftHoliday = shiftStatusInfo.isHoliday;
      const isDayOff = isHoliday || isShiftHoliday;

      // Crucial: Only count as scheduled working day if NOT company holiday AND NOT shift holiday
      if (!isDayOff) {
        employeeWorkingDays++;
      }

      if (dateStr > todayParts.dateStr) continue; // Skip future days (incomplete period)

      // Count toward potential attendance denominator only for elapsed scheduled working days
      if (!isDayOff) {
        totalPossibleDaysAll++;
      }

      const att = attendances.find(a => a.userId === u.id && toDateStr(a.date) === dateStr);
      const leave = approvedLeaves.find(l => {
        if (l.userId !== u.id) return false;
        const lStart = toDateStr(l.startDate);
        const lEnd = toDateStr(l.endDate);
        return dateStr >= lStart && dateStr <= lEnd;
      });

      // 1. Check for WFH (from attendance record OR approved leave request)
      const isAttWFH = att && (
        att.workLocation === 'HOME' ||
        att.status === 'WORK_FROM_HOME' ||
        att.status === 'WFH' ||
        (att.clockInLocation && att.clockInLocation.toLowerCase().includes('work from home'))
      );
      const isLeaveWFH = isLeaveRequestWFH(leave, activeLeaveTypes);
      const isWFH = isAttWFH || (isLeaveWFH && (!att || att.status === 'ABSENT' || att.status === 'WORK_FROM_HOME' || att.status === 'PRESENT'));

      if (isWFH) {
        if (!isDayOff) {
          const duration = (leave && (leave.isHalfDay || leave.totalDays === 0.5)) || (att && att.status === 'HALF_DAY') ? 0.5 : 1;
          wfhCount += duration;
          presentCount += duration; // Approved WFH contributes to Present without duplicate counting!
          if (att && att.workingHours) {
            totalWorkingHours += att.workingHours;
          }
          const isLate = att && (att.status === 'LATE' || (att.lateMinutes && att.lateMinutes > 0));
          if (isLate) {
            lateCount++;
          }
        }
      } else if (leave && (!att || att.status === 'ABSENT' || att.status === 'LEAVE')) {
        // 2. Approved leave takes precedence over conflicting ABSENT or default LEAVE
        if (!isDayOff) {
          const unpaid = isLeaveUnpaid(leave, activeLeaveTypes);
          const duration = (leave.isHalfDay || leave.totalDays === 0.5) || (att && att.status === 'HALF_DAY') ? 0.5 : 1;
          if (unpaid) {
            unpaidLeaveCount += duration;
          } else {
            paidLeaveCount += duration;
            const matched = matchActiveLeaveType(leave, activeLeaveTypes);
            if (matched) {
              leaveTypeCounts[matched.name] = (leaveTypeCounts[matched.name] || 0) + duration;
              leaveTypeCounts[matched.code] = (leaveTypeCounts[matched.code] || 0) + duration;
            }
          }
        }
      } else if (att) {
        // 3. Physical office attendance or explicit record
        const isLate = att.status === 'LATE' || (att.lateMinutes && att.lateMinutes > 0);
        if (att.workingHours) {
          totalWorkingHours += att.workingHours;
        }

        if (att.status === 'ABSENT') {
          if (!isDayOff) {
            absentCount++;
          }
        } else if (att.status === 'LEAVE') {
          if (!isDayOff) {
            // Counted under paidLeaveCount; do not invent unfounded CL/SL
            paidLeaveCount += 1;
          }
        } else {
          // PRESENT / LATE / HALF_DAY / etc.
          const duration = att.status === 'HALF_DAY' ? 0.5 : 1;
          presentCount += duration;
          if (isLate) {
            lateCount++;
          }
        }
      } else {
        // 4. No record and no approved leave
        if (!isDayOff) {
          absentCount++;
        }
      }
    }

    const totalLeaveCount = paidLeaveCount + unpaidLeaveCount;

    // Apply status filter if passed
    if (status && status !== 'ALL') {
      const sUpper = status.toUpperCase();
      if (sUpper === 'LATE' && lateCount === 0) continue;
      if (sUpper === 'PRESENT' && presentCount === 0) continue;
      if (sUpper === 'WFH' && wfhCount === 0) continue;
      if (sUpper === 'ABSENT' && absentCount === 0) continue;
      if (sUpper === 'LEAVE' && totalLeaveCount === 0) continue;
      if (sUpper === 'PAID_LEAVE' && paidLeaveCount === 0) continue;
      if (['UNPAID_LEAVE', 'LOP', 'LOSS_OF_PAY'].includes(sUpper) && unpaidLeaveCount === 0) continue;
    }

    totalLateCountAll += lateCount;
    totalAttendedCountAll += presentCount;

    records.push({
      userId: u.id,
      employee: u.name,
      employeeId: u.employeeId,
      role: u.role,
      department: u.department || '—',
      workingDays: employeeWorkingDays,
      present: presentCount,
      wfh: wfhCount,
      late: lateCount,
      totalLates: lateCount,
      absent: absentCount,
      paidLeave: paidLeaveCount,
      unpaidLeave: unpaidLeaveCount,
      lop: unpaidLeaveCount,
      leave: totalLeaveCount,
      totalHours: Number(totalWorkingHours.toFixed(1)),
      leaveTypeCounts,
      ...leaveTypeCounts
    });
  }

  // Summary Metrics
  const totalEmployees = records.length;
  const avgAttendancePercent = totalPossibleDaysAll > 0
    ? `${Math.min(100, Math.round((totalAttendedCountAll / totalPossibleDaysAll) * 1000) / 10)}%`
    : '0%';

  const weekLabel = `Week ${targetWeek}, ${targetYear}`;

  // Filter out WFH from dynamic leaveTypes for presentation since WFH has its own dedicated column
  const presentationLeaveTypes = activeLeaveTypes
    .filter(t => !['WFH', 'WORK_FROM_HOME'].includes(t.code?.toUpperCase()) && !t.name?.toUpperCase().includes('WFH') && !t.name?.toUpperCase().includes('WORK FROM HOME'))
    .map(t => ({ id: t.id, name: t.name, code: t.code }));

  return {
    companyName,
    reportType: 'Weekly',
    week: targetWeek,
    year: targetYear,
    weekLabel,
    startDate,
    endDate,
    formattedRange: `${formatDDMMYYYY(startDate)} to ${formatDDMMYYYY(endDate)}`,
    leaveTypes: presentationLeaveTypes,
    summary: {
      totalEmployees,
      totalWorkingDays: workingDaysInWeekCount,
      averageAttendance: avgAttendancePercent,
      averageAttendancePercent: avgAttendancePercent,
      totalLateCount: totalLateCountAll,
      totalPaidLeaves: records.reduce((acc, r) => acc + (r.paidLeave || 0), 0),
      totalLopDays: records.reduce((acc, r) => acc + (r.unpaidLeave || 0), 0)
    },
    records
  };
};

/**
 * 3. Generate Monthly Attendance Report
 */
const getMonthlyAttendanceData = async ({ organizationId, month, year, teamId, role, employeeName, status, userIds: filterUserIds }) => {
  const settings = await getEffectiveSettings(organizationId);
  const timeZone = getSystemTimeZone(settings);
  const now = new Date();
  const todayParts = getZonedParts(now, timeZone);

  // Dynamic Late Policy configurations
  const isLatePolicyEnabled = settings?.latePolicyEnabled !== false;
  const configuredLateLimit = settings?.warningLateLimit !== undefined ? Number(settings.warningLateLimit) : 3;
  const latePolicyAppliesTo = (settings?.latePolicyAppliesTo || 'INTERN,EMPLOYEE,TEAM_LEADER')
    .split(',')
    .map(r => r.trim());

  const targetMonth = month ? parseInt(month, 10) : todayParts.month;
  const targetYear = year ? parseInt(year, 10) : todayParts.year;

  const startOfMonth = new Date(Date.UTC(targetYear, targetMonth - 1, 1, 0, 0, 0, 0));
  // Last day of month
  const endOfMonth = new Date(Date.UTC(targetYear, targetMonth, 0, 23, 59, 59, 999));
  const daysInMonthTotal = endOfMonth.getUTCDate();

  // Organization info
  const org = organizationId ? await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true }
  }) : null;
  const companyName = org?.name || 'Innovety Tech';

  // Build User Query
  const userWhere = {
    status: 'ACTIVE',
    role: { in: ['INTERN', 'EMPLOYEE', 'TEAM_LEADER'] }
  };
  if (organizationId) userWhere.organizationId = organizationId;
  if (role && role !== 'ALL') userWhere.role = role;
  if (employeeName && employeeName.trim()) {
    const q = employeeName.trim();
    userWhere.OR = [
      { name: { contains: q } },
      { employeeId: { contains: q } }
    ];
  }

  // Team Filter
  if (teamId && teamId !== 'ALL') {
    const teamMembers = await prisma.teamMember.findMany({
      where: { teamId },
      select: { userId: true }
    });
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { leaderId: true }
    });
    const allowedUserIds = teamMembers.map(m => m.userId);
    if (team?.leaderId) allowedUserIds.push(team.leaderId);
    userWhere.id = { in: [...new Set(allowedUserIds)] };
  }

  // Member selection filter (if provided)
  if (filterUserIds) {
    const allowed = Array.isArray(filterUserIds)
      ? filterUserIds
      : String(filterUserIds).split(',').map(s => s.trim()).filter(Boolean);
    if (allowed.length > 0) {
      if (userWhere.id?.in) {
        userWhere.id = { in: userWhere.id.in.filter(id => allowed.includes(id)) };
      } else {
        userWhere.id = { in: allowed };
      }
    }
  }

  const activeUsers = await prisma.user.findMany({
    where: userWhere,
    select: {
      id: true,
      name: true,
      employeeId: true,
      role: true,
      department: true,
      joiningDate: true
    },
    orderBy: { name: 'asc' }
  });

  const userIds = activeUsers.map(u => u.id);

  const [attendances, approvedLeaves, calendarOverrides, permanentHolidays, rawLeaveTypes, batchShiftResolver] = await Promise.all([
    prisma.attendance.findMany({
      where: {
        date: { gte: startOfMonth, lte: endOfMonth },
        userId: { in: userIds }
      }
    }),
    prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        startDate: { lte: endOfMonth },
        endDate: { gte: startOfMonth },
        userId: { in: userIds }
      }
    }),
    prisma.workCalendar.findMany({
      where: {
        date: { gte: startOfMonth, lte: endOfMonth },
        ...(organizationId ? {
          OR: [
            { organizationId },
            { organizationId: null, createdBy: { organizationId } }
          ]
        } : {})
      }
    }),
    prisma.workCalendar.findMany({
      where: {
        isPermanent: true,
        status: 'HOLIDAY',
        ...(organizationId ? {
          OR: [
            { organizationId },
            { organizationId: null, createdBy: { organizationId } }
          ]
        } : {})
      }
    }),
    prisma.leaveType.findMany({
      where: {
        isActive: true,
        NOT: {
          code: { in: ['LOP', 'UNPAID', 'LOSS_OF_PAY'] }
        }
      },
      orderBy: [{ createdAt: 'asc' }]
    }),
    shiftService.createBatchShiftResolver({
      userIds,
      organizationId,
      startDate: startOfMonth,
      endDate: endOfMonth,
      client: prisma
    })
  ]);

  const activeLeaveTypes = ensureStandardLeaveTypes(rawLeaveTypes);

  // Construct dates of the month
  const calendarDays = [];
  let monthWorkingDaysCount = 0;

  for (let day = 1; day <= daysInMonthTotal; day++) {
    const dObj = new Date(Date.UTC(targetYear, targetMonth - 1, day, 0, 0, 0, 0));
    const dStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dow = dObj.getUTCDay();

    let isHol = false;
    if (dow === 0) {
      const override = calendarOverrides.find(c => toDateStr(c.date) === dStr && (c.status === 'WORKING' || c.status === 'WFH'));
      isHol = !override;
    } else if (calendarOverrides.some(c => toDateStr(c.date) === dStr && c.status === 'HOLIDAY')) {
      isHol = true;
    } else if (permanentHolidays.some(h => h.recurrenceMonth === targetMonth && h.recurrenceDay === day)) {
      isHol = true;
    }

    if (!isHol) monthWorkingDaysCount++;
    calendarDays.push({ dateStr: dStr, isHoliday: isHol, dayOfWeek: dow, dateObj: dObj });
  }

  let totalAttendedCountAll = 0;
  let totalPossibleDaysAll = 0;
  let totalLateCountAll = 0;
  const records = [];

  for (const u of activeUsers) {
    let presentCount = 0;
    let lateCount = 0;
    let absentCount = 0;
    let paidLeaveCount = 0;
    let unpaidLeaveCount = 0;
    let wfhCount = 0;
    let employeeWorkingDays = 0;
    let totalWorkingHours = 0;
    const leaveTypeCounts = {};
    activeLeaveTypes.forEach(t => {
      leaveTypeCounts[t.name] = 0;
      leaveTypeCounts[t.code] = 0;
    });

    const uJoiningStr = u.joiningDate ? toDateStr(u.joiningDate) : null;

    for (const { dateStr, isHoliday, dateObj } of calendarDays) {
      if (uJoiningStr && dateStr < uJoiningStr) continue; // Skip days prior to joining

      const shiftStatusInfo = batchShiftResolver.getDayStatus(u.id, dateObj, timeZone);
      const isShiftHoliday = shiftStatusInfo.isHoliday;
      const isDayOff = isHoliday || isShiftHoliday;

      // Crucial: Only count as working day if NOT company holiday AND NOT shift holiday
      if (!isDayOff) employeeWorkingDays++;

      if (dateStr > todayParts.dateStr) continue; // Incomplete period: skip future days from attendance/absence

      // Only count toward potential attendance denominator for elapsed scheduled working days
      if (!isDayOff) {
        totalPossibleDaysAll++;
      }

      const att = attendances.find(a => a.userId === u.id && toDateStr(a.date) === dateStr);
      const leave = approvedLeaves.find(l => {
        if (l.userId !== u.id) return false;
        const lStart = toDateStr(l.startDate);
        const lEnd = toDateStr(l.endDate);
        return dateStr >= lStart && dateStr <= lEnd;
      });

      // 1. Check for WFH (from attendance record OR approved leave request)
      const isAttWFH = att && (
        att.workLocation === 'HOME' ||
        att.status === 'WORK_FROM_HOME' ||
        att.status === 'WFH' ||
        (att.clockInLocation && att.clockInLocation.toLowerCase().includes('work from home'))
      );
      const isLeaveWFH = isLeaveRequestWFH(leave, activeLeaveTypes);
      const isWFH = isAttWFH || (isLeaveWFH && (!att || att.status === 'ABSENT' || att.status === 'WORK_FROM_HOME' || att.status === 'PRESENT'));

      if (isWFH) {
        if (!isDayOff) {
          const duration = (leave && (leave.isHalfDay || leave.totalDays === 0.5)) || (att && att.status === 'HALF_DAY') ? 0.5 : 1;
          wfhCount += duration;
          presentCount += duration; // Approved WFH contributes to Present count without duplicate counting!
          if (att && att.workingHours) {
            totalWorkingHours += att.workingHours;
          }
          const isLate = att && (att.status === 'LATE' || (att.lateMinutes && att.lateMinutes > 0));
          if (isLate) {
            lateCount++;
          }
        }
      } else if (leave && (!att || att.status === 'ABSENT' || att.status === 'LEAVE')) {
        // 2. Approved leave takes precedence over conflicting ABSENT or default LEAVE
        if (!isDayOff) {
          const unpaid = isLeaveUnpaid(leave, activeLeaveTypes);
          const duration = (leave.isHalfDay || leave.totalDays === 0.5) || (att && att.status === 'HALF_DAY') ? 0.5 : 1;
          if (unpaid) {
            unpaidLeaveCount += duration;
          } else {
            paidLeaveCount += duration;
            const matched = matchActiveLeaveType(leave, activeLeaveTypes);
            if (matched) {
              leaveTypeCounts[matched.name] = (leaveTypeCounts[matched.name] || 0) + duration;
              leaveTypeCounts[matched.code] = (leaveTypeCounts[matched.code] || 0) + duration;
            }
          }
        }
      } else if (att) {
        // 3. Physical office attendance or explicit record
        const isLate = att.status === 'LATE' || (att.lateMinutes && att.lateMinutes > 0);
        if (att.workingHours) {
          totalWorkingHours += att.workingHours;
        }

        if (att.status === 'ABSENT') {
          if (!isDayOff) {
            absentCount++;
          }
        } else if (att.status === 'LEAVE') {
          if (!isDayOff) {
            // Counted under paidLeaveCount; do not invent unfounded CL/SL
            paidLeaveCount += 1;
          }
        } else {
          // PRESENT / LATE / HALF_DAY / etc.
          const duration = att.status === 'HALF_DAY' ? 0.5 : 1;
          presentCount += duration;
          if (isLate) {
            lateCount++;
          }
        }
      } else {
        // 4. No record and no approved leave
        if (!isDayOff) {
          absentCount++;
        }
      }
    }

    const totalLeaveCount = paidLeaveCount + unpaidLeaveCount;

    // Calculate deduction-eligible lates based on dynamic Late Policy (for separate payroll deduction tracking)
    const isRoleApplicable = latePolicyAppliesTo.includes(u.role);
    const deductionLateCount = (isLatePolicyEnabled && isRoleApplicable)
      ? Math.max(0, lateCount - configuredLateLimit)
      : 0;

    // Apply status filter if passed
    if (status && status !== 'ALL') {
      const sUpper = status.toUpperCase();
      if (sUpper === 'LATE' && lateCount === 0) continue;
      if (sUpper === 'PRESENT' && presentCount === 0) continue;
      if (sUpper === 'WFH' && wfhCount === 0) continue;
      if (sUpper === 'ABSENT' && absentCount === 0) continue;
      if (sUpper === 'LEAVE' && totalLeaveCount === 0) continue;
      if (sUpper === 'PAID_LEAVE' && paidLeaveCount === 0) continue;
      if (['UNPAID_LEAVE', 'LOP', 'LOSS_OF_PAY'].includes(sUpper) && unpaidLeaveCount === 0) continue;
    }

    totalLateCountAll += lateCount;
    totalAttendedCountAll += presentCount;

    records.push({
      userId: u.id,
      employee: u.name,
      employeeId: u.employeeId,
      role: u.role,
      department: u.department || '—',
      workingDays: employeeWorkingDays,
      present: presentCount,
      wfh: wfhCount,
      late: lateCount, // Actual late count as required!
      deductionLate: deductionLateCount, // Kept separate and unchanged for payroll calculations
      totalLates: lateCount,
      absent: absentCount,
      paidLeave: paidLeaveCount,
      unpaidLeave: unpaidLeaveCount,
      lop: unpaidLeaveCount,
      leave: totalLeaveCount,
      totalHours: Number(totalWorkingHours.toFixed(1)),
      leaveTypeCounts,
      ...leaveTypeCounts
    });
  }

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = monthNames[targetMonth - 1] || 'Month';
  const avgAttendancePercent = totalPossibleDaysAll > 0
    ? `${Math.min(100, Math.round((totalAttendedCountAll / totalPossibleDaysAll) * 1000) / 10)}%`
    : '0%';

  // Filter out WFH from dynamic leaveTypes for presentation since WFH has its own dedicated column
  const presentationLeaveTypes = activeLeaveTypes
    .filter(t => !['WFH', 'WORK_FROM_HOME'].includes(t.code?.toUpperCase()) && !t.name?.toUpperCase().includes('WFH') && !t.name?.toUpperCase().includes('WORK FROM HOME'))
    .map(t => ({ id: t.id, name: t.name, code: t.code }));

  return {
    companyName,
    reportType: 'Monthly',
    month: targetMonth,
    monthName,
    year: targetYear,
    monthYearLabel: `${monthName} ${targetYear}`,
    leaveTypes: presentationLeaveTypes,
    summary: {
      totalWorkingDays: monthWorkingDaysCount,
      averageAttendance: avgAttendancePercent,
      averageAttendancePercent: avgAttendancePercent,
      totalLateCount: totalLateCountAll,
      totalPaidLeaves: records.reduce((acc, r) => acc + (r.paidLeave || 0), 0),
      totalLopDays: records.reduce((acc, r) => acc + (r.unpaidLeave || 0), 0)
    },
    records
  };
};

/**
 * 4. Generate Professional ExcelJS Workbook
 */
const generateExcelReport = async ({ type, organizationId, params }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Innovety CRM';
  workbook.lastModifiedBy = 'Innovety CRM';
  workbook.created = new Date();
  workbook.modified = new Date();

  const logoPath = getCompanyLogoPath(organizationId);

  // Palette: Innovety Orange
  const ORANGE_HEX = 'FFEA580C'; // Primary Orange
  const ORANGE_LIGHT = 'FFFFF7ED'; // Light warm zebra
  const BORDER_COLOR = 'FFE5E7EB'; // Subtle grey border

  if (type === 'daily') {
    const data = await getDailyAttendanceData({ organizationId, ...params });
    if (params?.userIds) {
      const allowed = Array.isArray(params.userIds)
        ? params.userIds
        : String(params.userIds).split(',').map(s => s.trim()).filter(Boolean);
      if (allowed.length > 0) {
        data.records = data.records.filter(r => allowed.includes(r.userId));
      }
    }
    if (!data.records || data.records.length === 0) {
      throw new Error('Please select at least one member to export.');
    }
    const sheet = workbook.addWorksheet('Daily Attendance', {
      pageSetup: { fitToPage: true, fitToWidth: 1 }
    });

    // Set row heights for branding (Rows 1-5)
    sheet.getRow(1).height = 16;
    sheet.getRow(2).height = 16;
    sheet.getRow(3).height = 16;
    sheet.getRow(4).height = 24;
    sheet.getRow(5).height = 20;

    // Add Logo if available in Rows 1-3
    if (logoPath) {
      try {
        const imageId = workbook.addImage({
          filename: logoPath,
          extension: logoPath.endsWith('.jpg') || logoPath.endsWith('.jpeg') ? 'jpeg' : 'png'
        });
        sheet.addImage(imageId, {
          tl: { col: 0.1, row: 0.2 },
          ext: { width: 130, height: 38 }
        });
      } catch (err) {
        console.warn('Failed to insert logo into Excel:', err);
      }
    }

    // Row 4: Company Title
    const titleRow = sheet.getRow(4);
    titleRow.values = [data.companyName];
    titleRow.font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: ORANGE_HEX } };
    sheet.mergeCells('A4:D4');

    // Row 5: Report Subtitle & Date
    const subRow = sheet.getRow(5);
    subRow.values = [`Daily Attendance Report  |  Date: ${data.date}`];
    subRow.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF475569' } };
    sheet.mergeCells('A5:D5');

    // Row 6: Table Headers
    const headerRow = sheet.getRow(6);
    headerRow.values = ['Employee', 'Attendance', 'Login Time', 'Login Status'];
    headerRow.height = 26;

    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: ORANGE_HEX }
      };
      cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: ORANGE_HEX } },
        bottom: { style: 'thin', color: { argb: ORANGE_HEX } },
        left: { style: 'thin', color: { argb: ORANGE_HEX } },
        right: { style: 'thin', color: { argb: ORANGE_HEX } }
      };
    });
    // Align Employee header left
    sheet.getCell('A6').alignment = { vertical: 'middle', horizontal: 'left' };

    // Data Rows start at Row 7
    let currentRow = 7;
    data.records.forEach((rec, idx) => {
      const row = sheet.getRow(currentRow);
      row.values = [
        rec.employee,
        rec.attendance,
        rec.loginTime,
        rec.loginStatus
      ];
      row.height = 22;

      const isEven = idx % 2 === 1;
      row.eachCell((cell, colNum) => {
        cell.font = { name: 'Segoe UI', size: 10 };
        cell.alignment = {
          vertical: 'middle',
          horizontal: colNum === 1 ? 'left' : 'center'
        };
        cell.border = {
          top: { style: 'thin', color: { argb: BORDER_COLOR } },
          bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
          left: { style: 'thin', color: { argb: BORDER_COLOR } },
          right: { style: 'thin', color: { argb: BORDER_COLOR } }
        };
        if (isEven) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: ORANGE_LIGHT }
          };
        }
      });
      currentRow++;
    });

    // Auto-fit Column Widths
    sheet.columns = [
      { key: 'A', width: 28 },
      { key: 'B', width: 18 },
      { key: 'C', width: 18 },
      { key: 'D', width: 18 }
    ];

    // Frozen Table Header at Row 6
    sheet.views = [
      {
        state: 'frozen',
        ySplit: 6,
        topLeftCell: 'A7'
      }
    ];

    return {
      workbook,
      filename: `Attendance_Daily_${data.date}.xlsx`
    };
  }

  if (type === 'weekly') {
    const data = await getWeeklyAttendanceData({ organizationId, ...params });
    if (params?.userIds) {
      const allowed = Array.isArray(params.userIds)
        ? params.userIds
        : String(params.userIds).split(',').map(s => s.trim()).filter(Boolean);
      if (allowed.length > 0) {
        data.records = data.records.filter(r => allowed.includes(r.userId));
      }
    }
    if (!data.records || data.records.length === 0) {
      throw new Error('Please select at least one member to export.');
    }
    const sheet = workbook.addWorksheet('Weekly Attendance', {
      pageSetup: { fitToPage: true, fitToWidth: 1 }
    });

    // Set row heights for branding (Rows 1-5)
    sheet.getRow(1).height = 16;
    sheet.getRow(2).height = 16;
    sheet.getRow(3).height = 16;
    sheet.getRow(4).height = 24;
    sheet.getRow(5).height = 20;

    // Add Logo in Rows 1-3
    if (logoPath) {
      try {
        const imageId = workbook.addImage({
          filename: logoPath,
          extension: logoPath.endsWith('.jpg') || logoPath.endsWith('.jpeg') ? 'jpeg' : 'png'
        });
        sheet.addImage(imageId, {
          tl: { col: 0.1, row: 0.2 },
          ext: { width: 130, height: 38 }
        });
      } catch (err) {
        console.warn('Failed to insert logo into Excel:', err);
      }
    }

    const dynamicLeaveHeaders = (data.leaveTypes || []).map(lt => lt.name);
    const headers = ['Members', 'Working Days', 'Present', 'WFH', 'Late', ...dynamicLeaveHeaders, 'Loss of Pay (LOP)'];
    const totalCols = headers.length;
    const lastColLetter = getColLetter(totalCols);

    // Row 4: Company Title
    const titleRow = sheet.getRow(4);
    titleRow.values = [data.companyName];
    titleRow.font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: ORANGE_HEX } };
    sheet.mergeCells(`A4:${lastColLetter}4`);

    // Row 5: Report Subtitle, Date & Summary
    const subRow = sheet.getRow(5);
    subRow.values = [
      `Weekly Attendance Report  |  ${data.weekLabel} (${data.formattedRange})  |  Total Working Days: ${data.summary.totalWorkingDays}  |  Average Attendance: ${data.summary.averageAttendancePercent}  |  Total Loss of Pay (LOP): ${data.summary.totalLopDays || 0} Days`
    ];
    subRow.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF475569' } };
    sheet.mergeCells(`A5:${lastColLetter}5`);

    // Row 6: Table Headers
    const headerRow = sheet.getRow(6);
    headerRow.values = headers;
    headerRow.height = 26;

    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: ORANGE_HEX }
      };
      cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: ORANGE_HEX } },
        bottom: { style: 'thin', color: { argb: ORANGE_HEX } },
        left: { style: 'thin', color: { argb: ORANGE_HEX } },
        right: { style: 'thin', color: { argb: ORANGE_HEX } }
      };
    });
    sheet.getCell('A6').alignment = { vertical: 'middle', horizontal: 'left' };

    // Data Rows start at Row 7
    let currentRow = 7;
    data.records.forEach((rec, idx) => {
      const row = sheet.getRow(currentRow);
      const dynamicLeaveVals = (data.leaveTypes || []).map(lt => {
        return rec.leaveTypeCounts?.[lt.name] ?? rec.leaveTypeCounts?.[lt.code] ?? rec[lt.name] ?? 0;
      });
      row.values = [
        rec.employee,
        rec.workingDays,
        rec.present,
        rec.wfh,
        rec.late,
        ...dynamicLeaveVals,
        rec.unpaidLeave ?? rec.lop ?? 0
      ];
      row.height = 22;

      const isEven = idx % 2 === 1;
      row.eachCell((cell, colNum) => {
        cell.font = { name: 'Segoe UI', size: 10 };
        cell.alignment = {
          vertical: 'middle',
          horizontal: colNum === 1 ? 'left' : 'center'
        };
        cell.border = {
          top: { style: 'thin', color: { argb: BORDER_COLOR } },
          bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
          left: { style: 'thin', color: { argb: BORDER_COLOR } },
          right: { style: 'thin', color: { argb: BORDER_COLOR } }
        };
        if (isEven) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: ORANGE_LIGHT }
          };
        }
      });
      currentRow++;
    });

    const colDefs = [
      { key: 'A', width: 28 }, // Members
      { key: 'B', width: 16 }, // Working Days
      { key: 'C', width: 14 }, // Present
      { key: 'D', width: 14 }, // WFH
      { key: 'E', width: 14 }  // Late
    ];
    (data.leaveTypes || []).forEach((lt, i) => {
      const colLetter = getColLetter(6 + i);
      const width = Math.max(16, (lt.name.length || 10) + 4);
      colDefs.push({ key: colLetter, width });
    });
    colDefs.push({
      key: getColLetter(totalCols),
      width: 18
    });
    sheet.columns = colDefs;

    sheet.views = [
      {
        state: 'frozen',
        ySplit: 6,
        topLeftCell: 'A7'
      }
    ];

    const formattedWeekStr = String(data.week).padStart(2, '0');
    return {
      workbook,
      filename: `Attendance_Weekly_Week${formattedWeekStr}_${data.year}.xlsx`
    };
  }

  if (type === 'monthly') {
    const data = await getMonthlyAttendanceData({ organizationId, ...params });
    if (params?.userIds) {
      const allowed = Array.isArray(params.userIds)
        ? params.userIds
        : String(params.userIds).split(',').map(s => s.trim()).filter(Boolean);
      if (allowed.length > 0) {
        data.records = data.records.filter(r => allowed.includes(r.userId));
      }
    }
    if (!data.records || data.records.length === 0) {
      throw new Error('Please select at least one member to export.');
    }
    const sheet = workbook.addWorksheet('Monthly Attendance', {
      pageSetup: { fitToPage: true, fitToWidth: 1 }
    });

    // Set row heights for branding (Rows 1-5)
    sheet.getRow(1).height = 16;
    sheet.getRow(2).height = 16;
    sheet.getRow(3).height = 16;
    sheet.getRow(4).height = 24;
    sheet.getRow(5).height = 20;

    // Add Logo in Rows 1-3
    if (logoPath) {
      try {
        const imageId = workbook.addImage({
          filename: logoPath,
          extension: logoPath.endsWith('.jpg') || logoPath.endsWith('.jpeg') ? 'jpeg' : 'png'
        });
        sheet.addImage(imageId, {
          tl: { col: 0.1, row: 0.2 },
          ext: { width: 130, height: 38 }
        });
      } catch (err) {
        console.warn('Failed to insert logo into Excel:', err);
      }
    }

    const dynamicLeaveHeaders = (data.leaveTypes || []).map(lt => lt.name);
    const headers = ['Members', 'Working Days', 'Present', 'WFH', 'Late', ...dynamicLeaveHeaders, 'Loss of Pay (LOP)'];
    const totalCols = headers.length;
    const lastColLetter = getColLetter(totalCols);

    // Row 4: Company Title
    const titleRow = sheet.getRow(4);
    titleRow.values = [data.companyName];
    titleRow.font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: ORANGE_HEX } };
    sheet.mergeCells(`A4:${lastColLetter}4`);

    // Row 5: Report Subtitle, Date & Summary
    const subRow = sheet.getRow(5);
    subRow.values = [
      `Monthly Attendance Report  |  ${data.monthYearLabel}  |  Total Working Days: ${data.summary.totalWorkingDays}  |  Average Attendance: ${data.summary.averageAttendancePercent}  |  Total Loss of Pay (LOP): ${data.summary.totalLopDays || 0} Days`
    ];
    subRow.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF475569' } };
    sheet.mergeCells(`A5:${lastColLetter}5`);

    // Row 6: Table Headers
    const headerRow = sheet.getRow(6);
    headerRow.values = headers;
    headerRow.height = 26;

    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: ORANGE_HEX }
      };
      cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: ORANGE_HEX } },
        bottom: { style: 'thin', color: { argb: ORANGE_HEX } },
        left: { style: 'thin', color: { argb: ORANGE_HEX } },
        right: { style: 'thin', color: { argb: ORANGE_HEX } }
      };
    });
    sheet.getCell('A6').alignment = { vertical: 'middle', horizontal: 'left' };

    // Data Rows start at Row 7
    let currentRow = 7;
    data.records.forEach((rec, idx) => {
      const row = sheet.getRow(currentRow);
      const dynamicLeaveVals = (data.leaveTypes || []).map(lt => {
        return rec.leaveTypeCounts?.[lt.name] ?? rec.leaveTypeCounts?.[lt.code] ?? rec[lt.name] ?? 0;
      });
      row.values = [
        rec.employee,
        rec.workingDays,
        rec.present,
        rec.wfh,
        rec.late,
        ...dynamicLeaveVals,
        rec.unpaidLeave ?? rec.lop ?? 0
      ];
      row.height = 22;

      const isEven = idx % 2 === 1;
      row.eachCell((cell, colNum) => {
        cell.font = { name: 'Segoe UI', size: 10 };
        cell.alignment = {
          vertical: 'middle',
          horizontal: colNum === 1 ? 'left' : 'center'
        };
        cell.border = {
          top: { style: 'thin', color: { argb: BORDER_COLOR } },
          bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
          left: { style: 'thin', color: { argb: BORDER_COLOR } },
          right: { style: 'thin', color: { argb: BORDER_COLOR } }
        };
        if (isEven) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: ORANGE_LIGHT }
          };
        }
      });
      currentRow++;
    });

    const colDefs = [
      { key: 'A', width: 28 }, // Members
      { key: 'B', width: 16 }, // Working Days
      { key: 'C', width: 14 }, // Present
      { key: 'D', width: 14 }, // WFH
      { key: 'E', width: 14 }  // Late
    ];
    (data.leaveTypes || []).forEach((lt, i) => {
      const colLetter = getColLetter(6 + i);
      const width = Math.max(16, (lt.name.length || 10) + 4);
      colDefs.push({ key: colLetter, width });
    });
    colDefs.push({
      key: getColLetter(totalCols),
      width: 18
    });
    sheet.columns = colDefs;

    sheet.views = [
      {
        state: 'frozen',
        ySplit: 6,
        topLeftCell: 'A7'
      }
    ];

    return {
      workbook,
      filename: `Attendance_Monthly_${data.monthName}_${data.year}.xlsx`
    };
  }

  throw new Error(`Unsupported report type: ${type}`);
};

module.exports = {
  getDailyAttendanceData,
  getWeeklyAttendanceData,
  getMonthlyAttendanceData,
  generateExcelReport
};
