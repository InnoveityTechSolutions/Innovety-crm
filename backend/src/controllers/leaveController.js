const prisma = require('../utils/db');
const { logActivity } = require('../utils/activityLogger');
const { createNotification } = require('../services/notification');
const { getOrganizationWhere } = require('../utils/organizationScope');
const { broadcastLeavePolicyUpdate } = require('../socket');
const {
  getCompanyLeavePolicy,
  filterLeaveTypesForCompany,
  normalizeRole
} = require('../utils/companyLeavePolicyStore');
const shiftService = require('../services/shiftService');
const { getEffectiveSettings } = require('../utils/settingsResolver');
const { getSystemTimeZone, getZonedParts } = require('../utils/attendanceUtils');

// Safe leave-type resolver supporting database ID, code, name, and standard CRM aliases
const resolveLeaveType = (rawType, companyLeaveTypes = []) => {
  if (!rawType) return null;
  const rawStr = String(rawType).trim();
  const rawUpper = rawStr.toUpperCase();

  // 1. Direct match by id, code, or name (case-insensitive)
  const direct = companyLeaveTypes.find(lt =>
    lt.id === rawStr ||
    (lt.code && lt.code.toUpperCase() === rawUpper) ||
    (lt.name && lt.name.trim().toUpperCase() === rawUpper)
  );
  if (direct) return direct;

  // 2. Standard CRM aliases mapped to active organization types
  if (['CL', 'CASUAL', 'CASUAL_LEAVE', 'CASUAL LEAVE'].includes(rawUpper)) {
    return companyLeaveTypes.find(lt => (lt.code && lt.code.toUpperCase() === 'CL') || (lt.name && lt.name.toLowerCase().includes('casual')));
  }
  if (['SL', 'SICK', 'SICK_LEAVE', 'SICK LEAVE', 'MEDICAL'].includes(rawUpper)) {
    return companyLeaveTypes.find(lt => (lt.code && lt.code.toUpperCase() === 'SL') || (lt.name && lt.name.toLowerCase().includes('sick')));
  }
  if (['COMP_OFF', 'COMPOFF', 'COMPENSATORY', 'COMPENSATORY_OFF', 'COMPENSATORY OFF'].includes(rawUpper)) {
    return companyLeaveTypes.find(lt => (lt.code && lt.code.toUpperCase() === 'COMP_OFF') || (lt.name && lt.name.toLowerCase().includes('comp')));
  }
  if (['WFH', 'WORK_FROM_HOME', 'WORK FROM HOME', 'REMOTE'].includes(rawUpper)) {
    return companyLeaveTypes.find(lt => (lt.code && lt.code.toUpperCase() === 'WFH') || (lt.name && lt.name.toLowerCase().includes('wfh')));
  }
  if (['EMERGENCY', 'EL', 'EMERGENCY_LEAVE'].includes(rawUpper)) {
    return companyLeaveTypes.find(lt => (lt.code && lt.code.toUpperCase() === 'EL') || (lt.name && lt.name.toLowerCase().includes('emergency')));
  }
  if (['LOP', 'UNPAID', 'LOSS_OF_PAY', 'LOSS OF PAY'].includes(rawUpper)) {
    return companyLeaveTypes.find(lt => ['LOP', 'UNPAID'].includes(lt.code?.toUpperCase()) || (lt.name && (lt.name.toLowerCase().includes('unpaid') || lt.name.toLowerCase().includes('loss of pay'))));
  }

  return null;
};

// Helper to validate minimum advance notice requirement
const validateMinNoticeDays = async (startDateInput, minNoticeDays, leaveTypeName, organizationId) => {
  const minNotice = parseInt(minNoticeDays, 10) || 0;
  if (minNotice <= 0) return null; // No advance notice required

  const settings = await getEffectiveSettings(organizationId);
  const timeZone = getSystemTimeZone(settings);
  const todayParts = getZonedParts(new Date(), timeZone);

  const startStr = typeof startDateInput === 'string'
    ? startDateInput.split('T')[0]
    : new Date(startDateInput).toISOString().split('T')[0];

  const [tY, tM, tD] = todayParts.dateStr.split('-').map(Number);
  const [sY, sM, sD] = startStr.split('-').map(Number);

  const todayMidnight = Date.UTC(tY, tM - 1, tD);
  const startMidnight = Date.UTC(sY, sM - 1, sD);
  const diffCalendarDays = Math.round((startMidnight - todayMidnight) / (1000 * 60 * 60 * 24));

  if (diffCalendarDays < minNotice) {
    const earliestDateObj = new Date(todayMidnight + minNotice * 24 * 60 * 60 * 1000);
    const eDay = String(earliestDateObj.getUTCDate()).padStart(2, '0');
    const eMonth = String(earliestDateObj.getUTCMonth() + 1).padStart(2, '0');
    const eYear = earliestDateObj.getUTCFullYear();
    const earliestFormatted = `${eDay}/${eMonth}/${eYear}`;

    return `${leaveTypeName || 'This leave type'} requires at least ${minNotice} day(s) advance notice. The earliest date you can apply for is ${earliestFormatted}.`;
  }

  return null;
};

// Helper to calculate working days count between 2 dates (Safeguard 3: evaluates each date, skips Sundays and shift holidays)
const calculateTotalDays = async (startDate, endDate, userId = null, organizationId = null) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return 0;
  }

  // Fetch employee's assigned shift
  const userShift = userId ? await shiftService.getEmployeeShift(userId) : null;

  // Fetch company holidays in date range
  const holidays = await prisma.holidayCalendar.findMany({
    where: {
      date: { gte: start, lte: end },
      ...(organizationId ? { organizationId } : {})
    }
  });
  const holidayDatesStr = new Set(holidays.map(h => new Date(h.date).toISOString().split('T')[0]));

  let count = 0;
  let curr = new Date(start);
  while (curr <= end) {
    const dateStr = curr.toISOString().split('T')[0];
    const dayName = shiftService.getDayName(curr);
    const isSunday = curr.getUTCDay() === 0 || dayName === 'SUNDAY';
    const isCompanyHoliday = holidayDatesStr.has(dateStr);
    const shiftStatus = shiftService.getShiftDayStatus(userShift, dayName, curr);
    const isShiftHoliday = shiftStatus === 'Holiday';

    // Safeguard 3: Skip Sundays and shift holidays
    if (!isSunday && !isCompanyHoliday && !isShiftHoliday) {
      count += 1;
    }

    curr.setDate(curr.getDate() + 1);
  }

  return count;
};

