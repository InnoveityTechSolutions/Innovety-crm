const prisma = require('../utils/db');
const shiftService = require('./shiftService');
const { getCompanyLeavePolicy, setCompanyLeavePolicy } = require('../utils/companyLeavePolicyStore');
const { getEffectiveSettings } = require('../utils/settingsResolver');
const { getSystemTimeZone, getTodayZonedDate, getZonedParts, evaluateAttendanceGeofence } = require('../utils/attendanceUtils');

const parseUserAgent = (userAgentString) => {
  if (!userAgentString) return { browser: 'Unknown', device: 'Unknown' };
  let browser = 'Unknown Browser';
  let device = 'Desktop';
  const ua = userAgentString.toLowerCase();
  if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('chrome') && !ua.includes('chromium')) browser = 'Chrome';
  else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'Safari';
  else if (ua.includes('edge') || ua.includes('edg')) browser = 'Edge';
  else if (ua.includes('opr') || ua.includes('opera')) browser = 'Opera';

  if (ua.includes('mobi') || ua.includes('android') || ua.includes('iphone')) device = 'Mobile';
  else if (ua.includes('ipad') || ua.includes('tablet')) device = 'Tablet';

  return { browser, device };
};

/**
 * InnovEity CRM — Comp-Off Service (Data Foundation & Business Logic)
 * 
 * Rules & Invariants:
 * 1. Eligible workdays: Weekly offs (Sunday or shift-scheduled off-days) and Company Holidays.
 * 2. Credit amount: strictly 0.5 (Half Day) or 1.0 (Full Day).
 * 3. Claim window: within 30 calendar days of the eligible work date.
 * 4. Default expiry: 90 days from work date, configurable per organization in Leave Policy.
 * 5. Balances are derived directly from the CompOffCredit ledger; never overwritten by static leave recalculation.
 */

const DEFAULT_VALIDITY_DAYS = 90;
const DEFAULT_CLAIM_WINDOW_DAYS = 30;

/**
 * 1. Validates credit amount (strictly 0.5 or 1.0)
 */
const validateCreditAmount = (creditDays) => {
  const days = parseFloat(creditDays);
  if (isNaN(days) || (days !== 0.5 && days !== 1.0)) {
    return {
      isValid: false,
      error: 'Invalid credit amount. Comp-Off credit must be exactly 0.5 (Half Day) or 1.0 (Full Day).'
    };
  }
  return { isValid: true, creditDays: days };
};

/**
 * 2. Retrieves Comp-Off policy settings for an organization (with safe fallbacks)
 */
const getCompOffPolicySettings = async (organizationId = null) => {
  try {
    let policy = null;
    if (organizationId) {
      const orgSettings = await prisma.organizationSettings.findUnique({
        where: { organizationId },
        select: { leavePolicy: true }
      });
      const storePolicy = getCompanyLeavePolicy(organizationId);
      policy = orgSettings?.leavePolicy || storePolicy;
    }

    if (!policy) {
      policy = await prisma.leavePolicy.findFirst({ where: { isGlobal: true } });
    }

    const validityDays = (policy?.compOffValidityDays !== undefined && policy?.compOffValidityDays !== null)
      ? parseInt(policy.compOffValidityDays, 10)
      : DEFAULT_VALIDITY_DAYS;

    const claimWindowDays = (policy?.compOffClaimWindowDays !== undefined && policy?.compOffClaimWindowDays !== null)
      ? parseInt(policy.compOffClaimWindowDays, 10)
      : DEFAULT_CLAIM_WINDOW_DAYS;

    const claimWindowEnabled = policy?.compOffClaimWindowEnabled !== undefined && policy?.compOffClaimWindowEnabled !== null
      ? Boolean(policy.compOffClaimWindowEnabled)
      : true;

    return {
      validityDays: isNaN(validityDays) || validityDays <= 0 ? DEFAULT_VALIDITY_DAYS : validityDays,
      claimWindowDays: isNaN(claimWindowDays) || claimWindowDays <= 0 ? DEFAULT_CLAIM_WINDOW_DAYS : claimWindowDays,
      claimWindowEnabled
    };
  } catch (err) {
    console.warn('[compOffService] Failed to read compOff policy settings, using defaults:', err.message);
    return {
      validityDays: DEFAULT_VALIDITY_DAYS,
      claimWindowDays: DEFAULT_CLAIM_WINDOW_DAYS,
      claimWindowEnabled: true
    };
  }
};

/**
 * 3. Calculates credit expiration date based on approval/grant date and configured validity days
 */
const calculateExpiryDate = (baseDate, validityDays = DEFAULT_VALIDITY_DAYS) => {
  const dateObj = baseDate instanceof Date ? new Date(baseDate.getTime()) : new Date(baseDate);
  if (isNaN(dateObj.getTime())) {
    throw new Error('Invalid baseDate provided for expiry calculation.');
  }
  const expiry = new Date(dateObj.getTime());
  expiry.setDate(expiry.getDate() + validityDays);
  expiry.setHours(23, 59, 59, 999);
  return expiry;
};

/**
 * 4. Validates claim window (within 30 calendar days of work date; not in future)
 */
const validateClaimWindow = (workDate, claimWindowDays = DEFAULT_CLAIM_WINDOW_DAYS, referenceDate = new Date(), claimWindowEnabled = true) => {
  const work = workDate instanceof Date ? new Date(workDate.getTime()) : new Date(workDate);
  const ref = referenceDate instanceof Date ? new Date(referenceDate.getTime()) : new Date(referenceDate);

  if (isNaN(work.getTime()) || isNaN(ref.getTime())) {
    return { isValid: false, error: 'Invalid date format provided for claim window evaluation.' };
  }

  // Work date cannot be in the future (relative to referenceDate date string)
  const workDateStr = work.toISOString().split('T')[0];
  const refDateStr = ref.toISOString().split('T')[0];

  if (workDateStr > refDateStr) {
    return {
      isValid: false,
      error: 'Comp-Off cannot be claimed for future dates.'
    };
  }

  // Calculate elapsed calendar days
  const workMidnight = new Date(`${workDateStr}T00:00:00.000Z`);
  const refMidnight = new Date(`${refDateStr}T00:00:00.000Z`);
  const diffMs = refMidnight.getTime() - workMidnight.getTime();
  const elapsedDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // If retrospective claim window rule is disabled, no age cutoff applies!
  if (!claimWindowEnabled) {
    return {
      isValid: true,
      elapsedDays,
      claimWindowDays: null,
      claimWindowEnabled: false
    };
  }

  if (elapsedDays > claimWindowDays) {
    return {
      isValid: false,
      elapsedDays,
      claimWindowDays,
      claimWindowEnabled: true,
      error: `Claim window expired. Comp-Off claims must be submitted within ${claimWindowDays} calendar days of the work date (elapsed: ${elapsedDays} days).`
    };
  }

  return {
    isValid: true,
    elapsedDays,
    claimWindowDays,
    claimWindowEnabled: true
  };
};

/**
 * 5. Evaluates whether a given date is an eligible workday for Comp-Off:
 *    - Sunday (always Weekly Off)
 *    - Shift-scheduled Off-Day (via shiftService)
 *    - Company Holiday (via HolidayCalendar or WorkCalendar)
 */
const validateEligibleDay = async ({ userId, workDate, organizationId = null }) => {
  const dateObj = workDate instanceof Date ? new Date(workDate.getTime()) : new Date(workDate);
  if (isNaN(dateObj.getTime())) {
    return { isEligible: false, reason: 'INVALID_DATE', message: 'Invalid work date format.' };
  }

  const dateStr = dateObj.toISOString().split('T')[0];
  const dayName = shiftService.getDayName(dateObj);
  const isSunday = dateObj.getUTCDay() === 0 || dayName === 'SUNDAY';

  let eligibleReason = null;

  // 1. Sunday is always eligible
  if (isSunday) {
    eligibleReason = 'SUNDAY_WEEKLY_OFF';
  }

  // 2. Check Company Holidays (HolidayCalendar)
  if (!eligibleReason) {
    const holidayWhere = {
      date: new Date(`${dateStr}T00:00:00.000Z`)
    };
    if (organizationId) {
      holidayWhere.organizationId = organizationId;
    }
    const holiday = await prisma.holidayCalendar.findFirst({ where: holidayWhere });
    if (holiday && !holiday.isWorkingHoliday) {
      eligibleReason = `COMPANY_HOLIDAY: ${holiday.title}`;
    }
  }

  // 3. Check WorkCalendar operational overrides
  if (!eligibleReason) {
    const calendarOverride = await prisma.workCalendar.findFirst({
      where: {
        date: new Date(`${dateStr}T00:00:00.000Z`),
        status: 'HOLIDAY',
        ...(organizationId ? { organizationId } : {})
      }
    });
    if (calendarOverride) {
      eligibleReason = `WORK_CALENDAR_HOLIDAY: ${calendarOverride.title || 'Holiday'}`;
    }
  }

  // 4. Check User's Assigned Shift Off-Days (e.g. 2nd/4th Saturday or custom weekly off)
  if (!eligibleReason && userId) {
    const userShift = await shiftService.getEmployeeShift(userId, prisma, dateObj);
    const shiftStatus = shiftService.getShiftDayStatus(userShift, dayName, dateObj);
    if (shiftStatus === 'Holiday') {
      eligibleReason = userShift?.isSaturdayLeave ? 'SATURDAY_LEAVE' : `SHIFT_SCHEDULED_OFF_DAY: ${dayName}`;
    }
  }

  if (eligibleReason) {
    return {
      isEligible: true,
      eligibleReason,
      dateStr,
      dayName
    };
  }

  return {
    isEligible: false,
    reason: 'NOT_AN_OFF_DAY',
    message: `${dateStr} (${dayName}) is a regular scheduled working day. Comp-Off can only be earned on weekly offs or company holidays.`,
    dateStr,
    dayName
  };
};

