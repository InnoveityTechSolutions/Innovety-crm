import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Sun,
  Home,
  Briefcase,
  ShieldAlert,
  Info,
  Edit3,
  Trash2,
  X,
  CheckCircle2,
  Sparkles,
  Lock,
  Building2,
  Palmtree,
  Clock,
  Video,
  Plus
} from 'lucide-react';
import api, { getSocket } from '../services/api';
import { useAuth } from '../context/AuthContext';
import CompanyScopeSelector from '../components/common/CompanyScopeSelector';
import { useCompanyScope } from '../context/CompanyScopeContext';
import { usePermissions } from '../hooks/usePermissions';
import ScheduleMeetingModal from '../components/meetings/ScheduleMeetingModal';
import MeetingDetailDrawer from '../components/meetings/MeetingDetailDrawer';
import MeetingReportModal from '../components/meetings/MeetingReportModal';

// Helper component for smooth horizontal scrolling text when title overflows cell width
const AutoMarqueeText = ({ text, className = '' }) => {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    if (containerRef.current && textRef.current) {
      setIsOverflowing(textRef.current.scrollWidth > containerRef.current.clientWidth);
    }
  }, [text]);

  return (
    <div ref={containerRef} className="w-full overflow-hidden whitespace-nowrap relative text-center">
      <span
        ref={textRef}
        className={`inline-block text-xs font-medium ${className} ${
          isOverflowing ? 'animate-marquee-scroll hover:pause-marquee' : 'truncate'
        }`}
      >
        {text}
      </span>
    </div>
  );
};

// Check if a title is a generic status default (which should NOT be rendered in normal cells)
const isGenericTitle = (title) => {
  if (!title) return true;
  const lower = title.trim().toLowerCase();
  return [
    'working day',
    'work from home',
    'sunday',
    'standard working day',
    'saturday default wfh',
    'fixed weekly holiday',
    'holiday',
    'company holiday',
    'wfh'
  ].includes(lower) || lower.endsWith('schedule');
};

// Status Configuration Tokens with rich soft corporate background colors & matching text tokens
const STATUS_TOKENS = {
  Working: {
    label: 'Working Day',
    cellBg: 'bg-[#D3F3E7] dark:bg-emerald-950/40 text-[#087443] dark:text-emerald-200 hover:bg-[#C2EDE0] dark:hover:bg-emerald-900/50 border-[#B5EADB]/40',
    legendBg: 'bg-[#D3F3E7] text-[#087443] border-[#A8E2CD] dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800/60',
    indicatorBg: 'bg-[#087443] dark:bg-emerald-400',
    textCls: 'text-[#087443] dark:text-emerald-200',
    icon: Briefcase
  },
  WFH: {
    label: 'Work From Home',
    cellBg: 'bg-[#CCE3FA] dark:bg-sky-950/40 text-[#124A9E] dark:text-sky-200 hover:bg-[#BADAFA] dark:hover:bg-sky-900/50 border-[#AEDBFA]/40',
    legendBg: 'bg-[#CCE3FA] text-[#124A9E] border-[#A3CEFA] dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-800/60',
    indicatorBg: 'bg-[#124A9E] dark:bg-sky-400',
    textCls: 'text-[#124A9E] dark:text-sky-200',
    icon: Home
  },
  Holiday: {
    label: 'Holiday',
    cellBg: 'bg-[#E9ECEF] dark:bg-slate-800/60 text-[#475569] dark:text-slate-300 hover:bg-[#DFE3E8] dark:hover:bg-slate-800/80 border-[#CBD5E1]/40',
    legendBg: 'bg-[#E9ECEF] text-[#475569] border-[#CBD5E1] dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700',
    indicatorBg: 'bg-[#475569] dark:bg-slate-400',
    textCls: 'text-[#475569] dark:text-slate-300',
    icon: Building2
  },
  MY_LEAVE: {
    label: 'My Leave',
    cellBg: 'bg-[#FFE5C0] dark:bg-amber-950/40 text-[#9E5D12] dark:text-amber-200 hover:bg-[#FCDBAA] dark:hover:bg-amber-900/50 border-[#FAD296]/40',
    legendBg: 'bg-[#FFE5C0] text-[#9E5D12] border-[#FCD298] dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800/60',
    indicatorBg: 'bg-[#9E5D12] dark:bg-amber-400',
    textCls: 'text-[#9E5D12] dark:text-amber-200',
    icon: Palmtree
  },
  COMP_OFF: {
    label: 'Comp-Off Work',
    cellBg: 'bg-[#EDE9FE] dark:bg-purple-950/40 text-[#6D28D9] dark:text-purple-200 hover:bg-[#DDD6FE] dark:hover:bg-purple-900/50 border-[#C4B5FD]/40',
    legendBg: 'bg-[#EDE9FE] text-[#6D28D9] border-[#C4B5FD] dark:bg-purple-950/50 dark:text-purple-200 dark:border-purple-800/60',
    indicatorBg: 'bg-[#7C3AED] dark:bg-purple-400',
    textCls: 'text-[#6D28D9] dark:text-purple-200',
    icon: Clock
  }
};