// 1. Get Leaves (Role Scoped + Advanced Date & Filter Queries)
const getLeaves = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;
    const {
      status,
      leaveType,
      payType,
      department,
      search,
      singleDate,
      fromDate,
      toDate,
      page,
      limit
    } = req.query;

    let baseWhere = {};

    // 1. Role Scoping
    if (userRole === 'SUPER_ADMIN' || userRole === 'ADMIN') {
      baseWhere = {};
    } else if (userRole === 'TEAM_LEADER') {
      const ledTeams = await prisma.team.findMany({
        where: { leaderId: userId },
        select: { id: true }
      });
      const teamIds = ledTeams.map(t => t.id);

      const teamMemberships = await prisma.teamMember.findMany({
        where: { teamId: { in: teamIds } },
        select: { userId: true }
      });
      const memberUserIds = teamMemberships.map(m => m.userId);

      baseWhere = {
        OR: [
          { userId: userId },
          { submittedTeamLeaderId: userId },
          { userId: { in: memberUserIds } }
        ]
      };
    } else {
      baseWhere = { userId };
    }

    const { getUserRelationWhere } = require('../utils/organizationScope');
    baseWhere = getUserRelationWhere(req, baseWhere);

    const andConditions = [];

    // 2. Status Filter with Strict Scoping
    if (status && status !== 'ALL') {
      const normStatus = status.toUpperCase();
      if (normStatus === 'PENDING') {
        if (userRole === 'TEAM_LEADER') {
          andConditions.push({ status: 'PENDING_TL_APPROVAL' });
        } else if (userRole === 'ADMIN' || userRole === 'SUPER_ADMIN') {
          andConditions.push({ status: 'PENDING_ADMIN_APPROVAL' });
        } else {
          andConditions.push({
            status: { in: ['PENDING_TL_APPROVAL', 'PENDING_ADMIN_APPROVAL'] }
          });
        }
      } else {
        andConditions.push({ status: normStatus });
      }
    }

    // 3. Leave Type Filter
    if (leaveType && leaveType !== 'ALL') {
      const normType = leaveType.toUpperCase();
      andConditions.push({
        OR: [
          { leaveType: normType },
          { type: normType }
        ]
      });
    }

    // 3.5 Pay Type Filter
    if (payType && payType !== 'ALL') {
      const normPayType = payType.toUpperCase();
      andConditions.push({ payType: normPayType });
    }

    // 4. Date Overlap Filter
    let filterStart = null;
    let filterEnd = null;

    if (singleDate) {
      filterStart = new Date(`${singleDate}T00:00:00.000Z`);
      filterEnd = new Date(`${singleDate}T23:59:59.999Z`);
    } else {
      if (fromDate) {
        filterStart = new Date(`${fromDate}T00:00:00.000Z`);
      }
      if (toDate) {
        filterEnd = new Date(`${toDate}T23:59:59.999Z`);
      }
    }

    if (filterEnd && !isNaN(filterEnd.getTime())) {
      andConditions.push({ startDate: { lte: filterEnd } });
    }
    if (filterStart && !isNaN(filterStart.getTime())) {
      andConditions.push({ endDate: { gte: filterStart } });
    }

    // 5. Department & Employee Search Filter
    const userWhere = {};
    if (department && department !== 'ALL') {
      userWhere.department = { equals: department };
    }

    if (search && search.trim()) {
      const q = search.trim();
      userWhere.OR = [
        { name: { contains: q } },
        { employeeId: { contains: q } },
        { email: { contains: q } }
      ];
    }

    if (Object.keys(userWhere).length > 0) {
      andConditions.push({ user: userWhere });
    }

    const finalWhere = andConditions.length > 0
      ? { AND: [baseWhere, ...andConditions] }
      : baseWhere;

    // Optional Pagination
    const pageNum = parseInt(page) || 0;
    const limitNum = parseInt(limit) || 0;

    let leaves = [];
    let totalCount = 0;

    if (pageNum > 0 && limitNum > 0) {
      totalCount = await prisma.leaveRequest.count({ where: finalWhere });
      leaves = await prisma.leaveRequest.findMany({
        where: finalWhere,
        include: {
          user: {
            select: { id: true, name: true, email: true, employeeId: true, role: true, department: true, profilePic: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum
      });

      return res.json({
        leaves,
        total: totalCount,
        page: pageNum,
        totalPages: Math.ceil(totalCount / limitNum)
      });
    }

    leaves = await prisma.leaveRequest.findMany({
      where: finalWhere,
      include: {
        user: {
          select: { id: true, name: true, email: true, employeeId: true, role: true, department: true, profilePic: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(leaves);
  } catch (error) {
    console.error('Get leaves error:', error);
    res.status(500).json({ message: 'Failed to retrieve leave requests.' });
  }
};

// 2. Get Dynamic Leave Balances (Global Leave Policy UserLeaveBalance)
const getLeaveBalances = async (req, res) => {
  try {
    const targetUserId = req.query.userId || req.user.id;
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        name: true,
        role: true,
        organizationId: true,
        joiningDate: true,
        createdAt: true
      }
    });

    if (!targetUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const orgId = req.query.organizationId || targetUser.organizationId;
    const normalizedRole = normalizeRole(targetUser.role);

    let policy = null;
    let companyAllocationMode = 'ANNUAL';
    if (orgId) {
      const orgSettings = await prisma.organizationSettings.findUnique({
        where: { organizationId: orgId }
      });
      const storePolicy = getCompanyLeavePolicy(orgId, normalizedRole);
      const companyLeavePolicy = orgSettings?.leavePolicy || storePolicy || {};

      // The company's active leave policy determines the allocation mode for all roles
      companyAllocationMode = companyLeavePolicy.allocationType || storePolicy?.allocationType || 'ANNUAL';

      policy = {
        allocationType: companyAllocationMode,
        carryForwardEnabled: companyLeavePolicy.carryForwardEnabled !== undefined ? companyLeavePolicy.carryForwardEnabled : true,
        maxCarryForwardDays: companyLeavePolicy.maxCarryForwardDays !== undefined ? parseFloat(companyLeavePolicy.maxCarryForwardDays) : 5.0,
        halfDayAllowed: companyLeavePolicy.halfDayAllowed !== undefined ? companyLeavePolicy.halfDayAllowed : true,
        workingDaysOnly: companyLeavePolicy.workingDaysOnly !== undefined ? companyLeavePolicy.workingDaysOnly : true,
        autoApproval: companyLeavePolicy.autoApproval !== undefined ? companyLeavePolicy.autoApproval : false,
        ...storePolicy,
        ...companyLeavePolicy,
        // Crucial: Company's active allocationType takes precedence over any stale role override
        allocationType: companyAllocationMode,
        allowances: {
          ...(storePolicy?.allowances || {}),
          ...(companyLeavePolicy.allowances || {})
        }
      };

      // Merge role-specific allowances if configured in company leave policy
      const roleConfig = companyLeavePolicy.roles?.[normalizedRole] || storePolicy?.roles?.[normalizedRole];
      if (roleConfig?.allowances) {
        policy.allowances = {
          ...policy.allowances,
          ...roleConfig.allowances
        };
      }
    }
    if (!policy) {
      policy = await prisma.leavePolicy.findFirst({ where: { isGlobal: true } });
    }

    const allocationMode = policy?.allocationType || companyAllocationMode || 'ANNUAL';
    const roleAllowances = policy?.allowances || {};

    const allLeaveTypes = await prisma.leaveType.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' }
    });

    const companyLeaveTypes = filterLeaveTypesForCompany(allLeaveTypes, orgId);

    // Filter out stale / inactive / deleted leave types from role allowances
    const activeLeaveCodes = new Set(
      companyLeaveTypes.map((lt) => (lt.code || '').toUpperCase())
    );
    const cleanedRoleAllowances = {};
    for (const [code, allowance] of Object.entries(roleAllowances)) {
      if (activeLeaveCodes.has(code.toUpperCase())) {
        cleanedRoleAllowances[code] = allowance;
      }
    }

    const userApprovedLeaves = await prisma.leaveRequest.findMany({
      where: { userId: targetUserId, status: 'APPROVED' }
    });

    const userPendingLeaves = await prisma.leaveRequest.findMany({
      where: {
        userId: targetUserId,
        status: { in: ['PENDING', 'PENDING_TL_APPROVAL', 'PENDING_ADMIN_APPROVAL'] }
      }
    });

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const userJoinDate = targetUser.joiningDate ? new Date(targetUser.joiningDate) : new Date(targetUser.createdAt || now);
    const validJoinDate = isNaN(userJoinDate.getTime()) ? now : userJoinDate;
    const joinYear = validJoinDate.getFullYear();
    const joinMonth = validJoinDate.getMonth();

    let startMonthIndex = 0;
    if (joinYear === currentYear) {
      startMonthIndex = Math.min(currentMonth, Math.max(0, joinMonth));
    } else if (joinYear > currentYear) {
      startMonthIndex = currentMonth + 1; // Future joiner
    }
    const priorMonthsCount = Math.max(0, currentMonth - startMonthIndex);

    for (const lt of companyLeaveTypes) {
      let usedThisYear = 0;
      let usedThisMonth = 0;
      let usedPriorMonths = 0;

      for (const l of userApprovedLeaves) {
        const lType = (l.leaveType || l.type || '').toUpperCase();
        if (lType === lt.code.toUpperCase() || lType === lt.name.toUpperCase()) {
          const start = new Date(l.startDate);
          const days = l.totalDays !== undefined ? parseFloat(l.totalDays) : 1.0;
          if (start.getFullYear() === currentYear) {
            usedThisYear += days;
            const startMonth = start.getMonth();
            if (startMonth === currentMonth) {
              usedThisMonth += days;
            } else if (startMonth < currentMonth) {
              usedPriorMonths += days;
            }
          }
        }
      }

      let pendingThisYear = 0;
      let pendingThisMonth = 0;

      for (const l of userPendingLeaves) {
        const lType = (l.leaveType || l.type || '').toUpperCase();
        if (lType === lt.code.toUpperCase() || lType === lt.name.toUpperCase()) {
          const start = new Date(l.startDate);
          const days = l.totalDays !== undefined ? parseFloat(l.totalDays) : 1.0;
          if (start.getFullYear() === currentYear) {
            pendingThisYear += days;
            if (start.getMonth() === currentMonth) {
              pendingThisMonth += days;
            }
          }
        }
      }

      const roleAllowance = cleanedRoleAllowances[lt.code] || cleanedRoleAllowances[lt.id] || cleanedRoleAllowances[lt.name];
      const annualDays = (roleAllowance?.annualDays !== undefined && roleAllowance?.annualDays !== null)
        ? parseFloat(roleAllowance.annualDays)
        : (lt.annualDays !== undefined ? parseFloat(lt.annualDays) : 12.0);
      let monthlyCreditDays = (roleAllowance?.monthlyCreditDays !== undefined && roleAllowance?.monthlyCreditDays !== null)
        ? parseFloat(roleAllowance.monthlyCreditDays)
        : (lt.monthlyCreditDays !== undefined ? parseFloat(lt.monthlyCreditDays) : 1.0);

      // In monthly allocation mode: if role allowance specifies custom days (e.g. Casual: 5, Sick: 8, Emergency: 0)
      if (allocationMode === 'MONTHLY' && roleAllowance) {
        if (roleAllowance.monthlyCreditDays !== undefined && roleAllowance.monthlyCreditDays !== null) {
          monthlyCreditDays = parseFloat(roleAllowance.monthlyCreditDays);
        } else if (roleAllowance.annualDays !== undefined && roleAllowance.annualDays !== null) {
          monthlyCreditDays = parseFloat(roleAllowance.annualDays);
        }
      }

      let allocated = 0;
      let used = 0;
      let pending = 0;
      let available = 0;
      let calculatedCarryForward = 0;
      let calculatedExpired = 0;

      if (lt.code === 'COMP_OFF' || (lt.code || '').toUpperCase() === 'COMP_OFF') {
        const compOffService = require('../services/compOffService');
        const ledgerBal = await compOffService.getUserCompOffLedgerBalance(targetUserId, now);
        allocated = 0;
        used = ledgerBal.totalUsed;
        pending = ledgerBal.pendingDays;
        available = ledgerBal.netAvailable;
        calculatedCarryForward = 0;
      } else if (allocationMode === 'MONTHLY') {
        allocated = monthlyCreditDays;
        used = usedThisMonth;
        pending = pendingThisMonth;

        if (lt.allowCarryForward) {
          // Unused monthly credits from prior months of current year accumulate into following months
          const priorEarned = priorMonthsCount * monthlyCreditDays;
          calculatedCarryForward = Math.max(0, priorEarned - usedPriorMonths);
          const totalAccrued = priorEarned + monthlyCreditDays;
          const totalUsedAndPending = usedPriorMonths + usedThisMonth + pendingThisMonth;
          available = Math.max(0, totalAccrued - totalUsedAndPending);
        } else {
          // When Carry Forward is disabled, unused monthly credits expire at month-end
          calculatedCarryForward = 0;
          available = Math.max(0, monthlyCreditDays - usedThisMonth - pendingThisMonth);
          const priorEarned = priorMonthsCount * monthlyCreditDays;
          calculatedExpired = Math.max(0, priorEarned - usedPriorMonths);
        }
      } else {
        // ANNUAL mode: Unused annual leave does NOT carry forward to the next year
        allocated = annualDays;
        used = usedThisYear;
        pending = pendingThisYear;
        calculatedCarryForward = 0;
        available = Math.max(0, annualDays - usedThisYear - pendingThisYear);
      }

      await prisma.userLeaveBalance.upsert({
        where: {
          userId_leaveTypeId: {
            userId: targetUserId,
            leaveTypeId: lt.id
          }
        },
        update: {
          allocated,
          used,
          pending,
          available,
          carryForward: calculatedCarryForward,
          expired: calculatedExpired,
          lastCreditedAt: new Date()
        },
        create: {
          userId: targetUserId,
          leaveTypeId: lt.id,
          allocated,
          used,
          pending,
          available,
          carryForward: calculatedCarryForward,
          expired: calculatedExpired,
          lastCreditedAt: new Date()
        }
      });
    }

    const balances = await prisma.userLeaveBalance.findMany({
      where: {
        userId: targetUserId,
        leaveType: { isActive: true }
      },
      include: { leaveType: true },
      orderBy: { leaveType: { displayOrder: 'asc' } }
    });

    const formattedTypes = balances.map((b) => {
      const lt = b.leaveType;
      const roleAllowance = cleanedRoleAllowances[lt.code] || cleanedRoleAllowances[lt.id] || cleanedRoleAllowances[lt.name];
      const annualDays = (roleAllowance?.annualDays !== undefined && roleAllowance?.annualDays !== null)
        ? parseFloat(roleAllowance.annualDays)
        : (lt.annualDays !== undefined ? parseFloat(lt.annualDays) : 12.0);
      let monthlyCreditDays = (roleAllowance?.monthlyCreditDays !== undefined && roleAllowance?.monthlyCreditDays !== null)
        ? parseFloat(roleAllowance.monthlyCreditDays)
        : (lt.monthlyCreditDays !== undefined ? parseFloat(lt.monthlyCreditDays) : 1.0);

      if (allocationMode === 'MONTHLY' && roleAllowance) {
        if (roleAllowance.monthlyCreditDays !== undefined && roleAllowance.monthlyCreditDays !== null) {
          monthlyCreditDays = parseFloat(roleAllowance.monthlyCreditDays);
        } else if (roleAllowance.annualDays !== undefined && roleAllowance.annualDays !== null) {
          monthlyCreditDays = parseFloat(roleAllowance.annualDays);
        }
      }

      return {
        id: lt.id,
        name: lt.name,
        code: lt.code,
        shortCode: lt.code,
        color: lt.color || '#3B82F6',
        icon: lt.icon || 'Calendar',
        annualDays,
        monthlyCreditDays,
        allocated: b.allocated,
        used: b.used,
        pending: b.pending || 0,
        available: b.available,
        carryForward: b.carryForward || 0,
        monthlyCredit: monthlyCreditDays,
        allowHalfDay: lt.allowHalfDay,
        allowCarryForward: lt.allowCarryForward,
        minNoticeDays: lt.minNoticeDays ?? 0
      };
    });

    const pendingRequestsCount = await prisma.leaveRequest.count({
      where: {
        userId: targetUserId,
        status: { in: ['PENDING', 'PENDING_TL_APPROVAL', 'PENDING_ADMIN_APPROVAL'] }
      }
    });

    const approvedRequestsCount = await prisma.leaveRequest.count({
      where: {
        userId: targetUserId,
        status: 'APPROVED'
      }
    });

    const casualBal = balances.find(b => ['CL', 'CASUAL'].includes(b.leaveType.code.toUpperCase()) || b.leaveType.name.toLowerCase().includes('casual'));
    const sickBal = balances.find(b => ['SL', 'SICK'].includes(b.leaveType.code.toUpperCase()) || b.leaveType.name.toLowerCase().includes('sick'));
    const emergencyBal = balances.find(b => ['EL', 'EMERGENCY'].includes(b.leaveType.code.toUpperCase()) || b.leaveType.name.toLowerCase().includes('emergency'));
    const wfhBal = balances.find(b => ['WFH'].includes(b.leaveType.code.toUpperCase()) || b.leaveType.name.toLowerCase().includes('wfh') || b.leaveType.name.toLowerCase().includes('home'));
    const compOffBal = balances.find(b => ['COMP_OFF', 'COMPOFF'].includes(b.leaveType.code.toUpperCase()) || b.leaveType.name.toLowerCase().includes('compensatory'));

    res.json({
      userId: targetUser.id,
      userName: targetUser.name,
      userRole: targetUser.role,
      organizationId: orgId,
      allocationMode,
      policy,
      leaveTypes: formattedTypes,
      balances,
      casualRemaining: casualBal ? casualBal.available : 0,
      sickRemaining: sickBal ? sickBal.available : 0,
      emergencyRemaining: emergencyBal ? emergencyBal.available : 0,
      wfhRemaining: wfhBal ? wfhBal.available : 0,
      wfhEnabled: !!wfhBal && wfhBal.leaveType.isActive,
      compOffRemaining: compOffBal ? compOffBal.available : 0,
      pendingRequestsCount,
      approvedRequestsCount,
      pendingRequests: pendingRequestsCount,
      approvedRequests: approvedRequestsCount
    });
  } catch (error) {
    console.error('Get leave balances error:', error);
    res.status(500).json({ message: 'Failed to retrieve leave balances.' });
  }
};

// 3. Apply Leave (Snapshot Team ID & Leader ID, Multi-level Routing)
const applyLeave = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;

    // Rule 1: Admin and Super Admin CANNOT apply for leave
    if (userRole === 'ADMIN' || userRole === 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Administrators and Super Admins cannot apply for leave.' });
    }

    const { startDate, endDate, leaveType, payType: inputPayType, type: altType, reason, letterContent, contactPhone, isHalfDay } = req.body;

    if (!startDate || !endDate || (!reason && !letterContent)) {
      return res.status(400).json({ message: 'Start date, end date, and reason/letter content are required.' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ message: 'Invalid start or end date format.' });
    }

    if (start > end) {
      return res.status(400).json({ message: 'Start date must be before or equal to end date.' });
    }

    const rawType = leaveType || altType || 'CL';
    const userRecordObj = await prisma.user.findUnique({
      where: { id: userId },
      select: { organizationId: true }
    });

    let totalDays = await calculateTotalDays(start, end, userId, userRecordObj?.organizationId);
    if (isHalfDay) {
      totalDays = 0.5;
    }
    if (totalDays <= 0) {
      return res.status(400).json({ message: 'The selected date range falls entirely on Sundays, shift holidays, or company holidays.' });
    }

    const allLeaveTypes = await prisma.leaveType.findMany({ where: { isActive: true } });
    const companyLeaveTypes = filterLeaveTypesForCompany(allLeaveTypes, userRecordObj?.organizationId);

    const matchedTypeObj = resolveLeaveType(rawType, companyLeaveTypes);

    // Never silently skip validation on invalid or unknown leave types
    if (!matchedTypeObj) {
      const rawUpper = String(rawType).trim().toUpperCase();
      if (rawUpper === 'WFH' || rawUpper === 'WORK_FROM_HOME') {
        return res.status(400).json({
          message: 'Work From Home (WFH) is not an active leave policy for your organization.'
        });
      }
      if (!['LOP', 'UNPAID', 'LOSS_OF_PAY', 'LOSS OF PAY'].includes(rawUpper)) {
        return res.status(400).json({
          message: `The selected leave type "${rawType}" is invalid or not available in your organization.`
        });
      }
    }

    const normalizedType = matchedTypeObj ? matchedTypeObj.code.toUpperCase() : String(rawType).toUpperCase();

    const determinedPayType = inputPayType
      ? (String(inputPayType).toUpperCase() === 'UNPAID' ? 'UNPAID' : 'PAID')
      : (['LOP', 'UNPAID', 'LOSS_OF_PAY'].includes(normalizedType) || (matchedTypeObj && !matchedTypeObj.isPaid) ? 'UNPAID' : 'PAID');

    if (normalizedType === 'WFH' && !matchedTypeObj) {
      return res.status(400).json({
        message: 'Work From Home (WFH) is not an active leave policy for your organization.'
      });
    }

    // Minimum advance notice validation
    const minNoticeError = await validateMinNoticeDays(
      startDate,
      matchedTypeObj?.minNoticeDays,
      matchedTypeObj?.name,
      userRecordObj?.organizationId
    );
    if (minNoticeError) {
      return res.status(400).json({ message: minNoticeError });
    }

    // Snapshot Team ID & Team Leader ID at creation time
    const teamMember = await prisma.teamMember.findFirst({
      where: { userId },
      include: {
        team: {
          select: { id: true, leaderId: true }
        }
      }
    });

    const submittedTeamId = teamMember?.team?.id || null;
    const submittedTeamLeaderId = teamMember?.team?.leaderId || null;

    const hasTeamLeader = submittedTeamLeaderId && submittedTeamLeaderId !== userId;
    let initialStatus = 'PENDING_ADMIN_APPROVAL';
    let tlApprovalStatus = 'NOT_REQUIRED';

    if ((userRole === 'INTERN' || userRole === 'EMPLOYEE') && hasTeamLeader) {
      initialStatus = 'PENDING_TL_APPROVAL';
      tlApprovalStatus = 'PENDING';
    }

    const isCompOff = normalizedType === 'COMP_OFF' || (matchedTypeObj?.code || '').toUpperCase() === 'COMP_OFF';

    let leave;

    if (isCompOff) {
      // Execute atomically inside interactive transaction with row-level lock on compoffcredit
      leave = await prisma.$transaction(async (tx) => {
        // Lock user's approved comp-off credits to serialize concurrent reservation attempts
        await tx.$queryRaw`
          SELECT id FROM compoffcredit 
          WHERE userId = ${userId} AND status = 'APPROVED' 
          FOR UPDATE
        `;

        const compOffService = require('../services/compOffService');
        const ledgerBal = await compOffService.getUserCompOffLedgerBalance(userId, new Date(), tx);
        const availableDays = ledgerBal.netAvailable;

        if (totalDays > availableDays) {
          const err = new Error(
            `Requested leave duration (${totalDays} day(s)) exceeds your available ${matchedTypeObj?.name || 'Comp-Off'} balance (${availableDays} day(s) remaining after pending reservations).`
          );
          err.statusCode = 400;
          throw err;
        }

        // Prevent Overlapping Active Leave/WFH Requests
        const overlapping = await tx.leaveRequest.findFirst({
          where: {
            userId,
            status: { in: ['PENDING_TL_APPROVAL', 'PENDING_ADMIN_APPROVAL', 'APPROVED'] },
            AND: [
              { startDate: { lte: end } },
              { endDate: { gte: start } }
            ]
          }
        });

        if (overlapping) {
          const err = new Error('You already have an active leave or WFH request overlapping with the selected date range.');
          err.statusCode = 400;
          throw err;
        }

        return await tx.leaveRequest.create({
          data: {
            userId,
            startDate: start,
            endDate: end,
            totalDays,
            leaveType: normalizedType,
            type: normalizedType === 'WFH' ? 'WFH' : 'LEAVE',
            payType: determinedPayType,
            reason: reason || 'Leave Application',
            letterContent: letterContent || reason,
            contactPhone: contactPhone || null,
            submittedTeamId,
            submittedTeamLeaderId,
            status: initialStatus,
            tlApprovalStatus,
            adminApprovalStatus: 'PENDING'
          }
        });
      });
    } else {
      // Normal leave type balance validation
      if (determinedPayType !== 'UNPAID' && matchedTypeObj) {
        const userBal = await prisma.userLeaveBalance.findUnique({
          where: {
            userId_leaveTypeId: {
              userId,
              leaveTypeId: matchedTypeObj.id
            }
          }
        });

        const availableDays = userBal ? userBal.available : matchedTypeObj.annualDays;

        if (totalDays > availableDays) {
          return res.status(400).json({
            message: `Requested leave duration (${totalDays} day(s)) exceeds your available ${matchedTypeObj.name} balance (${availableDays} day(s) remaining).`
          });
        }
      }

      // Prevent Overlapping Active Leave/WFH Requests
      const overlapping = await prisma.leaveRequest.findFirst({
        where: {
          userId,
          status: { in: ['PENDING_TL_APPROVAL', 'PENDING_ADMIN_APPROVAL', 'APPROVED'] },
          AND: [
            { startDate: { lte: end } },
            { endDate: { gte: start } }
          ]
        }
      });

      if (overlapping) {
        return res.status(400).json({
          message: 'You already have an active leave or WFH request overlapping with the selected date range.'
        });
      }

      leave = await prisma.leaveRequest.create({
        data: {
          userId,
          startDate: start,
          endDate: end,
          totalDays,
          leaveType: normalizedType,
          type: normalizedType === 'WFH' ? 'WFH' : 'LEAVE',
          payType: determinedPayType,
          reason: reason || 'Leave Application',
          letterContent: letterContent || reason,
          contactPhone: contactPhone || null,
          submittedTeamId,
          submittedTeamLeaderId,
          status: initialStatus,
          tlApprovalStatus,
          adminApprovalStatus: 'PENDING'
        }
      });
    }

    await logActivity({
      userId,
      action: 'LEAVE_SUBMIT',
      details: `Applied for ${normalizedType} (${totalDays} days) from ${startDate} to ${endDate}`
    });

    // 7-Stage Notification System Trigger (Step 1 & 2)
    // 1. Notify Applicant
    await createNotification({
      userId,
      title: 'Leave Request Submitted',
      message: 'Leave request submitted successfully.',
      type: 'LEAVE_SUBMITTED_SELF'
    });

    // 2. Notify Approvers based on hierarchy
    if (initialStatus === 'PENDING_TL_APPROVAL' && submittedTeamLeaderId) {
      await createNotification({
        userId: submittedTeamLeaderId,
        title: 'New Leave Request Pending Approval',
        message: `New leave request requires your approval (${req.user.name} - ${normalizedType}, ${totalDays} days).`,
        type: 'LEAVE_SUBMITTED_TL'
      });
    } else {
      const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
      for (const admin of admins) {
        await createNotification({
          userId: admin.id,
          title: 'Leave Request Awaiting Final Approval',
          message: `Leave request awaiting final approval (${req.user.name} - ${normalizedType}, ${totalDays} days).`,
          type: 'LEAVE_SUBMITTED_ADMIN'
        });
      }
    }

    res.status(201).json(leave);
  } catch (error) {
    console.error('Apply leave error:', error);
    res.status(error.statusCode || 500).json({ message: error.message || 'Failed to apply for leave.' });
  }
};