/**
 * 6. Checks for existing Comp-Off credit for the given user and date
 */
const checkExistingCredit = async (userId, workDate) => {
  const dateStr = workDate instanceof Date ? workDate.toISOString().split('T')[0] : String(workDate).split('T')[0];
  const targetDate = new Date(`${dateStr}T00:00:00.000Z`);

  return await prisma.compOffCredit.findUnique({
    where: {
      userId_workDate: {
        userId,
        workDate: targetDate
      }
    }
  });
};

/**
 * 7. Gathers attendance evidence for the work date if present
 */
const getWorkEvidence = async ({ userId, workDate }) => {
  const dateStr = workDate instanceof Date ? workDate.toISOString().split('T')[0] : String(workDate).split('T')[0];
  const targetDate = new Date(`${dateStr}T00:00:00.000Z`);

  const record = await prisma.attendance.findUnique({
    where: {
      userId_date: {
        userId,
        date: targetDate
      }
    },
    include: {
      attendanceLocation: { select: { id: true, name: true, address: true } }
    }
  });

  if (!record) {
    return { hasAttendance: false, record: null };
  }

  return {
    hasAttendance: true,
    record: {
      id: record.id,
      date: record.date,
      clockIn: record.clockIn,
      clockOut: record.clockOut,
      workingHours: record.workingHours,
      status: record.status,
      workLocation: record.workLocation,
      locationName: record.attendanceLocation?.name || record.clockInLocation || 'Office',
      isVerifiedGeofence: Boolean(record.attendanceLocationId)
    }
  };
};

/**
 * 8. Derives live Comp-Off balance for a user strictly from the CompOffCredit ledger.
 *    Separated from ordinary UserLeaveBalance.allocated.
 */
const getUserCompOffLedgerBalance = async (userId, referenceDate = new Date(), txClient = prisma) => {
  let now = new Date();
  if (referenceDate instanceof Date && !isNaN(referenceDate.getTime())) {
    now = referenceDate;
  } else if (typeof referenceDate === 'string' && !isNaN(new Date(referenceDate).getTime()) && (referenceDate.includes('-') || referenceDate.includes('/'))) {
    now = new Date(referenceDate);
  }

  // Active unexpired credits with available balance
  const activeCredits = await txClient.compOffCredit.findMany({
    where: {
      userId,
      status: 'APPROVED',
      availableDays: { gt: 0 },
      expiresAt: { gte: now }
    },
    orderBy: [
      { expiresAt: 'asc' },
      { earnedAt: 'asc' },
      { id: 'asc' }
    ] // FIFO order: earliest expiring credit first, deterministic tie-breakers
  });

  // All authorized credits for historical totals (exclude pending and rejected)
  const allUserCredits = await txClient.compOffCredit.findMany({
    where: {
      userId,
      status: { in: ['APPROVED', 'EXHAUSTED', 'EXPIRED'] }
    }
  });

  const totalEarned = allUserCredits.reduce((sum, c) => sum + (c.creditDays || 0), 0);
  const totalUsed = allUserCredits.reduce((sum, c) => sum + (c.usedDays || 0), 0);
  const totalAvailable = activeCredits.reduce((sum, c) => sum + (c.availableDays || 0), 0);

  // Check pending LeaveRequests for COMP_OFF (pending reservations)
  const pendingRequests = await txClient.leaveRequest.findMany({
    where: {
      userId,
      leaveType: 'COMP_OFF',
      status: { in: ['PENDING', 'PENDING_TL_APPROVAL', 'PENDING_ADMIN_APPROVAL'] }
    }
  });

  const pendingDays = pendingRequests.reduce((sum, r) => sum + (parseFloat(r.totalDays) || 0), 0);
  const netAvailable = Math.max(0, Math.round((totalAvailable - pendingDays) * 100) / 100);

  return {
    userId,
    totalEarned: Math.round(totalEarned * 100) / 100,
    totalUsed: Math.round(totalUsed * 100) / 100,
    totalAvailable: Math.round(totalAvailable * 100) / 100,
    pendingDays: Math.round(pendingDays * 100) / 100,
    netAvailable,
    activeCreditsCount: activeCredits.length,
    activeCredits
  };
};

/**
 * 9. Ensures the system COMP_OFF LeaveType exists idempotently
 */
const ensureCompOffLeaveType = async () => {
  try {
    const existing = await prisma.leaveType.findFirst({
      where: {
        OR: [
          { code: 'COMP_OFF' },
          { name: 'Compensatory Off' }
        ]
      }
    });

    if (existing) {
      if (!existing.isSystem) {
        await prisma.leaveType.update({
          where: { id: existing.id },
          data: { isSystem: true, isActive: true }
        });
      }
      return existing;
    }

    return await prisma.leaveType.create({
      data: {
        name: 'Compensatory Off',
        code: 'COMP_OFF',
        description: 'Compensatory off earned by working on weekly offs or company holidays',
        color: '#8B5CF6', // Purple/Violet
        icon: 'Clock',
        displayOrder: 4,
        isPaid: true,
        annualDays: 0,
        monthlyCreditDays: 0,
        allowCarryForward: false,
        requireDoc: false,
        allowHalfDay: true,
        isSystem: true,
        isActive: true
      }
    });
  } catch (err) {
    console.warn('[compOffService] Failed to ensure COMP_OFF leave type:', err.message);
    return null;
  }
};

/**
 * 10. Validates attendance record for genuine, verifiable work evidence
 */
const validateWorkEvidence = (record) => {
  if (!record) {
    return {
      isValid: false,
      reason: 'NO_ATTENDANCE_RECORD',
      message: 'No attendance record found for this employee on the specified work date.'
    };
  }

  // Attendance status must not be absent, on leave, or missed
  const invalidStatuses = ['ABSENT', 'LEAVE', 'MISSED'];
  if (invalidStatuses.includes(record.status)) {
    return {
      isValid: false,
      reason: 'INVALID_ATTENDANCE_STATUS',
      message: `Attendance record status is ${record.status}, which does not qualify as work performed.`
    };
  }

  // Must have a clock-in timestamp
  if (!record.clockIn) {
    return {
      isValid: false,
      reason: 'MISSING_CLOCK_IN',
      message: 'Attendance record does not contain a clock-in timestamp.'
    };
  }

  // Working hours check: must either have workingHours > 0, or clockOut > clockIn, or verified geofence location
  const hasHours = typeof record.workingHours === 'number' && record.workingHours > 0;
  const hasClockOut = record.clockOut && (new Date(record.clockOut).getTime() > new Date(record.clockIn).getTime());
  const hasGeofence = Boolean(record.attendanceLocationId) || (record.clockInLatitude !== null && record.clockInLongitude !== null);

  if (!hasHours && !hasClockOut && !hasGeofence) {
    return {
      isValid: false,
      reason: 'INSUFFICIENT_WORK_HOURS',
      message: 'Attendance record contains zero working hours and no verified clock-out or geofence evidence.'
    };
  }

  return {
    isValid: true,
    record,
    summary: {
      status: record.status,
      clockIn: record.clockIn,
      clockOut: record.clockOut,
      workingHours: record.workingHours,
      location: record.attendanceLocation?.name || record.workLocation || 'Office',
      isVerifiedGeofence: Boolean(record.attendanceLocationId)
    }
  };
};

/**
 * 11. Pre-flight verification for Comp-Off authorization
 */
