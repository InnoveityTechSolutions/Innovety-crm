const prisma = require('../utils/db');
const { logActivity } = require('../utils/activityLogger');
const { createNotification } = require('../services/notification');
const { broadcastAttendanceEvent } = require('../socket');
const { getOrganizationWhere, getEffectiveOrgId } = require('../utils/organizationScope');
const { getEffectiveSettings } = require('../utils/settingsResolver');
const shiftService = require('../services/shiftService');
const compOffService = require('../services/compOffService');
const {
  getSystemTimeZone,
  getTodayZonedDate,
  getZonedParts,
  createZonedDate,
  validateAttendanceWindow,
  calculateHaversineDistance,
  formatDistance,
  evaluateAttendanceGeofence
} = require('../utils/attendanceUtils');

const parseInputDate = (inputVal, timeZone = 'Asia/Kolkata') => {
  if (!inputVal) return null;
  if (inputVal instanceof Date) return isNaN(inputVal.getTime()) ? null : inputVal;

  const str = String(inputVal).trim();
  if (str.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(str)) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  const parts = str.split(/[T ]/);
  if (parts.length >= 2) {
    const [year, month, day] = parts[0].split('-').map(Number);
    const [hour, minute] = parts[1].split(':').map(Number);
    if (year && month && day && !isNaN(hour) && !isNaN(minute)) {
      return createZonedDate(year, month, day, hour, minute, timeZone);
    }
  }

  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
};


// Helper to parse User Agent details
const parseUserAgent = (userAgentString) => {
  if (!userAgentString) return { browser: 'Unknown', device: 'Unknown' };

  let browser = 'Unknown Browser';
  let device = 'Desktop';

  const ua = userAgentString.toLowerCase();

  if (ua.includes('firefox')) {
    browser = 'Firefox';
  } else if (ua.includes('chrome') && !ua.includes('chromium')) {
    browser = 'Chrome';
  } else if (ua.includes('safari') && !ua.includes('chrome')) {
    browser = 'Safari';
  } else if (ua.includes('edge') || ua.includes('edg')) {
    browser = 'Edge';
  } else if (ua.includes('opr') || ua.includes('opera')) {
    browser = 'Opera';
  }

  if (ua.includes('mobi') || ua.includes('android') || ua.includes('iphone')) {
    device = 'Mobile';
  } else if (ua.includes('ipad') || ua.includes('tablet')) {
    device = 'Tablet';
  }

  return { browser, device };
};

const getOrCreateSystemSettings = async (organizationId) => {
  return await getEffectiveSettings(organizationId);
};

const getClockInStatus = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const userId = req.user.id;
    const now = new Date();

    const settings = await getOrCreateSystemSettings(req.user?.organizationId);
    const timeZone = getSystemTimeZone(settings);
    const todayDate = getTodayZonedDate(now, timeZone);

    // Check user's joiningDate - attendance is strictly active from joiningDate onwards
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true, joiningDate: true, createdAt: true }
    });

    const effectiveJoining = currentUser?.joiningDate || currentUser?.createdAt;
    if (effectiveJoining) {
      const joiningMidnight = new Date(new Date(effectiveJoining).toISOString().split('T')[0] + 'T00:00:00.000Z');
      if (todayDate < joiningMidnight) {
        return res.json({
          isClockedIn: false,
          eligibleForAttendance: false,
          canClockIn: false,
          joiningDate: effectiveJoining,
          reason: 'EMPLOYMENT_NOT_STARTED',
          message: `Your employment starts on ${new Date(effectiveJoining).toLocaleDateString()}. Attendance will be available from your joining date.`,
          serverTime: now.toISOString(),
          autoClockOutEnabled: settings?.autoClockOutEnabled !== undefined ? settings.autoClockOutEnabled : true,
          clockInTime: settings?.clockInTime || settings?.internShiftStart || '09:00',
          clockOutTime: settings?.clockOutTime || settings?.internShiftEnd || '18:00',
          geofence: {
            officeLatitude: settings?.officeLatitude ?? 12.971598,
            officeLongitude: settings?.officeLongitude ?? 77.594562,
            allowedRadiusMeters: settings?.allowedRadiusMeters ?? 200.0,
            officeLocationName: settings?.officeLocationName || 'Innoveity Headquarters'
          }
        });
      }
    }

    // Check existing attendance for today
    const existing = await prisma.attendance.findUnique({
      where: { userId_date: { userId, date: todayDate } }
    });

    // Check if user has an APPROVED WFH/Leave
    const approvedLeave = await prisma.leaveRequest.findFirst({
      where: {
        userId,
        status: 'APPROVED',
        startDate: { lte: todayDate },
        endDate: { gte: todayDate }
      }
    });

    // Fetch user's assigned shift enriched with today's schedule
    const userShift = await shiftService.getEmployeeShiftWithSchedule(userId, now, timeZone);

    // Validate whether today is an eligible off-day (Sunday, Company Holiday, or Shift Weekly Off)
    const dayValidation = await compOffService.validateEligibleDay({
      userId,
      workDate: todayDate,
      organizationId: req.user?.organizationId
    });

    const isOffDay = Boolean(dayValidation.isEligible);
    const offDayType = isOffDay
      ? (dayValidation.eligibleReason?.includes('HOLIDAY') ? 'HOLIDAY' : 'WEEKLY_OFF')
      : null;
    const offDayReason = isOffDay ? dayValidation.eligibleReason : null;
    let offDayTitle = null;
    if (isOffDay) {
      if (dayValidation.eligibleReason?.includes(':')) {
        offDayTitle = dayValidation.eligibleReason.split(':')[1].trim();
      } else if (dayValidation.eligibleReason === 'SUNDAY_WEEKLY_OFF') {
        offDayTitle = 'Sunday Weekly Off';
      } else if (dayValidation.eligibleReason === 'SATURDAY_LEAVE') {
        offDayTitle = 'Saturday Leave';
      } else {
        offDayTitle = offDayType === 'HOLIDAY' ? 'Company Holiday' : 'Weekly Off';
      }
    }

    const validation = validateAttendanceWindow({
      userRole: req.user.role,
      settings,
      attendanceRecord: existing,
      approvedLeave,
      now,
      userShift
    });

    // If today is an off-day (holiday or weekly off) and employee hasn't already clocked in/out
    if (isOffDay && !existing) {
      validation.canClockIn = false;
      validation.state = 'HOLIDAY';
      validation.reason = offDayType === 'HOLIDAY' ? 'HOLIDAY' : (userShift?.isSaturdayLeave ? 'SATURDAY_LEAVE' : 'WEEKLY_OFF');
    }

    const clockInTimeStr = userShift?.startTime || settings?.clockInTime || (req.user.role === 'TEAM_LEADER' ? settings?.tlShiftStart : settings?.internShiftStart) || '09:00';
    const clockOutTimeStr = userShift?.endTime || settings?.clockOutTime || (req.user.role === 'TEAM_LEADER' ? settings?.tlShiftEnd : settings?.internShiftEnd) || '18:00';
    const [endHour, endMin] = clockOutTimeStr.split(':').map(Number);
    const { year, month, day } = getZonedParts(now, timeZone);
    const todayConfiguredShiftEnd = createZonedDate(year, month, day, endHour, endMin, timeZone);

    let shiftEndAt = todayConfiguredShiftEnd;
    if (existing?.clockOut && existing?.shiftEndAt) {
      shiftEndAt = existing.shiftEndAt;
    } else if (existing?.shiftEndAt) {
      shiftEndAt = existing.shiftEndAt;
    }

    if (existing && !existing.clockOut && (!existing.shiftEndAt || new Date(existing.shiftEndAt).getTime() !== todayConfiguredShiftEnd.getTime())) {
      prisma.attendance.update({
        where: { id: existing.id },
        data: { shiftEndAt: todayConfiguredShiftEnd }
      }).catch(e => console.warn('Sync shiftEndAt error:', e));
    }

    const isClockedIn = Boolean(existing?.clockIn && !existing?.clockOut);
    const secondsRemaining = (shiftEndAt && !existing?.clockOut)
      ? Math.max(0, Math.floor((new Date(shiftEndAt).getTime() - now.getTime()) / 1000))
      : 0;

    const userAutoClockOut = req.user?.autoClockOutEnabled !== undefined ? req.user.autoClockOutEnabled : true;
    const orgAutoClockOut = settings?.autoClockOutEnabled !== undefined ? settings.autoClockOutEnabled : true;
    const autoClockOutEnabled = Boolean(userAutoClockOut && orgAutoClockOut);

    // Dynamic Late Policy Calculations for Current Calendar Month
    const { year: currentYear, month: currentMonth } = getZonedParts(now, timeZone);
    const monthStart = createZonedDate(currentYear, currentMonth, 1, 0, 0, timeZone);
    const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
    const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
    const monthEnd = createZonedDate(nextYear, nextMonth, 1, 0, 0, timeZone);

    const monthlyLateCount = await prisma.attendance.count({
      where: {
        userId,
        status: 'LATE',
        date: {
          gte: monthStart,
          lt: monthEnd
        }
      }
    });

    const isLatePolicyEnabled = settings?.latePolicyEnabled !== false;
    const warningLimit = settings?.warningLateLimit !== undefined ? Number(settings.warningLateLimit) : 3;
    const appliesTo = (settings?.latePolicyAppliesTo || 'INTERN,EMPLOYEE,TEAM_LEADER')
      .split(',')
      .map(r => r.trim());
    const isApplicable = appliesTo.includes(req.user.role);

    const warningsRemaining = Math.max(0, warningLimit - monthlyLateCount);
    const deductibleLates = Math.max(0, monthlyLateCount - warningLimit);

    let lateSubtitle = `${warningLimit} warnings remaining`;
    if (monthlyLateCount === 0) {
      lateSubtitle = `${warningLimit} warnings remaining`;
    } else if (monthlyLateCount < warningLimit) {
      lateSubtitle = `${warningsRemaining} warning${warningsRemaining === 1 ? '' : 's'} remaining`;
    } else if (monthlyLateCount === warningLimit) {
      lateSubtitle = 'Last warning';
    } else {
      lateSubtitle = 'Deduction started';
    }

    const lateStats = {
      enabled: isLatePolicyEnabled,
      isApplicable,
      monthlyLates: monthlyLateCount,
      warningLimit,
      deductibleLates,
      warningsRemaining,
      displayRatio: `${monthlyLateCount}/${warningLimit}`,
      subtitle: lateSubtitle,
      deductionPerLate: settings?.deductionPerLate || '1_DAY_SALARY'
    };

    const assignedLocations = (await prisma.userAttendanceLocation.findMany({
      where: {
        userId: req.user.id,
        attendanceLocation: { isActive: true }
      },
      include: { attendanceLocation: true }
    })).map(a => a.attendanceLocation);

    const hasOrganizationLocations = (await prisma.attendanceLocation.count({
      where: { organizationId: req.user.organizationId }
    })) > 0;

    res.json({
      ...validation,
      isOffDay,
      offDayType,
      offDayReason,
      offDayTitle,
      lateStats,
      timezone: timeZone,
      isClockedIn,
      clockIn: existing?.clockIn || null,
      clockOut: existing?.clockOut || null,
      shiftEndAt: shiftEndAt ? new Date(shiftEndAt).toISOString() : null,
      secondsRemaining,
      serverTime: now.toISOString(),
      autoClockOut: Boolean(existing?.autoClockOut),
      autoClockOutEnabled,
      clockInTime: clockInTimeStr,
      clockOutTime: clockOutTimeStr,
      existingRecord: existing || null,
      approvedLeave: approvedLeave || null,
      shift: userShift ? {
        id: userShift.id,
        name: userShift.name,
        shiftName: userShift.name,
        startTime: userShift.startTime,
        endTime: userShift.endTime,
        workingDays: userShift.workingDays,
        isDefault: userShift.name === 'Company Default',
        todayStatus: userShift.todayStatus,
        dayName: userShift.dayName,
        isSaturdayLeave: Boolean(userShift.isSaturdayLeave),
        formattedStart: shiftService.formatTime12h(userShift.startTime),
        formattedEnd: shiftService.formatTime12h(userShift.endTime)
      } : null,
      ...(validation.reason === 'SATURDAY_LEAVE'
        ? { message: 'Today is a scheduled Saturday leave. Clock-in is not required.' }
        : validation.reason === 'HOLIDAY'
        ? { message: `Today is a designated Holiday${offDayTitle ? ` (${offDayTitle})` : ''}. Clock-in is disabled.` }
        : validation.reason === 'WEEKLY_OFF'
        ? { message: `Today is your scheduled weekly off${offDayTitle ? ` (${offDayTitle})` : ''}. Clock-in is not required.` }
        : validation.reason === 'SHIFT_NOT_STARTED'
        ? { message: `Clock-in window opens at ${validation.windowOpenFormatted} (Shift starts at ${validation.shiftStartFormatted || '09:00 AM'}).` }
        : validation.reason === 'ALREADY_CLOCKED_OUT'
        ? { message: 'You have already clocked out today. Daily attendance is completed.' }
        : {}),
      geofence: {
        officeLatitude: assignedLocations[0]?.latitude ?? settings?.officeLatitude ?? 12.971598,
        officeLongitude: assignedLocations[0]?.longitude ?? settings?.officeLongitude ?? 77.594562,
        allowedRadiusMeters: assignedLocations.length > 0 ? assignedLocations[0].radiusMeters : (settings?.allowedRadiusMeters ?? 200.0),
        officeLocationName: assignedLocations[0]?.name ?? settings?.officeLocationName ?? 'Innoveity Headquarters'
      },
      assignedLocations,
      hasOrganizationLocations
    });
  } catch (error) {
    console.error('Get clock-in status error:', error);
    res.status(500).json({ success: false, reason: 'SERVER_ERROR', message: 'Failed to retrieve clock-in status.' });
  }
};