// 4. Team Leader Approval (Step 1)
const approveLeaveTL = async (req, res) => {
  try {
    const { id } = req.params;
    const { remarks } = req.body;
    const userRole = req.user.role;
    const userId = req.user.id;

    if (userRole !== 'TEAM_LEADER' && userRole !== 'ADMIN') {
      return res.status(403).json({ message: 'Only Team Leaders or Admins can perform initial review.' });
    }

    const leave = await prisma.leaveRequest.findUnique({
      where: { id },
      include: { user: true }
    });

    if (!leave) {
      return res.status(404).json({ message: 'Leave request not found.' });
    }

    if (leave.status !== 'PENDING_TL_APPROVAL') {
      return res.status(400).json({ message: 'This request is not pending Team Leader review.' });
    }

    // Permission check: Must be assigned Team Leader at submission time or current team leader
    if (userRole === 'TEAM_LEADER') {
      if (leave.userId === userId) {
        return res.status(403).json({ message: 'Team Leaders cannot approve their own leave request.' });
      }
      if (leave.user.role === 'TEAM_LEADER') {
        return res.status(403).json({ message: 'Team Leaders cannot approve another Team Leader’s leave.' });
      }
      if (leave.submittedTeamLeaderId && leave.submittedTeamLeaderId !== userId) {
        return res.status(403).json({ message: 'You can only approve leave requests for your assigned team members.' });
      }
    }

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: {
        tlApprovalStatus: 'APPROVED',
        tlApprovedById: userId,
        tlApprovedAt: new Date(),
        tlRemarks: remarks || 'Approved by Team Leader',
        status: 'PENDING_ADMIN_APPROVAL'
      }
    });

    // 7-Stage Notification System Trigger (Step 3 & 4)
    // 3. Notify Employee
    await createNotification({
      userId: leave.userId,
      title: 'Leave Request Approved by Team Leader',
      message: 'Approved by Team Leader. Waiting for Admin approval.',
      type: 'LEAVE_TL_APPROVED'
    });

    // 4. Notify Admins
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    for (const admin of admins) {
      await createNotification({
        userId: admin.id,
        title: 'Leave Request Awaiting Final Approval',
        message: `Leave request for ${leave.user.name} approved by TL and awaiting final approval.`,
        type: 'LEAVE_FORWARDED_ADMIN'
      });
    }

    await logActivity({
      userId,
      action: 'LEAVE_TL_APPROVE',
      details: `Team Leader approved leave for ${leave.user.name}. Remarks: "${remarks || 'None'}"`
    });

    res.json(updated);
  } catch (error) {
    console.error('TL approve leave error:', error);
    res.status(500).json({ message: 'Failed to approve leave request.' });
  }
};