const verifyCompOffEligibility = async ({
  verifierUser,
  targetUserId,
  workDate,
  creditDays,
  organizationId,
  referenceDate = new Date(),
  txClient = prisma
}) => {
  // 1. Verifier Role Check
  if (verifierUser.role === 'SUPER_ADMIN') {
    return {
      allowed: false,
      statusCode: 403,
      error: 'Super Admin is strictly read-only and cannot authorize Comp-Off credits.'
    };
  }

  if (verifierUser.role !== 'ADMIN' && verifierUser.role !== 'TEAM_LEADER') {
    return {
      allowed: false,
      statusCode: 403,
      error: 'Only Administrators and authorized Team Leaders can verify or authorize Comp-Off credits.'
    };
  }

  // 2. Validate Target User
  if (!targetUserId) {
    return {
      allowed: false,
      statusCode: 400,
      error: 'Target employee userId is required.'
    };
  }

  const targetUser = await txClient.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, name: true, employeeId: true, role: true, organizationId: true, status: true, email: true }
  });

  if (!targetUser) {
    return {
      allowed: false,
      statusCode: 404,
      error: 'Target employee not found.'
    };
  }

  if (targetUser.organizationId !== organizationId) {
    return {
      allowed: false,
      statusCode: 403,
      error: 'Target employee does not belong to your organization.'
    };
  }

  if (targetUser.status && targetUser.status !== 'ACTIVE') {
    return {
      allowed: false,
      statusCode: 400,
      error: 'Target employee account is inactive.'
    };
  }

  // 3. Team Leader Role Restrictions
  if (verifierUser.role === 'TEAM_LEADER') {
    // Cannot authorize for self
    if (targetUserId === verifierUser.id) {
      return {
        allowed: false,
        statusCode: 403,
        error: 'Team Leaders cannot verify or authorize Comp-Off for themselves.'
      };
    }

    // Cannot authorize for another Team Leader
    if (targetUser.role === 'TEAM_LEADER') {
      return {
        allowed: false,
        statusCode: 403,
        error: 'Team Leaders cannot verify or authorize Comp-Off for another Team Leader.'
      };
    }

    // Cannot authorize for Admin / Super Admin
    if (targetUser.role === 'ADMIN' || targetUser.role === 'SUPER_ADMIN') {
      return {
        allowed: false,
        statusCode: 403,
        error: 'Cannot authorize Comp-Off for administrators.'
      };
    }

    // Must be assigned Team Leader of the employee
    const teamMembership = await txClient.teamMember.findFirst({
      where: {
        userId: targetUserId,
        team: {
          leaderId: verifierUser.id,
          organizationId
        }
      }
    });

    if (!teamMembership) {
      return {
        allowed: false,
        statusCode: 403,
        error: 'You can only verify or authorize Comp-Off for members of teams you lead.'
      };
    }
  }

  // 4. Validate Credit Amount (strictly 0.5 or 1.0)
  const amountValidation = validateCreditAmount(creditDays);
  if (!amountValidation.isValid) {
    return {
      allowed: false,
      statusCode: 400,
      error: amountValidation.error
    };
  }

  // 5. Validate Claim Window (within configured calendar days; not in future)
  const policy = await getCompOffPolicySettings(organizationId);
  const windowValidation = validateClaimWindow(workDate, policy.claimWindowDays, referenceDate, policy.claimWindowEnabled);
  if (!windowValidation.isValid) {
    return {
      allowed: false,
      statusCode: 400,
      error: windowValidation.error
    };
  }

  // 6. Validate Workday Eligibility (Sunday, Holiday, or Shift Off-day)
  const dateObj = workDate instanceof Date ? workDate : new Date(workDate);
  const dateStr = dateObj.toISOString().split('T')[0];
  const targetDate = new Date(`${dateStr}T00:00:00.000Z`);

  const dayValidation = await validateEligibleDay({
    userId: targetUserId,
    workDate: targetDate,
    organizationId
  });

  if (!dayValidation.isEligible) {
    return {
      allowed: false,
      statusCode: 400,
      error: dayValidation.message || `${dateStr} is a regular working day. Comp-Off can only be earned on weekly offs or company holidays.`
    };
  }

  // 7. Validate Attendance & Work Evidence
  const attendanceRecord = await txClient.attendance.findUnique({
    where: {
      userId_date: {
        userId: targetUserId,
        date: targetDate
      }
    },
    include: {
      attendanceLocation: { select: { id: true, name: true, address: true } }
    }
  });

  const evidenceValidation = validateWorkEvidence(attendanceRecord);
  if (!evidenceValidation.isValid) {
    return {
      allowed: false,
      statusCode: 400,
      error: evidenceValidation.message,
      missingEvidence: evidenceValidation.reason
    };
  }

  // 8. Prevent Duplicate Submissions (Check Unique Constraint)
  const existingCredit = await txClient.compOffCredit.findUnique({
    where: {
      userId_workDate: {
        userId: targetUserId,
        workDate: targetDate
      }
    }
  });

  if (existingCredit) {
    return {
      allowed: false,
      statusCode: 409,
      error: 'A Comp-Off credit already exists for this employee on this work date.',
      existingCredit
    };
  }

  // 9. Calculate Expiry Date (Policy-Driven Server Calculation)
  const expiresAt = calculateExpiryDate(targetDate, policy.validityDays);

  if (expiresAt <= referenceDate) {
    return {
      allowed: false,
      statusCode: 400,
      error: 'Calculated credit expiry date has already lapsed. Expired credits cannot be newly authorized.'
    };
  }

  return {
    allowed: true,
    targetUser,
    targetDate,
    creditDays: amountValidation.creditDays,
    attendanceRecord: evidenceValidation.record,
    expiresAt,
    validityDays: policy.validityDays,
    eligibleReason: dayValidation.eligibleReason
  };
};

/**
 * 12. Transaction-safe Comp-Off Authorization Helper
 */
const authorizeCreditInTransaction = async ({
  verifierUser,
  targetUserId,
  workDate,
  creditDays,
  remarks,
  organizationId,
  referenceDate = new Date(),
  txClient = prisma
}) => {
  const eligibility = await verifyCompOffEligibility({
    verifierUser,
    targetUserId,
    workDate,
    creditDays,
    organizationId,
    referenceDate,
    txClient
  });

  if (!eligibility.allowed) {
    const error = new Error(eligibility.error);
    error.statusCode = eligibility.statusCode || 400;
    error.missingEvidence = eligibility.missingEvidence;
    error.existingCredit = eligibility.existingCredit;
    throw error;
  }

  const isAdmin = verifierUser.role === 'ADMIN';
  const status = isAdmin ? 'APPROVED' : 'PENDING_ADMIN_APPROVAL';
  const availableDays = isAdmin ? eligibility.creditDays : 0.0;

  try {
    const credit = await txClient.compOffCredit.create({
      data: {
        organizationId,
        userId: targetUserId,
        workDate: eligibility.targetDate,
        attendanceId: eligibility.attendanceRecord?.id || null,
        creditDays: eligibility.creditDays,
        usedDays: 0.0,
        availableDays,
        status,
        reason: remarks || `Compensatory Off for work on ${eligibility.eligibleReason}`,
        claimedByRole: verifierUser.role,
        claimedById: verifierUser.id,
        tlApprovedById: verifierUser.role === 'TEAM_LEADER' ? verifierUser.id : null,
        tlApprovedAt: verifierUser.role === 'TEAM_LEADER' ? new Date() : null,
        tlRemarks: verifierUser.role === 'TEAM_LEADER' ? (remarks || 'Verified and recommended by Team Leader') : null,
        adminApprovedById: isAdmin ? verifierUser.id : null,
        adminApprovedAt: isAdmin ? new Date() : null,
        adminRemarks: isAdmin ? (remarks || 'Authorized by Admin') : null,
        expiresAt: eligibility.expiresAt
      },
      include: {
        user: { select: { id: true, name: true, employeeId: true, email: true, role: true } },
        attendance: { select: { id: true, date: true, clockIn: true, clockOut: true, workingHours: true, status: true } }
      }
    });

    return { credit, eligibility };
  } catch (err) {
    // Handle Prisma unique constraint violation (P2002)
    if (err.code === 'P2002') {
      const conflictError = new Error('A Comp-Off credit already exists for this employee on this work date.');
      conflictError.statusCode = 409;
      throw conflictError;
    }
    throw err;
  }
};

/**
 * 13. FIFO Credit Consumption Engine
 * Selects credits by earliest expiry first (earnedAt and id as deterministic tie-breakers).
 * Atomically updates usedDays, availableDays, lifecycle status, and records
 * consumption in CompOffConsumption.
 */
const consumeCompOffCreditsFIFO = async ({
  leaveRequestId,
  userId,
  daysToConsume,
  organizationId,
  txClient = prisma,
  referenceDate = new Date()
}) => {
  const amount = parseFloat(daysToConsume);
  if (isNaN(amount) || amount <= 0) {
    throw new Error('Invalid daysToConsume for Comp-Off consumption.');
  }

  const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);

  // 1. Fetch unexpired, active credits in deterministic FIFO order (earliest expiry first)
  // Uses locking read (FOR UPDATE) to bypass MySQL MVCC Repeatable Read snapshot and prevent concurrent overspend
  const rawEligibleCredits = await txClient.$queryRaw`
    SELECT id, organizationId, userId, workDate, attendanceId, creditDays, usedDays, availableDays, earnedAt, expiresAt, status, reason
    FROM compoffcredit
    WHERE userId = ${userId}
      AND status = 'APPROVED'
      AND availableDays > 0
      AND expiresAt >= ${now}
    ORDER BY expiresAt ASC, earnedAt ASC, id ASC
    FOR UPDATE
  `;

  const eligibleCredits = rawEligibleCredits.map(c => ({
    ...c,
    creditDays: parseFloat(c.creditDays) || 0,
    usedDays: parseFloat(c.usedDays) || 0,
    availableDays: parseFloat(c.availableDays) || 0
  }));

  const totalAvailable = eligibleCredits.reduce((sum, c) => sum + (c.availableDays || 0), 0);
  const roundedTotalAvailable = Math.round(totalAvailable * 100) / 100;

  if (roundedTotalAvailable < amount) {
    const error = new Error(
      `Insufficient available Comp-Off credits to approve this leave request. Required: ${amount} day(s), Available: ${roundedTotalAvailable} day(s).`
    );
    error.statusCode = 400;
    error.requiredDays = amount;
    error.availableDays = roundedTotalAvailable;
    throw error;
  }

  // 2. Consume across credits in FIFO order
  let remaining = amount;
  const consumptions = [];

  for (const credit of eligibleCredits) {
    if (remaining <= 0) break;

    const toDeduct = Math.min(credit.availableDays, remaining);
    const newAvailable = Math.round((credit.availableDays - toDeduct) * 100) / 100;
    const newUsed = Math.round((credit.usedDays + toDeduct) * 100) / 100;
    const newStatus = newAvailable === 0 ? 'EXHAUSTED' : 'APPROVED';

    await txClient.compOffCredit.update({
      where: { id: credit.id },
      data: {
        availableDays: newAvailable,
        usedDays: newUsed,
        status: newStatus
      }
    });

    const consumption = await txClient.compOffConsumption.create({
      data: {
        organizationId: organizationId || credit.organizationId,
        creditId: credit.id,
        leaveRequestId,
        userId,
        consumedDays: toDeduct,
        status: 'CONSUMED'
      }
    });

    consumptions.push(consumption);
    remaining = Math.round((remaining - toDeduct) * 100) / 100;
  }

  return {
    totalConsumed: amount,
    consumptions
  };
};

/**
 * 14. Reversal / Restoration of Consumed Comp-Off Credits
 * Restores credits consumed by an approved leave request that is cancelled.
 * Idempotent: checks status === 'CONSUMED' and marks restored.
 * Expiry-safe: does NOT make expired credits usable.
 */
