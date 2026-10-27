import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import {
  Calendar as CalendarIcon,
  Table as TableIcon,
  Filter,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Building2,
  Home,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  CalendarCheck
} from 'lucide-react';
import { formatLateDuration } from '../../utils/attendanceFormatter';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function AttendanceHistorySection({ user, refreshTrigger }) {
  const currentDate = new Date();
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'calendar'
  const [filterMonth, setFilterMonth] = useState(currentDate.getMonth() + 1);
  const [filterYear, setFilterYear] = useState(currentDate.getFullYear());
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterLocation, setFilterLocation] = useState('ALL');

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [records, setRecords] = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  // Calendar Day Detail Modal
  const [selectedDayRecord, setSelectedDayRecord] = useState(null);

  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page,
        limit,
        month: filterMonth,
        year: filterYear
      };
      if (filterStatus !== 'ALL') params.status = filterStatus;
      if (filterLocation !== 'ALL') params.workLocation = filterLocation;

      const res = await api.get('/attendance/history', { params });
      if (res.data?.success) {
        setRecords(res.data.records || []);
        setTotalRecords(res.data.total || 0);
        setTotalPages(res.data.totalPages || 1);
      } else if (Array.isArray(res.data)) {
        setRecords(res.data);
        setTotalRecords(res.data.length);
        setTotalPages(1);
      }
    } catch (err) {
      console.error('Failed to fetch attendance history:', err);
    } finally {
      setLoading(false);
    }
  }, [page, limit, filterMonth, filterYear, filterStatus, filterLocation]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory, refreshTrigger]);

  const formatDateDDMMYYYY = (dateInput) => {
    if (!dateInput) return '—';
    const obj = new Date(dateInput);
    if (isNaN(obj.getTime())) return '—';
    const day = String(obj.getDate()).padStart(2, '0');
    const monthStr = obj.toLocaleDateString('en-US', { month: 'short' });
    const year = obj.getFullYear();
    const weekday = obj.toLocaleDateString('en-US', { weekday: 'short' });
    return `${day} ${monthStr} ${year} (${weekday})`;
  };

  const formatWorkingHours = (hours, status) => {
    if (status === 'LEAVE' || status === 'HOLIDAY') return '—';
    if (!hours || hours === 0) return '—';
    const totalMinutes = Math.round(hours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  };

  const getStatusBadge = (log) => {
    const status = log.status || 'PRESENT';
    if (status === 'PRESENT' || status === 'WORK_FROM_HOME') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          <CheckCircle2 className="w-3 h-3" />
          {status === 'WORK_FROM_HOME' ? 'WORK FROM HOME' : 'PRESENT'}
        </span>
      );
    }
    if (status === 'LATE') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
          <AlertTriangle className="w-3 h-3" />
          LATE {log.lateMinutes ? `(${formatLateDuration(log.lateMinutes)})` : ''}
        </span>
      );
    }
    if (status === 'HALF_DAY') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
          HALF DAY
        </span>
      );
    }
    if (status === 'ABSENT') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
          <XCircle className="w-3 h-3" />
          ABSENT
        </span>
      );
    }
    if (status === 'HOLIDAY') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
          HOLIDAY
        </span>
      );
    }
    if (status === 'NOT_CHECKED_IN') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase bg-muted text-muted-foreground border border-border/40">
          Not Checked In
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase bg-muted text-muted-foreground">
        {status}
      </span>
    );
  };

  const getLocationBadge = (log) => {
    const loc = log.workLocation;
    if (loc === 'OFFICE') {
      const locationName = log.attendanceLocation?.name;
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground">
          <Building2 className="w-3.5 h-3.5 text-blue-500" /> {locationName ? locationName : 'Office'}
        </span>
      );
    }
    if (loc === 'HOME') {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground">
          <Home className="w-3.5 h-3.5 text-emerald-500" /> Home
        </span>
      );
    }
    if (loc === 'OTHER') {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground">
          <MapPin className="w-3.5 h-3.5 text-purple-500" /> {log.workLocationOther || log.clockInLocation || 'Other'}
        </span>
      );
    }
    return <span className="text-xs text-muted-foreground">—</span>;
  };

  // Calendar View Days Calculation
  const renderCalendarGrid = () => {
    const daysInMonth = new Date(filterYear, filterMonth, 0).getDate();
    const firstDayOfWeek = new Date(filterYear, filterMonth - 1, 1).getDay(); // 0 = Sun

    // Create lookup map dateStr -> record
    const dateRecordMap = new Map();
    records.forEach(r => {
      const dStr = new Date(r.date).toISOString().split('T')[0];
      dateRecordMap.set(dStr, r);
    });

    const calendarCells = [];

    // Empty lead-in cells
    for (let i = 0; i < firstDayOfWeek; i++) {
      calendarCells.push(<div key={`empty-${i}`} className="h-24 bg-muted/10 border border-border/30 rounded-xl" />);
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
      const dayDateObj = new Date(Date.UTC(filterYear, filterMonth - 1, day));
      const dateStr = dayDateObj.toISOString().split('T')[0];
      const isSunday = dayDateObj.getUTCDay() === 0;
      const rec = dateRecordMap.get(dateStr);

      const userJoining = user?.joiningDate || user?.createdAt;
      const userJoiningDateStr = userJoining ? new Date(userJoining).toISOString().split('T')[0] : '';
      const isBeforeJoining = Boolean(userJoiningDateStr && dateStr < userJoiningDateStr);

      let cellBg = 'bg-card border-border/50';
      if (isBeforeJoining) {
        cellBg = 'bg-muted/10 border-border/20 opacity-50 cursor-not-allowed';
      } else if (rec) {
        if (rec.status === 'PRESENT' || rec.status === 'WORK_FROM_HOME') cellBg = 'bg-emerald-500/5 border-emerald-500/30';
        else if (rec.status === 'LATE') cellBg = 'bg-amber-500/5 border-amber-500/30';
        else if (rec.status === 'ABSENT') cellBg = 'bg-rose-500/5 border-rose-500/30';
        else if (rec.status === 'HALF_DAY') cellBg = 'bg-purple-500/5 border-purple-500/30';
        else if (rec.status === 'HOLIDAY') cellBg = 'bg-indigo-500/5 border-indigo-500/30';
      } else if (isSunday) {
        cellBg = 'bg-muted/20 border-border/30';
      }

      calendarCells.push(
        <div
          key={dateStr}
          onClick={() => rec && setSelectedDayRecord(rec)}
          className={`h-24 border rounded-xl p-2 flex flex-col justify-between transition-all ${cellBg} ${rec ? 'hover:shadow-md cursor-pointer hover:scale-[1.02]' : ''}`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-xs font-bold ${isSunday ? 'text-rose-500' : 'text-foreground'}`}>
              {day}
            </span>
            {isSunday && <span className="text-[9px] font-semibold text-muted-foreground">Sun</span>}
          </div>

          {isBeforeJoining ? (
            <span className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-tight">
              Before Joining
            </span>
          ) : rec ? (
            <div className="space-y-1 text-left">
              <div className="scale-90 origin-left">
                {getStatusBadge(rec)}
              </div>
              {rec.clockIn && (
                <span className="text-[10px] font-mono text-muted-foreground block truncate">
                  {new Date(rec.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              {isSunday ? 'Non-working' : '—'}
            </span>
          )}
        </div>
      );
    }

    return calendarCells;
  };

  const startRecord = (page - 1) * limit + 1;
  const endRecord = Math.min(page * limit, totalRecords);

  return (
    <div className="space-y-6 pt-4 text-left">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <h2 className="text-lg font-black text-foreground tracking-tight flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-primary" />
            Attendance History
          </h2>
          <p className="text-xs text-muted-foreground font-medium mt-0.5">
            Complete audit log of your daily attendance records, work locations, and shift durations.
          </p>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border/60 self-start sm:self-auto">
          <button
            onClick={() => setViewMode('table')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              viewMode === 'table'
                ? 'bg-card text-foreground shadow-sm border border-border/40'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <TableIcon className="w-3.5 h-3.5" /> Table View
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              viewMode === 'calendar'
                ? 'bg-card text-foreground shadow-sm border border-border/40'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <CalendarIcon className="w-3.5 h-3.5" /> Calendar View
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-card border border-border/70 rounded-2xl p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
        {/* Month */}
        <div className="space-y-1">
          <label className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground block">Month</label>
          <select
            value={filterMonth}
            onChange={(e) => { setFilterMonth(Number(e.target.value)); setPage(1); }}
            className="w-full bg-background border border-border/80 rounded-xl px-3 py-2 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
          >
            {MONTH_NAMES.map((name, idx) => (
              <option key={idx + 1} value={idx + 1}>{name}</option>
            ))}
          </select>
        </div>

        {/* Year */}
        <div className="space-y-1">
          <label className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground block">Year</label>
          <select
            value={filterYear}
            onChange={(e) => { setFilterYear(Number(e.target.value)); setPage(1); }}
            className="w-full bg-background border border-border/80 rounded-xl px-3 py-2 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
          >
            {[2025, 2026, 2027].map((yr) => (
              <option key={yr} value={yr}>{yr}</option>
            ))}
          </select>
        </div>

        {/* Status */}
        <div className="space-y-1">
          <label className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground block">Status</label>
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
            className="w-full bg-background border border-border/80 rounded-xl px-3 py-2 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value="PRESENT">Present</option>
            <option value="LATE">Late</option>
            <option value="HALF_DAY">Half Day</option>
            <option value="ABSENT">Absent</option>
            <option value="WORK_FROM_HOME">Work From Home</option>
            <option value="HOLIDAY">Holiday</option>
          </select>
        </div>

        {/* Work Location */}
        <div className="space-y-1">
          <label className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground block">Location</label>
          <select
            value={filterLocation}
            onChange={(e) => { setFilterLocation(e.target.value); setPage(1); }}
            className="w-full bg-background border border-border/80 rounded-xl px-3 py-2 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
          >
            <option value="ALL">All Locations</option>
            <option value="OFFICE">Office</option>
            <option value="HOME">Home</option>
            <option value="OTHER">Other</option>
          </select>
        </div>

        {/* Records Per Page */}
        <div className="space-y-1">
          <label className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground block">Per Page</label>
          <select
            value={limit}
            onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
            className="w-full bg-background border border-border/80 rounded-xl px-3 py-2 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
          >
            <option value={10}>10 per page</option>
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
          </select>
        </div>
      </div>

      {/* Main Content: Table or Calendar */}
      {viewMode === 'table' ? (
        <div className="bg-card border border-border/70 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border/40 bg-muted/30 text-muted-foreground uppercase font-extrabold text-[10px] tracking-wider whitespace-nowrap">
                  <th className="px-5 py-3.5">Date</th>
                  <th className="px-5 py-3.5">Clock In</th>
                  <th className="px-5 py-3.5">Clock Out</th>
                  <th className="px-5 py-3.5">Work Location</th>
                  <th className="px-5 py-3.5">Total Worked</th>
                  <th className="px-5 py-3.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-muted-foreground font-medium">
                      Loading attendance history...
                    </td>
                  </tr>
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-muted-foreground font-medium">
                      No attendance records found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  records.map((log) => (
                    <tr key={log.id} className="hover:bg-muted/20 transition-all whitespace-nowrap">
                      <td className="px-5 py-3.5 font-bold text-foreground whitespace-nowrap">
                        {formatDateDDMMYYYY(log.date)}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-foreground whitespace-nowrap">
                        {log.clockIn ? new Date(log.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-foreground whitespace-nowrap">
                        {!log.clockIn ? '—' : log.clockOut ? new Date(log.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Shift Active'}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        {getLocationBadge(log)}
                      </td>
                      <td className="px-5 py-3.5 font-medium text-foreground whitespace-nowrap">
                        {formatWorkingHours(log.workingHours, log.status)}
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        {getStatusBadge(log)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          {!loading && totalRecords > 0 && (
            <div className="p-4 border-t border-border/40 flex flex-col sm:flex-row items-center justify-between gap-3 bg-muted/10">
              <span className="text-xs text-muted-foreground font-medium">
                Showing <strong className="text-foreground">{startRecord}</strong> - <strong className="text-foreground">{endRecord}</strong> of <strong className="text-foreground">{totalRecords}</strong> records
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border/60 text-xs font-bold text-foreground disabled:opacity-40 hover:bg-muted transition-all cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" /> Previous
                </button>

                <span className="text-xs font-bold text-foreground px-2">
                  Page {page} of {totalPages}
                </span>

                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border/60 text-xs font-bold text-foreground disabled:opacity-40 hover:bg-muted transition-all cursor-pointer"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Calendar View Grid */
        <div className="bg-card border border-border/70 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-extrabold uppercase tracking-wider text-muted-foreground border-b border-border/40 pb-2">
            <span>Sun</span>
            <span>Mon</span>
            <span>Tue</span>
            <span>Wed</span>
            <span>Thu</span>
            <span>Fri</span>
            <span>Sat</span>
          </div>

          <div className="grid grid-cols-7 gap-2">
            {renderCalendarGrid()}
          </div>
        </div>
      )}

      {/* Selected Calendar Day Detail Modal */}
      {selectedDayRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card border border-border/80 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl text-left">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="text-sm font-bold text-foreground">
                {formatDateDDMMYYYY(selectedDayRecord.date)}
              </h3>
              <button
                onClick={() => setSelectedDayRecord(null)}
                className="text-muted-foreground hover:text-foreground text-xs font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground font-semibold">Status:</span>
                <div>{getStatusBadge(selectedDayRecord)}</div>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground font-semibold">Clock In:</span>
                <span className="font-mono text-foreground font-bold">
                  {selectedDayRecord.clockIn ? new Date(selectedDayRecord.clockIn).toLocaleTimeString() : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground font-semibold">Clock Out:</span>
                <span className="font-mono text-foreground font-bold">
                  {selectedDayRecord.clockOut ? new Date(selectedDayRecord.clockOut).toLocaleTimeString() : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground font-semibold">Work Location:</span>
                <div>{getLocationBadge(selectedDayRecord)}</div>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground font-semibold">Total Worked:</span>
                <span className="font-bold text-foreground">
                  {formatWorkingHours(selectedDayRecord.workingHours, selectedDayRecord.status)}
                </span>
              </div>
            </div>

            <button
              onClick={() => setSelectedDayRecord(null)}
              className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-2 rounded-xl text-xs transition-all cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
