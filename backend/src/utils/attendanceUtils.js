const format12Hour = (dateObj, timeZone = 'Asia/Kolkata') => {
  return dateObj.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone
  });
};

const getSystemTimeZone = (settings) => {
  return settings?.timeZone || process.env.SYSTEM_TIMEZONE || 'Asia/Kolkata';
};

const getZonedParts = (date = new Date(), timeZone = 'Asia/Kolkata') => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = {};
  formatter.formatToParts(date).forEach(p => {
    if (p.type !== 'literal') parts[p.type] = p.value;
  });

  const year = parseInt(parts.year, 10);
  const month = parseInt(parts.month, 10);
  const day = parseInt(parts.day, 10);
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(parts.minute, 10);
  const second = parseInt(parts.second, 10);

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, day, hour, minute, second, dateStr };
};

// Returns a UTC Date object representing a specific local year, month, day, hour, min in the given timeZone
const createZonedDate = (year, month, day, hour, minute, timeZone = 'Asia/Kolkata') => {
  const utcCandidate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const zoned = getZonedParts(utcCandidate, timeZone);
  
  const targetMinutes = zoned.hour * 60 + zoned.minute;
  const nominalMinutes = hour * 60 + minute;
  let diffMinutes = targetMinutes - nominalMinutes;

  if (diffMinutes > 720) diffMinutes -= 1440;
  if (diffMinutes < -720) diffMinutes += 1440;

  return new Date(utcCandidate.getTime() - diffMinutes * 60 * 1000);
};

// Returns standard UTC Date for today's midnight in configured timeZone
const getTodayZonedDate = (now = new Date(), timeZone = 'Asia/Kolkata') => {
  const { year, month, day } = getZonedParts(now, timeZone);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
};

const getShiftWindowDates = (role, settings, now = new Date(), userShift = null) => {
  const timeZone = getSystemTimeZone(settings);
  const shiftStartStr = userShift?.startTime || (
    (role === 'TEAM_LEADER' || role === 'ADMIN')
      ? (settings?.tlShiftStart || '09:30')
      : (settings?.internShiftStart || '09:30')
  );

  const earlyWindowMins = settings?.earlyWindowMinutes !== undefined ? settings.earlyWindowMinutes : 30;
  const gracePeriodMins = settings?.gracePeriodMinutes !== undefined ? settings.gracePeriodMinutes : 15;

  const [startHour, startMin] = shiftStartStr.split(':').map(Number);
  const { year, month, day } = getZonedParts(now, timeZone);

  const shiftStart = createZonedDate(year, month, day, startHour, startMin, timeZone);
  const windowOpen = new Date(shiftStart.getTime() - earlyWindowMins * 60 * 1000);
  const windowClose = new Date(shiftStart.getTime() + gracePeriodMins * 60 * 1000);

  return {
    timeZone,
    shiftStartStr,
    earlyWindowMins,
    gracePeriodMins,
    shiftStart,
    windowOpen,
    windowClose,
    windowOpenFormatted: format12Hour(windowOpen, timeZone),
    shiftStartFormatted: format12Hour(shiftStart, timeZone),
    windowCloseFormatted: format12Hour(windowClose, timeZone),
    currentTimeFormatted: format12Hour(now, timeZone)
  };
};

