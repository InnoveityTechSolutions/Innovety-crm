/**
 * Utilities for formatting and extracting dates for the Meetings module.
 * Prevents timezone-related date shifts between local time and UTC.
 */

/**
 * Extracts a local 'YYYY-MM-DD' date string from a meeting object or date value.
 * Always prefers the meeting's local startTime or date string components so that
 * meetings scheduled on a specific date never shift to the previous day in timezones west of UTC.
 *
 * @param {Object|string|Date} meetingOrDate 
 * @returns {string} 'YYYY-MM-DD'
 */
export const getMeetingLocalDateString = (meetingOrDate) => {
  if (!meetingOrDate) return '';

  // 1. If meeting object has startTime, that instant reflects user's local date
  if (meetingOrDate.startTime) {
    const s = new Date(meetingOrDate.startTime);
    if (!isNaN(s.getTime())) {
      const year = s.getFullYear();
      const month = String(s.getMonth() + 1).padStart(2, '0');
      const day = String(s.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  // 2. If it has date property or is a string
  const rawDate = meetingOrDate.date !== undefined ? meetingOrDate.date : meetingOrDate;
  if (typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
    return rawDate.slice(0, 10);
  }

  if (rawDate) {
    const d = new Date(rawDate);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  return '';
};

/**
 * Formats a meeting date for display (e.g., "Tuesday, October 10, 2026" or "Oct 10, 2026")
 * without unwanted 1-day backward timezone shifts.
 *
 * @param {string|Date} dateVal 
 * @param {string|Date} startTimeVal 
 * @param {Intl.DateTimeFormatOptions} options 
 * @returns {string}
 */
export const formatMeetingDisplayDate = (dateVal, startTimeVal, options = {}) => {
  if (startTimeVal) {
    const d = new Date(startTimeVal);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', options);
    }
  }

  if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) {
    const [y, m, d] = dateVal.slice(0, 10).split('-').map(Number);
    const localDate = new Date(y, m - 1, d);
    return localDate.toLocaleDateString('en-US', options);
  }

  if (dateVal) {
    const d = new Date(dateVal);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', options);
    }
  }

  return '';
};

/**
 * Formats a time value (Date, ISO string, etc.) into '10:00 AM'
 */
export const formatMeetingDisplayTime = (timeVal) => {
  if (!timeVal) return '';
  try {
    return new Date(timeVal).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};