const restoreCompOffCreditConsumption = async ({
  leaveRequestId,
  txClient = prisma,
  adminUserId = null,
  referenceDate = new Date()
}) => {
  const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);

  // Find all unreversed consumption records for this leave request
  const consumptions = await txClient.compOffConsumption.findMany({
    where: {
      leaveRequestId,
      status: 'CONSUMED'
    },
    include: {
      credit: true
    }
  });

  if (!consumptions || consumptions.length === 0) {
    return { restoredCount: 0, restoredDays: 0, consumptions: [] };
  }

  let totalRestoredDays = 0;
  const restoredRecords = [];

  for (const record of consumptions) {
    const credit = record.credit;
    if (!credit) continue;

    const daysToRestore = record.consumedDays;
    const isExpired = now > new Date(credit.expiresAt);

    // Reduce usedDays
    const newUsed = Math.max(0, Math.round((credit.usedDays - daysToRestore) * 100) / 100);

    let newAvailable;
    let newStatus;

    if (isExpired) {
      // Retain accurate historical accounting, but do not make expired portion usable
      newAvailable = credit.availableDays;
      newStatus = 'EXPIRED';
    } else {
      // Unexpired: restore availability
      newAvailable = Math.min(
        credit.creditDays,
        Math.round((credit.availableDays + daysToRestore) * 100) / 100
      );
      newStatus = 'APPROVED';
    }

    await txClient.compOffCredit.update({
      where: { id: credit.id },
      data: {
        usedDays: newUsed,
        availableDays: newAvailable,
        status: newStatus
      }
    });

    const updatedConsumption = await txClient.compOffConsumption.update({
      where: { id: record.id },
      data: {
        status: 'RESTORED',
        restoredAt: now,
        restoredById: adminUserId
      }
    });

    restoredRecords.push(updatedConsumption);
    totalRestoredDays += daysToRestore;
  }

  return {
    restoredCount: restoredRecords.length,
    restoredDays: Math.round(totalRestoredDays * 100) / 100,
    consumptions: restoredRecords
  };
};

/**
 * 15. Safe Expiry Processing Engine
 * Transitions eligible ledger records to EXPIRED when validity window passes.
 * Partially consumed credits expire remaining available days while preserving
 * usedDays and creditDays.
 * Idempotent.
 */
const processExpiredCompOffCredits = async ({
  organizationId = null,
  referenceDate = new Date(),
  txClient = prisma
} = {}) => {
  const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);

  const where = {
    expiresAt: { lt: now },
    status: { in: ['APPROVED', 'PENDING_ADMIN_APPROVAL'] },
    availableDays: { gt: 0 }
  };

  if (organizationId) {
    where.organizationId = organizationId;
  }

  const expiredCredits = await txClient.compOffCredit.findMany({ where });

  if (!expiredCredits || expiredCredits.length === 0) {
    return { expiredCount: 0, expiredCredits: [] };
  }

  const updatedCredits = [];
  for (const credit of expiredCredits) {
    const updated = await txClient.compOffCredit.update({
      where: { id: credit.id },
      data: {
        status: 'EXPIRED',
        availableDays: 0.0
      }
    });
    updatedCredits.push(updated);
  }

  return {
    expiredCount: updatedCredits.length,
    expiredCredits: updatedCredits
  };
};

/**
 * 18. Create Advance Permission Request to work on a future holiday or weekly off
 */
const createCompOffPermissionRequest = async ({
  organizationId,
  userId,
  workDate,
  reason
}) => {
  if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
    const err = new Error('A detailed reason (at least 5 characters) is required for advance permission requests.');
    err.statusCode = 400;
    throw err;
  }

  const dateObj = workDate instanceof Date ? new Date(workDate.getTime()) : new Date(workDate);
  if (isNaN(dateObj.getTime())) {
    const err = new Error('Invalid workDate format. Use YYYY-MM-DD.');
    err.statusCode = 400;
    throw err;
  }

  const dateStr = dateObj.toISOString().split('T')[0];
  const targetDate = new Date(`${dateStr}T00:00:00.000Z`);

  // 1. Must be a strictly future date (relative to today)
  const todayStr = new Date().toISOString().split('T')[0];
  if (dateStr <= todayStr) {
    const err = new Error(`Advance permission can only be requested for future dates. Selected date (${dateStr}) is in the past or today.`);
    err.statusCode = 400;
    throw err;
  }

  // 2. Validate Off-Day Eligibility (must be a Sunday, Holiday, or Shift Off-Day)
  const dayValidation = await validateEligibleDay({
    userId,
    workDate: targetDate,
    organizationId
  });

  if (!dayValidation.isEligible) {
    const err = new Error(dayValidation.message || `${dateStr} (${dayValidation.dayName}) is an ordinary scheduled working day. Advance permission can only be requested for company holidays or weekly offs.`);
    err.statusCode = 400;
    throw err;
  }

  // 3. Prevent Duplicate Requests for same user and date
  const existing = await prisma.compOffPermissionRequest.findUnique({
    where: {
      userId_workDate: {
        userId,
        workDate: targetDate
      }
    }
  });

  if (existing) {
    if (existing.status === 'PENDING') {
      const err = new Error(`An advance permission request for ${dateStr} is already pending approval.`);
      err.statusCode = 409;
      throw err;
    }
    if (existing.status === 'APPROVED') {
      const err = new Error(`You already have approved advance permission to work on ${dateStr}.`);
      err.statusCode = 409;
      throw err;
    }
    // If previously REJECTED, update existing request to PENDING with new reason
    const updated = await prisma.compOffPermissionRequest.update({
      where: { id: existing.id },
      data: {
        reason: reason.trim(),
        holidayType: dayValidation.eligibleReason.includes('HOLIDAY') ? 'COMPANY_HOLIDAY' : 'WEEKLY_OFF',
        status: 'PENDING',
        approvedById: null,
        approvedAt: null,
        rejectionReason: null,
        adminRemarks: null
      },
      include: {
        user: { select: { id: true, name: true, employeeId: true, email: true, role: true } }
      }
    });

    return updated;
  }

  const holidayType = dayValidation.eligibleReason.includes('HOLIDAY') ? 'COMPANY_HOLIDAY' : 'WEEKLY_OFF';

  const request = await prisma.compOffPermissionRequest.create({
    data: {
      organizationId,
      userId,
      workDate: targetDate,
      holidayType,
      reason: reason.trim(),
      status: 'PENDING'
    },
    include: {
      user: { select: { id: true, name: true, employeeId: true, email: true, role: true } }
    }
  });

  return request;
};

/**
 * 19. Retrieve advance permission requests with role & tenant scoping
 */
const getCompOffPermissionRequests = async ({
  organizationId,
  userRole,
  currentUserId,
  targetUserId,
  status,
  limit = 100,
  offset = 0
}) => {
  const where = { organizationId };

  if (userRole === 'EMPLOYEE' || userRole === 'INTERN') {
    where.userId = currentUserId; // strictly self-only
  } else if (userRole === 'TEAM_LEADER') {
    if (targetUserId && targetUserId !== currentUserId) {
      // Must lead this user's team
      const membership = await prisma.teamMember.findFirst({
        where: {
          userId: targetUserId,
          team: { leaderId: currentUserId, organizationId }
        }
      });
      if (!membership) {
        const err = new Error('You can only view advance permission requests for members of teams you lead.');
        err.statusCode = 403;
        throw err;
      }
      where.userId = targetUserId;
    } else if (!targetUserId) {
      // Find all team members led by this TL + self
      const ledTeams = await prisma.team.findMany({
        where: { leaderId: currentUserId, organizationId },
        select: { members: { select: { userId: true } } }
      });
      const memberIds = new Set([currentUserId]);
      ledTeams.forEach(t => t.members.forEach(m => memberIds.add(m.userId)));
      where.userId = { in: Array.from(memberIds) };
    }
  } else if (targetUserId) {
    where.userId = targetUserId;
  }

  if (status && status !== 'ALL') {
    where.status = status;
  }

  const [total, requests] = await Promise.all([
    prisma.compOffPermissionRequest.count({ where }),
    prisma.compOffPermissionRequest.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            employeeId: true,
            email: true,
            role: true,
            department: true,
            departmentRef: { select: { id: true, name: true } }
          }
        },
        approvedBy: {
          select: {
            id: true,
            name: true,
            employeeId: true,
            email: true,
            role: true
          }
        }
      },
      orderBy: [{ workDate: 'asc' }, { createdAt: 'desc' }],
      take: parseInt(limit, 10),
      skip: parseInt(offset, 10)
    })
  ]);

  return { total, requests };
};

/**
 * 20. Admin Review of advance permission request (Approve or Reject)
 * Grants advance permission to work. DOES NOT CREATE COMP-OFF CREDITS.
 */
const reviewCompOffPermissionRequest = async ({
  requestId,
  reviewerUser,
  action,
  remarks,
  rejectionReason,
  organizationId
}) => {
  if (reviewerUser.role === 'SUPER_ADMIN') {
    const err = new Error('Super Admin is strictly read-only and cannot approve or reject advance permission requests.');
    err.statusCode = 403;
    throw err;
  }

  if (reviewerUser.role !== 'ADMIN') {
    const err = new Error('Only administrators can approve or reject advance permission requests.');
    err.statusCode = 403;
    throw err;
  }

  const request = await prisma.compOffPermissionRequest.findUnique({
    where: { id: requestId },
    include: { user: true }
  });

  if (!request || request.organizationId !== organizationId) {
    const err = new Error('Advance permission request not found or does not belong to your organization.');
    err.statusCode = 404;
    throw err;
  }

  if (request.userId === reviewerUser.id) {
    const err = new Error('Administrators cannot approve or reject their own advance permission requests.');
    err.statusCode = 403;
    throw err;
  }

  if (request.status !== 'PENDING') {
    const err = new Error(`Request has already been ${request.status.toLowerCase()} and cannot be reviewed again.`);
    err.statusCode = 400;
    throw err;
  }

  if (action === 'APPROVE') {
    const updated = await prisma.compOffPermissionRequest.update({
      where: { id: requestId },
      data: {
        status: 'APPROVED',
        approvedById: reviewerUser.id,
        approvedAt: new Date(),
        adminRemarks: remarks ? String(remarks).trim() : 'Approved by Admin'
      },
      include: {
        user: { select: { id: true, name: true, employeeId: true, email: true, role: true } },
        approvedBy: { select: { id: true, name: true, employeeId: true, email: true } }
      }
    });

    return updated;
  }

  if (action === 'REJECT') {
    if (!rejectionReason || typeof rejectionReason !== 'string' || rejectionReason.trim().length < 4) {
      const err = new Error('A clear rejection reason (at least 4 characters) is required.');
      err.statusCode = 400;
      throw err;
    }

    const updated = await prisma.compOffPermissionRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        approvedById: reviewerUser.id,
        approvedAt: new Date(),
        rejectionReason: rejectionReason.trim(),
        adminRemarks: remarks ? String(remarks).trim() : null
      },
      include: {
        user: { select: { id: true, name: true, employeeId: true, email: true, role: true } },
        approvedBy: { select: { id: true, name: true, employeeId: true, email: true } }
      }
    });

    return updated;
  }

  const err = new Error('Invalid review action. Must be APPROVE or REJECT.');
  err.statusCode = 400;
  throw err;
};