// Aliases for compatibility
STATUS_TOKENS.WORKING_DAY = STATUS_TOKENS.Working;
STATUS_TOKENS.HOLIDAY = STATUS_TOKENS.Holiday;
STATUS_TOKENS.SUNDAY = STATUS_TOKENS.Holiday;
STATUS_TOKENS.COMP_OFF_WORK = STATUS_TOKENS.COMP_OFF;
STATUS_TOKENS.Comp_Off = STATUS_TOKENS.COMP_OFF;

const WorkCalendar = () => {
  const { user } = useAuth();
  const isAdminOrSuperAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role);

  // Dynamic real-world today string
  const realToday = new Date();
  const todayStr = `${realToday.getFullYear()}-${String(realToday.getMonth() + 1).padStart(2, '0')}-${String(realToday.getDate()).padStart(2, '0')}`;

  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarDays, setCalendarDays] = useState([]);
  const [shiftInfo, setShiftInfo] = useState({
    shiftName: '',
    startTime: '',
    endTime: '',
    formattedStart: '',
    formattedEnd: ''
  });
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Selected date details modal state
  const [selectedDay, setSelectedDay] = useState(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // In-Place Edit Mode state for Date Override
  const [isEditMode, setIsEditMode] = useState(false);
  const [editForm, setEditForm] = useState({
    date: '',
    status: 'WORKING_DAY',
    title: '',
    reason: '',
    isPermanent: false
  });
  const [saving, setSaving] = useState(false);

  const month = currentDate.getMonth() + 1;
  const year = currentDate.getFullYear();

  const monthName = currentDate.toLocaleString('default', { month: 'long' });

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const { selectedOrgId, effectiveOrgId, loading: orgsLoading, companies } = useCompanyScope();
  const targetOrg = isSuperAdmin ? selectedOrgId : (effectiveOrgId || user?.organizationId);
  const selectedOrgIdRef = useRef(targetOrg);
  useEffect(() => {
    selectedOrgIdRef.current = targetOrg;
  }, [targetOrg]);

  // Phase 3 Meetings Module Integration
  const { canEdit } = usePermissions();
  const canScheduleMeeting = canEdit('meetings');

  const [meetings, setMeetings] = useState([]);
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [isMeetingDrawerOpen, setIsMeetingDrawerOpen] = useState(false);
  const [isScheduleMeetingOpen, setIsScheduleMeetingOpen] = useState(false);
  const [scheduleInitialDate, setScheduleInitialDate] = useState('');
  const [editingMeeting, setEditingMeeting] = useState(null);
  const [reportMeeting, setReportMeeting] = useState(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  // Index meetings by date string 'YYYY-MM-DD'
  const meetingsByDate = React.useMemo(() => {
    const map = {};
    (meetings || []).forEach(m => {
      let dStr = null;
      if (m.date) {
        dStr = typeof m.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(m.date)
          ? m.date.slice(0, 10)
          : new Date(m.date).toISOString().slice(0, 10);
      } else if (m.startTime) {
        const s = new Date(m.startTime);
        if (!isNaN(s.getTime())) {
          dStr = `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`;
        }
      }
      if (!dStr) return;
      if (!map[dStr]) map[dStr] = [];
      if (!map[dStr].some(existing => existing.id === m.id)) {
        map[dStr].push(m);
      }
    });
    return map;
  }, [meetings]);

  // Fetch Monthly Calendar Data
  const fetchCalendar = async (targetOrgOverride) => {
    try {
      setLoading(true);
      setErrorMsg('');
      const activeOrg = targetOrgOverride !== undefined ? targetOrgOverride : (selectedOrgIdRef.current || targetOrg);

      // Do not attempt to fetch before company scope is resolved if companies exist
      if (orgsLoading) return;

      const params = new URLSearchParams({ month, year });
      if (activeOrg) params.append('organizationId', activeOrg);

      const res = await api.get(`/work-calendar?${params.toString()}`);
      setCalendarDays(res.data.days || []);
      if (res.data.shiftName) {
        setShiftInfo({
          shiftName: res.data.shiftName,
          startTime: res.data.startTime || '',
          endTime: res.data.endTime || '',
          formattedStart: res.data.formattedStart || '',
          formattedEnd: res.data.formattedEnd || ''
        });
      }
    } catch (err) {
      console.error('[WorkCalendar] Failed to load work calendar:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to fetch work calendar data.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch Meetings for this scope
  const fetchMeetings = async (targetOrgOverride) => {
    try {
      const activeOrg = targetOrgOverride !== undefined ? targetOrgOverride : (selectedOrgIdRef.current || targetOrg);
      if (orgsLoading) return;
      const params = activeOrg ? { organizationId: activeOrg } : {};
      const res = await api.get('/meetings', { params });
      setMeetings(res.data?.meetings || []);
    } catch (err) {
      console.error('[WorkCalendar] Failed to load meetings:', err);
    }
  };

  useEffect(() => {
    if (orgsLoading) return;
    if (companies && companies.length > 0 && !selectedOrgId) return;
    setCalendarDays([]);
    fetchCalendar(selectedOrgId);
    fetchMeetings(selectedOrgId);
  }, [month, year, selectedOrgId, orgsLoading, companies]);

  // Real-time synchronization when shifts, schedules, member assignments, or meetings update
  useEffect(() => {
    const handleShiftUpdated = () => {
      fetchCalendar();
    };

    const handleMeetingsUpdated = () => {
      fetchMeetings();
    };

    window.addEventListener('shift_updated', handleShiftUpdated);
    window.addEventListener('schedule_updated', handleShiftUpdated);
    window.addEventListener('meeting_created', handleMeetingsUpdated);
    window.addEventListener('meeting_updated', handleMeetingsUpdated);
    window.addEventListener('meeting_rescheduled', handleMeetingsUpdated);
    window.addEventListener('meeting_cancelled', handleMeetingsUpdated);

    const socket = getSocket();
    if (socket) {
      socket.on('shift_updated', handleShiftUpdated);
      socket.on('schedule_updated', handleShiftUpdated);
      socket.on('work_calendar_updated', handleShiftUpdated);
      socket.on('meeting_created', handleMeetingsUpdated);
      socket.on('meeting_updated', handleMeetingsUpdated);
      socket.on('meeting_rescheduled', handleMeetingsUpdated);
      socket.on('meeting_cancelled', handleMeetingsUpdated);
    }

    return () => {
      window.removeEventListener('shift_updated', handleShiftUpdated);
      window.removeEventListener('schedule_updated', handleShiftUpdated);
      window.removeEventListener('meeting_created', handleMeetingsUpdated);
      window.removeEventListener('meeting_updated', handleMeetingsUpdated);
      window.removeEventListener('meeting_rescheduled', handleMeetingsUpdated);
      window.removeEventListener('meeting_cancelled', handleMeetingsUpdated);
      if (socket) {
        socket.off('shift_updated', handleShiftUpdated);
        socket.off('schedule_updated', handleShiftUpdated);
        socket.off('work_calendar_updated', handleShiftUpdated);
        socket.off('meeting_created', handleMeetingsUpdated);
        socket.off('meeting_updated', handleMeetingsUpdated);
        socket.off('meeting_rescheduled', handleMeetingsUpdated);
        socket.off('meeting_cancelled', handleMeetingsUpdated);
      }
    };
  }, [month, year, selectedOrgId]);

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 2, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month, 1));
  };

  // Navigates directly to the actual current real-world month & year
  const handleToday = () => {
    const now = new Date();
    setCurrentDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  };

  // Open Modal (Date Override Form DIRECTLY for Admin/Super Admin on editable dates)
  const handleDayClick = (dayItem) => {
    setSelectedDay(dayItem);
    let defaultStatus = dayItem.status;
    if (dayItem.status === 'Working' || dayItem.status === 'WORKING_DAY') defaultStatus = 'WORKING_DAY';
    else if (dayItem.status === 'WFH') defaultStatus = 'WFH';
    else if (dayItem.status === 'Holiday' || dayItem.status === 'HOLIDAY' || dayItem.status === 'SUNDAY') defaultStatus = 'HOLIDAY';
    else if (dayItem.status === 'MY_LEAVE') defaultStatus = dayItem.dayOfWeek === 6 ? 'WFH' : 'WORKING_DAY';
    else if (dayItem.status === 'COMP_OFF') defaultStatus = 'HOLIDAY';

    setEditForm({
      date: dayItem.date,
      status: ['WORKING_DAY', 'WFH', 'HOLIDAY'].includes(defaultStatus) ? defaultStatus : 'WORKING_DAY',
      title: dayItem.title && !isGenericTitle(dayItem.title) ? dayItem.title : '',
      reason: dayItem.reason && !['Saturday Default WFH', 'Standard Working Day', 'Fixed Weekly Holiday'].includes(dayItem.reason) && !dayItem.reason.endsWith('Schedule') ? dayItem.reason : '',
      isPermanent: Boolean(dayItem.isPermanent)
    });

    // Admin / Super Admin opening an editable (non-Sunday, non-CompOff) date -> open Override Form directly
    if (isAdminOrSuperAdmin && !dayItem.isSunday && dayItem.status !== 'COMP_OFF') {
      setIsEditMode(true);
    } else {
      setIsEditMode(false);
    }
    setIsDetailsOpen(true);
  };

  const handleStartEdit = () => {
    setIsEditMode(true);
  };

  // Close Override Form and discard changes
  const handleCancelEdit = () => {
    setIsDetailsOpen(false);
    setIsEditMode(false);
  };

  // Save Override Handler (Admin / Super Admin)
  const handleSaveOverride = async (e) => {
    e.preventDefault();
    if (!selectedDay || selectedDay.isSunday) return;

    try {
      setSaving(true);
      setErrorMsg('');

      const cleanTitle = editForm.title.trim();
      const cleanReason = editForm.reason.trim();
      const payload = {
        date: editForm.date,
        status: editForm.status,
        title: cleanTitle || null,
        reason: cleanReason || null,
        isPermanent: editForm.status === 'HOLIDAY' ? editForm.isPermanent : false,
        organizationId: selectedOrgIdRef.current || selectedOrgId
      };

      await api.post('/work-calendar', payload);

      setSuccessMsg('Calendar date override saved successfully.');
      setIsDetailsOpen(false);
      setIsEditMode(false);
      fetchCalendar();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      console.error('Save override error:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to save calendar override.');
    } finally {
      setSaving(false);
    }
  };

  // Delete Override Handler (Admin / Super Admin)
  const handleDeleteOverride = async () => {
    if (!selectedDay?.overrideId) return;
    if (!window.confirm('Are you sure you want to delete this custom override? The date will revert to its default schedule.')) return;

    try {
      setSaving(true);
      await api.delete(`/work-calendar/${selectedDay.overrideId}`);

      setSuccessMsg('Override deleted. Date restored to default schedule.');
      setIsDetailsOpen(false);
      setIsEditMode(false);
      fetchCalendar();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      console.error('Delete override error:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to delete override.');
    } finally {
      setSaving(false);
    }
  };

  // Calculate previous month padding dates
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay(); // 0 = Sun, ..., 6 = Sat
  const daysInPrevMonth = new Date(year, month - 1, 0).getDate();

  const prevMonthPaddingDays = [];
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    prevMonthPaddingDays.push(daysInPrevMonth - i);
  }

  // Calculate next month padding dates to complete grid (35 or 42 cells total)
  const totalCurrentMonthCells = firstDayOfWeek + calendarDays.length;
  const totalGridCells = totalCurrentMonthCells > 35 ? 42 : 35;
  const nextMonthPaddingCount = totalGridCells - totalCurrentMonthCells;

  const nextMonthPaddingDays = [];
  for (let i = 1; i <= nextMonthPaddingCount; i++) {
    nextMonthPaddingDays.push(i);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 md:p-8 max-w-7xl mx-auto space-y-6"
    >
      <CompanyScopeSelector />

      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border/40 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <CalendarIcon className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">Work Calendar</h1>
                {shiftInfo.shiftName && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 text-primary border border-primary/20 text-xs font-semibold shadow-xs">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Shift: {shiftInfo.shiftName} {shiftInfo.formattedStart ? `(${shiftInfo.formattedStart} – ${shiftInfo.formattedEnd})` : ''}</span>
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Live view of your assigned shift schedule, working days, WFH schedule, holidays, and leaves.
              </p>
            </div>
          </div>
        </div>

        {/* Month Navigation & Controls */}
        <div className="flex flex-wrap items-center gap-2 self-stretch sm:self-auto">
          {canScheduleMeeting && (
            <button
              onClick={() => {
                setScheduleInitialDate(todayStr);
                setEditingMeeting(null);
                setIsScheduleMeetingOpen(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-xs hover:bg-primary-hover transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Schedule Meeting</span>
            </button>
          )}

          <div className="flex items-center gap-1.5 bg-card border border-border rounded-xl p-1 shadow-sm">
            <button
              onClick={handlePrevMonth}
              className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Previous Month"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={handleToday}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
            >
              Today
            </button>
            <span className="px-3 py-1 font-semibold text-sm min-w-[130px] text-center text-foreground">
              {monthName} {year}
            </span>
            <button
              onClick={handleNextMonth}
              className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Next Month"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Alert Toasts */}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-danger/10 border border-danger/30 text-danger flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchCalendar()}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-danger/20 hover:bg-danger/30 text-danger transition-colors"
            >
              Retry
            </button>
            <button onClick={() => setErrorMsg('')} className="p-1 hover:bg-danger/20 rounded-md">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl bg-success/10 border border-success/30 text-success flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg('')} className="p-1 hover:bg-success/20 rounded-md">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Calendar Legend Bar */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3 text-xs md:text-sm">
        <span className="font-semibold text-muted-foreground uppercase text-[11px] tracking-wider">Legend:</span>
        <div className="flex flex-wrap items-center gap-2 md:gap-4">
          {['Working', 'WFH', 'Holiday', 'MY_LEAVE', 'COMP_OFF'].map((key) => {
            const config = STATUS_TOKENS[key];
            if (!config) return null;
            const Icon = config.icon;
            return (
              <div
                key={key}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-medium ${config.legendBg}`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${config.indicatorBg}`} />
                <Icon className="w-3.5 h-3.5" />
                <span>{config.label}</span>
              </div>
            );
          })}
          {/* Meetings Legend Item */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
            <Video className="w-3.5 h-3.5" />
            <span>Meeting</span>
          </div>
        </div>
      </div>

      {/* Main Monthly Calendar Grid */}
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        {/* Day Header Row (Sun header remains red) */}
        <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-center font-semibold text-xs py-3 text-muted-foreground uppercase tracking-wider">
          <div className="text-rose-500 dark:text-rose-400">Sun</div>
          <div>Mon</div>
          <div>Tue</div>
          <div>Wed</div>
          <div>Thu</div>
          <div>Fri</div>
          <div className="text-sky-500 dark:text-sky-400">Sat</div>
        </div>

        {/* Days Grid */}
        {loading ? (
          <div className="p-16 text-center text-muted-foreground flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium">Loading calendar schedule...</p>
          </div>
        ) : (
          <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-border/60 bg-background">
            {/* Previous Month Faded Padding Days (Neutral/white background, faded gray date) */}
            {prevMonthPaddingDays.map((prevDay) => (
              <div
                key={`prev-${prevDay}`}
                className="p-2.5 md:p-3.5 min-h-[95px] md:min-h-[115px] flex flex-col items-center justify-center text-center bg-white dark:bg-card select-none"
              >
                <span className="text-lg md:text-xl font-normal text-slate-400 dark:text-slate-600 select-none">
                  {prevDay}
                </span>
              </div>
            ))}

            {/* Current Month Calendar Days */}
            {calendarDays.map((dayItem) => {
              const dayNum = parseInt(dayItem.date.split('-')[2], 10);
              const isToday = dayItem.date === todayStr;
              const config = STATUS_TOKENS[dayItem.status] || STATUS_TOKENS.Working;
              const showCustomTitle = !isGenericTitle(dayItem.title);

              return (
                <div
                  key={dayItem.date}
                  onClick={() => handleDayClick(dayItem)}
                  className={`group relative p-2.5 md:p-3.5 min-h-[95px] md:min-h-[115px] flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-150 ${
                    config.cellBg
                  } ${
                    isToday ? 'ring-2 ring-[#087443] ring-inset shadow-xs' : ''
                  }`}
                >
                  {/* Today Indicator Badge */}
                  {isToday && (
                    <span className="absolute top-1.5 right-1.5 text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-[#087443] text-white uppercase tracking-wider shadow-xs">
                      TODAY
                    </span>
                  )}

                  {/* Permanent Holiday Sparkles */}
                  {dayItem.isPermanent && (
                    <span className="absolute top-1.5 left-1.5" title="Annual Permanent Holiday">
                      <Sparkles className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                    </span>
                  )}

                  {/* Centered Date Number */}
                  <span
                    className={`text-lg md:text-xl font-medium transition-transform group-hover:scale-105 ${
                      isToday
                        ? 'w-8 h-8 rounded-full bg-[#087443] text-white flex items-center justify-center font-semibold shadow-xs'
                        : config.textCls
                    }`}
                  >
                    {dayNum}
                  </span>

                  {/* Custom Title ONLY (Centered below date number with auto marquee scroll) */}
                  {showCustomTitle && (
                    <div className="mt-1.5 w-full overflow-hidden px-1">
                      <AutoMarqueeText
                        text={dayItem.title}
                        className={`text-xs font-semibold ${config.textCls} leading-tight`}
                      />
                    </div>
                  )}

                  {/* Scheduled Meetings Chips */}
                  {(() => {
                    const dayMeetings = meetingsByDate[dayItem.date] || [];
                    if (dayMeetings.length === 0) return null;
                    return (
                      <div className="mt-1 w-full flex flex-col gap-1 px-1 z-10">
                        {dayMeetings.slice(0, 2).map((m) => {
                          const timeStr = m.startTime
                            ? new Date(m.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                            : '';
                          const isCancelled = m.status === 'CANCELLED';
                          const isCompleted = m.status === 'COMPLETED';
                          return (
                            <div
                              key={m.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedMeeting(m);
                                setIsMeetingDrawerOpen(true);
                              }}
                              className={`w-full px-1.5 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 truncate transition-all hover:scale-[1.02] shadow-2xs cursor-pointer ${
                                isCancelled
                                  ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300 line-through'
                                  : isCompleted
                                  ? 'bg-sky-500/20 text-sky-700 dark:text-sky-300'
                                  : 'bg-emerald-600 text-white dark:bg-emerald-500'
                              }`}
                              title={`${m.title} (${timeStr})`}
                            >
                              <Video className="w-2.5 h-2.5 shrink-0" />
                              <span className="truncate">{timeStr ? `${timeStr} ` : ''}{m.title}</span>
                            </div>
                          );
                        })}
                        {dayMeetings.length > 2 && (
                          <span className="text-[9px] font-bold text-muted-foreground text-center">
                            +{dayMeetings.length - 2} more
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })}

            {/* Next Month Faded Padding Days (Neutral/white background, faded gray date) */}
            {nextMonthPaddingDays.map((nextDay) => (
              <div
                key={`next-${nextDay}`}
                className="p-2.5 md:p-3.5 min-h-[95px] md:min-h-[115px] flex flex-col items-center justify-center text-center bg-white dark:bg-card select-none"
              >
                <span className="text-lg md:text-xl font-normal text-slate-400 dark:text-slate-600 select-none">
                  {nextDay}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Single Date Details & Edit Override Modal */}
      <AnimatePresence>
        {isDetailsOpen && selectedDay && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border border-border rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-5"
            >
              <div className="flex items-start justify-between border-b border-border/40 pb-4">
                <div>
                  <h3 className="text-lg font-bold text-foreground">
                    {new Date(selectedDay.date + 'T00:00:00').toLocaleDateString('default', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {isEditMode ? 'Date Override Form' : 'Work Calendar Date Details'}
                  </p>
                </div>
                <button
                  onClick={() => { setIsDetailsOpen(false); setIsEditMode(false); }}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {!isEditMode ? (
                /* READ-ONLY DETAILS VIEW */
                <div className="space-y-4">
                  {/* Status Badge */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</label>
                    {(() => {
                      const cfg = STATUS_TOKENS[selectedDay.status] || STATUS_TOKENS.Working;
                      const Icon = cfg.icon;
                      return (
                        <div className={`mt-1 flex items-center gap-2 px-3 py-2 rounded-xl border font-semibold text-sm ${cfg.legendBg}`}>
                          <span className={`w-3 h-3 rounded-full ${cfg.indicatorBg}`} />
                          <Icon className="w-4 h-4" />
                          <span>{cfg.label}</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Title */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Title</label>
                    <p className="text-sm font-semibold text-foreground mt-0.5">{selectedDay.title || 'Standard Schedule'}</p>
                  </div>

                  {/* Reason / Details */}
                  {selectedDay.reason && (
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Details / Reason</label>
                      <p className="text-sm text-foreground/90 bg-muted/40 p-3 rounded-xl border border-border/50 mt-1 whitespace-pre-wrap">
                        {selectedDay.reason}
                      </p>
                    </div>
                  )}

                  {/* Permanent Holiday Flag */}
                  {selectedDay.isPermanent && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-medium">
                      <Sparkles className="w-4 h-4 shrink-0 text-amber-500" />
                      <span>This is an annual recurring permanent company holiday.</span>
                    </div>
                  )}

                  {/* Created By Metadata */}
                  {selectedDay.createdBy && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
                      <Info className="w-3.5 h-3.5" />
                      <span>Configured by Admin: <strong>{selectedDay.createdBy}</strong></span>
                    </div>
                  )}

                  {/* Approved Comp-Off Work Banner or Sunday Locked Warning Banner */}
                  {(selectedDay.status === 'COMP_OFF' || selectedDay.compOffDetails) ? (
                    <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300 flex items-start gap-2.5 text-xs">
                      <Clock className="w-4 h-4 shrink-0 mt-0.5 text-purple-600 dark:text-purple-400" />
                      <div>
                        <strong className="font-semibold block">Approved Comp-Off Work</strong>
                        <span>{selectedDay.compOffDetails?.reason || selectedDay.reason || 'Approved off-day work session.'}</span>
                        {selectedDay.compOffDetails?.approvedBy && (
                          <span className="block mt-1 text-[11px] text-muted-foreground">
                            Sanctioned by: <strong>{selectedDay.compOffDetails.approvedBy}</strong>
                          </span>
                        )}
                        {selectedDay.isSunday && (
                          <span className="block mt-1 text-[11px] text-purple-600/80 dark:text-purple-300/80 italic">
                            (Scheduled on Sunday weekly off)
                          </span>
                        )}
                      </div>
                    </div>
                  ) : selectedDay.isSunday ? (
                    <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 flex items-start gap-2.5 text-xs">
                      <Lock className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                      <div>
                        <strong className="font-semibold block">Sunday — Fixed Holiday</strong>
                        Sunday is a fixed weekly holiday and cannot be modified.
                      </div>
                    </div>
                  ) : null}

                  {/* Scheduled Meetings on this Date */}
                  <div className="space-y-2 pt-2 border-t border-border/60">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <Video className="w-3.5 h-3.5 text-primary" />
                        <span>Scheduled Meetings ({(meetingsByDate[selectedDay.date] || []).length})</span>
                      </label>
                      {canScheduleMeeting && (
                        <button
                          type="button"
                          onClick={() => {
                            setScheduleInitialDate(selectedDay.date);
                            setEditingMeeting(null);
                            setIsScheduleMeetingOpen(true);
                          }}
                          className="text-[11px] font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Schedule</span>
                        </button>
                      )}
                    </div>

                    {(meetingsByDate[selectedDay.date] || []).length === 0 ? (
                      <p className="text-xs text-muted-foreground italic bg-muted/20 p-2.5 rounded-xl border border-border/40">
                        No meetings scheduled on this day.
                      </p>
                    ) : (
                      <div className="space-y-1.5 max-h-36 overflow-y-auto">
                        {(meetingsByDate[selectedDay.date] || []).map((m) => {
                          const timeStr = m.startTime
                            ? new Date(m.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : '';
                          return (
                            <div
                              key={m.id}
                              onClick={() => {
                                setSelectedMeeting(m);
                                setIsMeetingDrawerOpen(true);
                              }}
                              className="p-2.5 rounded-xl bg-background hover:bg-muted/50 border border-border flex items-center justify-between text-xs cursor-pointer transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${
                                  m.status === 'COMPLETED' ? 'bg-sky-500' : m.status === 'CANCELLED' ? 'bg-rose-500' : 'bg-emerald-500'
                                }`} />
                                <div>
                                  <p className="font-bold text-foreground truncate max-w-[180px]">{m.title}</p>
                                  <p className="text-[10px] text-muted-foreground">{timeStr}</p>
                                </div>
                              </div>
                              <span className="text-[10px] font-bold text-primary hover:underline">
                                View Details
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Read-Only Action Buttons */}
                  <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-4">
                    {selectedDay.overrideId && isAdminOrSuperAdmin && !selectedDay.isSunday && (
                      <button
                        onClick={handleDeleteOverride}
                        disabled={saving}
                        className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-danger/10 text-danger hover:bg-danger/20 transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete Override
                      </button>
                    )}

                    {isAdminOrSuperAdmin && !selectedDay.isSunday && selectedDay.status !== 'COMP_OFF' && (
                      <button
                        onClick={handleStartEdit}
                        className="px-4 py-2 text-xs font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary-hover transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4" />
                        Override
                      </button>
                    )}

                    <button
                      onClick={() => { setIsDetailsOpen(false); setIsEditMode(false); }}
                      className="px-4 py-2 text-xs font-semibold rounded-xl bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : (
                /* IN-PLACE EDIT MODE FORM */
                <form onSubmit={handleSaveOverride} className="space-y-4">
                  {/* Status Selector */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">Status</label>
                    <select
                      value={editForm.status}
                      disabled={selectedDay.isSunday}
                      onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
                    >
                      <option value="WORKING_DAY">🟢 Working Day</option>
                      <option value="WFH">🔵 Work From Home</option>
                      <option value="HOLIDAY">⚪ Company Holiday</option>
                    </select>
                  </div>

                  {/* Title */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">Title</label>
                    <input
                      type="text"
                      placeholder="e.g. Independence Day / Special Working Day"
                      value={editForm.title}
                      onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>

                  {/* Reason / Details */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">Details / Reason</label>
                    <textarea
                      rows={3}
                      placeholder="Enter reason or additional details..."
                      value={editForm.reason}
                      onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                    />
                  </div>

                  {/* Permanent Holiday Checkbox (Only when status is HOLIDAY) */}
                  {editForm.status === 'HOLIDAY' && (
                    <label className="flex items-center gap-2.5 p-3 rounded-xl bg-muted/40 border border-border cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={editForm.isPermanent}
                        onChange={(e) => setEditForm({ ...editForm, isPermanent: e.target.checked })}
                        className="w-4 h-4 rounded text-primary focus:ring-primary"
                      />
                      <span className="text-xs font-medium text-foreground">
                        Make this holiday permanent every year
                      </span>
                    </label>
                  )}

                  {/* Edit Mode Buttons */}
                  <div className="flex items-center justify-between border-t border-border/40 pt-4">
                    {selectedDay.overrideId ? (
                      <button
                        type="button"
                        onClick={handleDeleteOverride}
                        disabled={saving}
                        className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-danger/10 text-danger hover:bg-danger/20 transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete Override
                      </button>
                    ) : <div />}

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="px-4 py-2 text-xs font-semibold rounded-xl bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={saving}
                        className="px-5 py-2 text-xs font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary-hover transition-colors shadow-sm disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                      >
                        {saving ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Saving...
                          </>
                        ) : (
                          'Save Changes'
                        )}
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Phase 3 Meeting Modals & Drawers */}
      <ScheduleMeetingModal
        isOpen={isScheduleMeetingOpen}
        onClose={() => {
          setIsScheduleMeetingOpen(false);
          setEditingMeeting(null);
        }}
        initialDate={scheduleInitialDate}
        editingMeeting={editingMeeting}
        onSuccess={() => {
          fetchMeetings();
        }}
      />

      <MeetingDetailDrawer
        isOpen={isMeetingDrawerOpen}
        onClose={() => {
          setIsMeetingDrawerOpen(false);
          setSelectedMeeting(null);
        }}
        meeting={selectedMeeting}
        onEdit={(m) => {
          setIsMeetingDrawerOpen(false);
          setEditingMeeting(m);
          setIsScheduleMeetingOpen(true);
        }}
        onOpenReport={(m) => {
          setIsMeetingDrawerOpen(false);
          setReportMeeting(m);
          setIsReportModalOpen(true);
        }}
        onMeetingUpdated={() => {
          fetchMeetings();
        }}
      />

      <MeetingReportModal
        isOpen={isReportModalOpen}
        onClose={() => {
          setIsReportModalOpen(false);
          setReportMeeting(null);
        }}
        meeting={reportMeeting}
        onSuccess={() => {
          fetchMeetings();
        }}
      />
    </motion.div>
  );
};

export default WorkCalendar;
