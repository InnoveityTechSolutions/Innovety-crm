/**
 * Formats late duration in minutes into human-readable hours and minutes.
 * Examples:
 *   0 -> ""
 *   1 -> "Late by 1 min"
 *   45 -> "Late by 45 mins"
 *   60 -> "Late by 1 hr"
 *   61 -> "Late by 1 hr 1 min"
 *   120 -> "Late by 2 hrs"
 *   125 -> "Late by 2 hrs 5 mins"
 *   244 -> "Late by 4 hrs 4 mins"
 */
export const formatLateDuration = (totalMinutes) => {
  if (!totalMinutes || totalMinutes <= 0) return '';
  const minsNum = Number(totalMinutes);
  const hours = Math.floor(minsNum / 60);
  const remainingMins = minsNum % 60;

  const hrStr = hours > 0 ? `${hours} ${hours === 1 ? 'hr' : 'hrs'}` : '';
  const minStr = remainingMins > 0 ? `${remainingMins} ${remainingMins === 1 ? 'min' : 'mins'}` : '';

  if (hours > 0 && remainingMins > 0) {
    return `Late by ${hrStr} ${minStr}`;
  }
  if (hours > 0) {
    return `Late by ${hrStr}`;
  }
  return `Late by ${minStr}`;
};

export const formatLateMinutesCompact = (totalMinutes) => {
  if (!totalMinutes || totalMinutes <= 0) return '';
  const minsNum = Number(totalMinutes);
  const hours = Math.floor(minsNum / 60);
  const remainingMins = minsNum % 60;

  const hrStr = hours > 0 ? `${hours} ${hours === 1 ? 'hr' : 'hrs'}` : '';
  const minStr = remainingMins > 0 ? `${remainingMins} ${remainingMins === 1 ? 'min' : 'mins'}` : '';

  if (hours > 0 && remainingMins > 0) {
    return `${hrStr} ${minStr}`;
  }
  if (hours > 0) {
    return hrStr;
  }
  return minStr;
};

/**
 * Formats a 24-hour time string ("09:00", "18:00", "18:00:00") into a 12-hour formatted time ("09:00 AM", "06:00 PM").
 * Handles raw strings, strips seconds, and formats 12-hour AM/PM correctly.
 */
export const formatTime12Hour = (time) => {
  if (!time || typeof time !== 'string') return '--';

  const parts = time.trim().split(':');
  if (parts.length < 2) return time;

  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);

  if (isNaN(hours) || isNaN(minutes)) return time;

  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours % 12 === 0 ? 12 : hours % 12;

  const paddedHours = String(hours12).padStart(2, '0');
  const paddedMinutes = String(minutes).padStart(2, '0');

  return `${paddedHours}:${paddedMinutes} ${period}`;
};

/**
 * Formats start and end time into a clean working hours range ("09:00 AM – 06:00 PM").
 */
export const formatWorkingHoursRange = (arg1 = '09:00', arg2 = '18:00') => {
  let start = '09:00';
  let end = '18:00';

  if (arg1 && typeof arg1 === 'object') {
    start = arg1.startTime || arg1.clockInTime || arg1.clockIn || '09:00';
    end = arg1.endTime || arg1.clockOutTime || arg1.clockOut || '18:00';
  } else {
    start = arg1 || '09:00';
    end = arg2 || '18:00';
  }

  const formattedStart = formatTime12Hour(start);
  const formattedEnd = formatTime12Hour(end);
  return `${formattedStart} – ${formattedEnd}`;
};

/**
 * Safely parses and formats a duration in hours into a formatted decimal string (e.g. "4.5").
 * Handles numbers, numeric strings ("4.50"), zero, null/undefined, and invalid values.
 * Returns null if the value is not a valid finite number.
 */
export const formatDurationHours = (value, decimals = 1) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num.toFixed(decimals);
};

/**
 * Safely formats a completed comp-off session worked duration label.
 * If duration is a valid positive number, returns `${formatted}${suffix}`.
 * Otherwise returns the specified fallback.
 */
export const formatCompOffWorkedDuration = (value, suffix = 'h', fallback = 'Completed', decimals = 1) => {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return `${num.toFixed(decimals)}${suffix}`;
};