// 5. Admin Final Approval (Step 2 - Final Sanction & Attendance Auto-Sync)
const approveLeaveAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { remarks } = req.body;
    const userRole = req.user.role;
    const userId = req.user.id;

    if (userRole === 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Super Admin is strictly read-only and cannot approve leave requests.' });
    }

    if (userRole !== 'ADMIN') {
      return res.status(403).json({ message: 'Only Administrators can perform final leave sanction.' });
    }

    const { getEffectiveOrgId } = require('../utils/organizationScope');
    const effectiveOrgId = getEffectiveOrgId(req);

    // Atomically execute Admin approval, credit consumption, and attendance synchronization
    const { updated, leave } = await prisma.$transaction(async (tx) => {
      const targetLeave = await tx.leaveRequest.findUnique({
        where: { id },
        include: { user: true }
      });

      if (!targetLeave) {
        const err = new Error('Leave request not found.');
        err.statusCode = 404;
        throw err;
      }

      // Tenant isolation guard
      if (effectiveOrgId && targetLeave.user?.organizationId !== effectiveOrgId) {
        const err = new Error('Unauthorized organization scope.');
        err.statusCode = 403;
        throw err;
      }

      // Strict Admin Queue: Admin acts ONLY on PENDING_ADMIN_APPROVAL
      if (targetLeave.status !== 'PENDING_ADMIN_APPROVAL') {
        const err = new Error('Leave request is not pending final Admin approval.');
        err.statusCode = 400;
        throw err;
      }

      const leaveType = (targetLeave.leaveType || targetLeave.type || 'CASUAL').toUpperCase();

      // 1. If COMP_OFF: execute transactional FIFO credit consumption
      if (leaveType === 'COMP_OFF') {
        const compOffService = require('../services/compOffService');
        await compOffService.consumeCompOffCreditsFIFO({
          leaveRequestId: targetLeave.id,
          userId: targetLeave.userId,
          daysToConsume: targetLeave.totalDays || 1.0,
          organizationId: targetLeave.user?.organizationId,
          txClient: tx
        });

        // Synchronize UserLeaveBalance for COMP_OFF inside tx
        const allLeaveTypes = await tx.leaveType.findMany({ where: { isActive: true } });
        const matchedType = allLeaveTypes.find(
          lt => lt.code.toUpperCase() === 'COMP_OFF' || lt.name.toUpperCase() === 'COMP_OFF'
        );
        if (matchedType) {
          const userBal = await tx.userLeaveBalance.findUnique({
            where: {
              userId_leaveTypeId: {
                userId: targetLeave.userId,
                leaveTypeId: matchedType.id
              }
            }
          });
          if (userBal) {
            const compOffLedger = await compOffService.getUserCompOffLedgerBalance(targetLeave.userId, new Date(), tx);
            await tx.userLeaveBalance.update({
              where: { id: userBal.id },
              data: {
                allocated: 0,
                used: compOffLedger.totalUsed,
                available: compOffLedger.netAvailable
              }
            });
          }
        }
      } else if (leaveType !== 'WFH' && targetLeave.payType !== 'UNPAID') {
        // Normal leave type: update UserLeaveBalance
        const allLeaveTypes = await tx.leaveType.findMany({ where: { isActive: true } });
        const matchedType = allLeaveTypes.find(
          lt => lt.code.toUpperCase() === leaveType || lt.name.toUpperCase() === leaveType
        );
        if (matchedType) {
          const userBal = await tx.userLeaveBalance.findUnique({
            where: {
              userId_leaveTypeId: {
                userId: targetLeave.userId,
                leaveTypeId: matchedType.id
              }
            }
          });
          if (userBal) {
            const leaveDays = targetLeave.totalDays || 1.0;
            const newUsed = userBal.used + leaveDays;
            const newAvailable = Math.max(0, userBal.available - leaveDays);
            await tx.userLeaveBalance.update({
              where: { id: userBal.id },
              data: { used: newUsed, available: newAvailable }
            });
          }
        }
      }

      // 2. Mark LeaveRequest as APPROVED
      const updatedLeave = await tx.leaveRequest.update({
        where: { id },
        data: {
          adminApprovalStatus: 'APPROVED',
          adminApprovedById: userId,
          adminApprovedAt: new Date(),
          adminRemarks: remarks || 'Sanctioned by Admin',
          status: 'APPROVED'
        }
      });

      // 3. Attendance Integration
      const attendanceStatus = leaveType === 'WFH' ? 'WORK_FROM_HOME' : 'LEAVE';
      const start = new Date(targetLeave.startDate);
      const end = new Date(targetLeave.endDate);
      let curr = new Date(start);

      while (curr <= end) {
        const localDateStr = curr.toLocaleDateString('en-CA');
        const targetDate = new Date(localDateStr + 'T00:00:00.000Z');

        const existing = await tx.attendance.findUnique({
          where: {
            userId_date: {
              userId: targetLeave.userId,
              date: targetDate
            }
          }
        });

        if (existing) {
          await tx.attendance.update({
            where: { id: existing.id },
            data: {
              status: attendanceStatus,
              workingHours: attendanceStatus === 'WORK_FROM_HOME' ? 8.0 : 0,
              editedBy: userId
            }
          });
        } else {
          await tx.attendance.create({
            data: {
              userId: targetLeave.userId,
              date: targetDate,
              clockIn: attendanceStatus === 'LEAVE' ? null : targetDate,
              clockOut: attendanceStatus === 'LEAVE' ? null : targetDate,
              status: attendanceStatus,
              workingHours: attendanceStatus === 'WORK_FROM_HOME' ? 8.0 : 0,
              clockInLocation: attendanceStatus === 'WORK_FROM_HOME' ? 'Work From Home (Approved)' : 'Approved Leave Period'
            }
          });
        }

        curr.setDate(curr.getDate() + 1);
      }

      return { updated: updatedLeave, leave: targetLeave };
    });

    // 7-Stage Notification System Trigger (Step 5)
    await createNotification({
      userId: leave.userId,
      title: 'Leave Request Approved',
      message: 'Your leave has been approved.',
      type: 'LEAVE_APPROVED'
    });

    if (leave.user?.organizationId) {
      broadcastLeavePolicyUpdate(leave.user.organizationId);
    }

    const leaveType = (leave.leaveType || leave.type || 'CASUAL').toUpperCase();
    await logActivity({
      userId,
      organizationId: leave.user?.organizationId,
      action: 'LEAVE_ADMIN_APPROVE',
      details: `Admin final sanctioned ${leaveType} leave for ${leave.user?.name}. Remarks: "${remarks || 'None'}"`,
      req
    });

    res.json(updated);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('Admin approve leave error:', error);
    res.status(500).json({ message: 'Failed to perform final leave sanction.' });
  }
};