const clockIn = async (req, res) => {
  try {
    if (['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        reason: 'ROLE_NOT_ALLOWED',
        message: 'Administrators do not use personal clock-in.'
      });
    }

    const userId = req.user.id;
    const now = new Date();

    const { latitude, longitude, workLocation = 'OFFICE', workLocationOther, location } = req.body;

    // Validate GPS Coordinates
    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null || latitude === '' || longitude === '') {
      return res.status(400).json({
        success: false,
        reason: 'LOCATION_REQUIRED',
        message: 'Location permission is required to verify your location before Clock-In.'
      });
    }

    const userLat = parseFloat(latitude);
    const userLon = parseFloat(longitude);

    if (isNaN(userLat) || isNaN(userLon) || userLat < -90 || userLat > 90 || userLon < -180 || userLon > 180) {
      return res.status(400).json({
        success: false,
        reason: 'LOCATION_REQUIRED',
        message: 'Unable to determine your current location. Please enable location services and try again.'
      });
    }

    const validLocations = ['OFFICE', 'HOME', 'OTHER'];
    if (!validLocations.includes(workLocation)) {
      return res.status(400).json({
        success: false,
        reason: 'INVALID_WORK_LOCATION',
        message: 'Please select a valid work location (Home or Other).'
      });
    }

    if (workLocation === 'OTHER' && (!workLocationOther || !workLocationOther.trim())) {
      return res.status(400).json({
        success: false,
        reason: 'LOCATION_REASON_REQUIRED',
        message: 'Location or reason is required when "Other" is selected.'
      });
    }

    const settings = await getOrCreateSystemSettings(req.user?.organizationId);
    const timeZone = getSystemTimeZone(settings);
    const todayDate = getTodayZonedDate(now, timeZone);

    // Strictly enforce joiningDate restriction on clockIn API
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true, joiningDate: true, createdAt: true }
    });

    const effectiveJoining = currentUser?.joiningDate || currentUser?.createdAt;
    if (effectiveJoining) {
      const joiningMidnight = new Date(new Date(effectiveJoining).toISOString().split('T')[0] + 'T00:00:00.000Z');
      if (todayDate < joiningMidnight) {
        return res.status(400).json({
          success: false,
          reason: 'EMPLOYMENT_NOT_STARTED',
          message: `Your employment starts on ${new Date(effectiveJoining).toLocaleDateString()}. Attendance clock-in is only permitted from your official joining date.`
        });
      }
    }

    // Multiple Attendance Locations Geofence Validation
    let matchedLocation = null;
    let distanceMeters = null;

    if (workLocation === 'OFFICE') {
      const assignedLocRecords = await prisma.userAttendanceLocation.findMany({
        where: {
          userId,
          attendanceLocation: { isActive: true }
        },
        include: {
          attendanceLocation: true
        }
      });

      const orgLocationCount = await prisma.attendanceLocation.count({
        where: { organizationId: req.user.organizationId }
      });

      const evalResult = evaluateAttendanceGeofence({
        userLat,
        userLon,
        assignedLocations: assignedLocRecords.map(r => r.attendanceLocation),
        hasOrgLocations: orgLocationCount > 0,
        settings
      });

      if (evalResult.status === 'NO_ASSIGNED_LOCATION') {
        return res.status(400).json({
          success: false,
          reason: 'NO_ASSIGNED_LOCATION',
          message: evalResult.message
        });
      }

      if (!evalResult.isInside) {
        return res.status(400).json({
          success: false,
          reason: 'OUTSIDE_GEOFENCE',
          isOutside: true,
          ...evalResult
        });
      }

      matchedLocation = evalResult.matchedLocation;
      distanceMeters = evalResult.distanceMeters;
    }

    // Check if user already clocked in today
    const existing = await prisma.attendance.findUnique({
      where: { userId_date: { userId, date: todayDate } }
    });

    if (existing) {
      if (existing.status === 'ABSENT' && existing.clockInLocation?.includes('Declined')) {
        return res.status(400).json({
          success: false,
          reason: 'DECLINED_LEAVE_ABSENT',
          message: 'Your leave application letter for today was DECLINED by Admin and your attendance is marked as ABSENT.'
        });
      }
      if (existing.clockOut) {
        return res.status(400).json({
          success: false,
          reason: 'ALREADY_CLOCKED_OUT',
          message: 'You have already clocked out today. Daily attendance is completed.'
        });
      }
      return res.status(400).json({
        success: false,
        reason: 'ALREADY_CLOCKED_IN',
        message: 'You have already clocked in today.'
      });
    }

    // Check if user has an APPROVED leave/WFH request for today
    const approvedLeave = await prisma.leaveRequest.findFirst({
      where: {
        userId,
        status: 'APPROVED',
        startDate: { lte: todayDate },
        endDate: { gte: todayDate }
      }
    });

    // Fetch user's assigned shift enriched with today's schedule
    const userShift = await shiftService.getEmployeeShiftWithSchedule(userId, now, timeZone);

    // Validate whether today is an eligible off-day (Sunday, Company Holiday, or Shift Weekly Off)
    const dayValidation = await compOffService.validateEligibleDay({
      userId,
      workDate: todayDate,
      organizationId: req.user?.organizationId
    });

    if (dayValidation.isEligible && !existing) {
      const isHoliday = dayValidation.eligibleReason?.includes('HOLIDAY');
      return res.status(400).json({
        success: false,
        reason: isHoliday ? 'HOLIDAY' : 'WEEKLY_OFF',
        message: `Today is a ${isHoliday ? 'designated holiday' : 'scheduled weekly off'}. Regular clock-in is disabled.`
      });
    }

    const validation = validateAttendanceWindow({
      userRole: req.user.role,
      settings,
      attendanceRecord: existing,
      approvedLeave,
      now,
      userShift
    });

    if (!validation.canClockIn) {
      let msg = `Clock-in is prohibited at this time.`;
      if (validation.reason === 'SATURDAY_LEAVE') {
        msg = `Today is a scheduled Saturday leave. Clock-in is not required.`;
      } else if (validation.reason === 'HOLIDAY') {
        msg = `Today is a designated Holiday. Clock-in is disabled.`;
      } else if (validation.reason === 'SHIFT_NOT_STARTED') {
        msg = `Clock-in window is not open yet. Shift starts at ${validation.shiftStartFormatted || '09:00 AM'}. Early clock-in opens at ${validation.windowOpenFormatted || '08:30 AM'} (Grace period ends at ${validation.windowCloseFormatted || '09:15 AM'}). Current server time is ${validation.currentTimeFormatted}.`;
      } else if (validation.reason === 'ALREADY_CLOCKED_IN') {
        msg = `You have already clocked in today.`;
      } else if (validation.reason === 'ALREADY_CLOCKED_OUT') {
        msg = `You have already clocked out today. Daily attendance is completed.`;
      }

      console.warn(`[ClockIn 400 Rejected] User: ${userId} (${req.user.role}) | Reason: ${validation.reason} | WindowOpen: ${validation.windowOpenFormatted} | CurrentTime: ${validation.currentTimeFormatted}`);

      return res.status(400).json({
        success: false,
        reason: validation.reason || 'CLOCK_IN_PROHIBITED',
        message: msg,
        currentTimeFormatted: validation.currentTimeFormatted,
        windowOpenFormatted: validation.windowOpenFormatted,
        shiftStartFormatted: validation.shiftStartFormatted,
        windowCloseFormatted: validation.windowCloseFormatted
      });
    }

    const ipAddress = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || '';
    const { browser, device } = parseUserAgent(userAgent);

    let finalStatus = 'PRESENT';
    let lateMinutes = validation.lateMinutes;

    if ((approvedLeave && approvedLeave.type === 'WFH') || userShift?.todayStatus === 'WFH' || workLocation === 'HOME') {
      finalStatus = 'WORK_FROM_HOME';
      lateMinutes = null;
    } else if (validation.state === 'OPEN_LATE') {
      finalStatus = 'LATE';
    } else {
      finalStatus = 'PRESENT';
      lateMinutes = null;
    }

    const shiftStartStr = userShift?.startTime || (
      (req.user.role === 'TEAM_LEADER' || req.user.role === 'ADMIN')
        ? (settings?.tlShiftStart || settings?.clockInTime || '09:00')
        : (settings?.internShiftStart || settings?.clockInTime || '09:00')
    );

    const clockOutTimeStr = userShift?.endTime || (
      settings?.clockOutTime || (req.user.role === 'TEAM_LEADER' ? settings?.tlShiftEnd : settings?.internShiftEnd) || '18:00'
    );
    const [endHour, endMin] = clockOutTimeStr.split(':').map(Number);
    const { year, month, day } = getZonedParts(now, timeZone);
    const shiftEndAt = createZonedDate(year, month, day, endHour, endMin, timeZone);

    const formattedLocationStr = workLocation === 'OTHER'
      ? workLocationOther.trim()
      : (workLocation === 'HOME' ? 'Home (Remote)' : (matchedLocation ? matchedLocation.name : 'Office'));
    const formattedGeofenceDetails = distanceMeters !== null
      ? `Lat: ${userLat.toFixed(6)}, Lon: ${userLon.toFixed(6)} (${formatDistance(distanceMeters)} from ${matchedLocation ? matchedLocation.name : 'Office'})`
      : `Lat: ${userLat.toFixed(6)}, Lon: ${userLon.toFixed(6)}`;
    const clockInLocDisplay = location || `${formattedLocationStr} • ${formattedGeofenceDetails}`;

    const attendance = await prisma.attendance.create({
      data: {
        userId,
        date: todayDate,
        clockIn: now,
        shiftEndAt,
        ipAddress,
        browser,
        device,
        status: finalStatus,
        clockInLocation: clockInLocDisplay,
        clockInLatitude: userLat,
        clockInLongitude: userLon,
        clockInAddress: req.body.address || matchedLocation?.address || null,
        workLocation,
        workLocationOther: workLocation === 'OTHER' ? workLocationOther.trim() : null,
        lateMinutes,
        earlyWindowUsed: settings?.earlyWindowMinutes !== undefined ? settings.earlyWindowMinutes : 30,
        gracePeriodUsed: settings?.gracePeriodMinutes !== undefined ? settings.gracePeriodMinutes : 15,
        shiftStartUsed: shiftStartStr,
        // Safeguard 1: Audit snapshot of shift active at clock-in
        shiftId: userShift?.id || null,
        shiftName: userShift?.name || 'Company Default',
        scheduledStartTime: shiftStartStr,
        scheduledEndTime: clockOutTimeStr,
        attendanceLocationId: matchedLocation?.id || null
      }
    });

    await logActivity({
      userId,
      action: 'CLOCK_IN',
      details: `Clocked in today at ${validation.currentTimeFormatted} from ${workLocation}. Status: ${finalStatus}${lateMinutes ? ` (${lateMinutes} mins late)` : ''}`,
      ipAddress
    });

    if (finalStatus === 'LATE') {
      const { year: currentYear, month: currentMonth } = getZonedParts(now, timeZone);
      const monthStart = createZonedDate(currentYear, currentMonth, 1, 0, 0, timeZone);
      const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
      const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
      const monthEnd = createZonedDate(nextYear, nextMonth, 1, 0, 0, timeZone);

      const monthlyLateCount = await prisma.attendance.count({
        where: {
          userId,
          status: 'LATE',
          date: { gte: monthStart, lt: monthEnd }
        }
      });

      const warningLimit = settings?.warningLateLimit !== undefined ? Number(settings.warningLateLimit) : 3;
      let lateAlertMsg = `You clocked in at ${validation.currentTimeFormatted}, which is ${lateMinutes} minute(s) past the grace period. Marked as LATE.`;

      if (monthlyLateCount <= warningLimit) {
        if (monthlyLateCount === warningLimit) {
          lateAlertMsg += ` [Last Warning: ${monthlyLateCount}/${warningLimit} lates this month. Next late arrival will initiate salary deductions.]`;
        } else {
          lateAlertMsg += ` [Warning: ${monthlyLateCount}/${warningLimit} lates this month. ${warningLimit - monthlyLateCount} warnings remaining.]`;
        }
      } else {
        const deductibleCount = monthlyLateCount - warningLimit;
        lateAlertMsg += ` [Deduction Alert: Exceeded warning limit (${monthlyLateCount}/${warningLimit}). Late #${deductibleCount} will be deducted in payroll.]`;
      }

      await createNotification({
        userId,
        title: 'Late Attendance Alert ⚠️',
        message: lateAlertMsg,
        type: 'ATTENDANCE_LATE'
      });
    }

    // Broadcast real-time Socket.IO event
    broadcastAttendanceEvent('attendance_clock_in', { userId, record: attendance });
    broadcastAttendanceEvent('attendance_updated', { userId, record: attendance });

    const checkInTimeFormatted = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone
    });

    const attendanceStatus = (finalStatus === 'WORK_FROM_HOME' || finalStatus === 'PRESENT') ? 'PRESENT' : (finalStatus === 'LATE' ? 'LATE' : finalStatus);

    res.status(201).json({
      success: true,
      checkInTime: checkInTimeFormatted,
      attendanceStatus: attendanceStatus,
      message: 'Clocked in successfully.',
      attendance,
      ...attendance
    });
  } catch (error) {
    console.error('[ClockIn Error Details]:', error);
    res.status(500).json({ success: false, reason: 'SERVER_ERROR', message: error.message || 'Clock in failed.', stack: error.stack });
  }
};