const validateAttendanceWindow = ({ userRole, settings, attendanceRecord, approvedLeave, now = new Date(), userShift = null }) => {
  const windowInfo = getShiftWindowDates(userRole, settings, now, userShift);

  let state = 'BEFORE_WINDOW';
  let canClockIn = false;
  let canClockOut = false;
  let attendanceStatus = 'NOT_CLOCKED_IN';
  let reason = null;
  let lateMinutes = null;

  if (attendanceRecord) {
    attendanceStatus = attendanceRecord.status;
    if (attendanceRecord.clockOut) {
      state = 'CLOCKED_OUT';
      canClockIn = false;
      canClockOut = false;
      reason = 'ALREADY_CLOCKED_OUT';
    } else {
      state = 'ALREADY_CLOCKED_IN';
      canClockIn = false;
      canClockOut = true;
      reason = 'ALREADY_CLOCKED_IN';
    }
  } else if (userShift?.todayStatus === 'Holiday') {
    state = 'HOLIDAY';
    canClockIn = false;
    canClockOut = false;
    reason = userShift?.isSaturdayLeave ? 'SATURDAY_LEAVE' : 'HOLIDAY';
    attendanceStatus = 'HOLIDAY';
  } else if (approvedLeave && approvedLeave.type === 'WFH') {
    state = 'APPROVED_WFH';
    canClockIn = true;
    canClockOut = false;
    attendanceStatus = 'WORK_FROM_HOME';
    reason = null;
  } else if (userShift?.todayStatus === 'WFH') {
    if (now < windowInfo.windowOpen) {
      state = 'BEFORE_WINDOW';
      canClockIn = false;
      canClockOut = false;
      reason = 'SHIFT_NOT_STARTED';
      attendanceStatus = 'WORK_FROM_HOME';
    } else if (now >= windowInfo.windowOpen && now <= windowInfo.windowClose) {
      state = 'OPEN_ON_TIME';
      canClockIn = true;
      canClockOut = false;
      attendanceStatus = 'WORK_FROM_HOME';
      reason = null;
    } else {
      state = 'OPEN_LATE';
      canClockIn = true;
      canClockOut = false;
      attendanceStatus = 'WORK_FROM_HOME';
      reason = null;
      const diffMs = now.getTime() - windowInfo.windowClose.getTime();
      lateMinutes = Math.floor(diffMs / (1000 * 60));
    }
  } else if (now < windowInfo.windowOpen) {
    state = 'BEFORE_WINDOW';
    canClockIn = false;
    canClockOut = false;
    reason = 'SHIFT_NOT_STARTED';
  } else if (now >= windowInfo.windowOpen && now <= windowInfo.windowClose) {
    state = 'OPEN_ON_TIME';
    canClockIn = true;
    canClockOut = false;
    attendanceStatus = 'NOT_CLOCKED_IN';
    reason = null;
  } else {
    state = 'OPEN_LATE';
    canClockIn = true;
    canClockOut = false;
    attendanceStatus = 'NOT_CLOCKED_IN';
    reason = null;
    const diffMs = now.getTime() - windowInfo.windowClose.getTime();
    lateMinutes = Math.floor(diffMs / (1000 * 60));
  }

  // Always output Diagnostics to stdout/PM2 for real-time production troubleshooting
  console.log(`[AttendanceEngine] Diagnostics:`, {
    serverISO: now.toISOString(),
    serverUTCString: now.toUTCString(),
    configuredTimeZone: windowInfo.timeZone,
    envTimeZone: process.env.SYSTEM_TIMEZONE || 'Not Set',
    currentTimeFormatted: windowInfo.currentTimeFormatted,
    role: userRole,
    rawDbSettings: {
      internShiftStart: settings?.internShiftStart,
      tlShiftStart: settings?.tlShiftStart,
      earlyWindowMinutes: settings?.earlyWindowMinutes,
      gracePeriodMinutes: settings?.gracePeriodMinutes,
      timeZone: settings?.timeZone
    },
    shiftStartStr: windowInfo.shiftStartStr,
    windowOpenFormatted: windowInfo.windowOpenFormatted,
    shiftStartFormatted: windowInfo.shiftStartFormatted,
    windowCloseFormatted: windowInfo.windowCloseFormatted,
    state,
    canClockIn,
    canClockOut,
    reason,
    lateMinutes
  });

  return {
    canClockIn,
    canClockOut,
    state,
    reason,
    attendanceStatus,
    serverTime: now.toISOString(),
    timeZone: windowInfo.timeZone,
    windowOpenTime: windowInfo.windowOpen.toISOString(),
    shiftStartTime: windowInfo.shiftStart.toISOString(),
    windowCloseTime: windowInfo.windowClose.toISOString(),
    windowOpenFormatted: windowInfo.windowOpenFormatted,
    shiftStartFormatted: windowInfo.shiftStartFormatted,
    windowCloseFormatted: windowInfo.windowCloseFormatted,
    currentTimeFormatted: windowInfo.currentTimeFormatted,
    earlyWindowMins: windowInfo.earlyWindowMins,
    gracePeriodMins: windowInfo.gracePeriodMins,
    lateMinutes
  };
};