// 6. Reject Leave Request
const rejectLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const { remarks } = req.body;
    const userRole = req.user.role;
    const userId = req.user.id;

    if (userRole === 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Super Admin is strictly read-only and cannot reject leave requests.' });
    }

    if (userRole !== 'ADMIN' && userRole !== 'TEAM_LEADER') {
      return res.status(403).json({ message: 'Insufficient permissions to reject leave.' });
    }

    const leave = await prisma.leaveRequest.findUnique({
      where: { id },
      include: { user: true }
    });

    if (!leave) {
      return res.status(404).json({ message: 'Leave request not found.' });
    }

    let updated = null;

    if (leave.status === 'PENDING_TL_APPROVAL') {
      if (userRole !== 'TEAM_LEADER' && userRole !== 'ADMIN') {
        return res.status(403).json({ message: 'Only Team Leaders or Admins can decline at this stage.' });
      }

      updated = await prisma.leaveRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          tlApprovalStatus: 'REJECTED',
          tlApprovedById: userId,
          tlApprovedAt: new Date(),
          tlRemarks: remarks || 'Declined by Team Leader'
        }
      });

      // 7-Stage Notification System Trigger (Step 7: TL Rejects)
      await createNotification({
        userId: leave.userId,
        title: 'Leave Request Rejected',
        message: 'Your leave has been rejected by your Team Leader.',
        type: 'LEAVE_REJECTED_TL'
      });

      await logActivity({
        userId,
        action: 'LEAVE_REJECT',
        details: `Team Leader declined leave for ${leave.user.name}. Remarks: "${remarks || 'None'}"`
      });
    } else if (leave.status === 'PENDING_ADMIN_APPROVAL') {
      if (userRole !== 'ADMIN') {
        return res.status(403).json({ message: 'Only Administrators can decline at this stage.' });
      }

      updated = await prisma.leaveRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          adminApprovalStatus: 'REJECTED',
          adminApprovedById: userId,
          adminApprovedAt: new Date(),
          adminRemarks: remarks || 'Declined by Admin'
        }
      });

      // 7-Stage Notification System Trigger (Step 6: Admin Rejects)
      await createNotification({
        userId: leave.userId,
        title: 'Leave Request Rejected',
        message: 'Your leave has been rejected.',
        type: 'LEAVE_REJECTED_ADMIN'
      });

      await logActivity({
        userId,
        action: 'LEAVE_REJECT',
        details: `Admin declined leave for ${leave.user.name}. Remarks: "${remarks || 'None'}"`
      });
    } else {
      return res.status(400).json({ message: 'Only pending leave requests can be rejected.' });
    }

    res.json(updated);
  } catch (error) {
    console.error('Reject leave error:', error);
    res.status(500).json({ message: 'Failed to reject leave request.' });
  }
};