const clockOut = async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();

    const settings = await getOrCreateSystemSettings(req.user?.organizationId);
    const timeZone = getSystemTimeZone(settings);
    const todayDate = getTodayZonedDate(now, timeZone);

    const attendance = await prisma.attendance.findUnique({
      where: { userId_date: { userId, date: todayDate } }
    });

    if (!attendance) {
      return res.status(400).json({
        success: false,
        reason: 'NOT_CLOCKED_IN',
        message: 'You have not clocked in today yet.'
      });
    }

    if (attendance.clockOut) {
      return res.status(400).json({
        success: false,
        reason: 'ALREADY_CLOCKED_OUT',
        message: 'You have already clocked out today.'
      });
    }

    // Calculate working decimal hours
    const diffMs = now.getTime() - new Date(attendance.clockIn).getTime();
    const workingHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;

    let status = attendance.status;
    if (workingHours < 4 && status !== 'WORK_FROM_HOME') {
      status = 'HALF_DAY';
    }

    const { latitude, longitude, address, workLocation, workLocationOther, location } = req.body;

    // Validate GPS Coordinates for Manual Clock-Out
    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null || latitude === '' || longitude === '') {
      return res.status(400).json({
        success: false,
        reason: 'LOCATION_REQUIRED',
        message: 'Location permission is required to verify your location before Clock-Out.'
      });
    }

    const userLat = parseFloat(latitude);
    const userLon = parseFloat(longitude);

    if (isNaN(userLat) || isNaN(userLon) || userLat < -90 || userLat > 90 || userLon < -180 || userLon > 180) {
      return res.status(400).json({
        success: false,
        reason: 'LOCATION_REQUIRED',
        message: 'Unable to determine your current location. Please enable location services and try again.'
      });
    }

    const effectiveWorkLocation = workLocation || attendance.workLocation || 'OFFICE';
    const effectiveWorkLocationOther = workLocationOther !== undefined ? workLocationOther : attendance.workLocationOther;

    let matchedLocation = null;
    let distanceMeters = null;

    if (effectiveWorkLocation === 'OFFICE') {
      const assignedLocRecords = await prisma.userAttendanceLocation.findMany({
        where: {
          userId,
          attendanceLocation: { isActive: true }
        },
        include: {
          attendanceLocation: true
        }
      });

      const orgLocationCount = await prisma.attendanceLocation.count({
        where: { organizationId: req.user.organizationId }
      });

      const evalResult = evaluateAttendanceGeofence({
        userLat,
        userLon,
        assignedLocations: assignedLocRecords.map(r => r.attendanceLocation),
        hasOrgLocations: orgLocationCount > 0,
        settings
      });

      if (evalResult.status === 'NO_ASSIGNED_LOCATION') {
        return res.status(400).json({
          success: false,
          reason: 'NO_ASSIGNED_LOCATION',
          message: evalResult.message
        });
      }

      if (!evalResult.isInside) {
        return res.status(400).json({
          success: false,
          reason: 'OUTSIDE_GEOFENCE',
          isOutside: true,
          ...evalResult
        });
      }

      matchedLocation = evalResult.matchedLocation;
      distanceMeters = evalResult.distanceMeters;
    }

    const formattedLocationStr = effectiveWorkLocation === 'OTHER'
      ? (effectiveWorkLocationOther || 'Other').trim()
      : (effectiveWorkLocation === 'HOME' ? 'Home (Remote)' : (matchedLocation ? matchedLocation.name : 'Office'));
    const formattedGeofenceDetails = distanceMeters !== null
      ? `Lat: ${userLat.toFixed(6)}, Lon: ${userLon.toFixed(6)} (${formatDistance(distanceMeters)} from ${matchedLocation ? matchedLocation.name : 'Office'})`
      : `Lat: ${userLat.toFixed(6)}, Lon: ${userLon.toFixed(6)}`;
    const clockOutLocDisplay = location || `${formattedLocationStr} • ${formattedGeofenceDetails}`;
    const clockOutAddr = address || matchedLocation?.address || null;

    const updatedAttendance = await prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        clockOut: now,
        workingHours,
        status,
        clockOutLocation: clockOutLocDisplay,
        clockOutLatitude: userLat,
        clockOutLongitude: userLon,
        clockOutAddress: clockOutAddr,
        clockOutWorkLocation: effectiveWorkLocation,
        clockOutWorkLocationOther: effectiveWorkLocation === 'OTHER' ? (effectiveWorkLocationOther || '').trim() : null,
        autoClockOut: false,
        clockOutReason: 'MANUAL'
      }
    });

    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    await logActivity({
      userId,
      action: 'CLOCK_OUT',
      details: `Clocked out today at ${now.toLocaleTimeString()}. Worked: ${workingHours} hrs. Status: ${status}`,
      ipAddress: ip
    });

    // Broadcast real-time Socket.IO event
    broadcastAttendanceEvent('attendance_clock_out', { userId, record: updatedAttendance });
    broadcastAttendanceEvent('attendance_updated', { userId, record: updatedAttendance });

    const totalMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)));
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    const workingDurationStr = `${String(hrs).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m`;

    const clockOutTimeFormatted = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone
    });

    res.json({
      success: true,
      clockOutTime: clockOutTimeFormatted,
      workingDuration: workingDurationStr,
      workingHours,
      message: `Clocked out successfully. Worked: ${workingDurationStr}.`,
      attendance: updatedAttendance,
      ...updatedAttendance
    });
  } catch (error) {
    console.error('Clock out error:', error);
    res.status(500).json({ success: false, reason: 'SERVER_ERROR', message: 'Clock out failed.' });
  }
};

