import React, { useEffect, useMemo } from 'react';
import {
  X,
  Clock,
  MapPin,
  Briefcase,
  AlertCircle,
  Building2,
  Home,
  CheckCircle2,
  LogIn,
  LogOut,
  ShieldCheck,
  Calendar
} from 'lucide-react';
import UserAvatar from '../common/UserAvatar';
import AttendanceMapEmbed, { isValidCoordinate } from './AttendanceMapEmbed';

/**
 * Format date as DD/MM/YYYY
 */
const formatDateDDMMYYYY = (dateInput) => {
  if (!dateInput) return '—';
  if (typeof dateInput === 'string' && dateInput.includes('T')) {
    const [yyyy, mm, dd] = dateInput.split('T')[0].split('-');
    if (yyyy && mm && dd) return `${dd}/${mm}/${yyyy}`;
  }
  const obj = new Date(dateInput);
  if (isNaN(obj.getTime())) return '—';
  const day = String(obj.getUTCDate ? obj.getUTCDate() : obj.getDate()).padStart(2, '0');
  const month = String((obj.getUTCMonth ? obj.getUTCMonth() : obj.getMonth()) + 1).padStart(2, '0');
  const year = obj.getUTCFullYear ? obj.getUTCFullYear() : obj.getFullYear();
  return `${day}/${month}/${year}`;
};

/**
 * Format timestamp into human-readable time + date
 */
const formatTimestamp = (timestamp) => {
  if (!timestamp) return 'Not recorded';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return 'Not recorded';
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
};

/**
 * Normalizes work type into "Office", "Home", or "Other"
 */
const formatWorkType = (workType, otherText) => {
  if (!workType) return 'Not recorded';
  const upper = String(workType).toUpperCase();
  if (upper === 'OFFICE') return 'Office';
  if (upper === 'HOME' || upper === 'WORK_FROM_HOME' || upper === 'WFH') return 'Home';
  if (upper === 'OTHER') {
    return otherText ? `Other (${otherText.trim()})` : 'Other';
  }
  return workType;
};