/**
 * 21. Scan upcoming future dates (next N days) for eligible holidays and weekly offs
 */
const getEligibleFutureDates = async ({ userId, organizationId, daysAhead = 60 }) => {
  const eligibleDates = [];
  const today = new Date();
  const limit = Math.min(Math.max(parseInt(daysAhead, 10) || 60, 1), 180);

  // Pre-fetch active permission requests for this user
  const activeRequests = await prisma.compOffPermissionRequest.findMany({
    where: {
      userId,
      organizationId,
      status: { in: ['PENDING', 'APPROVED'] }
    },
    select: { id: true, workDate: true, status: true }
  });
  const requestMap = new Map();
  activeRequests.forEach(r => {
    const dStr = new Date(r.workDate).toISOString().split('T')[0];
    requestMap.set(dStr, r);
  });

  for (let i = 1; i <= limit; i++) {
    const futureDate = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = futureDate.toISOString().split('T')[0];
    const targetDate = new Date(`${dateStr}T00:00:00.000Z`);

    const dayCheck = await validateEligibleDay({
      userId,
      workDate: targetDate,
      organizationId
    });

    if (dayCheck.isEligible) {
      const isHoliday = dayCheck.eligibleReason.includes('HOLIDAY');
      const existingReq = requestMap.get(dateStr);

      eligibleDates.push({
        date: dateStr,
        dayName: dayCheck.dayName,
        holidayType: isHoliday ? 'COMPANY_HOLIDAY' : 'WEEKLY_OFF',
        reason: dayCheck.eligibleReason,
        label: `${dateStr} (${dayCheck.dayName}) — ${isHoliday ? dayCheck.eligibleReason.replace('COMPANY_HOLIDAY: ', '') : 'Weekly Off'}`,
        existingRequest: existingReq ? { id: existingReq.id, status: existingReq.status } : null
      });
    }
  }

  return eligibleDates;
};

/**
 * 22. Update Comp-Off policy settings (retrospective claim window and validity)
 */
const updateCompOffPolicySettings = async ({
  organizationId,
  claimWindowEnabled,
  claimWindowDays,
  validityDays
}) => {
  const data = {};
  if (claimWindowEnabled !== undefined) {
    data.compOffClaimWindowEnabled = Boolean(claimWindowEnabled);
  }
  if (claimWindowDays !== undefined) {
    const days = parseInt(claimWindowDays, 10);
    if (!isNaN(days) && days >= 0) {
      data.compOffClaimWindowDays = days;
    }
  }
  if (validityDays !== undefined) {
    const days = parseInt(validityDays, 10);
    if (!isNaN(days) && days > 0) {
      data.compOffValidityDays = days;
    }
  }

  if (organizationId) {
    const orgSettings = await prisma.organizationSettings.findUnique({
      where: { organizationId }
    });
    const currentLeavePolicy = orgSettings?.leavePolicy || {};
    const updatedLeavePolicy = {
      ...currentLeavePolicy,
      ...data,
      compOffClaimWindowEnabled: data.compOffClaimWindowEnabled !== undefined
        ? data.compOffClaimWindowEnabled
        : (currentLeavePolicy.compOffClaimWindowEnabled !== undefined ? currentLeavePolicy.compOffClaimWindowEnabled : true),
      compOffClaimWindowDays: data.compOffClaimWindowDays !== undefined
        ? data.compOffClaimWindowDays
        : (currentLeavePolicy.compOffClaimWindowDays || DEFAULT_CLAIM_WINDOW_DAYS),
      compOffValidityDays: data.compOffValidityDays !== undefined
        ? data.compOffValidityDays
        : (currentLeavePolicy.compOffValidityDays || DEFAULT_VALIDITY_DAYS),
      updatedAt: new Date().toISOString()
    };

    await prisma.organizationSettings.upsert({
      where: { organizationId },
      update: { leavePolicy: updatedLeavePolicy },
      create: {
        organizationId,
        leavePolicy: updatedLeavePolicy
      }
    });

    setCompanyLeavePolicy(organizationId, updatedLeavePolicy);
  }

  // Also update global leavepolicy table if exists
  const globalPolicy = await prisma.leavePolicy.findFirst({ where: { isGlobal: true } });
  if (globalPolicy) {
    await prisma.leavePolicy.update({
      where: { id: globalPolicy.id },
      data
    });
  }

  return await getCompOffPolicySettings(organizationId);
};

/**
 * Safely normalizes a CompOffSession object for API responses.
 * Converts Prisma.Decimal durationHours to a finite JavaScript Number,
 * preserving null/undefined when session or durationHours is not present,
 * and ensuring invalid numeric values do not silently become NaN.
 */
const serializeCompOffSession = (session) => {
  if (!session || typeof session !== 'object') return session;

  let durationHours = session.durationHours;
  if (durationHours !== null && durationHours !== undefined) {
    const parsed = Number(durationHours);
    durationHours = Number.isFinite(parsed) ? parsed : 0;
  }

  return {
    ...session,
    durationHours
  };
};

/**
 * 23. Retrieves today's Comp-Off status for an employee.
 * Identifies if today is an approved holiday/weekly-off and whether a session is unstarted, active, or completed.
 */
const getTodayCompOffStatus = async ({ userId, organizationId, now = new Date() }) => {
  const settings = await getEffectiveSettings(organizationId);
  const timeZone = getSystemTimeZone(settings);
  const todayDate = getTodayZonedDate(now, timeZone);

  // 1. Check if today is an eligible off-day (Sunday, Holiday, or Weekly Off)
  const dayValidation = await validateEligibleDay({ userId, workDate: todayDate, organizationId });

  // 2. Check if a CompOffSession already exists for today
  const session = await prisma.compOffSession.findFirst({
    where: {
      userId,
      organizationId,
      workDate: todayDate
    },
    include: {
      permissionRequest: true
    }
  });

  // If a session is ACTIVE, user MUST be able to clock out
  if (session && session.status === 'ACTIVE') {
    return {
      canLogin: false,
      canClockOut: true,
      hasApprovedPermission: true,
      isSessionActive: true,
      isSessionCompleted: false,
      isOffDay: dayValidation.isEligible,
      offDayReason: dayValidation.eligibleReason,
      permissionRequest: session.permissionRequest,
      session: serializeCompOffSession(session),
      serverTime: now.toISOString(),
      todayDate: todayDate.toISOString().split('T')[0],
      message: 'You have an active Comp-Off working session.'
    };
  }

  // If session is COMPLETED
  if (session && session.status !== 'ACTIVE') {
    return {
      canLogin: false,
      canClockOut: false,
      hasApprovedPermission: true,
      isSessionActive: false,
      isSessionCompleted: true,
      isOffDay: dayValidation.isEligible,
      offDayReason: dayValidation.eligibleReason,
      permissionRequest: session.permissionRequest,
      session: serializeCompOffSession(session),
      serverTime: now.toISOString(),
      todayDate: todayDate.toISOString().split('T')[0],
      message: 'Comp-Off working session has been completed for today.'
    };
  }

  // If not an eligible off day, cannot do comp-off login
  if (!dayValidation.isEligible) {
    return {
      canLogin: false,
      canClockOut: false,
      hasApprovedPermission: false,
      isSessionActive: false,
      isSessionCompleted: false,
      isOffDay: false,
      offDayReason: null,
      reason: 'NOT_AN_OFF_DAY',
      message: dayValidation.message || 'Today is a regular working day. Comp-Off login is not applicable.',
      session: null,
      serverTime: now.toISOString(),
      todayDate: todayDate.toISOString().split('T')[0]
    };
  }

  // 3. Check if user has an APPROVED advance permission request for today
  const permissionRequest = await prisma.compOffPermissionRequest.findFirst({
    where: {
      userId,
      organizationId,
      workDate: todayDate,
      status: 'APPROVED'
    },
    include: {
      approvedBy: { select: { id: true, name: true, employeeId: true } }
    }
  });

  if (!permissionRequest) {
    const anyRequest = await prisma.compOffPermissionRequest.findFirst({
      where: {
        userId,
        organizationId,
        workDate: todayDate
      },
      select: { status: true, rejectionReason: true }
    });

    return {
      canLogin: false,
      canClockOut: false,
      hasApprovedPermission: false,
      isSessionActive: false,
      isSessionCompleted: false,
      isOffDay: true,
      offDayReason: dayValidation.eligibleReason,
      permissionStatus: anyRequest ? anyRequest.status : 'NONE',
      reason: anyRequest ? `PERMISSION_${anyRequest.status}` : 'NO_APPROVED_PERMISSION',
      message: anyRequest?.status === 'PENDING'
        ? 'Your Comp-Off permission request for today is pending Admin approval.'
        : anyRequest?.status === 'REJECTED'
        ? `Your Comp-Off permission request for today was rejected: ${anyRequest.rejectionReason || 'Rejected by Admin'}.`
        : 'No approved Comp-Off advance permission found for today.',
      session: null,
      serverTime: now.toISOString(),
      todayDate: todayDate.toISOString().split('T')[0]
    };
  }

  return {
    canLogin: true,
    canClockOut: false,
    hasApprovedPermission: true,
    isSessionActive: false,
    isSessionCompleted: false,
    isOffDay: true,
    offDayReason: dayValidation.eligibleReason,
    permissionRequest,
    session: null,
    serverTime: now.toISOString(),
    todayDate: todayDate.toISOString().split('T')[0],
    message: 'Comp-Off advance permission is approved. You can log in for your off-day work session.'
  };
};