// Helper to check if shift/attendance day has ended for a given target date
const isShiftEndedForDate = (targetDateObj, now, settings) => {
  const timeZone = getSystemTimeZone(settings);
  const todayZoned = getTodayZonedDate(now, timeZone);

  // If target date is strictly in the past, day has ended
  if (targetDateObj.getTime() < todayZoned.getTime()) {
    return true;
  }
  // If target date is in the future, shift has not ended
  if (targetDateObj.getTime() > todayZoned.getTime()) {
    return false;
  }

  // If target date is today, check if current time in timeZone is past shift end window (default 18:00)
  const shiftEndHour = settings?.shiftEndHour !== undefined ? settings.shiftEndHour : 18;
  const shiftEndMinute = settings?.shiftEndMinute !== undefined ? settings.shiftEndMinute : 0;

  const { hour: currentH, minute: currentM } = getZonedParts(now, timeZone);

  if (currentH > shiftEndHour || (currentH === shiftEndHour && currentM >= shiftEndMinute)) {
    return true;
  }

  return false;
};

const getAttendanceLogs = async (req, res) => {
  try {
    const { userId, status, startDate, endDate } = req.query;
    const { getEffectiveOrgId } = require('../utils/organizationScope');
    const targetOrgId = getEffectiveOrgId(req);

    const settings = await getOrCreateSystemSettings(targetOrgId);
    const timeZone = getSystemTimeZone(settings);
    const now = new Date();
    const todayParts = getZonedParts(now, timeZone);
    const todayDateStr = todayParts.dateStr; // e.g. "2026-09-22"

    // Parse helper for YYYY-MM-DD
    const parseToYMD = (inputVal) => {
      if (!inputVal) return null;
      const str = String(inputVal).trim();
      const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        return {
          year: parseInt(match[1], 10),
          month: parseInt(match[2], 10),
          day: parseInt(match[3], 10),
          dateStr: `${match[1]}-${match[2]}-${match[3]}`
        };
      }
      return null;
    };

    let startYMD = parseToYMD(startDate);
    if (!startYMD) {
      // Default to 60 days ago
      const defaultStart = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day - 60, 0, 0, 0, 0));
      const sY = defaultStart.getUTCFullYear();
      const sM = defaultStart.getUTCMonth() + 1;
      const sD = defaultStart.getUTCDate();
      startYMD = {
        year: sY,
        month: sM,
        day: sD,
        dateStr: `${sY}-${String(sM).padStart(2, '0')}-${String(sD).padStart(2, '0')}`
      };
    }

    let endYMD = parseToYMD(endDate) || { ...todayParts };

    if (startYMD.dateStr > endYMD.dateStr) {
      const temp = startYMD;
      startYMD = endYMD;
      endYMD = temp;
    }

    // STRICT RULE: Attendance Audit Maximum Date = TODAY
    if (endYMD.dateStr > todayDateStr) {
      endYMD = { ...todayParts };
    }

    // If requested range starts after today, return empty list immediately
    if (startYMD.dateStr > todayDateStr) {
      return res.json([]);
    }

    // Generate array of calendar dates within [startYMD, endYMD]
    const dateList = [];
    const curDate = new Date(Date.UTC(startYMD.year, startYMD.month - 1, startYMD.day, 0, 0, 0, 0));
    const endDateLimit = new Date(Date.UTC(endYMD.year, endYMD.month - 1, endYMD.day, 0, 0, 0, 0));

    while (curDate <= endDateLimit) {
      const y = curDate.getUTCFullYear();
      const m = curDate.getUTCMonth() + 1;
      const d = curDate.getUTCDate();
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      dateList.push({
        dateObj: new Date(curDate),
        dateStr,
        dayOfWeek: curDate.getUTCDay() // 0 = Sunday
      });
      curDate.setUTCDate(curDate.getUTCDate() + 1);
    }

    // 2. Determine Active Users Scope (Strictly Attendance-Eligible Roles ONLY)
    let userWhere = {
      status: 'ACTIVE',
      role: { in: ['INTERN', 'EMPLOYEE', 'TEAM_LEADER'] }
    };
    if (req.user.role === 'INTERN' || req.user.role === 'EMPLOYEE') {
      const userTeams = await prisma.teamMember.findMany({
        where: { userId: req.user.id },
        select: { teamId: true }
      });
      const teamIds = userTeams.map((t) => t.teamId);
      if (teamIds.length > 0) {
        const teamMembers = await prisma.teamMember.findMany({
          where: { teamId: { in: teamIds } }
        });
        const teams = await prisma.team.findMany({
          where: { id: { in: teamIds } },
          select: { leaderId: true }
        });
        const allowedIds = teamMembers.map((m) => m.userId);
        teams.forEach((t) => {
          if (t.leaderId) allowedIds.push(t.leaderId);
        });
        allowedIds.push(req.user.id);
        userWhere.id = { in: [...new Set(allowedIds)] };
      } else {
        userWhere.id = req.user.id;
      }
    } else if (req.user.role === 'TEAM_LEADER') {
      if (userId && userId !== 'ALL' && userId !== '') {
        userWhere.id = userId;
      } else {
        const teamMembers = await prisma.teamMember.findMany({
          where: { team: { leaderId: req.user.id } }
        });
        const allowedIds = teamMembers.map((m) => m.userId);
        allowedIds.push(req.user.id);
        userWhere.id = { in: allowedIds };
      }
    } else if ((req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN') && userId && userId !== 'ALL' && userId !== '') {
      userWhere.id = userId;
    }

    if (targetOrgId) {
      userWhere.organizationId = targetOrgId;
    }

    const activeUsers = await prisma.user.findMany({
      where: userWhere,
      select: {
        id: true,
        name: true,
        employeeId: true,
        email: true,
        department: true,
        profilePic: true,
        role: true,
        joiningDate: true,
        createdAt: true
      },
      orderBy: { name: 'asc' }
    });

    const userIds = activeUsers.map(u => u.id);

    // 3. Fetch Real Attendance, Approved Leaves & WorkCalendar for the date range & users
    const queryMinDate = new Date(Date.UTC(startYMD.year, startYMD.month - 1, startYMD.day - 1, 0, 0, 0, 0));
    const queryMaxDate = new Date(Date.UTC(endYMD.year, endYMD.month - 1, endYMD.day + 1, 23, 59, 59, 999));

    const [realAttendances, approvedLeaves, calendarOverrides, permanentHolidays, batchShiftResolver] = await Promise.all([
      prisma.attendance.findMany({
        where: {
          date: { gte: queryMinDate, lte: queryMaxDate },
          userId: { in: userIds }
        },
        include: {
          user: { select: { id: true, name: true, employeeId: true, email: true, department: true, profilePic: true } },
          attendanceLocation: { select: { id: true, name: true, address: true, radiusMeters: true } }
        }
      }),
      prisma.leaveRequest.findMany({
        where: {
          status: 'APPROVED',
          startDate: { lte: queryMaxDate },
          endDate: { gte: queryMinDate },
          userId: { in: userIds }
        }
      }),
      prisma.workCalendar.findMany({
        where: {
          date: { gte: queryMinDate, lte: queryMaxDate },
          ...(targetOrgId ? {
            OR: [
              { organizationId: targetOrgId },
              { organizationId: null, createdBy: { organizationId: targetOrgId } }
            ]
          } : {})
        }
      }),
      prisma.workCalendar.findMany({
        where: {
          isPermanent: true,
          status: 'HOLIDAY',
          ...(targetOrgId ? {
            OR: [
              { organizationId: targetOrgId },
              { organizationId: null, createdBy: { organizationId: targetOrgId } }
            ]
          } : {})
        }
      }),
      shiftService.createBatchShiftResolver({
        userIds,
        organizationId: targetOrgId,
        startDate: queryMinDate,
        endDate: queryMaxDate,
        client: prisma
      })
    ]);

    // Build lookup maps for fast matching
    const attendanceMap = new Map();
    realAttendances.forEach(att => {
      let dStr = null;
      if (att.clockIn) {
        dStr = getZonedParts(att.clockIn, timeZone).dateStr;
      } else if (att.date) {
        dStr = getZonedParts(att.date, timeZone).dateStr;
      }
      if (dStr) {
        attendanceMap.set(`${att.userId}_${dStr}`, att);
      }
    });

    const calendarOverrideMap = new Map();
    calendarOverrides.forEach(item => {
      if (item.date) {
        const itemDStr = getZonedParts(item.date, timeZone).dateStr;
        calendarOverrideMap.set(itemDStr, item);
      }
    });

    const permanentRulesMap = new Map();
    permanentHolidays.forEach(item => {
      if (item.recurrenceMonth && item.recurrenceDay) {
        permanentRulesMap.set(`${item.recurrenceMonth}_${item.recurrenceDay}`, item);
      }
    });

    // 4. Merge into View Model
    const mergedLogs = [];

    for (const { dateObj, dateStr, dayOfWeek } of dateList) {
      const dTime = dateObj.getTime();
      const [curY, curM, curD] = dateStr.split('-').map(Number);

      // Check if date is a company holiday or weekend
      const specificOverride = calendarOverrideMap.get(dateStr);
      const permRule = permanentRulesMap.get(`${curM}_${curD}`);

      let isHoliday = false;
      let holidayTitle = '';

      if (dayOfWeek === 0) {
        // Sunday is default holiday, unless explicitly overridden to WORKING/WFH
        if (specificOverride && (specificOverride.status === 'WORKING' || specificOverride.status === 'WFH')) {
          isHoliday = false;
        } else {
          isHoliday = true;
          holidayTitle = 'Sunday';
        }
      } else if (specificOverride) {
        if (specificOverride.status === 'HOLIDAY') {
          isHoliday = true;
          holidayTitle = specificOverride.title || 'Holiday';
        }
      } else if (permRule) {
        isHoliday = true;
        holidayTitle = permRule.title || 'Holiday';
      }

      for (const u of activeUsers) {
        // STRICT RULE: Attendance audit only starts from each employee's official joining date
        const uEffectiveJoining = u.joiningDate || u.createdAt;
        if (uEffectiveJoining) {
          const uJoiningMidnight = new Date(new Date(uEffectiveJoining).toISOString().split('T')[0] + 'T00:00:00.000Z').getTime();
          if (dTime < uJoiningMidnight) {
            continue; // Skip pre-employment date completely
          }
        }

        const shiftStatusInfo = batchShiftResolver.getDayStatus(u.id, dateObj, timeZone);
        const isShiftHoliday = shiftStatusInfo.isHoliday;
        const shiftName = shiftStatusInfo.shift?.name || 'Shift';

        const key = `${u.id}_${dateStr}`;
        const realAtt = attendanceMap.get(key);

        // 1. Real attendance record exists
        if (realAtt) {
          // If marked ABSENT in DB but falls on a holiday (company or shift), display as HOLIDAY
          if (realAtt.status === 'ABSENT' && (isHoliday || isShiftHoliday)) {
            mergedLogs.push({
              ...realAtt,
              status: 'HOLIDAY',
              holidayTitle: isHoliday ? holidayTitle : `${shiftName} Holiday`,
              date: dateObj
            });
            continue;
          }
          mergedLogs.push({
            ...realAtt,
            date: dateObj // Guarantee strictly matching selected calendar date
          });
          continue;
        }

        // 2. Check if user has an approved leave spanning this date
        const leave = approvedLeaves.find(l => {
          if (l.userId !== u.id) return false;
          const lStart = new Date(l.startDate).toISOString().split('T')[0];
          const lEnd = new Date(l.endDate).toISOString().split('T')[0];
          return dateStr >= lStart && dateStr <= lEnd;
        });

        if (leave) {
          const leaveTypeName = leave.leaveType || leave.type || 'LEAVE';
          const leaveStatusStr = leaveTypeName.toUpperCase().endsWith('LEAVE') || leaveTypeName.toUpperCase() === 'WFH'
            ? leaveTypeName.toUpperCase()
            : `${leaveTypeName.toUpperCase()} LEAVE`;

          mergedLogs.push({
            id: `leave_${u.id}_${dateStr}`,
            isSynthetic: true,
            userId: u.id,
            date: dateObj,
            clockIn: null,
            clockOut: null,
            workingHours: null,
            status: leaveStatusStr,
            leaveType: leaveTypeName,
            user: u
          });
          continue;
        }

        // 3. Company holiday, weekend, or Shift holiday
        if (isHoliday || isShiftHoliday) {
          mergedLogs.push({
            id: `holiday_${u.id}_${dateStr}`,
            isSynthetic: true,
            userId: u.id,
            date: dateObj,
            clockIn: null,
            clockOut: null,
            workingHours: null,
            status: 'HOLIDAY',
            holidayTitle: isHoliday ? holidayTitle : `${shiftName} Holiday`,
            user: u
          });
          continue;
        }

        // 4. No record and no leave: Absent
        mergedLogs.push({
          id: `absent_${u.id}_${dateStr}`,
          isSynthetic: true,
          userId: u.id,
          date: dateObj,
          clockIn: null,
          clockOut: null,
          workingHours: null,
          status: 'ABSENT',
          user: u
        });
      }
    }

    // 5. Apply Status Filter
    let filtered = mergedLogs;
    if (status && status !== 'ALL' && status !== '') {
      const targetS = status.toUpperCase();
      filtered = mergedLogs.filter(log => {
        if (targetS === 'LEAVE') {
          return log.status === 'LEAVE' || log.status.includes('LEAVE') || log.status === 'SICK' || log.status === 'CASUAL';
        }
        if (targetS === 'ABSENT') {
          return log.status === 'ABSENT';
        }
        if (targetS === 'HOLIDAY') {
          return log.status === 'HOLIDAY';
        }
        return log.status === targetS;
      });
    }

    // 6. Sort View Model: date DESC, clockIn DESC (nulls last), user name ASC
    filtered.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      if (dateA !== dateB) return dateB - dateA;

      const timeA = a.clockIn ? new Date(a.clockIn).getTime() : null;
      const timeB = b.clockIn ? new Date(b.clockIn).getTime() : null;

      if (timeA !== null && timeB !== null) {
        if (timeA !== timeB) return timeB - timeA;
      } else if (timeA !== null && timeB === null) {
        return -1;
      } else if (timeA === null && timeB !== null) {
        return 1;
      }

      return (a.user?.name || '').localeCompare(b.user?.name || '');
    });

    res.json(filtered);
  } catch (error) {
    console.error('Get attendance logs error:', error);
    res.status(500).json({ message: 'Failed to retrieve attendance logs.' });
  }
};

const updateAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId: bodyUserId, date: bodyDate, clockIn, clockOut, status, workingHours: clientWorkingHours } = req.body;

    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Only Administrators can edit attendance records.' });
    }

    let record = null;
    let targetUserId = bodyUserId;
    let targetDate = bodyDate ? new Date(bodyDate) : null;

    // Check if real record exists in DB
    if (id && !id.startsWith('pending_') && !id.startsWith('leave_') && !id.startsWith('absent_') && !id.startsWith('holiday_') && !id.startsWith('synthetic_')) {
      record = await prisma.attendance.findUnique({
        where: { id },
        include: { user: true }
      });
    } else if (id && (id.startsWith('pending_') || id.startsWith('leave_') || id.startsWith('absent_') || id.startsWith('holiday_') || id.startsWith('synthetic_'))) {
      const parts = id.split('_');
      if (parts.length >= 3) {
        targetUserId = parts[1];
        targetDate = new Date(`${parts[2]}T00:00:00.000Z`);
      }
    }

    if (!record && (!targetUserId || !targetDate)) {
      return res.status(404).json({ message: 'Attendance record or user/date context not found.' });
    }

    // Rule: Protect Leave Management integration for DB LEAVE records
    if (record && record.status === 'LEAVE' && status && status !== 'LEAVE') {
      return res.status(400).json({ message: 'Approved Leave records are managed via Leave Management. Please resolve leave applications in Leave Management rather than changing Attendance logs directly.' });
    }

    const newStatus = status || (record ? record.status : 'PRESENT');
    const data = {
      status: newStatus,
      editedBy: req.user.id
    };

    const settings = await getOrCreateSystemSettings();
    const timeZone = getSystemTimeZone(settings);

    if (newStatus === 'LEAVE' || newStatus === 'ABSENT') {
      data.clockIn = null;
      data.clockOut = null;
      data.workingHours = 0;
    } else {
      const newClockIn = clockIn ? parseInputDate(clockIn, timeZone) : (record ? record.clockIn : null);
      const newClockOut = clockOut ? parseInputDate(clockOut, timeZone) : (record ? record.clockOut : null);

      if (!newClockIn && newStatus !== 'WORK_FROM_HOME') {
        return res.status(400).json({ message: `Clock In time is required for ${newStatus} status.` });
      }

      if (newClockIn && newClockOut) {
        if (new Date(newClockOut).getTime() < new Date(newClockIn).getTime()) {
          return res.status(400).json({ message: 'Clock Out cannot be earlier than Clock In.' });
        }
        const diffMs = new Date(newClockOut).getTime() - new Date(newClockIn).getTime();
        data.workingHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
      } else if (clientWorkingHours !== undefined && clientWorkingHours !== null) {
        data.workingHours = parseFloat(clientWorkingHours);
      }

      data.clockIn = newClockIn || null;
      data.clockOut = newClockOut || null;

      if (newStatus === 'LATE' && newClockIn) {
        const userObj = record ? record.user : await prisma.user.findUnique({ where: { id: targetUserId } });
        const shiftStartStr = (userObj?.role === 'TEAM_LEADER' || userObj?.role === 'ADMIN')
          ? (settings?.tlShiftStart || '09:30')
          : (settings?.internShiftStart || '09:30');
        const [shiftH, shiftM] = shiftStartStr.split(':').map(Number);

        const { year, month, day } = getZonedParts(newClockIn, timeZone);
        const shiftStart = createZonedDate(year, month, day, shiftH, shiftM, timeZone);

        const diffMins = Math.floor((newClockIn.getTime() - shiftStart.getTime()) / 60000);
        data.lateMinutes = diffMins > 0 ? diffMins : null;
      } else if (newStatus !== 'LATE') {
        data.lateMinutes = null;
      }
    }

    let updated;
    if (record) {
      updated = await prisma.attendance.update({
        where: { id: record.id },
        data,
        include: { user: { select: { id: true, name: true, employeeId: true } } }
      });
    } else {
      updated = await prisma.attendance.upsert({
        where: { userId_date: { userId: targetUserId, date: targetDate } },
        update: data,
        create: {
          userId: targetUserId,
          date: targetDate,
          ...data
        },
        include: { user: { select: { id: true, name: true, employeeId: true } } }
      });
    }

    const prevClockInStr = record && record.clockIn ? record.clockIn.toISOString() : 'NULL';
    const newClockInStr = updated.clockIn ? updated.clockIn.toISOString() : 'NULL';
    const prevClockOutStr = record && record.clockOut ? record.clockOut.toISOString() : 'NULL';
    const newClockOutStr = updated.clockOut ? updated.clockOut.toISOString() : 'NULL';

    await logActivity({
      userId: req.user.id,
      action: 'ATTENDANCE_EDIT',
      details: `Admin (${req.user.name}) edited attendance for ${updated.user.name} (${updated.user.employeeId}) on ${updated.date.toISOString().split('T')[0]}: Status [${record ? record.status : 'PENDING'} -> ${updated.status}], ClockIn [${prevClockInStr} -> ${newClockInStr}], ClockOut [${prevClockOutStr} -> ${newClockOutStr}]`
    });

    broadcastAttendanceEvent('attendance_updated', { userId: updated.userId, record: updated });
    res.json(updated);
  } catch (error) {
    console.error('Update attendance error:', error);
    res.status(500).json({ message: 'Failed to update attendance record.' });
  }
};

