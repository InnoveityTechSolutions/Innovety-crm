import React, { useState, useEffect, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  CheckCircle2,
  Clock,
  Sparkles,
  Info,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import api from '../../services/api';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parseYMD = (ymdStr) => {
  if (!ymdStr) return null;
  const parts = ymdStr.split('-').map(Number);
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  return new Date(ymdStr);
};

/**
 * CompOffCalendarPicker
 *
 * An interactive, responsive monthly mini-calendar for selecting eligible
 * off-days (company holidays & weekly offs) for advance Comp-Off permission requests.
 *
 * @param {string} selectedDate - Currently selected date in 'YYYY-MM-DD' format
 * @param {function} onSelectDate - Callback invoked with (dateStr, dayMetadata)
 * @param {Array} eligibleDates - Authoritative array from /api/comp-off/eligible-future-dates
 * @param {boolean} loadingEligibleDates - Loading indicator for eligible dates
 */
export const CompOffCalendarPicker = ({
  selectedDate,
  onSelectDate,
  eligibleDates = [],
  loadingEligibleDates = false
}) => {
  const realToday = useMemo(() => new Date(), []);
  const currentRealYear = realToday.getFullYear();
  const currentRealMonth = realToday.getMonth() + 1;

  // Real today string in YYYY-MM-DD format
  const todayStr = useMemo(() => {
    const y = realToday.getFullYear();
    const m = String(realToday.getMonth() + 1).padStart(2, '0');
    const d = String(realToday.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [realToday]);

  // Maximum date allowed: today + 60 calendar days (60-day advance window)
  const maxDateObj = useMemo(() => {
    return new Date(realToday.getTime() + 60 * 24 * 60 * 60 * 1000);
  }, [realToday]);

  const maxDateStr = useMemo(() => {
    const y = maxDateObj.getFullYear();
    const m = String(maxDateObj.getMonth() + 1).padStart(2, '0');
    const d = String(maxDateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [maxDateObj]);

  const maxMonth = maxDateObj.getMonth() + 1;
  const maxYear = maxDateObj.getFullYear();

  // Calendar view month & year state
  const [viewYear, setViewYear] = useState(currentRealYear);
  const [viewMonth, setViewMonth] = useState(currentRealMonth);

  const [calendarDays, setCalendarDays] = useState([]);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [calendarError, setCalendarError] = useState('');

  // Map of authoritative eligible dates from backend comp-off API
  const eligibleMap = useMemo(() => {
    const map = new Map();
    (eligibleDates || []).forEach((item) => {
      if (item.date) {
        map.set(item.date, item);
      }
    });
    return map;
  }, [eligibleDates]);

  // Month navigation guards
  const canGoPrev = useMemo(() => {
    if (viewYear < currentRealYear) return false;
    if (viewYear === currentRealYear && viewMonth <= currentRealMonth) return false;
    return true;
  }, [viewYear, viewMonth, currentRealYear, currentRealMonth]);

  const canGoNext = useMemo(() => {
    if (viewYear > maxYear) return false;
    if (viewYear === maxYear && viewMonth >= maxMonth) return false;
    return true;
  }, [viewYear, viewMonth, maxYear, maxMonth]);

  const handlePrevMonth = () => {
    if (!canGoPrev) return;
    if (viewMonth === 1) {
      setViewMonth(12);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (!canGoNext) return;
    if (viewMonth === 12) {
      setViewMonth(1);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  // Fetch month days from /api/work-calendar to resolve exact employee schedule
  const fetchMonthCalendar = async (m, y) => {
    try {
      setLoadingCalendar(true);
      setCalendarError('');
      const res = await api.get('/work-calendar', {
        params: { month: m, year: y }
      });
      setCalendarDays(res.data?.days || []);
    } catch (err) {
      console.error('[CompOffCalendarPicker] Failed to fetch calendar:', err);
      setCalendarError(err.response?.data?.message || 'Failed to load schedule for this month.');
    } finally {
      setLoadingCalendar(false);
    }
  };

  useEffect(() => {
    fetchMonthCalendar(viewMonth, viewYear);
  }, [viewMonth, viewYear]);

  // Calendar grid calculation (Sunday-Saturday 7-column layout)
  const { leadingPaddingDays, daysInCurrentMonth, trailingPaddingDays } = useMemo(() => {
    const firstDayOfWeek = new Date(viewYear, viewMonth - 1, 1).getDay(); // 0=Sun, 6=Sat
    const daysInPrev = new Date(viewYear, viewMonth - 1, 0).getDate();
    const daysInCurr = new Date(viewYear, viewMonth, 0).getDate();

    const leading = [];
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      leading.push(daysInPrev - i);
    }

    const totalCells = firstDayOfWeek + daysInCurr;
    const targetTotal = totalCells > 35 ? 42 : 35;
    const trailingCount = targetTotal - totalCells;

    const trailing = [];
    for (let i = 1; i <= trailingCount; i++) {
      trailing.push(i);
    }

    return {
      leadingPaddingDays: leading,
      daysInCurrentMonth: daysInCurr,
      trailingPaddingDays: trailing
    };
  }, [viewYear, viewMonth]);

  // Formatted title for current view (e.g., "November 2026")
  const monthTitle = useMemo(() => {
    const d = new Date(viewYear, viewMonth - 1, 1);
    return d.toLocaleString('default', { month: 'long', year: 'numeric' });
  }, [viewYear, viewMonth]);

  // Extract selected day metadata for prominent display
  const selectedDayMeta = useMemo(() => {
    if (!selectedDate) return null;
    const fromEligible = eligibleMap.get(selectedDate);
    const fromCalendar = (calendarDays || []).find((d) => d.date === selectedDate);
    if (!fromEligible && !fromCalendar) return { date: selectedDate };

    const isHol = fromEligible?.holidayType === 'COMPANY_HOLIDAY' || fromCalendar?.status === 'Holiday';
    const reasonText = fromEligible?.reason
      ? (fromEligible.reason.startsWith('COMPANY_HOLIDAY:')
          ? fromEligible.reason.replace('COMPANY_HOLIDAY:', '').trim()
          : fromEligible.reason === 'SUNDAY_WEEKLY_OFF'
          ? 'Sunday Weekly Off'
          : fromEligible.reason)
      : fromCalendar?.title || fromCalendar?.reason || (isHol ? 'Company Holiday' : 'Weekly Off');

    return {
      date: selectedDate,
      isHoliday: isHol,
      type: fromEligible?.holidayType || (isHol ? 'COMPANY_HOLIDAY' : 'WEEKLY_OFF'),
      reasonText,
      dayName: fromEligible?.dayName || parseYMD(selectedDate)?.toLocaleDateString('en-US', { weekday: 'long' }) || ''
    };
  }, [selectedDate, eligibleMap, calendarDays]);

  // Count eligible days in the currently viewed month
  const eligibleDaysInViewCount = useMemo(() => {
    let count = 0;
    for (let day = 1; day <= daysInCurrentMonth; day++) {
      const dStr = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (dStr > todayStr && dStr <= maxDateStr && eligibleMap.has(dStr)) {
        const item = eligibleMap.get(dStr);
        if (!item?.existingRequest) {
          count++;
        }
      }
    }
    return count;
  }, [viewYear, viewMonth, daysInCurrentMonth, todayStr, maxDateStr, eligibleMap]);

  return (
    <div className="space-y-3">
      {/* Month Header & Navigation */}
      <div className="flex items-center justify-between p-2.5 rounded-2xl bg-muted/40 border border-border/70 select-none">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary shrink-0" />
          <div>
            <h4 className="text-xs sm:text-sm font-black text-foreground">{monthTitle}</h4>
            <p className="text-[10px] text-muted-foreground font-semibold">
              {loadingCalendar || loadingEligibleDates
                ? 'Loading schedule & eligible off-days...'
                : `${eligibleDaysInViewCount} eligible off-day${eligibleDaysInViewCount === 1 ? '' : 's'} available`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlePrevMonth}
            disabled={!canGoPrev || loadingCalendar || loadingEligibleDates}
            title={canGoPrev ? 'Previous month' : 'Cannot navigate to past months'}
            className="p-1.5 rounded-xl border border-border/70 bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer shadow-xs"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleNextMonth}
            disabled={!canGoNext || loadingCalendar || loadingEligibleDates}
            title={canGoNext ? 'Next month' : 'Reached 60-day advance booking limit'}
            className="p-1.5 rounded-xl border border-border/70 bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer shadow-xs"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Weekday Column Headers (Sun - Sat) */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w, idx) => (
          <div
            key={w}
            className={`py-1 text-[11px] font-black uppercase tracking-wider ${
              idx === 0 ? 'text-purple-600 dark:text-purple-400' : 'text-muted-foreground'
            }`}
          >
            {w}
          </div>
        ))}
      </div>

      {/* Empty State Banner (if no eligible dates in the entire 60-day window) */}
      {!loadingEligibleDates && eligibleDates.length === 0 && (
        <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
          <span>No upcoming company holidays or weekly offs found in the next 60 days.</span>
        </div>
      )}

      {/* Calendar Grid */}
      <div className="relative">
        {(loadingCalendar || loadingEligibleDates) && (
          <div className="absolute inset-0 z-10 rounded-2xl bg-background/60 backdrop-blur-xs flex items-center justify-center">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-card border border-border shadow-md text-xs font-semibold text-foreground">
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>{loadingEligibleDates ? 'Checking eligible dates...' : 'Updating month...'}</span>
            </div>
          </div>
        )}

        {calendarError ? (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{calendarError}</span>
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {/* Leading Padding Cells */}
            {leadingPaddingDays.map((padDay, idx) => (
              <div
                key={`pad-lead-${idx}`}
                className="h-11 sm:h-12 rounded-xl p-1 text-[10px] text-muted-foreground/30 bg-muted/5 border border-transparent flex items-start justify-end pointer-events-none select-none"
              >
                {padDay}
              </div>
            ))}

            {/* Current Month Day Cells */}
            {Array.from({ length: daysInCurrentMonth }, (_, i) => i + 1).map((dayNum) => {
              const dateStr = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              const dayData = (calendarDays || []).find((d) => d.date === dateStr) || {};

              const isPastOrToday = dateStr <= todayStr;
              const isBeyond60 = dateStr > maxDateStr;

              const eligibleEntry = eligibleMap.get(dateStr);
              const isEligibleByBackend = Boolean(eligibleEntry);

              const hasExistingRequest = Boolean(eligibleEntry?.existingRequest);
              const requestStatus = eligibleEntry?.existingRequest?.status;

              const isLeave = dayData.status === 'MY_LEAVE';
              const isAlreadyApprovedWork = dayData.status === 'COMP_OFF' || requestStatus === 'APPROVED';
              const isPendingRequest = requestStatus === 'PENDING';

              const isHoliday =
                eligibleEntry?.holidayType === 'COMPANY_HOLIDAY' ||
                dayData.status === 'Holiday' ||
                (dayData.title && !['Sunday', 'Working Day', 'Work From Home'].includes(dayData.title));

              const isSunday = dayData.isSunday || dayData.dayOfWeek === 0;

              // Authoritative eligibility check matching backend validateEligibleDay:
              // Must be strictly future, within 60 days, verified eligible off-day, and not already requested/on leave.
              const isSelectable =
                !isPastOrToday &&
                !isBeyond60 &&
                isEligibleByBackend &&
                !hasExistingRequest &&
                !isLeave &&
                !isAlreadyApprovedWork;

              const isSelected = selectedDate === dateStr;

              // Tooltip / Title text
              let tooltipText = '';
              if (isPastOrToday) {
                tooltipText = dateStr === todayStr ? 'Today (Advance permission requires future dates)' : 'Past date';
              } else if (isBeyond60) {
                tooltipText = 'Beyond 60-day advance booking window';
              } else if (isPendingRequest) {
                tooltipText = 'Advance permission request already pending review';
              } else if (isAlreadyApprovedWork) {
                tooltipText = 'Approved Comp-Off work already scheduled';
              } else if (isLeave) {
                tooltipText = 'User approved leave';
              } else if (isSelectable) {
                tooltipText = isHoliday
                  ? `Company Holiday: ${eligibleEntry?.reason || dayData.title || 'Holiday'}`
                  : 'Weekly Off';
              } else {
                tooltipText = 'Scheduled working day';
              }

              // Styling resolution
              let cellClasses =
                'h-11 sm:h-12 rounded-xl p-1 sm:p-1.5 transition-all text-left flex flex-col justify-between relative border select-none ';

              if (isSelected) {
                cellClasses +=
                  'bg-primary text-white border-primary shadow-md ring-2 ring-primary/40 font-black cursor-pointer scale-102 z-10';
              } else if (isPendingRequest) {
                cellClasses +=
                  'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 opacity-80 cursor-not-allowed';
              } else if (isAlreadyApprovedWork) {
                cellClasses +=
                  'bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-300 opacity-80 cursor-not-allowed';
              } else if (isSelectable) {
                if (isHoliday) {
                  cellClasses +=
                    'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/40 text-emerald-800 dark:text-emerald-200 cursor-pointer shadow-xs hover:scale-102';
                } else {
                  // Weekly Off (Sunday or scheduled off-day)
                  cellClasses +=
                    'bg-purple-500/10 hover:bg-purple-500/20 border-purple-500/40 text-purple-800 dark:text-purple-200 cursor-pointer shadow-xs hover:scale-102';
                }
              } else {
                // Disabled working day or past date
                cellClasses +=
                  'bg-muted/15 border-border/30 text-muted-foreground/40 opacity-40 cursor-not-allowed';
              }

              return (
                <button
                  key={dateStr}
                  type="button"
                  disabled={!isSelectable}
                  title={tooltipText}
                  onClick={() => {
                    if (isSelectable && onSelectDate) {
                      onSelectDate(dateStr, {
                        date: dateStr,
                        dayName: eligibleEntry?.dayName,
                        holidayType: eligibleEntry?.holidayType,
                        reason: eligibleEntry?.reason || dayData.title || dayData.reason
                      });
                    }
                  }}
                  className={cellClasses}
                >
                  {/* Date Number Header */}
                  <div className="flex items-center justify-between w-full">
                    <span
                      className={`text-xs font-black ${
                        isSelected
                          ? 'text-white'
                          : isSelectable
                          ? isHoliday
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : 'text-purple-700 dark:text-purple-300'
                          : 'text-muted-foreground/60'
                      }`}
                    >
                      {dayNum}
                    </span>

                    {/* Today indicator */}
                    {dateStr === todayStr && (
                      <span className="w-1.5 h-1.5 rounded-full bg-primary" title="Today" />
                    )}

                    {/* Active Selected Checkmark */}
                    {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-white shrink-0" />}
                  </div>

                  {/* Micro Badge for Status */}
                  <div className="truncate w-full">
                    {isPendingRequest ? (
                      <span className="block text-[8px] sm:text-[9px] font-black uppercase text-amber-600 dark:text-amber-400 truncate">
                        Pending
                      </span>
                    ) : isAlreadyApprovedWork ? (
                      <span className="block text-[8px] sm:text-[9px] font-black uppercase text-purple-600 dark:text-purple-300 truncate">
                        Approved
                      </span>
                    ) : isSelectable ? (
                      <span
                        className={`block text-[8px] sm:text-[9px] font-black uppercase truncate ${
                          isSelected
                            ? 'text-white/90'
                            : isHoliday
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-purple-600 dark:text-purple-400'
                        }`}
                      >
                        {isHoliday ? 'Holiday' : 'Off'}
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}

            {/* Trailing Padding Cells */}
            {trailingPaddingDays.map((padDay, idx) => (
              <div
                key={`pad-trail-${idx}`}
                className="h-11 sm:h-12 rounded-xl p-1 text-[10px] text-muted-foreground/25 bg-muted/5 border border-transparent flex items-start justify-end pointer-events-none select-none"
              >
                {padDay}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Selected Date Confirmation Banner */}
      {selectedDayMeta?.date ? (
        <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-between gap-3 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-xl bg-primary text-white flex items-center justify-center shrink-0 shadow-xs">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black text-foreground truncate">
                {parseYMD(selectedDayMeta.date)?.toLocaleDateString('en-US', {
                  weekday: 'short',
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric'
                })}
              </p>
              <p className="text-[11px] text-primary font-bold truncate">
                {selectedDayMeta.reasonText}
              </p>
            </div>
          </div>

          <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-primary/20 text-primary border border-primary/30 shrink-0">
            Selected
          </span>
        </div>
      ) : (
        <div className="p-2.5 rounded-xl bg-muted/20 border border-border/50 text-[11px] text-muted-foreground flex items-center gap-2">
          <Info className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>Click any highlighted holiday or weekly off to request permission.</span>
        </div>
      )}

      {/* Legend Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-border/40 text-[10px] text-muted-foreground font-semibold">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-purple-500/20 border border-purple-500/40 inline-block" />
          <span>Weekly Off</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/20 border border-emerald-500/40 inline-block" />
          <span>Company Holiday</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/20 border border-amber-500/40 inline-block" />
          <span>Pending Request</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-muted/20 border border-border/40 inline-block opacity-40" />
          <span>Working Day</span>
        </div>
      </div>
    </div>
  );
};

export default CompOffCalendarPicker;