/**
 * 24. Starts a dedicated Comp-Off work session.
 * - Validates approved advance permission for today.
 * - Prevents duplicate sessions.
 * - Performs geofence validation; requires mandatory reason if outside.
 * - Configures auto-clock-out target (loginTime + dailyDuration) if user.autoClockOutEnabled.
 * - NEVER marks late or compares against normal shift-start time.
 * - NEVER creates or alters normal attendance records.
 */
const startCompOffSession = async ({
  userId,
  organizationId,
  latitude,
  longitude,
  locationReason,
  ipAddress,
  userAgent,
  now = new Date()
}) => {
  const settings = await getEffectiveSettings(organizationId);
  const timeZone = getSystemTimeZone(settings);
  const todayDate = getTodayZonedDate(now, timeZone);

  // 1. Fetch user to verify active status and autoClockOut setting
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      employeeId: true,
      email: true,
      role: true,
      organizationId: true,
      autoClockOutEnabled: true,
      status: true
    }
  });

  if (!user || user.status === 'INACTIVE') {
    const err = new Error('User account is invalid or inactive.');
    err.statusCode = 403;
    throw err;
  }

  // 2. Verify that today is an eligible off-day (Sunday, Company Holiday, or Shift Weekly Off)
  const dayValidation = await validateEligibleDay({ userId, workDate: todayDate, organizationId });
  if (!dayValidation.isEligible) {
    const err = new Error(dayValidation.message || 'Comp-Off login is only permitted on company holidays or scheduled weekly offs.');
    err.statusCode = 400;
    throw err;
  }

  // 3. Verify approved advance permission for today
  const permissionRequest = await prisma.compOffPermissionRequest.findFirst({
    where: {
      userId,
      organizationId,
      workDate: todayDate,
      status: 'APPROVED'
    }
  });

  if (!permissionRequest) {
    const err = new Error('Cannot start Comp-Off session: no approved advance permission exists for today.');
    err.statusCode = 400;
    throw err;
  }

  // 4. Verify no session already exists for today
  const existingSession = await prisma.compOffSession.findFirst({
    where: {
      userId,
      organizationId,
      workDate: todayDate
    }
  });

  if (existingSession) {
    const err = new Error(
      existingSession.status === 'ACTIVE'
        ? 'A Comp-Off session is already active for today.'
        : 'Comp-Off session has already been completed for today. Duplicate sessions are prohibited.'
    );
    err.statusCode = 409;
    throw err;
  }

  // 4. Geofence evaluation
  const [assignedLocRecords, orgLocationCount] = await Promise.all([
    prisma.userAttendanceLocation.findMany({
      where: {
        userId,
        attendanceLocation: { isActive: true }
      },
      include: { attendanceLocation: true }
    }),
    prisma.attendanceLocation.count({
      where: { organizationId }
    })
  ]);

  let locationStatus = 'INSIDE';
  let flaggedForReview = false;
  let distanceMeters = null;
  let allowedRadiusMeters = null;
  let locationName = settings?.officeLocationName || 'Office';

  if (latitude !== undefined && latitude !== null && longitude !== undefined && longitude !== null) {
    const evalResult = evaluateAttendanceGeofence({
      userLat: latitude,
      userLon: longitude,
      assignedLocations: assignedLocRecords.map(r => r.attendanceLocation),
      hasOrgLocations: orgLocationCount > 0,
      settings
    });

    if (evalResult.isInside) {
      locationStatus = 'INSIDE';
      flaggedForReview = false;
      distanceMeters = evalResult.distanceMeters;
      allowedRadiusMeters = evalResult.allowedRadiusMeters;
      locationName = evalResult.locationName || locationName;
    } else {
      // Outside geofence: requires mandatory reason
      if (!locationReason || typeof locationReason !== 'string' || locationReason.trim().length < 3) {
        const err = new Error('You are outside the permitted work location. A valid reason (at least 3 characters) is required to start your Comp-Off session.');
        err.statusCode = 400;
        err.isOutsideGeofence = true;
        err.geofence = evalResult;
        throw err;
      }

      locationStatus = 'OUTSIDE';
      flaggedForReview = true;
      distanceMeters = evalResult.distanceMeters;
      allowedRadiusMeters = evalResult.allowedRadiusMeters;
      locationName = evalResult.locationName || locationName;
    }
  }

  // 5. Calculate daily duration and auto-clock-out target
  const [sH, sM] = String(settings?.clockInTime || '09:00').split(':').map(Number);
  const [eH, eM] = String(settings?.clockOutTime || '18:00').split(':').map(Number);
  let dailyDurationHours = (eH * 60 + eM - (sH * 60 + sM)) / 60;
  if (isNaN(dailyDurationHours) || dailyDurationHours <= 0) {
    dailyDurationHours = 8.0;
  }

  const isAutoClockOutEnabled = user.autoClockOutEnabled !== false;
  let autoClockOutTarget = null;
  if (isAutoClockOutEnabled) {
    autoClockOutTarget = new Date(now.getTime() + dailyDurationHours * 3600000);
  }

  // User Agent Details
  const userAgentInfo = parseUserAgent(userAgent);

  // 6. Create CompOffSession record atomically
  const session = await prisma.compOffSession.create({
    data: {
      organizationId,
      userId,
      permissionRequestId: permissionRequest.id,
      workDate: todayDate,
      loginTime: now,
      status: 'ACTIVE',
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      locationStatus,
      locationName,
      distanceMeters,
      allowedRadiusMeters,
      locationReason: locationReason ? String(locationReason).trim() : null,
      flaggedForReview,
      ipAddress: ipAddress || null,
      device: userAgentInfo.device,
      browser: userAgentInfo.browser,
      autoClockOutTarget
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          employeeId: true,
          email: true,
          autoClockOutEnabled: true
        }
      },
      permissionRequest: true
    }
  });

  return serializeCompOffSession(session);
};

/**
 * 25. Ends an active Comp-Off work session.
 * - Idempotently marks session as COMPLETED.
 * - Calculates durationHours = round((clockOutTime - loginTime)/3600000, 2).
 * - Prevents double clock-out or clock-out without active session.
 */
const endCompOffSession = async ({
  userId,
  organizationId,
  sessionId = null,
  now = new Date()
}) => {
  const session = await prisma.compOffSession.findFirst({
    where: {
      ...(sessionId ? { id: sessionId } : {}),
      userId,
      organizationId,
      status: 'ACTIVE',
      clockOutTime: null
    }
  });

  if (!session) {
    const err = new Error('No active Comp-Off working session found to clock out.');
    err.statusCode = 404;
    throw err;
  }

  const clockOutTime = now;
  const loginTime = new Date(session.loginTime);
  const diffMs = Math.max(0, clockOutTime.getTime() - loginTime.getTime());
  const durationHours = Math.round((diffMs / 3600000) * 100) / 100;

  const updateResult = await prisma.compOffSession.updateMany({
    where: {
      id: session.id,
      status: 'ACTIVE',
      clockOutTime: null
    },
    data: {
      clockOutTime,
      durationHours,
      status: 'COMPLETED',
      clockOutType: 'MANUAL'
    }
  });

  if (updateResult.count === 0) {
    const err = new Error('Comp-Off session has already been completed.');
    err.statusCode = 400;
    throw err;
  }

  const updatedSession = await prisma.compOffSession.findUnique({
    where: { id: session.id },
    include: {
      user: {
        select: { id: true, name: true, employeeId: true, email: true }
      },
      permissionRequest: true
    }
  });

  return serializeCompOffSession(updatedSession);
};

/**
 * 26. Evaluates active Comp-Off sessions whose autoClockOutTarget has elapsed.
 * Only applies to employees whose individual autoClockOutEnabled setting is NOT false.
 */
const processCompOffAutoClockOut = async (simulatedNow = null) => {
  const now = simulatedNow instanceof Date ? simulatedNow : new Date();
  const summary = {
    processedCount: 0,
    autoClockedOutCount: 0,
    skippedCount: 0,
    results: []
  };

  try {
    const activeSessions = await prisma.compOffSession.findMany({
      where: {
        status: 'ACTIVE',
        clockOutTime: null,
        autoClockOutTarget: { lte: now }
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            employeeId: true,
            autoClockOutEnabled: true,
            organizationId: true
          }
        }
      }
    });

    if (!activeSessions || activeSessions.length === 0) {
      return summary;
    }

    summary.processedCount = activeSessions.length;

    for (const session of activeSessions) {
      try {
        if (session.user?.autoClockOutEnabled === false) {
          summary.skippedCount++;
          summary.results.push({
            id: session.id,
            userId: session.userId,
            action: 'SKIPPED',
            reason: 'INDIVIDUAL_AUTO_CLOCKOUT_DISABLED'
          });
          continue;
        }

        const clockOutTime = now;
        const loginTime = new Date(session.loginTime);
        const diffMs = Math.max(0, clockOutTime.getTime() - loginTime.getTime());
        const durationHours = Math.round((diffMs / 3600000) * 100) / 100;

        const updateResult = await prisma.compOffSession.updateMany({
          where: {
            id: session.id,
            status: 'ACTIVE',
            clockOutTime: null
          },
          data: {
            clockOutTime,
            durationHours,
            status: 'COMPLETED',
            clockOutType: 'AUTO'
          }
        });

        if (updateResult.count > 0) {
          summary.autoClockedOutCount++;
          summary.results.push({
            id: session.id,
            userId: session.userId,
            action: 'AUTO_CLOCKED_OUT',
            durationHours,
            clockOutTime
          });
        } else {
          summary.skippedCount++;
        }
      } catch (err) {
        console.error(`[CompOffAutoClockOut] Error auto clocking out session ${session.id}:`, err);
      }
    }
  } catch (error) {
    console.error('[CompOffAutoClockOut] Error processing auto clock-out:', error);
  }

  return summary;
};