const getAttendanceAnalytics = async (req, res) => {
  try {
    const { getEffectiveOrgId } = require('../utils/organizationScope');
    const targetOrgId = getEffectiveOrgId(req);
    const now = new Date();
    const settings = await getOrCreateSystemSettings(targetOrgId);
    const timeZone = getSystemTimeZone(settings);

    const startOfToday = getTodayZonedDate(now, timeZone);
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1);

    const userWhere = { role: { in: ['INTERN', 'EMPLOYEE', 'TEAM_LEADER'] }, status: 'ACTIVE' };
    if (targetOrgId) {
      userWhere.organizationId = targetOrgId;
    }

    const activeUsers = await prisma.user.findMany({
      where: userWhere,
      select: { id: true, joiningDate: true, createdAt: true }
    });
    // Filter active users to only those who have joined on or before today
    const eligibleActiveUsers = activeUsers.filter(u => {
      const uEffective = u.joiningDate || u.createdAt;
      if (!uEffective) return true;
      const uJoining = new Date(new Date(uEffective).toISOString().split('T')[0] + 'T00:00:00.000Z');
      return uJoining <= startOfToday;
    });
    const totalMembersCount = eligibleActiveUsers.length;
    const userIds = eligibleActiveUsers.map(u => u.id);

    const todayAttendances = await prisma.attendance.findMany({
      where: {
        date: { gte: startOfToday, lte: endOfToday },
        userId: { in: userIds }
      }
    });

    const todayApprovedLeaves = await prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        startDate: { lte: endOfToday },
        endDate: { gte: startOfToday },
        userId: { in: userIds }
      }
    });

    const dayEnded = isShiftEndedForDate(startOfToday, now, settings);

    const presentCount = todayAttendances.filter((a) => a.status === 'PRESENT' || a.status === 'WORK_FROM_HOME').length;
    const lateCount = todayAttendances.filter((a) => a.status === 'LATE').length;
    const halfDayCount = todayAttendances.filter((a) => a.status === 'HALF_DAY').length;

    const usersWithActivity = new Set([
      ...todayAttendances.map(a => a.userId),
      ...todayApprovedLeaves.map(l => l.userId)
    ]);
    const absentCount = userIds.filter(id => !usersWithActivity.has(id)).length;

    res.json({
      totalInterns: totalMembersCount,
      totalMembers: totalMembersCount,
      presentToday: presentCount,
      lateToday: lateCount,
      halfDayToday: halfDayCount,
      absentToday: absentCount
    });
  } catch (error) {
    console.error('Attendance analytics error:', error);
    res.status(500).json({ message: 'Failed to retrieve attendance analytics.' });
  }
};