// 7. Cancel Leave Request (Applicant while pending, Admin can cancel approved leave)
const cancelLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;
    const effectiveOrgId = req.user.organizationId;

    const leave = await prisma.leaveRequest.findUnique({
      where: { id },
      include: { user: true }
    });
    if (!leave) {
      return res.status(404).json({ message: 'Leave request not found.' });
    }

    // Tenant isolation guard
    if (effectiveOrgId && leave.user?.organizationId !== effectiveOrgId) {
      return res.status(403).json({ message: 'Unauthorized organization scope.' });
    }

    if (leave.status === 'CANCELLED') {
      return res.status(400).json({ message: 'Leave request is already cancelled.' });
    }

    if (leave.status === 'REJECTED') {
      return res.status(400).json({ message: 'Rejected leave requests cannot be cancelled.' });
    }

    // Cancellation of APPROVED leave: Admin only
    if (leave.status === 'APPROVED') {
      if (userRole !== 'ADMIN') {
        return res.status(400).json({ message: 'Once approved or finalized, leave requests cannot be cancelled by employees.' });
      }

      // Admin cancels approved leave atomically
      const { updated } = await prisma.$transaction(async (tx) => {
        const cancelledLeave = await tx.leaveRequest.update({
          where: { id },
          data: { status: 'CANCELLED' }
        });

        const leaveType = (leave.leaveType || leave.type || 'CASUAL').toUpperCase();

        if (leaveType === 'COMP_OFF') {
          const compOffService = require('../services/compOffService');
          await compOffService.restoreCompOffCreditConsumption({
            leaveRequestId: leave.id,
            organizationId: leave.user?.organizationId,
            txClient: tx,
            adminUserId: userId
          });

          // Sync UserLeaveBalance
          const allLeaveTypes = await tx.leaveType.findMany({ where: { isActive: true } });
          const matchedType = allLeaveTypes.find(
            lt => lt.code.toUpperCase() === 'COMP_OFF' || lt.name.toUpperCase() === 'COMP_OFF'
          );
          if (matchedType) {
            const userBal = await tx.userLeaveBalance.findUnique({
              where: {
                userId_leaveTypeId: {
                  userId: leave.userId,
                  leaveTypeId: matchedType.id
                }
              }
            });
            if (userBal) {
              const compOffLedger = await compOffService.getUserCompOffLedgerBalance(leave.userId, new Date(), tx);
              await tx.userLeaveBalance.update({
                where: { id: userBal.id },
                data: {
                  allocated: 0,
                  used: compOffLedger.totalUsed,
                  available: compOffLedger.netAvailable
                }
              });
            }
          }
        } else if (leaveType !== 'WFH' && leave.payType !== 'UNPAID') {
          // Normal leave: restore used balance
          const allLeaveTypes = await tx.leaveType.findMany({ where: { isActive: true } });
          const matchedType = allLeaveTypes.find(
            lt => lt.code.toUpperCase() === leaveType || lt.name.toUpperCase() === leaveType
          );
          if (matchedType) {
            const userBal = await tx.userLeaveBalance.findUnique({
              where: {
                userId_leaveTypeId: {
                  userId: leave.userId,
                  leaveTypeId: matchedType.id
                }
              }
            });
            if (userBal) {
              const leaveDays = leave.totalDays || 1.0;
              const newUsed = Math.max(0, userBal.used - leaveDays);
              const maxAvailable = userBal.allocated + userBal.carryForward;
              const newAvailable = Math.min(maxAvailable, userBal.available + leaveDays);
              await tx.userLeaveBalance.update({
                where: { id: userBal.id },
                data: {
                  used: newUsed,
                  available: newAvailable
                }
              });
            }
          }
        }

        // Clean up auto-generated attendance records for this approved period
        const start = new Date(leave.startDate);
        const end = new Date(leave.endDate);
        const startStr = start.toLocaleDateString('en-CA');
        const endStr = end.toLocaleDateString('en-CA');

        await tx.attendance.deleteMany({
          where: {
            userId: leave.userId,
            date: {
              gte: new Date(startStr + 'T00:00:00.000Z'),
              lte: new Date(endStr + 'T23:59:59.999Z')
            },
            clockInLocation: { in: ['Approved Leave Period', 'Work From Home (Approved)'] }
          }
        });

        return { updated: cancelledLeave };
      });

      await logActivity({
        userId,
        organizationId: leave.user?.organizationId,
        action: 'LEAVE_CANCEL_APPROVED',
        details: `Admin cancelled approved leave for ${leave.user?.name} (${leave.leaveType || leave.type})`,
        req
      });

      // Notify employee of cancellation and credit restoration
      const leaveTypeStr = (leave.leaveType || leave.type || 'LEAVE').toUpperCase();
      await createNotification({
        userId: leave.userId,
        title: 'Approved Leave Cancelled by Admin',
        message: `Your approved ${leaveTypeStr} leave (${leave.totalDays} day(s)) was cancelled by an administrator.${leaveTypeStr === 'COMP_OFF' ? ' Consumed Comp-Off credits have been restored.' : ''}`,
        type: 'LEAVE_CANCELLED_ADMIN'
      });

      return res.json(updated);
    }

    // Pending cancellation: Applicant only or Admin
    if (leave.userId !== userId && userRole !== 'ADMIN') {
      return res.status(403).json({ message: 'You can only cancel your own leave requests.' });
    }

    if (!['PENDING_TL_APPROVAL', 'PENDING_ADMIN_APPROVAL', 'PENDING'].includes(leave.status)) {
      return res.status(400).json({ message: 'Once approved or finalized, leave requests cannot be cancelled by employees.' });
    }

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });

    await logActivity({
      userId,
      organizationId: leave.user?.organizationId,
      action: 'LEAVE_CANCEL',
      details: `Cancelled pending leave request (${leave.leaveType || leave.type})`,
      req
    });

    res.json(updated);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('Cancel leave error:', error);
    res.status(500).json({ message: 'Failed to cancel leave request.' });
  }
};