/**
 * 27. Resolves the authoritative daily duration in hours for an employee on a given date.
 * - Prioritizes the employee's assigned shift if available.
 * - Safely falls back to effective organization settings (clockInTime/clockOutTime).
 * - Defaults to 8.0 hours if unresolvable.
 */
const resolveAuthoritativeDailyDurationHours = async (userOrObj, orgIdArg, dateArg = new Date()) => {
  let userId, organizationId, date;
  if (typeof userOrObj === 'object' && userOrObj !== null && !(userOrObj instanceof Date)) {
    userId = userOrObj.userId || userOrObj.id;
    organizationId = userOrObj.organizationId;
    date = userOrObj.date || new Date();
  } else {
    userId = userOrObj;
    organizationId = orgIdArg;
    date = dateArg;
  }

  let shiftStart = null;
  let shiftEnd = null;

  try {
    if (userId) {
      const userShift = await shiftService.getEmployeeShift(userId, prisma, date);
      if (userShift && userShift.startTime && userShift.endTime) {
        shiftStart = userShift.startTime;
        shiftEnd = userShift.endTime;
      }
    }
  } catch (err) {
    console.warn('[compOffService] Failed to get employee shift:', err.message);
  }

  if (!shiftStart || !shiftEnd) {
    const settings = await getEffectiveSettings(organizationId);
    shiftStart = settings?.clockInTime || '09:00';
    shiftEnd = settings?.clockOutTime || '18:00';
  }

  const [inH, inM] = String(shiftStart).split(':').map(Number);
  const [outH, outM] = String(shiftEnd).split(':').map(Number);
  if (isNaN(inH) || isNaN(inM) || isNaN(outH) || isNaN(outM)) {
    return 8.0;
  }
  const diffHours = (outH * 60 + outM - (inH * 60 + inM)) / 60;
  return diffHours > 0 ? Math.round(diffHours * 100) / 100 : 8.0;
};

/**
 * 28. Calculates dynamic credit based on recorded duration and authoritative daily duration.
 * - < 50% of configured daily duration: 0 credit
 * - >= 50% and < 100%: 0.5-day credit
 * - >= 100%: 1.0-day credit
 */
const calculateDynamicCompOffCredit = (durationOrObj, dailyDurationHoursArg) => {
  let durationHours, dailyDurationHours;
  if (typeof durationOrObj === 'object' && durationOrObj !== null) {
    durationHours = durationOrObj.durationHours;
    dailyDurationHours = durationOrObj.dailyDurationHours;
  } else {
    durationHours = durationOrObj;
    dailyDurationHours = dailyDurationHoursArg;
  }

  const daily = parseFloat(dailyDurationHours);
  const D = !isNaN(daily) && daily > 0 ? daily : 8.0;
  const duration = parseFloat(durationHours);
  const W = !isNaN(duration) && duration > 0 ? duration : 0.0;

  const thresholdHalf = Math.round((0.5 * D) * 100) / 100;
  const thresholdFull = Math.round((1.0 * D) * 100) / 100;
  const percentage = Math.round((W / D) * 100);

  let eligibleCredit = 0.0;
  let thresholdMet = 'BELOW_MINIMUM';
  let reason = '';

  if (W < thresholdHalf) {
    eligibleCredit = 0.0;
    thresholdMet = 'BELOW_MINIMUM';
    reason = `Worked ${W}h of ${D}h daily duration (${percentage}%) - below minimum 50% threshold (${thresholdHalf}h). No credit eligible.`;
  } else if (W < thresholdFull) {
    eligibleCredit = 0.5;
    thresholdMet = 'HALF_DAY';
    reason = `Worked ${W}h of ${D}h daily duration (${percentage}%) - qualifies for 0.5-day credit (Half Day).`;
  } else {
    eligibleCredit = 1.0;
    thresholdMet = 'FULL_DAY';
    reason = `Worked ${W}h of ${D}h daily duration (${percentage}%) - qualifies for 1.0-day credit (Full Day).`;
  }

  return {
    eligibleCredit,
    isEligible: eligibleCredit > 0,
    thresholdMet,
    percentage,
    thresholdHalf,
    thresholdFull,
    dailyDurationHours: D,
    durationHours: W,
    reason
  };
};

/**
 * 29. Verifies and approves a completed Comp-Off session.
 * - Admin only. Super Admin and employees are strictly forbidden.
 * - Session must be completed.
 * - Recalculates eligibility dynamically on backend (minimum 50% threshold required).
 * - Sets expiresAt based on grant/approval date (90 days from approval).
 * - Creates exactly one CompOffCredit entry and links it to the session.
 * - Idempotent & concurrency-safe.
 */
const verifyAndApproveCompOffSession = async (sessionOrObj, verifierArg, orgIdArg, remarksArg, txClientArg) => {
  let sessionId, verifierUser, organizationId, remarks, txClient;
  if (typeof sessionOrObj === 'object' && sessionOrObj !== null) {
    sessionId = sessionOrObj.sessionId || sessionOrObj.id;
    verifierUser = sessionOrObj.verifierUser || sessionOrObj.user;
    organizationId = sessionOrObj.organizationId;
    remarks = sessionOrObj.remarks;
    txClient = sessionOrObj.txClient || prisma;
  } else {
    sessionId = sessionOrObj;
    verifierUser = verifierArg;
    organizationId = orgIdArg;
    remarks = remarksArg;
    txClient = txClientArg || prisma;
  }

  if (typeof verifierUser === 'string') {
    verifierUser = await prisma.user.findUnique({
      where: { id: verifierUser }
    });
  }

  if (!verifierUser) {
    const err = new Error('Authentication required.');
    err.statusCode = 401;
    throw err;
  }

  if (verifierUser.role === 'SUPER_ADMIN') {
    const err = new Error('Super Admin is strictly read-only and cannot approve Comp-Off sessions.');
    err.statusCode = 403;
    throw err;
  }

  if (verifierUser.role !== 'ADMIN') {
    const err = new Error('Only authorized tenant Administrators can approve Comp-Off sessions.');
    err.statusCode = 403;
    throw err;
  }

  return await txClient.$transaction(async (tx) => {
    const session = await tx.compOffSession.findUnique({
      where: { id: sessionId },
      include: {
        user: { select: { id: true, name: true, employeeId: true, email: true, organizationId: true } },
        permissionRequest: true
      }
    });

    if (!session) {
      const err = new Error('Comp-Off session not found.');
      err.statusCode = 404;
      throw err;
    }

    if (session.organizationId !== organizationId) {
      const err = new Error('Unauthorized organization scope.');
      err.statusCode = 403;
      throw err;
    }

    // Employees cannot approve their own sessions
    if (verifierUser.id === session.userId) {
      const err = new Error('Administrators cannot approve their own Comp-Off sessions.');
      err.statusCode = 403;
      throw err;
    }

    // Session must be completed
    if (session.status !== 'COMPLETED' || !session.clockOutTime) {
      const err = new Error('Cannot approve an active or incomplete Comp-Off session. The session must be clocked out first.');
      err.statusCode = 400;
      throw err;
    }

    // Check approvalStatus
    if (session.approvalStatus === 'APPROVED') {
      const err = new Error('This Comp-Off session has already been approved.');
      err.statusCode = 409;
      throw err;
    }

    if (session.approvalStatus === 'REJECTED') {
      const err = new Error('Cannot approve a session that has already been rejected.');
      err.statusCode = 400;
      throw err;
    }

    // Check if a credit already exists for this workDate
    const existingCredit = await tx.compOffCredit.findUnique({
      where: {
        userId_workDate: {
          userId: session.userId,
          workDate: session.workDate
        }
      }
    });

    if (existingCredit) {
      const err = new Error('A Comp-Off credit already exists for this employee on this work date.');
      err.statusCode = 409;
      err.existingCredit = existingCredit;
      throw err;
    }

    // Calculate dynamic eligibility
    const dailyDurationHours = await resolveAuthoritativeDailyDurationHours({
      userId: session.userId,
      organizationId,
      date: session.workDate
    });

    const calculation = calculateDynamicCompOffCredit({
      durationHours: session.durationHours,
      dailyDurationHours
    });

    if (calculation.eligibleCredit <= 0) {
      const err = new Error(
        `Session working duration (${session.durationHours}h) is below the minimum 50% threshold of configured daily duration (${dailyDurationHours}h). Minimum ${calculation.thresholdHalf}h required to earn credit. Zero credit granted.`
      );
      err.statusCode = 400;
      err.code = 'BELOW_MINIMUM_DURATION';
      err.calculation = calculation;
      throw err;
    }

    // Expiry calculation: validity period begins on approval/grant date
    const grantDate = new Date();
    const policy = await getCompOffPolicySettings(organizationId);
    const expiresAt = calculateExpiryDate(grantDate, policy.validityDays);

    // Create CompOffCredit entry
    const creditReason = remarks || `Comp-Off credit for off-day work on ${session.workDate.toISOString().split('T')[0]} (${calculation.durationHours}h worked)`;
    const credit = await tx.compOffCredit.create({
      data: {
        organizationId,
        userId: session.userId,
        workDate: session.workDate,
        creditDays: calculation.eligibleCredit,
        usedDays: 0.0,
        availableDays: calculation.eligibleCredit,
        status: 'APPROVED',
        reason: creditReason,
        claimedByRole: 'ADMIN',
        claimedById: verifierUser.id,
        adminApprovedById: verifierUser.id,
        adminApprovedAt: grantDate,
        adminRemarks: remarks || 'Session verified and approved by Admin',
        expiresAt,
        sessionId: session.id
      }
    });

    // Update CompOffSession
    const updatedSession = await tx.compOffSession.update({
      where: { id: session.id },
      data: {
        approvalStatus: 'APPROVED',
        adminApprovedById: verifierUser.id,
        adminApprovedAt: grantDate,
        adminRemarks: remarks || 'Session verified and approved by Admin',
        creditId: credit.id,
        calculatedCredit: calculation.eligibleCredit
      },
      include: {
        user: { select: { id: true, name: true, employeeId: true, email: true, department: true } },
        permissionRequest: true
      }
    });

    return {
      success: true,
      session: serializeCompOffSession(updatedSession),
      credit,
      calculation,
      grantedCredit: calculation.eligibleCredit
    };
  });
};