const getAttendanceHistory = async (req, res) => {
  try {
    const targetUserId = (['ADMIN', 'SUPER_ADMIN'].includes(req.user.role) && req.query.userId)
      ? req.query.userId
      : req.user.id;

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));

    const { status, workLocation, month, year } = req.query;

    const now = new Date();
    const settings = await getOrCreateSystemSettings(req.user?.organizationId);
    const timeZone = getSystemTimeZone(settings);
    const todayZoned = getTodayZonedDate(now, timeZone);

    const selMonth = parseInt(month) || (todayZoned.getUTCMonth() + 1);
    const selYear = parseInt(year) || todayZoned.getUTCFullYear();

    // Fetch target user's joiningDate & organizationId
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, joiningDate: true, createdAt: true, organizationId: true }
    });

    const effectiveJoining = targetUser?.joiningDate || targetUser?.createdAt;
    const targetUserJoiningMidnight = effectiveJoining
      ? new Date(new Date(effectiveJoining).toISOString().split('T')[0] + 'T00:00:00.000Z')
      : null;

    // 1. Determine month boundaries
    const startOfMonth = new Date(Date.UTC(selYear, selMonth - 1, 1));
    const endOfMonth = new Date(Date.UTC(selYear, selMonth, 0, 23, 59, 59));

    // 2. Fetch existing DB attendance records, company holidays & shift resolver
    const [dbAttendances, holidays, workCalendarOverrides, permanentHolidays, batchShiftResolver] = await Promise.all([
      prisma.attendance.findMany({
        where: {
          userId: targetUserId,
          date: { gte: startOfMonth, lte: endOfMonth }
        },
        include: {
          user: {
            select: { id: true, name: true, email: true, employeeId: true, role: true, department: true }
          },
          attendanceLocation: {
            select: { id: true, name: true, address: true, radiusMeters: true }
          }
        }
      }),
      prisma.holidayCalendar.findMany({
        where: {
          date: { gte: startOfMonth, lte: endOfMonth },
          ...(targetUser?.organizationId ? { organizationId: targetUser.organizationId } : {})
        }
      }),
      prisma.workCalendar.findMany({
        where: {
          date: { gte: startOfMonth, lte: endOfMonth },
          status: 'HOLIDAY',
          ...(targetUser?.organizationId ? {
            OR: [
              { organizationId: targetUser.organizationId },
              { organizationId: null, createdBy: { organizationId: targetUser.organizationId } }
            ]
          } : {})
        }
      }),
      prisma.workCalendar.findMany({
        where: {
          isPermanent: true,
          status: 'HOLIDAY',
          recurrenceMonth: selMonth,
          ...(targetUser?.organizationId ? {
            OR: [
              { organizationId: targetUser.organizationId },
              { organizationId: null, createdBy: { organizationId: targetUser.organizationId } }
            ]
          } : {})
        }
      }),
      shiftService.createBatchShiftResolver({
        userIds: [targetUserId],
        organizationId: targetUser?.organizationId,
        startDate: startOfMonth,
        endDate: endOfMonth,
        client: prisma
      })
    ]);

    const attMap = new Map();
    dbAttendances.forEach(a => {
      const dStr = new Date(a.date).toISOString().split('T')[0];
      attMap.set(dStr, a);
    });

    const holidayDateMap = new Map();
    holidays.forEach(h => {
      if (h.date) holidayDateMap.set(new Date(h.date).toISOString().split('T')[0], h.title || 'Company Holiday');
    });
    workCalendarOverrides.forEach(w => {
      if (w.date) holidayDateMap.set(new Date(w.date).toISOString().split('T')[0], w.title || 'Company Holiday');
    });

    const permDayMap = new Map();
    permanentHolidays.forEach(p => {
      if (p.recurrenceDay) permDayMap.set(p.recurrenceDay, p.title || 'Company Holiday');
    });

    // 3. Generate all valid historical dates up to TODAY (clamped to todayZoned)
    const generatedLogs = [];
    const maxDate = endOfMonth < todayZoned ? endOfMonth : todayZoned;

    const curr = new Date(startOfMonth);
    while (curr <= maxDate) {
      const dateStr = curr.toISOString().split('T')[0];
      const currMidnight = new Date(`${dateStr}T00:00:00.000Z`);

      // STRICT RULE: Calendar history starts from joiningDate onwards
      if (targetUserJoiningMidnight && currMidnight < targetUserJoiningMidnight) {
        curr.setUTCDate(curr.getUTCDate() + 1);
        continue; // Skip pre-joining date (never generate ABSENT, HOLIDAY, or NOT_CHECKED_IN)
      }
      const dayOfWeek = curr.getUTCDay(); // 0 = Sunday, 6 = Saturday
      const dayOfMonth = curr.getUTCDate();
      const isSunday = dayOfWeek === 0;

      let isCompanyHoliday = false;
      let companyHolidayTitle = '';
      if (holidayDateMap.has(dateStr)) {
        isCompanyHoliday = true;
        companyHolidayTitle = holidayDateMap.get(dateStr);
      } else if (permDayMap.has(dayOfMonth)) {
        isCompanyHoliday = true;
        companyHolidayTitle = permDayMap.get(dayOfMonth);
      }

      const shiftStatusInfo = batchShiftResolver.getDayStatus(targetUserId, curr, timeZone);
      const isShiftHoliday = shiftStatusInfo.isHoliday;
      const shiftName = shiftStatusInfo.shift?.name || 'Shift';

      const existingRecord = attMap.get(dateStr);

      if (existingRecord) {
        // If marked ABSENT in DB but falls on a holiday (company, Sunday, or shift), display as HOLIDAY
        if (existingRecord.status === 'ABSENT' && (isSunday || isCompanyHoliday || isShiftHoliday)) {
          generatedLogs.push({
            ...existingRecord,
            status: 'HOLIDAY',
            holidayTitle: isCompanyHoliday ? companyHolidayTitle : isSunday ? 'Sunday' : `${shiftName} Holiday`
          });
        } else {
          generatedLogs.push(existingRecord);
        }
      } else if (isSunday || isCompanyHoliday || isShiftHoliday) {
        generatedLogs.push({
          id: `holiday-${dateStr}`,
          userId: targetUserId,
          date: new Date(curr),
          status: 'HOLIDAY',
          holidayTitle: isCompanyHoliday ? companyHolidayTitle : isSunday ? 'Sunday' : `${shiftName} Holiday`,
          clockIn: null,
          clockOut: null,
          workLocation: null,
          workingHours: null
        });
      } else {
        const isToday = dateStr === todayZoned.toISOString().split('T')[0];
        if (isToday) {
          generatedLogs.push({
            id: `today-pending-${dateStr}`,
            userId: targetUserId,
            date: new Date(curr),
            status: 'NOT_CHECKED_IN',
            clockIn: null,
            clockOut: null,
            workLocation: null,
            workingHours: null
          });
        } else {
          generatedLogs.push({
            id: `absent-${dateStr}`,
            userId: targetUserId,
            date: new Date(curr),
            status: 'ABSENT',
            clockIn: null,
            clockOut: null,
            workLocation: null,
            workingHours: null
          });
        }
      }

      curr.setUTCDate(curr.getUTCDate() + 1);
    }

    // 6. Sort Newest First (Descending by date)
    generatedLogs.sort((a, b) => new Date(b.date) - new Date(a.date));

    // 7. Apply Filters (status, workLocation)
    let filteredLogs = generatedLogs;

    if (status && status !== 'ALL') {
      filteredLogs = filteredLogs.filter(l => l.status === status);
    }

    if (workLocation && workLocation !== 'ALL') {
      filteredLogs = filteredLogs.filter(l => l.workLocation === workLocation);
    }

    // 8. Apply Pagination
    const total = filteredLogs.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;
    const paginatedRecords = filteredLogs.slice(skip, skip + limit);

    res.json({
      success: true,
      records: paginatedRecords,
      total,
      page,
      limit,
      totalPages
    });
  } catch (error) {
    console.error('Get attendance history error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve attendance history.' });
  }
};