const calculateHaversineDistance = (lat1, lon1, lat2, lon2) => {
  const numLat1 = parseFloat(lat1);
  const numLon1 = parseFloat(lon1);
  const numLat2 = parseFloat(lat2);
  const numLon2 = parseFloat(lon2);

  if (isNaN(numLat1) || isNaN(numLon1) || isNaN(numLat2) || isNaN(numLon2)) {
    return NaN;
  }

  const R = 6371000; // Radius of Earth in meters
  const dLat = (numLat2 - numLat1) * (Math.PI / 180);
  const dLon = (numLon2 - numLon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(numLat1 * (Math.PI / 180)) * Math.cos(numLat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in meters
};

const formatDistance = (meters) => {
  if (meters === null || meters === undefined || isNaN(meters)) return 'Unknown';
  const m = Math.round(meters);
  if (m < 1000) {
    return `${m} m`;
  }
  const km = (m / 1000).toFixed(1);
  return `${km} km`;
};

const evaluateAttendanceGeofence = ({
  userLat,
  userLon,
  assignedLocations = [],
  hasOrgLocations = false,
  settings = {}
}) => {
  const numLat = parseFloat(userLat);
  const numLon = parseFloat(userLon);

  if (isNaN(numLat) || isNaN(numLon) || numLat < -90 || numLat > 90 || numLon < -180 || numLon > 180) {
    return {
      isValid: false,
      status: 'GPS_ERROR',
      isInside: false,
      message: 'Invalid GPS coordinates.'
    };
  }

  // Active assigned locations take precedence
  const activeAssignedLocations = assignedLocations.filter(loc => loc && (loc.isActive !== false));

  if (activeAssignedLocations.length > 0) {
    let nearestLocation = null;
    let minDistance = Infinity;
    let matchedLocation = null;
    let matchedDistance = Infinity;

    for (const loc of activeAssignedLocations) {
      const dist = calculateHaversineDistance(numLat, numLon, loc.latitude, loc.longitude);
      if (!isNaN(dist)) {
        if (dist < minDistance) {
          minDistance = dist;
          nearestLocation = loc;
        }
        if (dist <= loc.radiusMeters && dist < matchedDistance) {
          matchedDistance = dist;
          matchedLocation = loc;
        }
      }
    }

    if (matchedLocation) {
      return {
        isValid: true,
        isInside: true,
        status: 'INSIDE',
        matchedLocation: {
          id: matchedLocation.id,
          name: matchedLocation.name,
          radiusMeters: matchedLocation.radiusMeters,
          latitude: matchedLocation.latitude,
          longitude: matchedLocation.longitude
        },
        nearestLocation: {
          id: matchedLocation.id,
          name: matchedLocation.name,
          radiusMeters: matchedLocation.radiusMeters,
          latitude: matchedLocation.latitude,
          longitude: matchedLocation.longitude
        },
        locationName: matchedLocation.name,
        distanceMeters: Math.round(matchedDistance),
        allowedRadiusMeters: matchedLocation.radiusMeters,
        formattedDistance: formatDistance(matchedDistance),
        message: 'You are within the permitted location.'
      };
    } else {
      return {
        isValid: true,
        isInside: false,
        status: 'OUTSIDE',
        matchedLocation: null,
        nearestLocation: nearestLocation ? {
          id: nearestLocation.id,
          name: nearestLocation.name,
          radiusMeters: nearestLocation.radiusMeters,
          latitude: nearestLocation.latitude,
          longitude: nearestLocation.longitude
        } : null,
        locationName: nearestLocation ? nearestLocation.name : 'Office',
        distanceMeters: minDistance !== Infinity ? Math.round(minDistance) : null,
        allowedRadiusMeters: nearestLocation ? nearestLocation.radiusMeters : null,
        formattedDistance: minDistance !== Infinity ? formatDistance(minDistance) : null,
        message: nearestLocation
          ? `You are currently outside the permitted location "${nearestLocation.name}" (${formatDistance(minDistance)} away). Allowed radius is ${nearestLocation.radiusMeters}m.`
          : 'You are outside your allowed attendance locations.'
      };
    }
  }

  // If user has no assigned locations, but organization has defined locations
  if (hasOrgLocations) {
    return {
      isValid: true,
      isInside: false,
      status: 'NO_ASSIGNED_LOCATION',
      matchedLocation: null,
      nearestLocation: null,
      locationName: null,
      distanceMeters: null,
      allowedRadiusMeters: null,
      formattedDistance: null,
      message: 'No attendance location has been assigned to your account. Please contact your administrator.'
    };
  }

  // Fallback to legacy single office geofence for unmigrated organizations
  const officeLat = settings?.officeLatitude ?? 12.971598;
  const officeLon = settings?.officeLongitude ?? 77.594562;
  const allowedRadius = settings?.allowedRadiusMeters ?? 200.0;
  const officeName = settings?.officeLocationName || 'Innoveity Headquarters';
  const dist = calculateHaversineDistance(numLat, numLon, officeLat, officeLon);
  const isWithin = !isNaN(dist) && dist <= allowedRadius;

  if (isWithin) {
    return {
      isValid: true,
      isInside: true,
      status: 'INSIDE',
      matchedLocation: {
        id: 'legacy-office',
        name: officeName,
        radiusMeters: allowedRadius,
        latitude: officeLat,
        longitude: officeLon
      },
      nearestLocation: {
        id: 'legacy-office',
        name: officeName,
        radiusMeters: allowedRadius,
        latitude: officeLat,
        longitude: officeLon
      },
      locationName: officeName,
      distanceMeters: Math.round(dist),
      allowedRadiusMeters: allowedRadius,
      formattedDistance: formatDistance(dist),
      message: 'You are within the permitted location.'
    };
  } else {
    return {
      isValid: true,
      isInside: false,
      status: 'OUTSIDE',
      matchedLocation: null,
      nearestLocation: {
        id: 'legacy-office',
        name: officeName,
        radiusMeters: allowedRadius,
        latitude: officeLat,
        longitude: officeLon
      },
      locationName: officeName,
      distanceMeters: Math.round(dist),
      allowedRadiusMeters: allowedRadius,
      formattedDistance: formatDistance(dist),
      message: `You are currently outside the permitted location (${formatDistance(dist)} away). Allowed radius is ${allowedRadius}m.`
    };
  }
};

module.exports = {
  format12Hour,
  getSystemTimeZone,
  getZonedParts,
  createZonedDate,
  getTodayZonedDate,
  getShiftWindowDates,
  validateAttendanceWindow,
  calculateHaversineDistance,
  formatDistance,
  evaluateAttendanceGeofence
};