/**
 * 30. Rejects a completed Comp-Off session.
 * - Admin only. Super Admin and employees are strictly forbidden.
 * - Requires mandatory non-empty rejectionReason.
 * - Strictly creates zero credits.
 */
const rejectCompOffSession = async (sessionOrObj, verifierArg, orgIdArg, rejectionReasonArg, adminRemarksArg) => {
  let sessionId, verifierUser, organizationId, rejectionReason, adminRemarks;
  if (typeof sessionOrObj === 'object' && sessionOrObj !== null) {
    sessionId = sessionOrObj.sessionId || sessionOrObj.id;
    verifierUser = sessionOrObj.verifierUser || sessionOrObj.user;
    organizationId = sessionOrObj.organizationId;
    rejectionReason = sessionOrObj.rejectionReason;
    adminRemarks = sessionOrObj.adminRemarks;
  } else {
    sessionId = sessionOrObj;
    verifierUser = verifierArg;
    organizationId = orgIdArg;
    rejectionReason = rejectionReasonArg;
    adminRemarks = adminRemarksArg;
  }

  if (typeof verifierUser === 'string') {
    verifierUser = await prisma.user.findUnique({
      where: { id: verifierUser }
    });
  }

  if (!verifierUser) {
    const err = new Error('Authentication required.');
    err.statusCode = 401;
    throw err;
  }

  if (verifierUser.role === 'SUPER_ADMIN') {
    const err = new Error('Super Admin is strictly read-only and cannot reject Comp-Off sessions.');
    err.statusCode = 403;
    throw err;
  }

  if (verifierUser.role !== 'ADMIN') {
    const err = new Error('Only authorized tenant Administrators can review Comp-Off sessions.');
    err.statusCode = 403;
    throw err;
  }

  if (!rejectionReason || typeof rejectionReason !== 'string' || !rejectionReason.trim()) {
    const err = new Error('A valid rejection reason is required to reject a Comp-Off session.');
    err.statusCode = 400;
    throw err;
  }

  return await prisma.$transaction(async (tx) => {
    const session = await tx.compOffSession.findUnique({
      where: { id: sessionId },
      include: {
        user: { select: { id: true, name: true, employeeId: true, email: true } },
        permissionRequest: true
      }
    });

    if (!session) {
      const err = new Error('Comp-Off session not found.');
      err.statusCode = 404;
      throw err;
    }

    if (session.organizationId !== organizationId) {
      const err = new Error('Unauthorized organization scope.');
      err.statusCode = 403;
      throw err;
    }

    if (verifierUser.id === session.userId) {
      const err = new Error('Administrators cannot reject their own Comp-Off sessions.');
      err.statusCode = 403;
      throw err;
    }

    if (session.approvalStatus === 'APPROVED') {
      const err = new Error('Cannot reject a session that has already been approved and credited.');
      err.statusCode = 400;
      throw err;
    }

    if (session.approvalStatus === 'REJECTED') {
      const err = new Error('This Comp-Off session has already been rejected.');
      err.statusCode = 400;
      throw err;
    }

    const updatedSession = await tx.compOffSession.update({
      where: { id: session.id },
      data: {
        approvalStatus: 'REJECTED',
        adminApprovedById: verifierUser.id,
        adminApprovedAt: new Date(),
        rejectionReason: rejectionReason.trim(),
        adminRemarks: adminRemarks ? adminRemarks.trim() : rejectionReason.trim()
      },
      include: {
        user: { select: { id: true, name: true, employeeId: true, email: true } },
        permissionRequest: true
      }
    });

    return { success: true, session: serializeCompOffSession(updatedSession) };
  });
};

/**
 * 31. Lists Comp-Off sessions scoped by organization and role with dynamic eligibility enrichment.
 */
const getCompOffSessions = async (options = {}) => {
  const {
    organizationId,
    requestingUser,
    user,
    status,
    approvalStatus,
    userId,
    dateFrom,
    dateTo,
    limit = 100,
    page = 1,
    filters = {}
  } = options;

  const reqUser = requestingUser || user;
  const where = { organizationId };

  const effectiveStatus = status || filters.status;
  const effectiveApprovalStatus = approvalStatus || filters.approvalStatus;
  const effectiveUserId = userId || filters.userId;
  const effectiveDateFrom = dateFrom || filters.dateFrom;
  const effectiveDateTo = dateTo || filters.dateTo;

  if (reqUser && (reqUser.role === 'EMPLOYEE' || reqUser.role === 'INTERN')) {
    where.userId = reqUser.id;
  } else if (reqUser && reqUser.role === 'TEAM_LEADER') {
    if (effectiveUserId) {
      where.userId = effectiveUserId;
    } else {
      const teams = await prisma.team.findMany({
        where: { leaderId: reqUser.id, organizationId },
        include: { members: true }
      });
      const memberIds = new Set([reqUser.id]);
      teams.forEach(t => t.members.forEach(m => memberIds.add(m.userId)));
      where.userId = { in: Array.from(memberIds) };
    }
  } else {
    // Admin & Super Admin
    if (effectiveUserId) {
      where.userId = effectiveUserId;
    }
  }

  if (effectiveStatus && effectiveStatus !== 'ALL') {
    where.status = effectiveStatus;
  }

  if (effectiveApprovalStatus && effectiveApprovalStatus !== 'ALL') {
    where.approvalStatus = effectiveApprovalStatus;
  }

  if (effectiveDateFrom || effectiveDateTo) {
    where.workDate = {};
    if (effectiveDateFrom) where.workDate.gte = new Date(effectiveDateFrom);
    if (effectiveDateTo) where.workDate.lte = new Date(effectiveDateTo);
  }

  const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

  const [total, sessions] = await Promise.all([
    prisma.compOffSession.count({ where }),
    prisma.compOffSession.findMany({
      where,
      orderBy: { loginTime: 'desc' },
      skip,
      take,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            employeeId: true,
            email: true,
            department: true,
            role: true
          }
        },
        permissionRequest: true
      }
    })
  ]);

  // Enrich each session with authoritative daily duration & dynamic credit calculation
  const enrichedSessions = await Promise.all(
    sessions.map(async (sess) => {
      const durationHours = parseFloat(sess.durationHours) || 0;
      const dailyDurationHours = await resolveAuthoritativeDailyDurationHours({
        userId: sess.userId,
        organizationId,
        date: sess.workDate
      });

      const calculation = calculateDynamicCompOffCredit({
        durationHours,
        dailyDurationHours
      });

      let credit = null;
      if (sess.creditId) {
        credit = await prisma.compOffCredit.findUnique({
          where: { id: sess.creditId }
        });
      }

      let approvedBy = null;
      if (sess.adminApprovedById) {
        approvedBy = await prisma.user.findUnique({
          where: { id: sess.adminApprovedById },
          select: { id: true, name: true, employeeId: true }
        });
      }

      return {
        ...sess,
        durationHours,
        configuredDailyDuration: dailyDurationHours,
        calculatedCredit: sess.calculatedCredit !== null ? parseFloat(sess.calculatedCredit) : calculation.eligibleCredit,
        creditEligibility: calculation,
        canApprove: sess.status === 'COMPLETED' && sess.approvalStatus === 'PENDING' && calculation.eligibleCredit > 0,
        canReject: sess.approvalStatus === 'PENDING',
        credit,
        approvedBy
      };
    })
  );

  return {
    sessions: enrichedSessions,
    total,
    page: Math.max(parseInt(page, 10) || 1, 1),
    totalPages: Math.ceil(total / take)
  };
};

module.exports = {
  DEFAULT_VALIDITY_DAYS,
  DEFAULT_CLAIM_WINDOW_DAYS,
  validateCreditAmount,
  getCompOffPolicySettings,
  calculateExpiryDate,
  validateClaimWindow,
  validateEligibleDay,
  checkExistingCredit,
  getWorkEvidence,
  getUserCompOffLedgerBalance,
  ensureCompOffLeaveType,
  validateWorkEvidence,
  verifyCompOffEligibility,
  authorizeCreditInTransaction,
  consumeCompOffCreditsFIFO,
  restoreCompOffCreditConsumption,
  processExpiredCompOffCredits,
  createCompOffPermissionRequest,
  getCompOffPermissionRequests,
  reviewCompOffPermissionRequest,
  getEligibleFutureDates,
  updateCompOffPolicySettings,
  serializeCompOffSession,
  getTodayCompOffStatus,
  startCompOffSession,
  endCompOffSession,
  processCompOffAutoClockOut,
  getCompOffSessions,
  resolveAuthoritativeDailyDurationHours,
  calculateDynamicCompOffCredit,
  verifyAndApproveCompOffSession,
  rejectCompOffSession
};