const getCompanyLeaveReport = async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
      return res.status(403).json({ message: 'Access denied: Admin or Super Admin permissions required for Company Leave Audit.' });
    }

    const targetOrgId = getEffectiveOrgId(req);
    const { month, year, startDate, endDate, departmentId, role, search } = req.query;

    // Fetch Organization details
    let organization = null;
    if (targetOrgId) {
      organization = await prisma.organization.findUnique({
        where: { id: targetOrgId },
        select: { id: true, name: true, slug: true, companyCode: true }
      });
    }

    // Determine target month and year
    let targetYear = new Date().getFullYear();
    let targetMonth = new Date().getMonth() + 1; // 1-12
    let monthParamStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;

    if (month && typeof month === 'string' && month.includes('-')) {
      const parts = month.split('-');
      targetYear = parseInt(parts[0], 10);
      targetMonth = parseInt(parts[1], 10);
      monthParamStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
    } else if (month) {
      targetMonth = parseInt(month, 10);
      if (year) targetYear = parseInt(year, 10);
      monthParamStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
    } else if (year) {
      targetYear = parseInt(year, 10);
      monthParamStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
    }

    const monthStart = new Date(Date.UTC(targetYear, targetMonth - 1, 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(targetYear, targetMonth, 0, 23, 59, 59, 999));

    // Build User filter - Exclude ADMIN and SUPER_ADMIN from employee list
    const userWhere = {
      ...(targetOrgId ? { organizationId: targetOrgId } : {}),
      status: 'ACTIVE',
      role: role ? role.toUpperCase() : { notIn: ['ADMIN', 'SUPER_ADMIN'] },
      ...(departmentId ? { departmentId } : {}),
      ...(search ? {
        OR: [
          { name: { contains: search } },
          { email: { contains: search } },
          { employeeId: { contains: search } }
        ]
      } : {})
    };

    const users = await prisma.user.findMany({
      where: userWhere,
      select: {
        id: true,
        name: true,
        email: true,
        employeeId: true,
        role: true,
        department: true,
        departmentId: true,
        departmentRef: { select: { id: true, name: true } },
        profilePic: true,
        casualLeaveQuota: true,
        sickLeaveQuota: true,
        emergencyLeaveQuota: true,
        status: true,
        joiningDate: true
      },
      orderBy: { name: 'asc' }
    });

    const userIds = users.map(u => u.id);

    // Build Leave Request query
    const leaveWhere = {
      userId: { in: userIds },
      AND: [
        { endDate: { gte: monthStart } },
        { startDate: { lte: monthEnd } }
      ]
    };

    const leaveRequests = await prisma.leaveRequest.findMany({
      where: leaveWhere,
      include: {
        user: { select: { id: true, name: true, employeeId: true } }
      },
      orderBy: { startDate: 'desc' }
    });

    const availableLeaveTypes = ["Casual", "Sick", "WFH"];

    // Aggregate User level leave stats
    const employeesReport = users.map(u => {
      const allocatedPaid = (u.casualLeaveQuota || 12) + (u.sickLeaveQuota || 12) + (u.emergencyLeaveQuota || 6);

      const userLeaves = leaveRequests.filter(l => l.userId === u.id);
      const approvedLeaves = userLeaves.filter(l => l.status === 'APPROVED');

      let paidDaysUsed = 0;
      let unpaidDaysUsed = 0;
      const leaveTypes = {
        Casual: 0,
        Sick: 0,
        WFH: 0,
        casual: 0,
        sick: 0,
        wfh: 0
      };

      approvedLeaves.forEach(l => {
        const days = Number(l.totalDays || 1);
        const lType = (l.leaveType || l.type || 'CASUAL').toLowerCase();
        const pType = (l.payType || 'PAID').toUpperCase();

        if (pType === 'UNPAID' || lType === 'unpaid') {
          unpaidDaysUsed += days;
        } else {
          paidDaysUsed += days;
          if (lType === 'casual') {
            leaveTypes.Casual += days;
            leaveTypes.casual += days;
          } else if (lType === 'sick') {
            leaveTypes.Sick += days;
            leaveTypes.sick += days;
          } else if (lType === 'wfh') {
            leaveTypes.WFH += days;
            leaveTypes.wfh += days;
          } else {
            leaveTypes.Casual += days;
            leaveTypes.casual += days;
          }
        }
      });

      const remainingBalance = Math.max(0, allocatedPaid - paidDaysUsed);
      const departmentName = u.departmentRef?.name || u.department || 'General';

      return {
        id: u.id,
        name: u.name,
        email: u.email,
        employeeId: u.employeeId || 'EM-1001',
        role: u.role,
        department: departmentName,
        departmentId: u.departmentId || null,
        avatar: u.profilePic || null,
        allocatedPaid,
        paid: paidDaysUsed,
        unpaid: unpaidDaysUsed,
        balance: remainingBalance,
        leaveTypes,
        casualUsed: leaveTypes.casual,
        sickUsed: leaveTypes.sick,
        emergencyUsed: 0,
        totalAppliedLeaves: userLeaves.length,
        leavesHistory: userLeaves.map(l => ({
          id: l.id,
          startDate: l.startDate,
          endDate: l.endDate,
          totalDays: l.totalDays,
          leaveType: l.leaveType || l.type || 'CASUAL',
          payType: l.payType || 'PAID',
          status: l.status,
          reason: l.reason,
          subject: l.subject
        }))
      };
    });

    const totalEmployeesCount = employeesReport.length;
    const totalPaidLeaves = employeesReport.reduce((acc, curr) => acc + curr.paid, 0);
    const totalUnpaidLeaves = employeesReport.reduce((acc, curr) => acc + curr.unpaid, 0);
    const totalRemainingBalance = employeesReport.reduce((acc, curr) => acc + curr.balance, 0);

    // Department Breakdown
    const deptMap = new Map();
    employeesReport.forEach(emp => {
      const deptName = emp.department || 'General';
      if (!deptMap.has(deptName)) {
        deptMap.set(deptName, {
          departmentId: emp.departmentId || deptName,
          departmentName: deptName,
          employeesCount: 0,
          paidLeaves: 0,
          unpaidLeaves: 0,
          balance: 0
        });
      }
      const deptStats = deptMap.get(deptName);
      deptStats.employeesCount += 1;
      deptStats.paidLeaves += emp.paid;
      deptStats.unpaidLeaves += emp.unpaid;
      deptStats.balance += emp.balance;
    });

    const departmentBreakdown = Array.from(deptMap.values());

    // Leave Type Breakdown
    const leaveTypeBreakdown = {
      Casual: employeesReport.reduce((acc, emp) => acc + emp.leaveTypes.Casual, 0),
      Sick: employeesReport.reduce((acc, emp) => acc + emp.leaveTypes.Sick, 0),
      WFH: employeesReport.reduce((acc, emp) => acc + emp.leaveTypes.WFH, 0),
      casual: employeesReport.reduce((acc, emp) => acc + emp.leaveTypes.casual, 0),
      sick: employeesReport.reduce((acc, emp) => acc + emp.leaveTypes.sick, 0),
      wfh: employeesReport.reduce((acc, emp) => acc + emp.leaveTypes.wfh, 0),
      unpaid: totalUnpaidLeaves
    };

    const dateObj = new Date(targetYear, targetMonth - 1, 1);
    const reportingPeriod = dateObj.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    return res.json({
      month: monthParamStr,
      company: organization?.name || 'INNOVEITY Workspace',
      availableLeaveTypes,
      summary: {
        totalEmployees: totalEmployeesCount,
        paidLeaves: totalPaidLeaves,
        unpaidLeaves: totalUnpaidLeaves,
        balance: totalRemainingBalance
      },
      employees: employeesReport,
      departmentBreakdown,
      leaveTypeBreakdown,
      reportingPeriod,
      organization: organization || { name: 'INNOVEITY Workspace' }
    });
  } catch (error) {
    console.error('Get company leave report error:', error);
    return res.status(500).json({ message: 'Failed to generate company leave audit report.' });
  }
};

const verifyLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null || latitude === '' || longitude === '') {
      return res.status(400).json({
        success: false,
        reason: 'LOCATION_REQUIRED',
        message: 'Location coordinates are required.'
      });
    }

    const userLat = parseFloat(latitude);
    const userLon = parseFloat(longitude);
    if (isNaN(userLat) || userLat < -90 || userLat > 90 || isNaN(userLon) || userLon < -180 || userLon > 180) {
      return res.status(400).json({
        success: false,
        reason: 'LOCATION_REQUIRED',
        message: 'Invalid GPS coordinates.'
      });
    }

    const userId = req.user.id;
    const settings = await getOrCreateSystemSettings(req.user?.organizationId);

    const assignedLocRecords = await prisma.userAttendanceLocation.findMany({
      where: {
        userId,
        attendanceLocation: { isActive: true }
      },
      include: {
        attendanceLocation: true
      }
    });

    const hasOrgLocations = (await prisma.attendanceLocation.count({
      where: { organizationId: req.user.organizationId }
    })) > 0;

    const evalResult = evaluateAttendanceGeofence({
      userLat,
      userLon,
      assignedLocations: assignedLocRecords.map(r => r.attendanceLocation),
      hasOrgLocations,
      settings
    });

    return res.json({
      success: true,
      ...evalResult
    });
  } catch (error) {
    console.error('Verify location error:', error);
    return res.status(500).json({
      success: false,
      reason: 'SERVER_ERROR',
      message: 'Failed to verify attendance location.'
    });
  }
};

const getAttendanceById = async (req, res) => {
  try {
    const { id } = req.params;
    const targetOrgId = getEffectiveOrgId(req);

    const record = await prisma.attendance.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            employeeId: true,
            email: true,
            department: true,
            profilePic: true,
            role: true,
            organizationId: true
          }
        },
        attendanceLocation: {
          select: {
            id: true,
            name: true,
            address: true,
            radiusMeters: true,
            latitude: true,
            longitude: true
          }
        }
      }
    });

    if (!record) {
      return res.status(404).json({ success: false, message: 'Attendance record not found.' });
    }

    // Organization tenant isolation check
    if (targetOrgId && record.user?.organizationId && record.user.organizationId !== targetOrgId && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Access denied to this organization record.' });
    }

    // Role permission check: Interns/Employees can only view their own
    if (['INTERN', 'EMPLOYEE'].includes(req.user.role) && record.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    return res.json({ success: true, record });
  } catch (error) {
    console.error('Error fetching attendance by id:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch attendance record.' });
  }
};

module.exports = {
  getClockInStatus,
  clockIn,
  clockOut,
  getAttendanceLogs,
  updateAttendance,
  getAttendanceAnalytics,
  getAttendanceHistory,
  getCompanyLeaveReport,
  verifyLocation,
  getAttendanceById
};

