import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { useTheme } from '../../context/ThemeContext';
import api, { getSocket } from '../../services/api';
import UserAvatar from '../common/UserAvatar';
import ClockInModal from '../attendance/ClockInModal';
import ApplyLeaveModal from '../leave/ApplyLeaveModal';
import ClockOutReminderModal from '../worklog/ClockOutReminderModal';
import useClockOutWithReminder from '../../hooks/useClockOutWithReminder';
import useShiftCountdown from '../../hooks/useShiftCountdown';
import { getTargetShiftHours, getShiftProgressColor } from '../../utils/shiftProgress';
import ClockInToast from '../common/ClockInToast';
import CompOffSessionCard from '../leave/CompOffSessionCard';
import TeamRosterStatus from './TeamRosterStatus';
import TimeRollSuccessBanner from '../common/TimeRollSuccessBanner';
import { captureDeviceCoordinates, reverseGeocodeCoordinates } from '../../utils/geolocationHelper';
import { formatCompOffWorkedDuration } from '../../utils/attendanceFormatter';
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Play,
  Square,
  FileText,
  Calendar,
  CheckCircle,
  User as UserIcon,
  Users,
  Briefcase,
  TrendingUp,
  Award,
  Sparkles,
  ChevronRight,
  Plus,
  MessageSquare,
  Megaphone,
  Activity,
  MapPin,
  Shield,
  Layers,
  ArrowUpRight,
  Laptop,
  Send,
  X
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: 'easeOut' }
  }
};