// 8. Update Pending Leave Request (Applicant only - while pending)
const updateLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;
    const { startDate, endDate, leaveType, payType: inputPayType, type: altType, reason, letterContent, contactPhone, isHalfDay } = req.body;

    const leave = await prisma.leaveRequest.findUnique({
      where: { id },
      include: { user: true }
    });

    if (!leave) {
      return res.status(404).json({ message: 'Leave request not found.' });
    }

    if (leave.userId !== userId && userRole !== 'ADMIN') {
      return res.status(403).json({ message: 'You can only edit your own pending leave requests.' });
    }

    if (!['PENDING_TL_APPROVAL', 'PENDING_ADMIN_APPROVAL', 'PENDING'].includes(leave.status)) {
      return res.status(400).json({ message: 'Only pending leave requests can be edited.' });
    }

    const start = startDate ? new Date(startDate) : leave.startDate;
    const end = endDate ? new Date(endDate) : leave.endDate;

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ message: 'Invalid start or end date format.' });
    }

    if (start > end) {
      return res.status(400).json({ message: 'Start date must be before or equal to end date.' });
    }

    let totalDays = await calculateTotalDays(start, end, leave.userId, leave.user?.organizationId);
    if (isHalfDay) {
      totalDays = 0.5;
    }

    const rawType = leaveType || altType || leave.leaveType || 'CL';
    const allLeaveTypes = await prisma.leaveType.findMany({ where: { isActive: true } });
    const companyLeaveTypes = filterLeaveTypesForCompany(allLeaveTypes, leave.user?.organizationId);
    const matchedTypeObj = resolveLeaveType(rawType, companyLeaveTypes);

    if (!matchedTypeObj) {
      const rawUpper = String(rawType).trim().toUpperCase();
      if (rawUpper === 'WFH' || rawUpper === 'WORK_FROM_HOME') {
        return res.status(400).json({
          message: 'Work From Home (WFH) is not an active leave policy for your organization.'
        });
      }
      if (!['LOP', 'UNPAID', 'LOSS_OF_PAY', 'LOSS OF PAY'].includes(rawUpper)) {
        return res.status(400).json({
          message: `The selected leave type "${rawType}" is invalid or not available in your organization.`
        });
      }
    }

    const normalizedType = matchedTypeObj ? matchedTypeObj.code.toUpperCase() : String(rawType).toUpperCase();

    // Minimum advance notice validation for edits
    const minNoticeError = await validateMinNoticeDays(
      startDate || leave.startDate,
      matchedTypeObj?.minNoticeDays,
      matchedTypeObj?.name,
      leave.user?.organizationId
    );
    if (minNoticeError) {
      return res.status(400).json({ message: minNoticeError });
    }

    const determinedPayType = inputPayType
      ? (String(inputPayType).toUpperCase() === 'UNPAID' ? 'UNPAID' : 'PAID')
      : (['LOP', 'UNPAID', 'LOSS_OF_PAY'].includes(normalizedType) ? 'UNPAID' : (leave.payType || 'PAID'));

    // Check for overlaps excluding this leave
    const overlapping = await prisma.leaveRequest.findFirst({
      where: {
        userId: leave.userId,
        id: { not: id },
        status: { in: ['PENDING_TL_APPROVAL', 'PENDING_ADMIN_APPROVAL', 'APPROVED'] },
        AND: [
          { startDate: { lte: end } },
          { endDate: { gte: start } }
        ]
      }
    });

    if (overlapping) {
      return res.status(400).json({
        message: 'You already have an active leave or WFH request overlapping with the selected date range.'
      });
    }

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: {
        startDate: start,
        endDate: end,
        totalDays,
        leaveType: normalizedType,
        type: normalizedType === 'WFH' ? 'WFH' : 'LEAVE',
        payType: determinedPayType,
        reason: reason || leave.reason,
        letterContent: letterContent || reason || leave.letterContent,
        contactPhone: contactPhone !== undefined ? contactPhone : leave.contactPhone
      }
    });

    await logActivity({
      userId,
      action: 'LEAVE_EDIT',
      details: `Updated pending leave request (${normalizedType}, ${totalDays} days)`
    });

    res.json(updated);
  } catch (error) {
    console.error('Update leave error:', error);
    res.status(500).json({ message: 'Failed to update leave request.' });
  }
};

module.exports = {
  getLeaves,
  getLeaveBalances,
  applyLeave,
  updateLeave,
  approveLeaveTL,
  approveLeaveAdmin,
  rejectLeave,
  cancelLeave,
  calculateTotalDays
};