export default function AttendanceAuditDetailsModal({ isOpen, onClose, record }) {
  useEffect(() => {
    if (!isOpen) return;

    // Prevent background page scrolling while modal is open, restore previous setting on close/unmount
    const originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Extract / resolve coordinates with fallback to string matching
  const clockInCoords = useMemo(() => {
    if (!record) return { latitude: null, longitude: null };
    if (isValidCoordinate(record.clockInLatitude, record.clockInLongitude)) {
      return { latitude: record.clockInLatitude, longitude: record.clockInLongitude };
    }
    if (record.clockInLocation) {
      const match = record.clockInLocation.match(/Lat:\s*([-\d.]+),\s*Lon:\s*([-\d.]+)/i);
      if (match) {
        return { latitude: parseFloat(match[1]), longitude: parseFloat(match[2]) };
      }
    }
    return { latitude: null, longitude: null };
  }, [record]);

  const clockOutCoords = useMemo(() => {
    if (!record) return { latitude: null, longitude: null };
    if (isValidCoordinate(record.clockOutLatitude, record.clockOutLongitude)) {
      return { latitude: record.clockOutLatitude, longitude: record.clockOutLongitude };
    }
    if (record.clockOutLocation) {
      const match = record.clockOutLocation.match(/Lat:\s*([-\d.]+),\s*Lon:\s*([-\d.]+)/i);
      if (match) {
        return { latitude: parseFloat(match[1]), longitude: parseFloat(match[2]) };
      }
    }
    return { latitude: null, longitude: null };
  }, [record]);

  // Resolved addresses
  const clockInAddress = useMemo(() => {
    if (!record) return 'Address unavailable';
    if (record.clockInAddress && record.clockInAddress.trim()) {
      return record.clockInAddress.trim();
    }
    if (record.attendanceLocation?.address && record.attendanceLocation.address.trim()) {
      return record.attendanceLocation.address.trim();
    }
    return 'Address unavailable';
  }, [record]);

  const clockOutAddress = useMemo(() => {
    if (!record) return 'Address unavailable';
    if (record.clockOutAddress && record.clockOutAddress.trim()) {
      return record.clockOutAddress.trim();
    }
    return 'Address unavailable';
  }, [record]);

  if (!isOpen || !record) return null;

  const isAutoClockOut = Boolean(record.autoClockOut || record.clockOutReason === 'AUTO');
  const hasClockOut = Boolean(record.clockOut);
  const isSynthetic = Boolean(record.isSynthetic);

  // Status badge styling
  const getStatusBadge = (status) => {
    const s = String(status || '').toUpperCase();
    if (s === 'PRESENT' || s === 'WORK_FROM_HOME') {
      return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
    }
    if (s === 'LATE') {
      return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
    }
    if (s === 'HALF_DAY') {
      return 'bg-purple-500/10 text-purple-600 border-purple-500/20';
    }
    if (s === 'ABSENT') {
      return 'bg-rose-500/10 text-rose-600 border-rose-500/20';
    }
    if (s === 'HOLIDAY') {
      return 'bg-sky-500/10 text-sky-600 border-sky-500/20';
    }
    return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl my-auto rounded-2xl border border-border/40 bg-card p-3.5 sm:p-4 md:p-5 pt-3 sm:pt-3.5 pb-3 sm:pb-3.5 shadow-2xl animate-in zoom-in-95 duration-200 text-left flex flex-col md:max-h-[92vh] max-h-none overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border/40 pb-2 sm:pb-2.5">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <UserAvatar user={record.user} size="lg" className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl" />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold text-foreground">
                  {record.user?.name || 'Employee Attendance'}
                </h2>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase border ${getStatusBadge(
                    record.status
                  )}`}
                >
                  {record.status}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                <span className="font-mono font-semibold text-foreground/80">
                  {record.user?.employeeId || 'ID: —'}
                </span>
                {record.user?.department && ` • ${record.user.department}`}
                {record.user?.role && ` • ${record.user.role.replace('_', ' ')}`}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            title="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Compact Summary Banner directly below header */}
        <div className="mt-2 sm:mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 bg-muted/30 px-3 py-1.5 sm:px-3 sm:py-2 rounded-xl border border-border/30 text-xs">
          <div>
            <span className="text-[10px] text-muted-foreground font-semibold uppercase block">Date</span>
            <span className="font-bold text-foreground font-mono">
              {formatDateDDMMYYYY(record.date)}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground font-semibold uppercase block">Working Hours</span>
            <span className="font-bold text-foreground font-mono">
              {record.workingHours !== null && record.workingHours !== undefined
                ? `${record.workingHours} hrs`
                : '—'}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground font-semibold uppercase block">Shift / Timing</span>
            <span className="font-semibold text-foreground truncate block">
              {record.shiftName || 'Company Default'}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground font-semibold uppercase block">Session Type</span>
            <span className="font-semibold text-foreground">
              {record.clockIn ? 'Recorded Session' : isSynthetic ? 'Calendar Entry' : 'Manual Entry'}
            </span>
          </div>
        </div>

        {/* Content Area (Scrolls cleanly if viewport genuinely requires it, bottom padded to prevent clipping) */}
        <div className="mt-2.5 sm:mt-3 flex-1 md:overflow-y-auto md:min-h-0 space-y-2.5 sm:space-y-3 pb-1">
          {/* If completely synthetic (e.g. Absent without any clock-in session) */}
          {!record.clockIn && (
            <div className="p-3 rounded-xl border border-dashed border-border/60 bg-muted/20 text-center">
              <AlertCircle className="h-4 w-4 text-muted-foreground/70 mx-auto mb-1" />
              <p className="text-xs font-semibold text-foreground">No Clock-In Recorded for this Date</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Attendance was recorded as <strong className="font-semibold">{record.status}</strong>.
              </p>
            </div>
          )}

          {/* TWO-COLUMN SIDE-BY-SIDE LAYOUT (1 col on mobile, 2 cols on md+) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 lg:gap-3.5 items-stretch">
            {/* -------------------- COLUMN 1: CLOCK-IN CARD -------------------- */}
            <div className="rounded-2xl border border-border/40 bg-card/70 p-3 sm:p-3.5 flex flex-col justify-between shadow-sm">
              <div>
                {/* 1. Clock-In Heading and Status Badge */}
                <div className="flex items-center justify-between border-b border-border/30 pb-1.5 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold shrink-0">
                      <LogIn className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <h3 className="text-xs sm:text-sm font-bold text-foreground">Clock-In Details</h3>
                      <p className="text-[10px] text-muted-foreground">Recorded check-in session</p>
                    </div>
                  </div>
                  <span className="text-[10px] sm:text-[11px] font-mono font-bold text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                    Clock-In
                  </span>
                </div>

                {record.clockIn ? (
                  <div className="space-y-1.5 text-xs">
                    {/* 2. Work Type */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-2 items-baseline">
                      <span className="text-[11px] font-semibold text-muted-foreground">Work Type:</span>
                      <div className="sm:col-span-2 font-bold text-foreground flex items-center gap-1.5">
                        <Briefcase className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="break-words">{formatWorkType(record.workLocation, record.workLocationOther)}</span>
                      </div>
                    </div>

                    {/* 3. Actual Clock-In Timestamp */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-2 items-baseline">
                      <span className="text-[11px] font-semibold text-muted-foreground">Clock-In Time:</span>
                      <div className="sm:col-span-2 font-mono font-bold text-foreground flex items-center gap-1.5 flex-wrap">
                        <Clock className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        <span>{formatTimestamp(record.clockIn)}</span>
                        {record.lateMinutes ? (
                          <span className="text-[10px] font-sans font-bold text-yellow-600 bg-yellow-500/10 px-1.5 py-0.5 rounded ml-1">
                            {record.lateMinutes}m late
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* 4. Saved Clock-In Address */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-2 items-baseline">
                      <span className="text-[11px] font-semibold text-muted-foreground">Clock-In Address:</span>
                      <div className="sm:col-span-2 text-foreground/90 flex items-start gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                        <span className="break-words leading-relaxed">{clockInAddress}</span>
                      </div>
                    </div>

                    {/* 5. Google Maps Embed & 6. Open in Google Maps Link */}
                    <div className="space-y-1 pt-0.5">
                      <span className="text-[11px] font-semibold text-muted-foreground block">
                        Clock-In Location:
                      </span>
                      <AttendanceMapEmbed
                        latitude={clockInCoords.latitude}
                        longitude={clockInCoords.longitude}
                        title="Clock-In Location Map"
                        height="h-28 sm:h-32"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-dashed border-border/50 bg-muted/10 text-center my-auto py-6">
                    <Clock className="h-6 w-6 text-muted-foreground/60 mx-auto mb-1.5" />
                    <p className="text-xs font-semibold text-foreground">No Clock-In Recorded</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">No arrival session on record for this date.</p>
                  </div>
                )}
              </div>
            </div>

            {/* -------------------- COLUMN 2: CLOCK-OUT CARD -------------------- */}
            <div className="rounded-2xl border border-border/40 bg-card/70 p-3 sm:p-3.5 flex flex-col justify-between shadow-sm">
              <div>
                {/* 1. Clock-Out Heading and Status Badge */}
                <div className="flex items-center justify-between border-b border-border/30 pb-1.5 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center font-bold shrink-0">
                      <LogOut className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <h3 className="text-xs sm:text-sm font-bold text-foreground">Clock-Out Details</h3>
                      <p className="text-[10px] text-muted-foreground">Recorded departure session</p>
                    </div>
                  </div>

                  {/* Status Badge */}
                  {!hasClockOut && (
                    <span className="text-[10px] sm:text-[11px] font-mono font-bold text-amber-600 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md">
                      Not Clocked Out
                    </span>
                  )}
                  {hasClockOut && isAutoClockOut && (
                    <span className="inline-flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono font-bold text-amber-600 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                      Auto Clock-Out
                    </span>
                  )}
                  {hasClockOut && !isAutoClockOut && (
                    <span className="text-[10px] sm:text-[11px] font-mono font-bold text-indigo-600 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md">
                      Manual Clock-Out
                    </span>
                  )}
                </div>

                {/* State A: Not clocked out yet */}
                {!hasClockOut && (
                  <div className="space-y-1.5 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-2 items-baseline">
                      <span className="text-[11px] font-semibold text-muted-foreground">Work Type:</span>
                      <div className="sm:col-span-2 font-bold text-foreground flex items-center gap-1.5">
                        <Briefcase className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="break-words">{formatWorkType(record.workLocation, record.workLocationOther)}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-2 items-baseline">
                      <span className="text-[11px] font-semibold text-muted-foreground">Clock-Out Time:</span>
                      <div className="sm:col-span-2 font-mono font-bold text-amber-600 flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                        <span>Session in progress</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-2 items-baseline">
                      <span className="text-[11px] font-semibold text-muted-foreground">Clock-Out Address:</span>
                      <div className="sm:col-span-2 text-muted-foreground flex items-start gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0 mt-0.5" />
                        <span>Pending employee departure</span>
                      </div>
                    </div>
                    <div className="space-y-1 pt-0.5">
                      <span className="text-[11px] font-semibold text-muted-foreground block">
                        Clock-Out Location:
                      </span>
                      <div className="h-28 sm:h-32 rounded-xl border border-dashed border-border/50 bg-muted/15 flex flex-col items-center justify-center p-3 text-center">
                        <Clock className="h-6 w-6 text-amber-500/70 mb-1" />
                        <span className="text-xs font-bold text-foreground">Active Session Open</span>
                        <span className="text-[10.5px] text-muted-foreground mt-0.5 max-w-xs leading-relaxed">
                          Employee has not submitted clock-out yet. Location will be recorded upon departure.
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* State B: Automatic Clock-Out */}
                {hasClockOut && isAutoClockOut && (
                  <div className="space-y-1.5 text-xs">
                    {/* Work Type */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-2 items-baseline">
                      <span className="text-[11px] font-semibold text-muted-foreground">Work Type:</span>
                      <div className="sm:col-span-2 font-bold text-foreground flex items-center gap-1.5">
                        <Briefcase className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="break-words">
                          {formatWorkType(
                            record.clockOutWorkLocation || record.workLocation,
                            record.clockOutWorkLocationOther || record.workLocationOther
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Clock-Out Time */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-2 items-baseline">
                      <span className="text-[11px] font-semibold text-muted-foreground">Clock-Out Time:</span>
                      <div className="sm:col-span-2 font-mono font-bold text-foreground flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                        <span>{formatTimestamp(record.clockOut)}</span>
                        <span className="text-[10px] font-sans font-bold text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded ml-1">
                          System Shift End
                        </span>
                      </div>
                    </div>

                    {/* Saved Clock-Out Address */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-2 items-baseline">
                      <span className="text-[11px] font-semibold text-muted-foreground">Clock-Out Address:</span>
                      <div className="sm:col-span-2 text-foreground/80 flex items-start gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0 mt-0.5" />
                        <span className="break-words leading-relaxed">
                          {record.clockOutAddress && record.clockOutAddress.trim()
                            ? record.clockOutAddress.trim()
                            : 'Not recorded (Automated System Departure)'}
                        </span>
                      </div>
                    </div>

                    {/* Visually balanced location area matching Google Maps slot on left */}
                    <div className="space-y-1 pt-0.5">
                      <span className="text-[11px] font-semibold text-muted-foreground block">
                        Clock-Out Location:
                      </span>
                      <div className="h-28 sm:h-32 rounded-xl border border-dashed border-border/50 bg-muted/15 flex flex-col justify-between p-2.5 sm:p-3 text-center">
                        <div className="flex-1 flex flex-col items-center justify-center">
                          <div className="h-5 w-5 rounded-full bg-amber-500/10 text-amber-600 flex items-center justify-center mb-0.5">
                            <ShieldCheck className="h-3 w-3" />
                          </div>
                          <span className="text-xs font-bold text-foreground">Location Not Captured</span>
                          <p className="text-[10px] text-muted-foreground mt-0.5 max-w-xs leading-tight">
                            Automatic clock-out occurred via scheduled system rules at shift end. Device GPS coordinates were not captured per privacy rules.
                          </p>
                        </div>
                        <div className="pt-1 border-t border-border/30 flex items-center justify-between text-[10px] text-muted-foreground">
                          <span className="font-mono">Shift Policy Auto-End</span>
                          <span className="font-semibold text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded">
                            Automated
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* State C: Manual Clock-Out */}
                {hasClockOut && !isAutoClockOut && (
                  <div className="space-y-1.5 text-xs">
                    {/* Work Type */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-2 items-baseline">
                      <span className="text-[11px] font-semibold text-muted-foreground">Work Type:</span>
                      <div className="sm:col-span-2 font-bold text-foreground flex items-center gap-1.5">
                        <Briefcase className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="break-words">
                          {formatWorkType(
                            record.clockOutWorkLocation || record.workLocation,
                            record.clockOutWorkLocationOther || record.workLocationOther
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Actual Clock-Out Timestamp */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-2 items-baseline">
                      <span className="text-[11px] font-semibold text-muted-foreground">Clock-Out Time:</span>
                      <div className="sm:col-span-2 font-mono font-bold text-foreground flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                        <span>{formatTimestamp(record.clockOut)}</span>
                      </div>
                    </div>

                    {/* Saved Clock-Out Address */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-2 items-baseline">
                      <span className="text-[11px] font-semibold text-muted-foreground">Clock-Out Address:</span>
                      <div className="sm:col-span-2 text-foreground/90 flex items-start gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                        <span className="break-words leading-relaxed">{clockOutAddress}</span>
                      </div>
                    </div>

                    {/* Google Maps Embed & Open in Google Maps Link */}
                    <div className="space-y-1 pt-0.5">
                      <span className="text-[11px] font-semibold text-muted-foreground block">
                        Clock-Out Location:
                      </span>
                      <AttendanceMapEmbed
                        latitude={clockOutCoords.latitude}
                        longitude={clockOutCoords.longitude}
                        title="Clock-Out Location Map"
                        height="h-28 sm:h-32"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer (Read-Only) */}
        <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-2.5 border-t border-border/40 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground/80 hidden sm:inline">
            Press <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-muted border border-border/50 rounded-md">Esc</kbd> or click outside to dismiss
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 sm:px-5 sm:py-2 rounded-xl text-xs font-bold bg-muted hover:bg-muted/80 text-foreground transition-colors cursor-pointer ml-auto"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