export const EmployeeDashboard = () => {
  const { user } = useAuth();
  const { onlineUsers, notifications } = useSocket();
  const { userChatEnabled } = useTheme();
  const navigate = useNavigate();

  // Time & Live Clock State
  const [time, setTime] = useState(new Date());

  // Attendance State
  const [clockedRecord, setClockedRecord] = useState(null);
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [clockLoading, setClockLoading] = useState(false);
  const [clockStatus, setClockStatus] = useState(null);
  const [attendanceAlert, setAttendanceAlert] = useState('');
  const [clockInToast, setClockInToast] = useState(null);
  const [upcomingSchedule, setUpcomingSchedule] = useState(null);
  const [compOffStatus, setCompOffStatus] = useState(null);
  const [isCompOffLoginModalOpen, setIsCompOffLoginModalOpen] = useState(false);
  const [compOffActionLoading, setCompOffActionLoading] = useState(false);

  const handleClockInSuccess = (resData) => {
    setIsClockInModalOpen(false);
    const statusStr = resData?.attendanceStatus || resData?.status || (resData?.attendance?.status === 'LATE' ? 'LATE' : 'PRESENT');
    const timeStr = resData?.checkInTime || (resData?.clockIn ? new Date(resData.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

    setClockInToast({
      type: 'success',
      checkInTime: timeStr,
      attendanceStatus: statusStr
    });
    fetchEmployeeDashboardData();

    setTimeout(() => {
      setClockInToast(null);
    }, 3000);
  };

  const handleClockInError = (errMsg) => {
    setClockInToast({
      type: 'error',
      title: 'Clock-In Failed',
      message: errMsg || 'Please try again.'
    });

    setTimeout(() => {
      setClockInToast(null);
    }, 3000);
  };

  const isClockedIn = Boolean(clockedRecord && clockedRecord.clockIn && !clockedRecord.clockOut);

  const isClockedOutToday = Boolean(clockedRecord && clockedRecord.clockIn && clockedRecord.clockOut);

  const getWorkedDurationText = (record) => {
    if (!record?.clockIn || !record?.clockOut) return null;
    const start = new Date(record.clockIn).getTime();
    const end = new Date(record.clockOut).getTime();
    const diff = end - start;
    if (isNaN(diff) || diff <= 0) return null;
    const mins = Math.floor(diff / (1000 * 60));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  };

  const shiftCountdown = useShiftCountdown({
    shiftEndAt: clockStatus?.shiftEndAt || clockedRecord?.shiftEndAt,
    serverTime: clockStatus?.serverTime,
    autoClockOutEnabled: clockStatus?.autoClockOutEnabled,
    isClockedIn,
    onShiftEnd: () => {
      fetchEmployeeDashboardData();
    }
  });



  // Data States (Strictly Database Fetched & Employee Scoped)
  const [myTasks, setMyTasks] = useState([]);
  const [teamTasks, setTeamTasks] = useState([]);
  const [myProjects, setMyProjects] = useState([]);
  const [myTeam, setMyTeam] = useState(null);
  const [myActivities, setMyActivities] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);

  // Leave Modal State
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    type: 'CASUAL',
    reason: '',
    contactPhone: ''
  });
  const [leaveSuccess, setLeaveSuccess] = useState(null);

  // Time Filter for Charts & Dynamic Theme RGB Color Tracking
  const [timeFilter, setTimeFilter] = useState('1W');
  const [chartPrimaryColor, setChartPrimaryColor] = useState('rgb(var(--primary))');

  useEffect(() => {
    const updateThemeColor = () => {
      const computed = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
      if (computed) {
        setChartPrimaryColor(`rgb(${computed})`);
      }
    };
    updateThemeColor();
    const observer = new MutationObserver(updateThemeColor);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const lastFetchTimestampRef = useRef(0);
  const debounceFetchTimerRef = useRef(null);

  const safeRefreshDashboard = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastFetchTimestampRef.current < 1500) {
      return;
    }
    if (debounceFetchTimerRef.current) {
      clearTimeout(debounceFetchTimerRef.current);
    }
    debounceFetchTimerRef.current = setTimeout(() => {
      lastFetchTimestampRef.current = Date.now();
      console.log('[Dashboard] Executing single dashboard & shift state refresh');
      fetchEmployeeDashboardData();
    }, 100);
  }, []);

  useEffect(() => {
    fetchEmployeeDashboardData();

    const handleShiftEvent = (payload) => {
      console.log('[Socket/Window] Shift update received on Employee Dashboard:', payload);
      safeRefreshDashboard(true);
    };

    window.addEventListener('shift_updated', handleShiftEvent);
    const socket = getSocket();
    if (socket) {
      const handleAttendanceEvent = (payload) => {
        console.log('[Socket] Attendance event received:', payload?.record?.id || payload);
        safeRefreshDashboard();
      };
      
      socket.off('attendance_clock_in', handleAttendanceEvent);
      socket.off('attendance_clock_out', handleAttendanceEvent);
      socket.off('attendance_updated', handleAttendanceEvent);
      socket.off('settings_updated', handleAttendanceEvent);
      socket.off('shift_updated', handleShiftEvent);
      socket.off('schedule_updated', handleShiftEvent);

      socket.on('attendance_clock_in', handleAttendanceEvent);
      socket.on('attendance_clock_out', handleAttendanceEvent);
      socket.on('attendance_updated', handleAttendanceEvent);
      socket.on('settings_updated', handleAttendanceEvent);
      socket.on('shift_updated', handleShiftEvent);
      socket.on('schedule_updated', handleShiftEvent);

      return () => {
        window.removeEventListener('shift_updated', handleShiftEvent);
        socket.off('attendance_clock_in', handleAttendanceEvent);
        socket.off('attendance_clock_out', handleAttendanceEvent);
        socket.off('attendance_updated', handleAttendanceEvent);
        socket.off('settings_updated', handleAttendanceEvent);
        socket.off('shift_updated', handleShiftEvent);
        socket.off('schedule_updated', handleShiftEvent);
      };
    } else {
      return () => {
        window.removeEventListener('shift_updated', handleShiftEvent);
      };
    }
  }, [user, safeRefreshDashboard]);

  const fetchEmployeeDashboardData = async () => {
    try {
      setLoading(true);

      const [
        tasksRes,
        projectsRes,
        attendanceStatusRes,
        attendanceLogsRes,
        announcementsRes,
        leavesRes,
        teamsRes,
        logsRes,
        holidaysRes,
        scheduleRes,
        compOffStatusRes
      ] = await Promise.all([
        api.get('/tasks').catch(() => ({ data: [] })),
        api.get('/projects').catch(() => ({ data: [] })),
        api.get('/attendance/status').catch(() => ({ data: null })),
        api.get('/attendance/logs').catch(() => ({ data: [] })),
        api.get('/announcements').catch(() => ({ data: [] })),
        api.get('/leaves').catch(() => ({ data: [] })),
        api.get('/teams').catch(() => ({ data: [] })),
        api.get('/logs?limit=20').catch(() => ({ data: { logs: [] } })),
        api.get('/payroll/holidays').catch(() => ({ data: [] })),
        api.get('/shifts/my-schedule').catch(() => ({ data: {} })),
        api.get('/comp-off/sessions/today-status').catch(() => ({ data: null }))
      ]);

      // 1. My Tasks (Strictly Filtered for logged-in Employee)
      const tasksData = Array.isArray(tasksRes.data) ? tasksRes.data : [];
      setTeamTasks(tasksData);
      const userAssigned = tasksData.filter(t => 
        t.assigneeId === user.id || 
        t.assignedToId === user.id || 
        t.assignedTo?.id === user.id ||
        (t.assignees && t.assignees.some(a => a.id === user.id))
      );
      setMyTasks(userAssigned);

      // 2. My Projects (Filtered for logged-in Employee)
      const projectsData = Array.isArray(projectsRes.data) ? projectsRes.data : [];
      const userProj = projectsData.filter(p => 
        p.members && p.members.some(m => m.userId === user.id || m.id === user.id)
      );
      setMyProjects(userProj);

      // 3. Attendance Status & Logs
      const logs = Array.isArray(attendanceLogsRes.data) ? attendanceLogsRes.data : [];
      setAttendanceLogs(logs);
      
      const holData = Array.isArray(holidaysRes.data) ? holidaysRes.data : [];
      setHolidays(holData);
      
      const statusData = attendanceStatusRes.data;
      setClockStatus(statusData);

      const compOffData = compOffStatusRes?.data || null;
      setCompOffStatus(compOffData);

      const localDateStr = new Date().toLocaleDateString('en-CA');
      const todayRec = (statusData?.existingRecord && statusData.existingRecord.clockIn)
        ? statusData.existingRecord
        : logs.find(l => !l.isSynthetic && Boolean(l.clockIn) && new Date(l.date).toLocaleDateString('en-CA') === localDateStr);
      setClockedRecord(todayRec || null);

      // 4. Announcements
      const ancData = Array.isArray(announcementsRes.data) ? announcementsRes.data : [];
      setAnnouncements(ancData);

      // 5. My Leaves
      const leavesData = Array.isArray(leavesRes.data) ? leavesRes.data : [];
      setLeaves(leavesData);

      // 6. My Team Information (Strictly Employee Team)
      const teamsData = Array.isArray(teamsRes.data) ? teamsRes.data : [];
      const userTeam = teamsData.find(t => 
        t.members && t.members.some(m => m.userId === user.id || m.user?.id === user.id)
      );
      setMyTeam(userTeam || null);

      // 7. My Recent Activity Logs
      const rawLogs = logsRes.data?.logs || logsRes.data || [];
      const userLogs = Array.isArray(rawLogs) ? rawLogs.filter(l => l.userId === user.id || l.userCode === user.employeeId) : [];
      setMyActivities(userLogs);

      // 8. Upcoming Shift Schedule (Phase 6)
      const schedData = scheduleRes.data?.data || (scheduleRes.data?.today ? scheduleRes.data : null);
      if (schedData) {
        setUpcomingSchedule(schedData);
      }

      setLoading(false);
    } catch (err) {
      console.error('Error fetching Employee Dashboard data:', err);
      setLoading(false);
    }
  };

  const fetchCompOffStatus = useCallback(async () => {
    try {
      const res = await api.get('/comp-off/sessions/today-status');
      setCompOffStatus(res.data);
    } catch (err) {
      console.warn('Failed to fetch comp-off status in EmployeeDashboard:', err);
    }
  }, []);

  const handleCompOffClockOut = async () => {
    try {
      setCompOffActionLoading(true);
      await api.post('/comp-off/sessions/clock-out', {
        sessionId: compOffStatus?.session?.id
      });
      await fetchCompOffStatus();
      await fetchEmployeeDashboardData();
    } catch (err) {
      console.error('Comp-Off Clock Out error:', err);
    } finally {
      setCompOffActionLoading(false);
    }
  };

  const compOffElapsedText = useMemo(() => {
    if (!compOffStatus?.session?.loginTime || compOffStatus.session.clockOutTime) return '00h 00m 00s';
    const start = new Date(compOffStatus.session.loginTime).getTime();
    const diff = Math.max(0, time.getTime() - start);
    const secs = Math.floor(diff / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }, [compOffStatus?.session?.loginTime, compOffStatus?.session?.clockOutTime, time]);

  const isOffDay = useMemo(() => {
    return Boolean(
      clockStatus?.isOffDay ||
      compOffStatus?.isOffDay ||
      clockStatus?.state === 'HOLIDAY' ||
      clockStatus?.reason === 'HOLIDAY' ||
      clockStatus?.reason === 'WEEKLY_OFF' ||
      clockStatus?.reason === 'SATURDAY_LEAVE' ||
      upcomingSchedule?.today?.status === 'Holiday'
    );
  }, [clockStatus, compOffStatus, upcomingSchedule]);

  const offDayLabel = useMemo(() => {
    if (clockStatus?.offDayTitle) return clockStatus.offDayTitle;
    if (clockStatus?.reason === 'SATURDAY_LEAVE') return 'Saturday Leave';
    if (clockStatus?.reason === 'WEEKLY_OFF') return 'Weekly Off';
    if (clockStatus?.reason === 'HOLIDAY') return 'Company Holiday';
    if (compOffStatus?.offDayReason?.includes(':')) return compOffStatus.offDayReason.split(':')[1].trim();
    if (compOffStatus?.offDayReason === 'SUNDAY_WEEKLY_OFF') return 'Sunday Weekly Off';
    if (upcomingSchedule?.today?.dayName === 'Sunday') return 'Sunday Weekly Off';
    return 'Holiday / Weekly Off';
  }, [clockStatus, compOffStatus, upcomingSchedule]);

  // Helper for Geolocation Clock In/Out
  const getCoordinates = () => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve('Geolocation not supported');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude.toFixed(6);
          const lon = position.coords.longitude.toFixed(6);
          resolve(`Lat: ${lat}, Lon: ${lon}`);
        },
        (error) => {
          console.warn('Geolocation error:', error);
          resolve('Office Location Validated');
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    });
  };

  const [isClockInModalOpen, setIsClockInModalOpen] = useState(false);

  const handleClockIn = () => {
    setIsClockInModalOpen(true);
  };

  const executeClockOut = async () => {
    try {
      setClockLoading(true);
      setAttendanceAlert('');
      const coords = await captureDeviceCoordinates();
      const address = await reverseGeocodeCoordinates(coords.latitude, coords.longitude);
      const locationStr = address
        ? `${address} (Lat: ${coords.latitude}, Lon: ${coords.longitude})`
        : `Lat: ${coords.latitude}, Lon: ${coords.longitude}`;

      const res = await api.post('/attendance/clock-out', {
        latitude: coords.latitude,
        longitude: coords.longitude,
        address: address || null,
        location: locationStr
      });
      const record = res.data;
      setClockedRecord(record);

      const outTimeStr = record?.clockOutTime || (record?.clockOut ? new Date(record.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      const durationStr = record?.workingDuration || (record?.workingHours ? `${Math.floor(record.workingHours)}h ${Math.round((record.workingHours % 1) * 60)}m` : '00h 00m');

      setClockInToast({
        mode: 'clockOut',
        type: 'success',
        clockOutTime: outTimeStr,
        workingDuration: durationStr,
        title: 'Clock-Out Successful!',
        subtitle: 'See you tomorrow 👋'
      });

      await fetchEmployeeDashboardData();

      setTimeout(() => {
        setClockInToast(null);
      }, 3000);
    } catch (err) {
      setClockInToast({
        mode: 'clockOut',
        type: 'error',
        title: 'Clock-Out Failed',
        message: err.response?.data?.message || 'Please try again.'
      });

      setTimeout(() => {
        setClockInToast(null);
      }, 2000);
    } finally {
      setClockLoading(false);
    }
  };

  const {
    reminderModal,
    handleClockOut,
    closeModal,
    handleCompleteWorkLog,
    handleClockOutAnyway
  } = useClockOutWithReminder(user, executeClockOut);

  // Real Database Leave Balances State
  const [leaveBalancesData, setLeaveBalancesData] = useState({
    allocationMode: 'ANNUAL',
    leaveTypes: [],
    pendingRequests: 0,
    approvedRequests: 0
  });

  const fetchLeaveBalances = async () => {
    try {
      const res = await api.get('/leaves/balances');
      if (res.data) {
        setLeaveBalancesData({
          allocationMode: res.data.allocationMode || 'ANNUAL',
          leaveTypes: Array.isArray(res.data.leaveTypes) ? res.data.leaveTypes : [],
          pendingRequests: res.data.pendingRequests ?? res.data.pendingRequestsCount ?? 0,
          approvedRequests: res.data.approvedRequests ?? res.data.approvedRequestsCount ?? 0
        });
      }
    } catch (err) {
      console.warn('Failed to fetch user leave balances:', err);
    }
  };

  useEffect(() => {
    if (user?.id) {
      fetchLeaveBalances();
    }
  }, [user?.id, leaves]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handlePolicyUpdate = (data) => {
      if (!data?.organizationId || data.organizationId === user?.organizationId) {
        fetchLeaveBalances();
      }
    };
    socket.on('organization_leave_policy_updated', handlePolicyUpdate);
    return () => {
      socket.off('organization_leave_policy_updated', handlePolicyUpdate);
    };
  }, [user?.organizationId]);

  const handleApplyLeaveSubmit = async (e) => {
    e.preventDefault();
    try {
      setLeaveSubmitting(true);
      setLeaveSuccess(null);
      await api.post('/leaves', {
        startDate: leaveForm.startDate,
        endDate: leaveForm.endDate,
        leaveType: leaveForm.type,
        payType: leaveForm.payType || (['LOP', 'UNPAID', 'LOSS_OF_PAY'].includes(leaveForm.type) ? 'UNPAID' : 'PAID'),
        type: leaveForm.type,
        reason: leaveForm.reason,
        contactPhone: leaveForm.contactPhone
      });
      setLeaveSuccess('Leave application submitted successfully for review!');
      await fetchEmployeeDashboardData();
      await fetchLeaveBalances();
      setTimeout(() => {
        setIsLeaveModalOpen(false);
        setLeaveSuccess(null);
        setLeaveForm({
          startDate: new Date().toISOString().split('T')[0],
          endDate: new Date().toISOString().split('T')[0],
          type: 'CASUAL',
          reason: '',
          contactPhone: ''
        });
      }, 1500);
    } catch (err) {
      setLeaveSuccess(`Error: ${err.response?.data?.message || 'Failed to submit leave application'}`);
    } finally {
      setLeaveSubmitting(false);
    }
  };

  // Greeting based on time of day
  const getGreeting = () => {
    const hour = time.getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  // Live Working Hours calculation
  const currentWorkingHours = useMemo(() => {
    if (!clockedRecord) return 0;
    if (clockedRecord.clockOut) return clockedRecord.workingHours || 0;
    if (clockedRecord.clockIn) {
      const diff = (time - new Date(clockedRecord.clockIn)) / (1000 * 3600);
      return Math.max(0, Math.round(diff * 10) / 10);
    }
    return 0;
  }, [clockedRecord, time]);

  // Target Shift Hours & Dynamic Progress Calculation
  const targetShiftHours = useMemo(() => {
    return getTargetShiftHours(clockStatus?.clockInTime || '09:00', clockStatus?.clockOutTime || '18:00');
  }, [clockStatus?.clockInTime, clockStatus?.clockOutTime]);

  const shiftProgressPercent = useMemo(() => {
    if (!isClockedIn && !clockedRecord?.clockOut) return 0;
    return Math.min(100, Math.round((currentWorkingHours / targetShiftHours) * 100));
  }, [isClockedIn, clockedRecord?.clockOut, currentWorkingHours, targetShiftHours]);

  const progressColor = useMemo(() => {
    return getShiftProgressColor(shiftProgressPercent);
  }, [shiftProgressPercent]);

  // Task Stats Breakdown
  const pendingTasks = myTasks.filter(t => t.status === 'PENDING');
  const inProgressTasks = myTasks.filter(t => t.status === 'IN_PROGRESS');
  const reviewTasks = myTasks.filter(t => t.status === 'WAITING_FOR_REVIEW');
  const completedTasks = myTasks.filter(t => t.status === 'APPROVED' || t.status === 'COMPLETED');

  // Real Monthly Attendance Rate %
  const attendanceRate = useMemo(() => {
    if (!attendanceLogs || attendanceLogs.length === 0) return 100;
    const now = new Date();
    const thisMonthLogs = attendanceLogs.filter(l => new Date(l.date).getMonth() === now.getMonth());
    if (thisMonthLogs.length === 0) return 100;
    const presentCount = thisMonthLogs.filter(l => ['PRESENT', 'LATE', 'HALF_DAY', 'WORK_FROM_HOME'].includes(l.status)).length;
    return Math.round((presentCount / thisMonthLogs.length) * 100);
  }, [attendanceLogs]);

  // Dynamic Late Count Stats (for current calendar month)
  const lateStats = useMemo(() => {
    if (clockStatus?.lateStats) {
      return clockStatus.lateStats;
    }
    // Fallback calculation from attendanceLogs if clockStatus is not loaded yet
    const now = new Date();
    const currYear = now.getFullYear();
    const currMonth = now.getMonth();
    const monthlyLates = (attendanceLogs || []).filter(l => {
      const d = new Date(l.date);
      return d.getFullYear() === currYear && d.getMonth() === currMonth && l.status === 'LATE';
    }).length;

    const warningLimit = 3;
    const warningsRemaining = Math.max(0, warningLimit - monthlyLates);
    let subtitle = `${warningLimit} warnings remaining`;
    if (monthlyLates === 0) {
      subtitle = `${warningLimit} warnings remaining`;
    } else if (monthlyLates < warningLimit) {
      subtitle = `${warningsRemaining} warning${warningsRemaining === 1 ? '' : 's'} remaining`;
    } else if (monthlyLates === warningLimit) {
      subtitle = 'Last warning';
    } else {
      subtitle = 'Deduction started';
    }

    return {
      monthlyLates,
      warningLimit,
      displayRatio: `${monthlyLates}/${warningLimit}`,
      subtitle
    };
  }, [clockStatus, attendanceLogs]);

  // Leave Balances (12 Casual, 8 Sick, 3 Emergency default limits minus approved)
  const leaveStats = useMemo(() => {
    const approved = leaves.filter(l => l.status === 'APPROVED');
    const pending = leaves.filter(l => ['PENDING', 'PENDING_TL_APPROVAL', 'PENDING_ADMIN_APPROVAL'].includes(l.status)).length;
    
    let casualUsed = 0;
    let sickUsed = 0;
    let emergencyUsed = 0;

    approved.forEach(l => {
      const days = Math.ceil((new Date(l.endDate) - new Date(l.startDate)) / (1000 * 3600 * 24)) + 1;
      if (l.type === 'SICK') sickUsed += days;
      else if (l.type === 'EMERGENCY') emergencyUsed += days;
      else casualUsed += days;
    });

    return {
      casualLeft: Math.max(0, 12 - casualUsed),
      sickLeft: Math.max(0, 8 - sickUsed),
      emergencyLeft: Math.max(0, 3 - emergencyUsed),
      pendingRequests: pending,
      approvedRequests: approved.length
    };
  }, [leaves]);

  // Real Weekly Productivity Bar Chart Data from last 7 days attendance logs
  const weeklyProductivityData = useMemo(() => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const result = [];
    const now = new Date();
    let hasData = false;

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const dateStr = d.toLocaleDateString('en-CA');
      const dayName = days[d.getDay()];
      
      const log = attendanceLogs.find(l => new Date(l.date).toLocaleDateString('en-CA') === dateStr);
      let hours = 0;
      if (log) {
        if (log.workingHours) {
          hours = log.workingHours;
        } else if (log.clockIn && log.clockOut) {
          hours = (new Date(log.clockOut) - new Date(log.clockIn)) / (1000 * 3600);
        } else if (log.clockIn) {
          hours = (new Date() - new Date(log.clockIn)) / (1000 * 3600);
        }
      }
      hours = Math.round(hours * 10) / 10;
      if (hours > 0) hasData = true;

      result.push({ day: dayName, hours });
    }

    return { data: result, hasData };
  }, [attendanceLogs]);

  // Real Today's Schedule Timeline items
  const todaySchedule = useMemo(() => {
    const items = [];
    const todayStr = new Date().toLocaleDateString('en-CA');

    if (clockedRecord?.clockIn) {
      items.push({
        time: new Date(clockedRecord.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        title: 'Shift Check-In',
        subtitle: `Clocked in (${clockedRecord.status})`,
        color: 'bg-primary'
      });
    }

    myTasks.forEach(task => {
      if (task.dueDate && new Date(task.dueDate).toLocaleDateString('en-CA') === todayStr) {
        items.push({
          time: 'Due Today',
          title: task.title,
          subtitle: `Priority: ${task.priority || 'NORMAL'} • Status: ${task.status}`,
          color: 'bg-amber-500'
        });
      }
    });

    if (clockedRecord?.clockOut) {
      items.push({
        time: new Date(clockedRecord.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        title: 'Shift Check-Out',
        subtitle: `Shift completed (${clockedRecord.workingHours?.toFixed(1) || 0} hrs)`,
        color: 'bg-primary'
      });
    }

    return items;
  }, [clockedRecord, myTasks]);

  // Enriched Team Members for Team Roster & Status (Active Tasks + Today's Attendance)
  const enrichedTeamMembers = useMemo(() => {
    if (!myTeam) return [];
    const todayStr = new Date().toLocaleDateString('en-CA');

    const memberMap = new Map();

    // 1. Add Leader if exists
    if (myTeam.leader) {
      memberMap.set(myTeam.leader.id, {
        ...myTeam.leader,
        role: myTeam.leader.role || 'TEAM_LEADER'
      });
    }

    // 2. Add Members
    if (Array.isArray(myTeam.members)) {
      myTeam.members.forEach((mem) => {
        const u = mem.user || mem;
        if (u && u.id && !memberMap.has(u.id)) {
          memberMap.set(u.id, {
            ...u,
            role: u.role || 'MEMBER'
          });
        }
      });
    }

    // Build O(1) Today Attendance Map by userId
    const todayAttendanceMap = new Map();
    (attendanceLogs || []).forEach((log) => {
      if (!log || !log.userId) return;
      const logDateStr = new Date(log.date).toLocaleDateString('en-CA');
      if (logDateStr === todayStr) {
        todayAttendanceMap.set(log.userId, log);
      }
    });

    // Build O(1) Today Approved Leave Map by userId
    const todayLeaveMap = new Map();
    (leaves || []).forEach((leave) => {
      if (!leave || !leave.userId || leave.status !== 'APPROVED') return;
      const startStr = new Date(leave.startDate).toLocaleDateString('en-CA');
      const endStr = new Date(leave.endDate || leave.startDate).toLocaleDateString('en-CA');
      if (todayStr >= startStr && todayStr <= endStr) {
        todayLeaveMap.set(leave.userId, leave);
      }
    });

    const membersList = Array.from(memberMap.values());

    return membersList.map((member) => {
      // Active tasks count for this member
      const memberTasksCount = teamTasks.filter((t) =>
        (t.assigneeId === member.id || t.assignedToId === member.id || t.assignedTo?.id === member.id) &&
        (t.status === 'IN_PROGRESS' || t.status === 'WAITING_FOR_REVIEW' || t.status === 'PENDING')
      ).length;

      const todayLog = todayAttendanceMap.get(member.id);
      const todayLeave = todayLeaveMap.get(member.id);

      let attStatus = 'ABSENT';

      if (todayLeave) {
        const lType = (todayLeave.type || todayLeave.leaveType || '').toUpperCase();
        if (lType === 'WFH') {
          attStatus = 'WFH';
        } else {
          attStatus = 'ON LEAVE';
        }
      } else if (todayLog) {
        const hasClockIn = Boolean(todayLog.clockIn);
        const isPresentStatus = ['PRESENT', 'LATE', 'WORK_FROM_HOME', 'HALF_DAY'].includes((todayLog.status || '').toUpperCase());

        if (hasClockIn || isPresentStatus) {
          attStatus = 'PRESENT';
        } else {
          attStatus = 'ABSENT';
        }
      } else {
        attStatus = 'ABSENT';
      }

      return {
        ...member,
        memberTasksCount,
        attStatus
      };
    });
  }, [myTeam, teamTasks, attendanceLogs, leaves]);

  if (loading) {
    return (
      <div className="space-y-6 p-2">
        <div className="skeleton h-36 w-full rounded-[28px]" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="skeleton h-24 rounded-[24px]" />
          <div className="skeleton h-24 rounded-[24px]" />
          <div className="skeleton h-24 rounded-[24px]" />
          <div className="skeleton h-24 rounded-[24px]" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="skeleton h-96 lg:col-span-2 rounded-[28px]" />
          <div className="skeleton h-96 rounded-[28px]" />
        </div>
        {/* Clock In Modal */}
      <ClockInModal
        isOpen={isClockInModalOpen}
        onClose={() => setIsClockInModalOpen(false)}
        onSuccess={() => fetchEmployeeDashboardData()}
        user={user}
      />
        {/* Clock Out Reminder Modal */}
      <ClockOutReminderModal
        isOpen={reminderModal.isOpen}
        isDraft={reminderModal.isDraft}
        hasWorkLog={reminderModal.hasWorkLog}
        onClose={closeModal}
        onCompleteWorkLog={handleCompleteWorkLog}
        onClockOutAnyway={handleClockOutAnyway}
      />
      </div>
    );
  }

  return (
    <motion.div
      className="w-full space-y-8 pb-10"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* 1. Personalized Welcome Banner Section */}
      <motion.div variants={itemVariants} className="relative rounded-[24px] border border-border/80 bg-card p-6 md:p-8 shadow-sm backdrop-blur-xl overflow-hidden">
        <div className="absolute -right-12 -bottom-12 w-64 h-64 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          {/* User Identity & Info */}
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="relative">
              <UserAvatar user={user} className="h-16 w-16 sm:h-20 sm:w-20 rounded-2xl ring-4 ring-primary/20 shadow-lg object-cover" />
              <span className={`absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-2 border-card ${
                isClockedIn ? 'bg-success' : compOffStatus?.isSessionActive ? 'bg-purple-500' : 'bg-amber-500'
              }`} title={isClockedIn ? 'Clocked In & Active' : compOffStatus?.isSessionActive ? 'Comp-Off Active' : 'Not Clocked In'} />
            </div>

            <div className="space-y-1.5 text-left">
              <h1 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">
                {getGreeting()}, {user.name} 👋
              </h1>
              <div>
                <span className="inline-block px-3 py-0.5 text-xs font-bold rounded-full bg-primary/10 text-primary border border-primary/20">
                  {user.role}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground font-semibold pt-0.5">
                <span>{user?.role === 'INTERN' ? 'Intern ID' : 'Employee ID'}: <strong className="text-foreground font-mono">{user.internId || user.employeeId || user.id?.substring(0, 8)}</strong></span>
                <span>•</span>
                <span>Dept: <strong className="text-foreground">{user.department || 'General'}</strong></span>
                <span>•</span>
                <span>Team: <strong className="text-foreground">{myTeam?.name || 'No Team Assigned'}</strong></span>
                {myTeam?.leader && (
                  <>
                    <span>•</span>
                    <span>Reporting To: <strong className="text-foreground">{myTeam.leader.name}</strong></span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Live Date & Time Counter Badge with Clock In/Out Buttons underneath */}
          <div className="flex flex-col items-center justify-center gap-2 bg-muted/40 border border-border/60 rounded-2xl p-4 shrink-0 text-center min-w-[220px]">
            <TimeRollSuccessBanner clockInToast={clockInToast} time={time} />

            <div className="flex items-center justify-center gap-2 pt-2 border-t border-border/40 w-full min-h-[36px]">
              <AnimatePresence mode="wait">
                {isClockedOutToday ? (
                  <motion.div
                    key="emp-card-attendance-completed"
                    initial={{ opacity: 0, scale: 0.95, y: 4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -4 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="w-full flex items-center justify-center text-center p-1.5 rounded-xl bg-primary/10 border border-primary/20 text-primary shadow-sm"
                  >
                    <span
                      className="inline-flex items-center justify-center px-3 py-1 rounded-full text-[10px] font-mono font-extrabold border"
                      style={{
                        backgroundColor: 'var(--brand-primary-light)',
                        borderColor: 'var(--brand-primary)',
                        color: 'var(--brand-primary)'
                      }}
                    >
                      Worked Today: {getWorkedDurationText(clockedRecord) || '0h 0m'}
                    </span>
                  </motion.div>
                ) : isClockedIn ? (
                  <motion.button
                    key="emp-btn-clock-out"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    onClick={() => {
                      console.log("[CLOCKOUT] Button clicked");
                      handleClockOut();
                    }}
                    disabled={clockLoading || !clockStatus?.canClockOut}
                    className="flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-4 py-1.5 rounded-xl text-xs font-extrabold shadow-sm transition-all active:scale-95 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed w-full"
                  >
                    {clockLoading ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Clocking Out...</span>
                      </>
                    ) : (
                      <>
                        <Square className="h-3 w-3 fill-current" />
                        <span>Clock Out</span>
                      </>
                    )}
                  </motion.button>
                ) : compOffStatus?.isSessionActive ? (
                  <motion.div
                    key="emp-btn-compoff-active"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    className="flex flex-col gap-1 w-full"
                  >
                    <button
                      onClick={handleCompOffClockOut}
                      disabled={compOffActionLoading}
                      className="w-full flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-extrabold text-white bg-gradient-to-r from-purple-600 to-rose-600 hover:from-purple-700 hover:to-rose-700 shadow-sm transition active:scale-95 cursor-pointer disabled:opacity-50"
                    >
                      {compOffActionLoading ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Square className="w-3.5 h-3.5 fill-current" />
                      )}
                      <span>Comp-Off Clock-Out</span>
                    </button>
                    <span className="text-[10px] font-mono font-bold text-violet-600 dark:text-violet-400 text-center">
                      Active: {compOffElapsedText}
                    </span>
                  </motion.div>
                ) : compOffStatus?.isSessionCompleted ? (
                  <motion.div
                    key="emp-card-compoff-completed"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    className="w-full px-3 py-1.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-700 dark:text-violet-300 text-[11px] font-bold text-center"
                  >
                    Comp-Off Worked: {formatCompOffWorkedDuration(compOffStatus.session?.durationHours, 'h', 'Completed')}
                  </motion.div>
                ) : isOffDay ? (
                  compOffStatus?.canLogin ? (
                    <motion.button
                      key="emp-btn-compoff-login"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                      onClick={() => setIsCompOffLoginModalOpen(true)}
                      className="w-full flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-extrabold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shadow-sm transition active:scale-95 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
                      <span>Comp-Off Login</span>
                    </motion.button>
                  ) : (
                    <motion.div
                      key="emp-card-offday-banner"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                      className="w-full px-2.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-[11px] font-bold text-center"
                    >
                      <span className="block truncate">{offDayLabel}</span>
                    </motion.div>
                  )
                ) : (
                  <motion.button
                    key="emp-btn-clock-in"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    onClick={handleClockIn}
                    disabled={clockLoading || !clockStatus?.canClockIn}
                    className="flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded-xl text-xs font-extrabold shadow-sm transition-all active:scale-95 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed w-full"
                  >
                    {clockLoading ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Clocking In...</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5 fill-current" />
                        <span>Clock In</span>
                      </>
                    )}
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </motion.div>

      {/* 8. Quick Actions Bar (Center Aligned) */}
      <motion.div variants={itemVariants} className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap pb-2">
        <Link
          to="/tasks"
          className="flex items-center gap-2 bg-card hover:bg-muted text-foreground border border-border/70 px-4 py-2.5 rounded-2xl text-xs font-bold shadow-xs transition-all shrink-0"
        >
          <FileText className="h-4 w-4 text-primary" />
          <span>My Tasks ({myTasks.length})</span>
        </Link>

        <button
          onClick={() => setIsLeaveModalOpen(true)}
          className="flex items-center gap-2 bg-card hover:bg-muted text-foreground border border-border/70 px-4 py-2.5 rounded-2xl text-xs font-bold shadow-xs transition-all shrink-0 cursor-pointer"
        >
          <Calendar className="h-4 w-4 text-amber-500" />
          <span>Apply Leave</span>
        </button>

        <Link
          to="/profile"
          className="flex items-center gap-2 bg-card hover:bg-muted text-foreground border border-border/70 px-4 py-2.5 rounded-2xl text-xs font-bold shadow-xs transition-all shrink-0"
        >
          <UserIcon className="h-4 w-4 text-blue-500" />
          <span>My Profile</span>
        </Link>

        {userChatEnabled && (
          <Link
            to="/chat"
            className="flex items-center gap-2 bg-card hover:bg-muted text-foreground border border-border/70 px-4 py-2.5 rounded-2xl text-xs font-bold shadow-xs transition-all shrink-0"
          >
            <MessageSquare className="h-4 w-4 text-purple-500" />
            <span>Chat Room</span>
          </Link>
        )}

        <Link
          to="/announcements"
          className="flex items-center gap-2 bg-card hover:bg-muted text-foreground border border-border/70 px-4 py-2.5 rounded-2xl text-xs font-bold shadow-xs transition-all shrink-0"
        >
          <Megaphone className="h-4 w-4 text-primary" />
          <span>Announcements</span>
        </Link>
      </motion.div>

      {/* 12. Employee Statistics Strip Cards (Dynamic Database Values) */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-5">
        <div className="rounded-[24px] border border-border/70 bg-card p-5 shadow-sm flex flex-col justify-between text-left">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Total Tasks</span>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-black text-foreground">{myTasks.length}</span>
            <FileText className="h-5 w-5 text-primary opacity-80" />
          </div>
          <span className="text-[10px] text-muted-foreground mt-1">Assigned to you</span>
        </div>

        <div className="rounded-[24px] border border-border/70 bg-card p-5 shadow-sm flex flex-col justify-between text-left">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Completed</span>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-black text-primary">{completedTasks.length}</span>
            <CheckCircle2 className="h-5 w-5 text-primary opacity-80" />
          </div>
          <span className="text-[10px] text-muted-foreground mt-1">Approved deliverables</span>
        </div>

        <div className="rounded-[24px] border border-border/70 bg-card p-5 shadow-sm flex flex-col justify-between text-left">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Pending</span>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-black text-amber-500">{pendingTasks.length + inProgressTasks.length + reviewTasks.length}</span>
            <Clock className="h-5 w-5 text-amber-500 opacity-80" />
          </div>
          <span className="text-[10px] text-muted-foreground mt-1">In progress & queued</span>
        </div>

        <div className="rounded-[24px] border border-border/70 bg-card p-5 shadow-sm flex flex-col justify-between text-left">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Attendance %</span>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-black text-primary">{attendanceRate}%</span>
            <CheckCircle className="h-5 w-5 text-primary opacity-80" />
          </div>
          <span className="text-[10px] text-muted-foreground mt-1">This month</span>
        </div>

        <div className="rounded-[24px] border border-border/70 bg-card p-5 shadow-sm flex flex-col justify-between text-left">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Assigned Projects</span>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-black text-blue-500">{myProjects.length}</span>
            <Briefcase className="h-5 w-5 text-blue-500 opacity-80" />
          </div>
          <span className="text-[10px] text-muted-foreground mt-1">Active workspaces</span>
        </div>
      </motion.div>

      {/* 2-Column Responsive SaaS Grid (Left ~68%, Right ~32%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Column (~68%) */}
        <div className="lg:col-span-8 space-y-8">

          {/* 2. Today's Shift Attendance Summary (Primary Card) */}
          <motion.div variants={itemVariants} className="rounded-[24px] border border-border/70 bg-card p-6 shadow-sm space-y-5 text-left">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/40 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-primary/10 text-primary shrink-0">
                  <Clock className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-foreground">Today's Shift Attendance Summary</h3>
                  <p className="text-xs text-muted-foreground font-medium">Logged check-in times, shift status, and daily hours progress.</p>
                  
                  {/* Auto Clock-Out Status Badge Placed Under Header (Only shown during active shift) */}
                  {isClockedIn && (
                    <div className="pt-0.5">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full border ${
                        shiftCountdown.autoClockOutEnabled
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${shiftCountdown.autoClockOutEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                        {shiftCountdown.autoClockOutEnabled ? 'Automatic Clock-Out Enabled' : 'Manual Clock-Out Required'}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-center">
                {clockedRecord?.autoClockOut && (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-500/10 text-blue-600 border border-blue-500/20">
                    Auto Clocked Out
                  </span>
                )}
                <span className={`px-3.5 py-1 rounded-full text-xs font-black border ${
                  clockedRecord && clockedRecord.clockOut
                    ? 'bg-primary/10 text-primary border-primary/20'
                    : isClockedIn
                    ? 'bg-success/10 text-success border-success/20'
                    : compOffStatus?.isSessionActive
                    ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
                    : compOffStatus?.isSessionCompleted
                    ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20'
                    : isOffDay
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20'
                    : 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                }`}>
                  {clockedRecord && clockedRecord.clockOut
                    ? 'Shift Completed'
                    : isClockedIn
                    ? (shiftCountdown.isExpired && !shiftCountdown.autoClockOutEnabled ? 'Shift Ended (Manual Clock-Out Required)' : `Active (${clockedRecord?.status || 'PRESENT'})`)
                    : compOffStatus?.isSessionActive
                    ? 'Comp-Off Active'
                    : compOffStatus?.isSessionCompleted
                    ? 'Comp-Off Completed'
                    : isOffDay
                    ? offDayLabel
                    : 'Not Clocked In'}
                </span>
              </div>
            </div>

            {attendanceAlert && (
              <div className="p-3.5 rounded-2xl border border-primary/20 bg-primary/10 text-primary text-xs font-semibold flex items-center justify-between">
                <span>{attendanceAlert}</span>
              </div>
            )}

            {/* Four Equal-Width Metric Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-5 pt-1">
              {/* Box 1: Check In */}
              <div className="p-4 rounded-2xl bg-muted/20 border border-border/60 flex flex-col justify-between min-h-[105px]">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">Check In</span>
                <div>
                  <span className="text-2xl font-black text-foreground block tracking-tight">
                    {clockedRecord?.clockIn
                      ? new Date(clockedRecord.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : '--:--'}
                  </span>
                  <span className="text-[11px] text-muted-foreground font-medium block mt-0.5 truncate">
                    {clockedRecord?.clockIn ? 'Recorded Entry' : 'Scheduled Start'}
                  </span>
                </div>
              </div>

              {/* Box 2: Check Out (Live Countdown + Company Shift End Time) */}
              <div className={`p-4 rounded-2xl border flex flex-col justify-between min-h-[105px] ${
                isClockedIn
                  ? (shiftCountdown.isExpired && !shiftCountdown.autoClockOutEnabled
                      ? 'bg-amber-500/10 border-amber-500/20'
                      : 'bg-primary/10 border-primary/20')
                  : 'bg-muted/20 border-border/60'
              }`}>
                <span className={`text-[11px] font-extrabold uppercase tracking-wider ${isClockedIn ? 'text-primary' : 'text-muted-foreground'}`}>
                  Check Out
                </span>
                
                <div>
                  {clockedRecord?.clockOut ? (
                    <>
                      <span className="text-2xl font-black text-foreground block tracking-tight">
                        {new Date(clockedRecord.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-[11px] text-muted-foreground font-semibold block mt-0.5 truncate">
                        {clockedRecord.autoClockOut ? 'Auto Clocked Out' : 'Shift Completed'}
                      </span>
                    </>
                  ) : isClockedIn ? (
                    shiftCountdown.isExpired ? (
                      shiftCountdown.autoClockOutEnabled ? (
                        <>
                          <span className="text-2xl font-black text-foreground block tracking-tight">
                            {shiftCountdown.targetEndTimeFormatted}
                          </span>
                          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold block mt-0.5 truncate">
                            Auto Clocked Out
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-xl font-black text-amber-600 dark:text-amber-400 block tracking-tight">
                            Shift Ended
                          </span>
                          <span className="text-[11px] text-amber-600/90 dark:text-amber-400/90 font-bold block mt-0.5 truncate">
                            Manual Clock-Out
                          </span>
                        </>
                      )
                    ) : (
                      <>
                        <span className="text-2xl font-black font-mono text-primary block tracking-tight">
                          {shiftCountdown.formattedRemaining}
                        </span>
                        <span className="text-[11px] text-muted-foreground font-semibold block mt-0.5 truncate">
                          Ends: {shiftCountdown.targetEndTimeFormatted}
                        </span>
                      </>
                    )
                  ) : (
                    <>
                      <span className="text-2xl font-black text-foreground block tracking-tight">--:--</span>
                      <span className="text-[11px] text-muted-foreground font-medium block mt-0.5 truncate">
                        Awaiting Clock In
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Box 3: Working Hours */}
              <div className="p-4 rounded-2xl bg-muted/20 border border-border/60 flex flex-col justify-between min-h-[105px]">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">Working Hours</span>
                <div>
                  <span className="text-2xl font-black text-primary block tracking-tight">
                    {currentWorkingHours.toFixed(1)} hrs
                  </span>
                  <span className="text-[11px] text-muted-foreground font-medium block mt-0.5 truncate">
                    Target: {targetShiftHours.toFixed(1)} hrs
                  </span>
                </div>
              </div>

              {/* Box 4: Late Count */}
              <div className="p-4 rounded-2xl bg-muted/20 border border-border/60 flex flex-col justify-between min-h-[105px]">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">Late Count</span>
                <div>
                  <span className={`text-2xl font-black block tracking-tight ${
                    lateStats.monthlyLates > lateStats.warningLimit
                      ? 'text-rose-600 dark:text-rose-400'
                      : (lateStats.monthlyLates === lateStats.warningLimit ? 'text-amber-600 dark:text-amber-400' : 'text-foreground')
                  }`}>
                    {lateStats.displayRatio || `${lateStats.monthlyLates || 0}/${lateStats.warningLimit || 3}`}
                  </span>
                  <span className={`text-[11px] font-medium block mt-0.5 truncate ${
                    lateStats.monthlyLates > lateStats.warningLimit
                      ? 'text-rose-500 dark:text-rose-400 font-semibold'
                      : (lateStats.monthlyLates === lateStats.warningLimit ? 'text-amber-500 font-semibold' : 'text-muted-foreground')
                  }`}>
                    {lateStats.subtitle}
                  </span>
                </div>
              </div>
            </div>

            {/* Daily Shift Progress Bar */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-muted-foreground font-medium">Shift Completion Progress (Target: {targetShiftHours.toFixed(1)} Hours)</span>
                <span className={`font-mono font-bold transition-colors duration-500 ${isClockedIn || clockedRecord?.clockOut ? progressColor.text : 'text-muted-foreground'}`}>
                  {shiftProgressPercent}%
                </span>
              </div>
              <div className="h-3 w-full bg-muted rounded-full overflow-hidden p-0.5 border border-border/40">
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out ${shiftProgressPercent > 0 ? progressColor.bg : 'bg-transparent'}`}
                  style={{
                    width: `${shiftProgressPercent}%`,
                    backgroundColor: shiftProgressPercent > 0 ? progressColor.hex : 'transparent'
                  }}
                />
              </div>
            </div>
          </motion.div>

          {/* 3. My Tasks Widget (Strictly Employee Assigned Tasks) */}
          <motion.div variants={itemVariants} className="rounded-[24px] border border-border/70 bg-card p-6 shadow-sm space-y-5 text-left">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">My Assigned Deliverables & Tasks</h3>
                <p className="text-xs text-muted-foreground font-medium">Tasks explicitly assigned to your workflow.</p>
              </div>

              <Link to="/tasks" className="text-xs font-bold text-primary hover:underline flex items-center gap-1 bg-primary/10 px-3 py-1.5 rounded-xl transition-all">
                <span>View All Tasks</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {/* Task Status Filters - One horizontal row, equal spacing, consistent height */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs font-bold no-scrollbar">
              <span className="h-8 px-3.5 inline-flex items-center rounded-full bg-muted text-foreground border border-border/40 shrink-0">
                All ({myTasks.length})
              </span>
              <span className="h-8 px-3.5 inline-flex items-center rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20 shrink-0">
                Pending ({pendingTasks.length})
              </span>
              <span className="h-8 px-3.5 inline-flex items-center rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/20 shrink-0">
                In Progress ({inProgressTasks.length})
              </span>
              <span className="h-8 px-3.5 inline-flex items-center rounded-full bg-purple-500/10 text-purple-600 border border-purple-500/20 shrink-0">
                In Review ({reviewTasks.length})
              </span>
              <span className="h-8 px-3.5 inline-flex items-center rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
                Completed ({completedTasks.length})
              </span>
            </div>

            {/* Task Cards List / Empty State */}
            <div className="dash-scroll max-h-80 space-y-3">
              {myTasks.length === 0 ? (
                <div className="h-44 flex flex-col items-center justify-center text-center text-xs text-muted-foreground bg-muted/10 rounded-2xl border border-dashed border-border/60 p-6">
                  <CheckCircle2 className="h-8 w-8 text-primary/40 mb-2" />
                  <span className="font-bold text-foreground text-sm">No tasks assigned</span>
                  <span className="text-[11px] text-muted-foreground mt-0.5">You're all caught up on deliverables for today!</span>
                </div>
              ) : (
                myTasks.map((task) => (
                  <div
                    key={task.id}
                    onClick={() => navigate('/tasks')}
                    className="p-4 rounded-2xl border border-border/60 bg-muted/20 hover:bg-muted/40 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                          {task.title}
                        </span>
                        {task.priority && (
                          <span className={`px-2 py-0.5 text-[10px] font-extrabold rounded-md ${
                            task.priority === 'HIGH' || task.priority === 'URGENT'
                              ? 'bg-rose-500/10 text-rose-600 border border-rose-500/20'
                              : 'bg-blue-500/10 text-blue-600 border border-blue-500/20'
                          }`}>
                            {task.priority}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {task.description || 'No detailed description provided.'}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[11px] text-muted-foreground font-semibold flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No Due Date'}
                      </span>

                      <span className={`px-2.5 py-1 text-[10px] font-extrabold rounded-full ${
                        task.status === 'APPROVED' || task.status === 'COMPLETED'
                          ? 'bg-success/10 text-success border-success/20'
                          : task.status === 'WAITING_FOR_REVIEW'
                          ? 'bg-purple-500/10 text-purple-600 border border-purple-500/20'
                          : 'bg-amber-500/10 text-amber-600 border border-amber-500/20'
                      }`}>
                        {task.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>

          {/* 6 & 13. Real Performance Analytics & Weekly Productivity Chart */}
          <motion.div variants={itemVariants} className="rounded-[24px] border border-border/70 bg-card p-6 shadow-sm space-y-5 text-left">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">Performance Analytics & Productivity</h3>
                <p className="text-xs text-muted-foreground font-medium">Weekly productivity hours and task velocity breakdown.</p>
              </div>

              <div className="flex items-center gap-1 bg-muted p-1 rounded-xl border border-border/40 text-xs font-semibold">
                {['1W', '1M'].map(f => (
                  <button
                    key={f}
                    onClick={() => setTimeFilter(f)}
                    className={`px-3 py-1 rounded-lg transition-all ${
                      timeFilter === f ? 'bg-primary text-white font-bold' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-64 w-full pt-2 flex items-center justify-center">
              {!weeklyProductivityData.hasData ? (
                <div className="text-xs text-muted-foreground text-center py-10 font-medium">
                  No analytics available.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyProductivityData.data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(200, 200, 200, 0.2)" />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} className="text-xs font-medium text-muted-foreground" />
                    <YAxis tickLine={false} axisLine={false} className="text-xs font-medium text-muted-foreground" />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderRadius: '16px', fontSize: '12px' }}
                    />
                    <Bar dataKey="hours" radius={[8, 8, 0, 0]} fill={chartPrimaryColor}>
                      {weeklyProductivityData.data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={chartPrimaryColor} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </motion.div>

        </div>

        {/* Right Column (~32%) */}
        <div className="lg:col-span-4 space-y-8">

          {/* 4. Today's Dynamic Schedule (Aligned Flush with Top of Attendance Card) */}
          <motion.div variants={itemVariants} className="rounded-[24px] border border-border/70 bg-card p-6 shadow-sm space-y-5 text-left">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                <span>Today's Schedule</span>
              </h3>
              <span className="text-xs text-muted-foreground font-semibold">{time.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            </div>

            <div className="dash-scroll max-h-52">
            {todaySchedule.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground font-medium bg-muted/10 rounded-2xl border border-dashed border-border/40">
                No scheduled events for today.
              </div>
            ) : (
              <div className="space-y-3 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-border/60">
                {todaySchedule.map((item, idx) => (
                  <div key={idx} className="pl-7 relative flex items-start justify-between gap-2">
                    <span className={`absolute left-1.5 top-1.5 h-3 w-3 rounded-full ${item.color} ring-4 ring-card`} />
                    <div>
                      <span className="text-xs font-bold text-foreground block">{item.time} — {item.title}</span>
                      <span className="text-[11px] text-muted-foreground">{item.subtitle}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            </div>
          </motion.div>

          {/* 5. Real Leave Balances & Apply Modal Trigger */}
          <motion.div variants={itemVariants} className="rounded-[24px] border border-border/70 bg-card p-6 shadow-sm space-y-5 text-left">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-foreground tracking-tight">Leave Balances</h3>
                <span className="inline-flex items-center rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                  {(leaveBalancesData.allocationMode || '').toUpperCase() === 'MONTHLY' ? 'Monthly Credit' : 'Annual Allocation'}
                </span>
              </div>
              <button
                onClick={() => setIsLeaveModalOpen(true)}
                className="text-xs font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer bg-primary/10 px-2.5 py-1 rounded-xl transition-all"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Apply</span>
              </button>
            </div>

            {/* Dynamic Leave Cards */}
            <div className={`grid gap-3 text-center ${
              leaveBalancesData.leaveTypes.length === 1 ? 'grid-cols-1' :
              leaveBalancesData.leaveTypes.length === 2 ? 'grid-cols-2' :
              leaveBalancesData.leaveTypes.length === 3 ? 'grid-cols-3' :
              'grid-cols-2 sm:grid-cols-4'
            }`}>
              {leaveBalancesData.leaveTypes.length === 0 ? (
                <div className="col-span-full p-4 text-xs text-muted-foreground">No leave balances available.</div>
              ) : (
                leaveBalancesData.leaveTypes.map((lt) => (
                  <div
                    key={lt.id || lt.code}
                    className="p-3.5 rounded-2xl bg-muted/30 border border-border/50 flex flex-col items-center justify-center text-center min-h-[95px] transition-all hover:bg-muted/50 hover:border-border/70"
                  >
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block text-center leading-tight w-full truncate" title={lt.name}>
                      {lt.name}
                    </span>
                    <span className="text-2xl font-black text-foreground block text-center leading-none my-1.5">
                      {lt.available}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-medium block text-center">
                      {lt.carryForward > 0 ? `Days Left (+${lt.carryForward} carried)` : 'Days Left'}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between text-xs font-semibold pt-1 border-t border-border/40">
              <span className="text-muted-foreground">Pending Requests: <strong className="text-amber-500 font-bold">{leaveBalancesData.pendingRequests}</strong></span>
              <span className="text-muted-foreground">Approved: <strong className="text-success font-bold">{leaveBalancesData.approvedRequests}</strong></span>
            </div>
          </motion.div>

          {/* 10. Team Roster & Status Widget */}
          <motion.div variants={itemVariants}>
            <TeamRosterStatus members={enrichedTeamMembers} className="rounded-[24px]" />
          </motion.div>

          {/* 7. Real Announcements & Alerts */}
          <motion.div variants={itemVariants} className="rounded-[24px] border border-border/70 bg-card p-6 shadow-sm space-y-5 text-left">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="text-base font-bold text-foreground">Announcements & Alerts</h3>
              <Megaphone className="h-5 w-5 text-primary" />
            </div>

            <div className="dash-scroll max-h-56 space-y-3">
              {announcements.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center font-medium">No announcements.</p>
              ) : (
                announcements.map((anc) => (
                  <div key={anc.id} className="p-3.5 rounded-2xl border border-border/40 bg-muted/20 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-foreground">{anc.title}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{new Date(anc.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2">{anc.content}</p>
                  </div>
                ))
              )}
            </div>
          </motion.div>

        </div>
      </div>

      {/* 5. Shared Apply Leave Modal */}
      <ApplyLeaveModal
        isOpen={isLeaveModalOpen}
        onClose={() => setIsLeaveModalOpen(false)}
        onSuccess={() => {
          fetchEmployeeDashboardData();
          fetchLeaveBalances();
        }}
        userRole={user?.role || 'EMPLOYEE'}
      />



      {/* Clock In Modal */}
      <ClockInModal
        isOpen={isClockInModalOpen}
        onClose={() => setIsClockInModalOpen(false)}
        onSuccess={handleClockInSuccess}
        onError={handleClockInError}
        user={user}
      />

      {/* Clock Out Reminder Modal */}
      <ClockOutReminderModal
        isOpen={reminderModal.isOpen}
        isDraft={reminderModal.isDraft}
        hasWorkLog={reminderModal.hasWorkLog}
        onClose={closeModal}
        onCompleteWorkLog={handleCompleteWorkLog}
        onClockOutAnyway={handleClockOutAnyway}
      />

      {/* Comp-Off Login Modal (Reusing ClockInModal in COMPOFF mode) */}
      <ClockInModal
        isOpen={isCompOffLoginModalOpen}
        onClose={() => setIsCompOffLoginModalOpen(false)}
        onSuccess={() => {
          fetchEmployeeDashboardData();
          fetchCompOffStatus();
        }}
        user={user}
        mode="COMPOFF"
        permission={compOffStatus?.permissionRequest}
      />
    </motion.div>
  );
};

export default EmployeeDashboard;
