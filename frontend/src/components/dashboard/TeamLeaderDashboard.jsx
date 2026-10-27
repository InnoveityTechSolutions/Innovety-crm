import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { useTheme } from '../../context/ThemeContext';
import api, { getSocket } from '../../services/api';
import UserAvatar from '../common/UserAvatar';
import LeaveOverviewCard from './LeaveOverviewCard';
import ClockInModal from '../attendance/ClockInModal';
import ApplyLeaveModal from '../leave/ApplyLeaveModal';
import useShiftCountdown from '../../hooks/useShiftCountdown';
import { getTargetShiftHours, getShiftProgressColor } from '../../utils/shiftProgress';
import ClockOutReminderModal from '../worklog/ClockOutReminderModal';
import useClockOutWithReminder from '../../hooks/useClockOutWithReminder';
import ClockInToast from '../common/ClockInToast';
import TeamRosterStatus from './TeamRosterStatus';
import TeamLeaderShiftWidget from './TeamLeaderShiftWidget';
import TeamLeaderPerformanceView from '../intelligence/TeamLeaderPerformanceView';
import TimeRollSuccessBanner from '../common/TimeRollSuccessBanner';
import { captureDeviceCoordinates, reverseGeocodeCoordinates } from '../../utils/geolocationHelper';
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
  Search,
  MapPin,
  Shield,
  Layers,
  ArrowUpRight,
  Laptop,
  Send,
  X,
  UserCheck,
  Coffee
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

const WEEKDAYS_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// 7-day rolling week calculation (Previous 3 days -> Today -> Next 3 days)
const getRollingWeekDays = () => {
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const days = [];
  for (let i = -3; i <= 3; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    const dayIndex = d.getDay();

    days.push({
      dayName: WEEKDAYS_SHORT[dayIndex] || d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
      dateNum: d.getDate(),
      isToday: i === 0,
      fullDate: d,
      dateString: dateString
    });
  }
  return days;
};

export const TeamLeaderDashboard = () => {
  const { user } = useAuth();
  const { onlineUsers, notifications } = useSocket();
  const { userChatEnabled } = useTheme();
  const navigate = useNavigate();

  // Time & Live Clock State
  const [time, setTime] = useState(new Date());

  // Attendance State
  const [clockedRecord, setClockedRecord] = useState(null);
  const [clockStatus, setClockStatus] = useState(null);
  const [clockLoading, setClockLoading] = useState(false);
  const [attendanceAlert, setAttendanceAlert] = useState('');
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [clockInToast, setClockInToast] = useState(null);

  const handleClockInSuccess = (resData) => {
    setIsClockInModalOpen(false);
    const statusStr = resData?.attendanceStatus || resData?.status || (resData?.attendance?.status === 'LATE' ? 'LATE' : 'PRESENT');
    const timeStr = resData?.checkInTime || (resData?.clockIn ? new Date(resData.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

    setClockInToast({
      type: 'success',
      checkInTime: timeStr,
      attendanceStatus: statusStr
    });
    fetchTLDashboardData();

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

  // Attendance Card Segmented View Tab ('MY_SHIFT' or 'TEAM_SUMMARY')
  const [attendanceTab, setAttendanceTab] = useState('MY_SHIFT');

  const isClockedIn = Boolean(clockedRecord && clockedRecord.clockIn && !clockedRecord.clockOut);

  const isClockedOutToday = Boolean(
    (clockedRecord && clockedRecord.clockIn && clockedRecord.clockOut) ||
    (clockStatus && clockStatus.canClockIn === false && !isClockedIn && clockedRecord)
  );

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
      fetchTLDashboardData();
    }
  });



  // Data States (Strictly Database Fetched & Team Leader Scoped)
  const [teamTasks, setTeamTasks] = useState([]);
  const [teamProjects, setTeamProjects] = useState([]);
  const [myTeam, setMyTeam] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [taskFilter, setTaskFilter] = useState('ALL');

  // Leave Balances & Apply Modal State
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
  const [leaveBalances, setLeaveBalances] = useState({
    allocationMode: 'ANNUAL',
    leaveTypes: [],
    pendingRequests: 0,
    approvedRequests: 0
  });


  // Chart View Toggle (1W vs 1M) & Dynamic Theme Primary Color
  const [chartView, setChartView] = useState('1W');
  const [chartPrimaryColor, setChartPrimaryColor] = useState('rgb(var(--primary))');

  // Selected Date for Schedule Widget
  const todayDateStr = useMemo(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, []);

  const [selectedDate, setSelectedDate] = useState(todayDateStr);
  const rollingWeekDays = getRollingWeekDays();

  useEffect(() => {
    const updateThemeColor = () => {
      const computed = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
      if (computed) {
        setChartPrimaryColor(computed.includes(',') || computed.includes(' ') ? `rgb(${computed})` : computed);
      }
    };
    updateThemeColor();
    const observer = new MutationObserver(updateThemeColor);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const lastFetchTimestampRef = useRef(0);
  const debounceFetchTimerRef = useRef(null);

  const safeRefreshTLDashboard = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastFetchTimestampRef.current < 1500) {
      return;
    }
    if (debounceFetchTimerRef.current) {
      clearTimeout(debounceFetchTimerRef.current);
    }
    debounceFetchTimerRef.current = setTimeout(() => {
      lastFetchTimestampRef.current = Date.now();
      console.log('[AutoClockOut] Executing single TL attendance state refresh');
      fetchTLDashboardData();
    }, 100);
  }, []);

  useEffect(() => {
    fetchTLDashboardData();

    const handleShiftEvent = (payload) => {
      console.log('[Socket/Window] Shift update received on Team Leader Dashboard:', payload);
      safeRefreshTLDashboard(true);
    };

    window.addEventListener('shift_updated', handleShiftEvent);
    const socket = getSocket();
    if (socket) {
      const handleAttendanceEvent = (payload) => {
        console.log('[Socket] Attendance event received:', payload?.record?.id || payload);
        safeRefreshTLDashboard();
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
  }, [user, safeRefreshTLDashboard]);

  const fetchLeaveBalances = async () => {
    try {
      const res = await api.get('/leaves/balances');
      if (res.data) {
        const formattedTypes = Array.isArray(res.data.leaveTypes) ? res.data.leaveTypes : [];
        
        setLeaveBalances({
          allocationMode: res.data.allocationMode || 'ANNUAL',
          leaveTypes: formattedTypes,
          pendingRequests: res.data.pendingRequests ?? res.data.pendingRequestsCount ?? 0,
          approvedRequests: res.data.approvedRequests ?? res.data.approvedRequestsCount ?? 0
        });
      }
    } catch (err) {
      console.warn('Failed to fetch leave balances:', err);
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
    socket.on('leave_balance_updated', handlePolicyUpdate);
    return () => {
      socket.off('organization_leave_policy_updated', handlePolicyUpdate);
      socket.off('leave_balance_updated', handlePolicyUpdate);
    };
  }, [user?.organizationId]);

  const fetchTLDashboardData = async () => {
    try {
      setLoading(true);
      fetchLeaveBalances();

      const [
        tasksRes,
        projectsRes,
        attendanceStatusRes,
        attendanceLogsRes,
        announcementsRes,
        leavesRes,
        teamsRes,
        usersRes
      ] = await Promise.all([
        api.get('/tasks').catch(() => ({ data: [] })),
        api.get('/projects').catch(() => ({ data: [] })),
        api.get('/attendance/status').catch(() => ({ data: null })),
        api.get('/attendance/logs').catch(() => ({ data: [] })),
        api.get('/announcements').catch(() => ({ data: [] })),
        api.get('/leaves').catch(() => ({ data: [] })),
        api.get('/teams').catch(() => ({ data: [] })),
        api.get('/users?limit=1000').catch(() => ({ data: { users: [] } }))
      ]);

      const tasksData = Array.isArray(tasksRes.data) ? tasksRes.data : [];
      setTeamTasks(tasksData);

      const projectsData = Array.isArray(projectsRes.data) ? projectsRes.data : [];
      setTeamProjects(projectsData);

      const logs = Array.isArray(attendanceLogsRes.data) ? attendanceLogsRes.data : [];
      setAttendanceLogs(logs);

      const statusData = attendanceStatusRes.data;
      setClockStatus(statusData);

      const localDateStr = new Date().toLocaleDateString('en-CA');
      const todayRec = statusData?.existingRecord || logs.find(l => new Date(l.date).toLocaleDateString('en-CA') === localDateStr && l.userId === user?.id);
      setClockedRecord(todayRec || null);

      const ancData = Array.isArray(announcementsRes.data) ? announcementsRes.data : [];
      setAnnouncements(ancData);

      const leavesData = Array.isArray(leavesRes.data) ? leavesRes.data : [];
      setLeaves(leavesData);

      const teamsData = Array.isArray(teamsRes.data) ? teamsRes.data : [];
      const userTeam = teamsData.find(t => t.leaderId === user?.id || t.members?.some(m => m.id === user?.id));
      setMyTeam(userTeam || null);

      const allUsers = usersRes.data?.users || usersRes.data || [];
      if (userTeam && Array.isArray(userTeam.members)) {
        setTeamMembers(userTeam.members.map(m => m.user || m));
      } else {
        const deptMembers = Array.isArray(allUsers) ? allUsers.filter(u => u.department === user?.department && u.id !== user?.id) : [];
        setTeamMembers(deptMembers);
      }
    } catch (err) {
      console.error('Failed to load Team Leader dashboard data:', err);
    } finally {
      setLoading(false);
    }
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
      const record = res.data.record || res.data;
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

      await fetchTLDashboardData();

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
      setLeaveSuccess('Leave application submitted successfully for Admin review!');
      await fetchTLDashboardData();
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

  const getGreeting = () => {
    const hour = time.getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  // 1. Team Attendance Breakdown Calculation (Present, Late, On Leave, WFH, Absent)
  const teamAttendanceBreakdown = useMemo(() => {
    const todayStr = new Date().toLocaleDateString('en-CA');

    let present = 0;
    let late = 0;
    let onLeave = 0;
    let wfh = 0;
    let absent = 0;

    // Filter out members who haven't officially joined yet
    const eligibleMembers = teamMembers.filter(member => {
      const joinDate = member.joiningDate || member.createdAt;
      if (!joinDate) return true;
      const joinStr = new Date(joinDate).toLocaleDateString('en-CA');
      return joinStr <= todayStr;
    });

    eligibleMembers.forEach(member => {
      const leaveToday = leaves.find(l => 
        l.userId === member.id &&
        l.status === 'APPROVED' &&
        new Date(l.startDate).toLocaleDateString('en-CA') <= todayStr &&
        new Date(l.endDate || l.startDate).toLocaleDateString('en-CA') >= todayStr
      );

      if (leaveToday) {
        if (leaveToday.type === 'WFH' || leaveToday.leaveType === 'WFH') {
          wfh++;
        } else {
          onLeave++;
        }
        return;
      }

      const log = attendanceLogs.find(l => l.userId === member.id && new Date(l.date).toLocaleDateString('en-CA') === todayStr);
      if (log) {
        if (log.status === 'LATE') late++;
        else if (log.status === 'WORK_FROM_HOME') wfh++;
        else present++;
      } else {
        absent++;
      }
    });

    const total = eligibleMembers.length || 1;
    const activeTurnout = present + late + wfh;
    const attendancePercent = Math.round((activeTurnout / total) * 100);

    return { present, late, onLeave, wfh, absent, attendancePercent, total: eligibleMembers.length };
  }, [teamMembers, leaves, attendanceLogs]);

  // 2. Enhanced Pending Approvals (Pending Leave Requests + Pending Task Reviews)
  const pendingApprovals = useMemo(() => {
    const pendingLeaves = leaves.filter(l => l.status === 'PENDING_TL_APPROVAL' || l.status === 'PENDING').length;
    const pendingTaskReviews = teamTasks.filter(t => t.status === 'WAITING_FOR_REVIEW').length;
    return {
      total: pendingLeaves + pendingTaskReviews,
      pendingLeaves,
      pendingTaskReviews
    };
  }, [leaves, teamTasks]);

  // 3. Refined Team Productivity % (Completed, Pending, Overdue Tasks)
  const productivityStats = useMemo(() => {
    const todayStr = new Date().toLocaleDateString('en-CA');
    let completed = 0;
    let pending = 0;
    let overdue = 0;

    teamTasks.forEach(t => {
      if (t.status === 'APPROVED' || t.status === 'COMPLETED') {
        completed++;
      } else {
        pending++;
        if (t.dueDate && new Date(t.dueDate).toLocaleDateString('en-CA') < todayStr) {
          overdue++;
        }
      }
    });

    const total = completed + pending;
    const score = total > 0 ? Math.round((completed / total) * 100) : 100;
    return { score, completed, pending, overdue, total: teamTasks.length };
  }, [teamTasks]);

  // General Stats
  const stats = useMemo(() => {
    const totalTeamCount = teamMembers.length;
    const activeTasksCount = teamTasks.filter(t => t.status === 'IN_PROGRESS' || t.status === 'WAITING_FOR_REVIEW').length;
    const activeProjectsCount = teamProjects.filter(p => p.status === 'IN_PROGRESS' || p.status === 'ACTIVE').length;

    return {
      totalTeamCount,
      pendingTLApprovals: pendingApprovals.total,
      activeTasksCount,
      activeProjectsCount,
      teamAttendancePercent: teamAttendanceBreakdown.attendancePercent,
      productivityPercent: productivityStats.score
    };
  }, [teamMembers, pendingApprovals, teamTasks, teamProjects, teamAttendanceBreakdown, productivityStats]);

  // Live Working Hours, Break Hours, Overtime Calculation for TL
  const currentWorkingHours = useMemo(() => {
    if (!clockedRecord?.clockIn) return '0.0';
    const start = new Date(clockedRecord.clockIn);
    const end = clockedRecord.clockOut ? new Date(clockedRecord.clockOut) : time;
    const diffMs = Math.max(0, end - start);
    return (diffMs / (1000 * 60 * 60)).toFixed(1);
  }, [clockedRecord, time]);

  // Target Shift Hours & Dynamic Progress Calculation
  const targetShiftHours = useMemo(() => {
    return getTargetShiftHours(clockStatus?.clockInTime || '09:00', clockStatus?.clockOutTime || '18:00');
  }, [clockStatus?.clockInTime, clockStatus?.clockOutTime]);

  const shiftProgressPercent = useMemo(() => {
    if (!isClockedIn && !clockedRecord?.clockOut) return 0;
    return Math.min(100, Math.round((parseFloat(currentWorkingHours) / targetShiftHours) * 100));
  }, [isClockedIn, clockedRecord?.clockOut, currentWorkingHours, targetShiftHours]);

  const progressColor = useMemo(() => {
    return getShiftProgressColor(shiftProgressPercent);
  }, [shiftProgressPercent]);

  const breakHours = useMemo(() => {
    if (!clockedRecord?.breakMinutes) return '0.0';
    return (clockedRecord.breakMinutes / 60).toFixed(1);
  }, [clockedRecord]);

  const overtimeHours = useMemo(() => {
    const hrs = parseFloat(currentWorkingHours);
    return hrs > 8.0 ? (hrs - 8.0).toFixed(1) : '0.0';
  }, [currentWorkingHours]);

  // Comprehensive Schedule & Deliverables for Selected Date (Meetings, Deliverables, Deadlines, Leaves)
  const selectedDateSchedule = useMemo(() => {
    if (!selectedDate) return [];

    const items = [];

    // 1. Task Deadlines & Deliverables
    teamTasks.forEach(t => {
      if (t.dueDate) {
        const d = new Date(t.dueDate).toLocaleDateString('en-CA');
        if (d === selectedDate) {
          items.push({
            id: `task-${t.id}`,
            title: t.title,
            type: 'DELIVERABLE',
            subtitle: `Priority: ${t.priority || 'NORMAL'} • Status: ${t.status}`,
            assignee: t.assignedTo?.name || 'Team Member',
            badgeColor: t.priority === 'HIGH' ? 'bg-rose-500/10 text-rose-600' : 'bg-primary/10 text-primary'
          });
        }
      }
    });

    // 2. Team Member Leave Events
    leaves.forEach(l => {
      if (l.status === 'APPROVED') {
        const start = new Date(l.startDate).toLocaleDateString('en-CA');
        const end = new Date(l.endDate || l.startDate).toLocaleDateString('en-CA');
        if (selectedDate >= start && selectedDate <= end) {
          items.push({
            id: `leave-${l.id}`,
            title: `${l.user?.name || 'Team Member'} on Leave`,
            type: 'LEAVE',
            subtitle: `${l.leaveType || l.type || 'CASUAL'} (${l.reason || 'Approved Leave'})`,
            assignee: l.user?.name,
            badgeColor: 'bg-amber-500/10 text-amber-600'
          });
        }
      }
    });

    return items;
  }, [teamTasks, leaves, selectedDate]);

  // Task Filter List
  const filteredTaskList = useMemo(() => {
    if (taskFilter === 'ALL') return teamTasks;
    return teamTasks.filter(t => t.status === taskFilter);
  }, [teamTasks, taskFilter]);

  // Performance Chart Data (Real DB Aggregation for 1W vs 1M)
  const performanceChartData = useMemo(() => {
    if (chartView === '1W') {
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      return days.map(day => {
        const count = teamTasks.filter(t => {
          if (t.status !== 'APPROVED' && t.status !== 'COMPLETED') return false;
          if (!t.updatedAt) return false;
          const d = new Date(t.updatedAt);
          const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
          return dayName === day;
        }).length;
        return { name: day, completed: count };
      });
    } else {
      const weeks = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
      return weeks.map((w, idx) => {
        const count = teamTasks.filter(t => (t.status === 'APPROVED' || t.status === 'COMPLETED')).length;
        return { name: w, completed: Math.round((count / 4) * (idx + 1)) };
      });
    }
  }, [teamTasks, chartView]);

  // Team Member Roster with Attendance Status & Active Task Count
  const enrichedTeamMembers = useMemo(() => {
    const todayStr = new Date().toLocaleDateString('en-CA');

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

    return teamMembers.map(member => {
      const memberTasksCount = teamTasks.filter(t => 
        (t.assigneeId === member.id || t.assignedToId === member.id || t.assignedTo?.id === member.id) &&
        (t.status === 'IN_PROGRESS' || t.status === 'WAITING_FOR_REVIEW')
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
  }, [teamMembers, teamTasks, leaves, attendanceLogs]);

  if (loading) {
    return (
      <div className="space-y-6 p-2 text-left">
        <div className="skeleton h-28 w-full rounded-[28px]" />
        <div className="skeleton h-12 w-full rounded-2xl" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton h-28 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="space-y-6 text-left font-sans w-full mx-auto"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* 1. Header Banner — Matching Employee Dashboard Layout */}
      <motion.div
        variants={itemVariants}
        className="rounded-[32px] border border-border/70 bg-white dark:bg-card p-6 sm:p-7 shadow-sm relative overflow-hidden"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="flex items-center gap-4 sm:gap-5">
            <UserAvatar user={user} className="h-16 w-16 sm:h-20 sm:w-20 rounded-2xl border-2 border-primary/30 shadow-md shrink-0" />
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">
                  {getGreeting()}, {user?.name?.split(' ')[0] || 'Team Leader'}!
                </h1>
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-primary/10 text-primary border border-primary/20">
                  <Shield className="w-3.5 h-3.5 text-primary" />
                  <span>TEAM LEADER</span>
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground font-semibold">
                <span className="font-mono font-bold text-foreground">ID: {user?.employeeId || 'TL-1001'}</span>
                <span>•</span>
                <span>{user?.department || 'Engineering'}</span>
                <span>•</span>
                <span className="text-primary font-bold">{myTeam?.name || 'Alpha Core Team'}</span>
              </div>
            </div>
          </div>

          {/* Live Clock & Shift Control — vertical centered layout */}
          <div className="flex flex-col items-center gap-3 bg-muted/30 border border-border/60 p-5 rounded-2xl shrink-0 min-w-[210px]">
            <TimeRollSuccessBanner clockInToast={clockInToast} time={time} />

            <div className="flex items-center justify-center gap-2 pt-2 border-t border-border/40 w-full min-h-[36px]">
              <AnimatePresence mode="wait">
                {isClockedOutToday ? (
                  <motion.div
                    key="tl-card-attendance-completed"
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
                ) : !isClockedIn ? (
                  <motion.button
                    key="tl-btn-clock-in"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    onClick={handleClockIn}
                    disabled={clockLoading || !clockStatus?.canClockIn}
                    className="flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md transition-all active:scale-95 cursor-pointer disabled:opacity-50 w-full"
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
                ) : (
                  <motion.button
                    key="tl-btn-clock-out"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    onClick={() => {
                      console.log("[CLOCKOUT] Button clicked");
                      handleClockOut();
                    }}
                    disabled={clockLoading || !clockStatus?.canClockOut}
                    className="flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md transition-all active:scale-95 cursor-pointer disabled:opacity-50 w-full"
                  >
                    {clockLoading ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Clocking Out...</span>
                      </>
                    ) : (
                      <>
                        <Square className="h-3.5 w-3.5 fill-current" />
                        <span>Clock Out</span>
                      </>
                    )}
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </motion.div>

      {/* 2. Pill-Style Quick Action Bar (7 Buttons, Including Attendance) */}
      <motion.div variants={itemVariants} className="flex items-center sm:justify-center gap-2 overflow-x-auto pb-1 scrollbar-none w-full">
        {[
          { to: '/tasks', icon: FileText, label: 'My Tasks', color: 'text-primary' },
          { to: '/leaves', icon: Calendar, label: 'Leave Management', color: 'text-amber-500' },
          { to: '/attendance', icon: Clock, label: 'Attendance', color: 'text-success' },
          { to: '/employees', icon: Users, label: 'Team Members', color: 'text-purple-500' },
          ...(userChatEnabled ? [{ to: '/messages', icon: MessageSquare, label: 'Chat Room', color: 'text-indigo-500' }] : []),
          { to: '/announcements', icon: Megaphone, label: 'Announcements', color: 'text-rose-500' },
          { to: '/profile', icon: UserIcon, label: 'My Profile', color: 'text-blue-500' }
        ].map(item => (
          <Link
            key={item.to}
            to={item.to}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-card hover:bg-muted border border-border/70 text-xs font-bold text-foreground transition-all cursor-pointer shrink-0 shadow-xs"
          >
            <item.icon className={`w-4 h-4 ${item.color}`} />
            <span>{item.label}</span>
          </Link>
        ))}
      </motion.div>

      {/* 3. Top 6 Team Leader KPI Metric Cards */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-xs flex flex-col justify-between hover:border-primary/40 transition-all">
          <span className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider">Total Team Members</span>
          <span className="text-2xl font-black text-foreground mt-2">{stats.totalTeamCount}</span>
          <span className="text-[10px] text-primary font-semibold mt-0.5">Active Workforce</span>
        </div>

        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 shadow-xs flex flex-col justify-between hover:border-amber-500/50 transition-all">
          <span className="text-[10px] font-extrabold uppercase text-amber-700 dark:text-amber-400 tracking-wider">Pending Approvals</span>
          <span className="text-2xl font-black text-amber-500 mt-2">{stats.pendingTLApprovals}</span>
          <span className="text-[10px] text-amber-600/80 font-semibold mt-0.5">Leaves ({pendingApprovals.pendingLeaves}) • Reviews ({pendingApprovals.pendingTaskReviews})</span>
        </div>

        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 shadow-xs flex flex-col justify-between hover:border-primary/50 transition-all">
          <span className="text-[10px] font-extrabold uppercase text-primary tracking-wider">Active Tasks</span>
          <span className="text-2xl font-black text-primary mt-2">{stats.activeTasksCount}</span>
          <span className="text-[10px] text-primary/80 font-semibold mt-0.5">In Progress & Review</span>
        </div>

        <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-4 shadow-xs flex flex-col justify-between hover:border-indigo-500/50 transition-all">
          <span className="text-[10px] font-extrabold uppercase text-indigo-700 dark:text-indigo-400 tracking-wider">Attendance %</span>
          <span className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-2">{stats.teamAttendancePercent}%</span>
          <span className="text-[10px] text-indigo-600/80 font-semibold mt-0.5">Today's Turnout</span>
        </div>

        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-4 shadow-xs flex flex-col justify-between hover:border-blue-500/50 transition-all">
          <span className="text-[10px] font-extrabold uppercase text-blue-700 dark:text-blue-400 tracking-wider">Active Projects</span>
          <span className="text-2xl font-black text-blue-500 mt-2">{stats.activeProjectsCount}</span>
          <span className="text-[10px] text-blue-600/80 font-semibold mt-0.5">Assigned Projects</span>
        </div>

        <div className="rounded-2xl border border-purple-500/30 bg-purple-500/5 p-4 shadow-xs flex flex-col justify-between hover:border-purple-500/50 transition-all">
          <span className="text-[10px] font-extrabold uppercase text-purple-700 dark:text-purple-400 tracking-wider">Team Productivity</span>
          <span className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-2">{stats.productivityPercent}%</span>
          <span className="text-[10px] text-purple-600/80 font-semibold mt-0.5">Done ({productivityStats.completed}) • Overdue ({productivityStats.overdue})</span>
        </div>
      </motion.div>

      {/* 4. Full-Width Team Member Leave Approvals Card (Matching Admin Leave Overview UI & Width Exactly) */}
      <motion.div variants={itemVariants} className="w-full">
        <LeaveOverviewCard
          title="Team Member Leave Approvals"
          subtitle="Review and approve leave requests submitted by your team members."
          leaves={leaves}
          teamMembers={teamMembers}
          onRefresh={fetchTLDashboardData}
        />
      </motion.div>

      {/* 5. Main 2-Column Content Layout */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN (8 cols): Attendance Summary & Breakdown, Tasks, Performance Chart */}
        <div className="lg:col-span-8 space-y-6">
          {/* Today's Shift & Team Attendance Widget with In-Header Segmented Tabs */}
          <div className="rounded-3xl border border-border/70 bg-card p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/40 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-primary/10 text-primary border border-primary/20">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">Today's Shift & Team Attendance</h3>
                  <p className="text-xs text-muted-foreground font-medium">Switch between your personal shift summary and team turnout statistics.</p>
                </div>
              </div>

              {/* Segmented Control Header Buttons ([ My Shift Summary ] [ Team Summary ]) */}
              <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-2xl border border-border/60 text-xs font-bold shrink-0">
                <button
                  type="button"
                  onClick={() => setAttendanceTab('MY_SHIFT')}
                  className={`px-3.5 py-1.5 rounded-xl transition-all cursor-pointer ${
                    attendanceTab === 'MY_SHIFT'
                      ? 'btn-primary shadow-xs font-black'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  My Shift Summary
                </button>
                <button
                  type="button"
                  onClick={() => setAttendanceTab('TEAM_SUMMARY')}
                  className={`px-3.5 py-1.5 rounded-xl transition-all cursor-pointer ${
                    attendanceTab === 'TEAM_SUMMARY'
                      ? 'btn-primary shadow-xs font-black'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Team Summary
                </button>
              </div>
            </div>

            {/* TAB VIEW 1: MY SHIFT SUMMARY */}
            {attendanceTab === 'MY_SHIFT' && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-semibold">Shift Status:</span>
                    <span className={`px-3 py-1 rounded-full text-xs font-black border ${
                      clockedRecord && !clockedRecord.clockOut
                        ? (shiftCountdown.isExpired && !shiftCountdown.autoClockOutEnabled ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' : 'bg-success/10 text-success border-success/20')
                        : clockedRecord?.clockOut
                        ? 'bg-blue-500/10 text-blue-600 border-blue-500/20'
                        : 'bg-muted text-muted-foreground border-border/60'
                    }`}>
                      {clockedRecord && !clockedRecord.clockOut ? (shiftCountdown.isExpired && !shiftCountdown.autoClockOutEnabled ? 'Shift Ended (Manual Clock-Out Required)' : 'Shift Active') : clockedRecord?.clockOut ? 'Shift Completed' : 'Not Clocked In'}
                    </span>
                  </div>

                  {/* Auto Clock-Out Status Badge */}
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full border ${
                    shiftCountdown.autoClockOutEnabled
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${shiftCountdown.autoClockOutEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                    {shiftCountdown.autoClockOutEnabled ? 'Automatic Clock-Out Enabled' : 'Manual Clock-Out Required'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center text-xs">
                  <div className="p-3 rounded-2xl bg-muted/30 border border-border/50">
                    <span className="text-[10px] font-extrabold uppercase text-muted-foreground block">Check-In</span>
                    <span className="text-sm font-bold text-foreground mt-1 block">
                      {clockedRecord?.clockIn ? new Date(clockedRecord.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                    </span>
                  </div>

                  <div className={`p-3 rounded-2xl border ${
                    isClockedIn
                      ? (shiftCountdown.isExpired && !shiftCountdown.autoClockOutEnabled ? 'bg-amber-500/10 border-amber-500/20' : 'bg-primary/10 border-primary/20')
                      : 'bg-muted/30 border-border/50'
                  }`}>
                    <span className={`text-[10px] font-extrabold uppercase block ${isClockedIn ? 'text-primary' : 'text-muted-foreground'}`}>Check-Out</span>
                    {clockedRecord?.clockOut ? (
                      <>
                        <span className="text-sm font-bold text-foreground mt-1 block">
                          {new Date(clockedRecord.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-[9px] text-muted-foreground font-medium block mt-0.5">
                          {clockedRecord.autoClockOut ? 'Automatically Clocked Out' : 'Shift Completed'}
                        </span>
                      </>
                    ) : isClockedIn ? (
                      shiftCountdown.isExpired ? (
                        shiftCountdown.autoClockOutEnabled ? (
                          <>
                            <span className="text-sm font-bold text-foreground mt-1 block">
                              {shiftCountdown.targetEndTimeFormatted}
                            </span>
                            <span className="text-[9px] text-emerald-600 font-bold block mt-0.5">
                              Automatically Clocked Out
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-xs font-bold text-amber-600 block mt-1">
                              Shift Ended
                            </span>
                            <span className="text-[9px] text-amber-600 font-medium block mt-0.5">
                              Please clock out manually.
                            </span>
                          </>
                        )
                      ) : (
                        <>
                          <span className="text-sm font-black font-mono text-primary mt-1 block">
                            {shiftCountdown.formattedRemaining}
                          </span>
                          <span className="text-[9px] text-muted-foreground font-semibold block mt-0.5">
                            Shift Ends: {shiftCountdown.targetEndTimeFormatted}
                          </span>
                        </>
                      )
                    ) : (
                      <span className="text-sm font-bold text-foreground mt-1 block">--:--</span>
                    )}
                  </div>

                  <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20">
                    <span className="text-[10px] font-extrabold uppercase text-primary block">Working Hours</span>
                    <span className="text-sm font-black text-primary mt-1 block">{currentWorkingHours} hrs</span>
                  </div>

                  <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20">
                    <span className="text-[10px] font-extrabold uppercase text-amber-600 block">Break Hours</span>
                    <span className="text-sm font-black text-amber-600 mt-1 block">{breakHours} hrs</span>
                  </div>

                  <div className="p-3 rounded-2xl bg-purple-500/10 border border-purple-500/20">
                    <span className="text-[10px] font-extrabold uppercase text-purple-600 block">Overtime</span>
                    <span className="text-sm font-black text-purple-600 mt-1 block">{overtimeHours} hrs</span>
                  </div>
                </div>

                {/* Shift Completion Progress Bar */}
                <div className="space-y-1.5 pt-2 border-t border-border/30">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-muted-foreground">My Shift Completion ({currentWorkingHours} hrs)</span>
                    <span className={`font-mono font-bold transition-colors duration-500 ${isClockedIn || clockedRecord?.clockOut ? progressColor.text : 'text-muted-foreground'}`}>
                      {shiftProgressPercent}% ({targetShiftHours.toFixed(1)} Hrs Target)
                    </span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden p-0.5 border border-border/40">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ease-out ${shiftProgressPercent > 0 ? progressColor.bg : 'bg-transparent'}`}
                      style={{
                        width: `${shiftProgressPercent}%`,
                        backgroundColor: shiftProgressPercent > 0 ? progressColor.hex : 'transparent'
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* TAB VIEW 2: TEAM SUMMARY */}
            {attendanceTab === 'TEAM_SUMMARY' && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-semibold">
                    Total Team Members: <strong className="text-foreground">{teamAttendanceBreakdown.total}</strong>
                  </span>
                  <span className="px-3 py-1 rounded-full text-xs font-black bg-indigo-500/10 text-indigo-600 border border-indigo-500/20">
                    {teamAttendanceBreakdown.attendancePercent}% Turnout
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center text-xs font-bold">
                  <div className="p-3 rounded-2xl bg-success/10 border border-success/20 text-success">
                    <span className="text-lg font-black block leading-tight">{teamAttendanceBreakdown.present}</span>
                    <span className="text-[10px] uppercase block mt-0.5">Present</span>
                  </div>
                  <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-600">
                    <span className="text-lg font-black block leading-tight">{teamAttendanceBreakdown.late}</span>
                    <span className="text-[10px] uppercase block mt-0.5">Late</span>
                  </div>
                  <div className="p-3 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-600">
                    <span className="text-lg font-black block leading-tight">{teamAttendanceBreakdown.onLeave}</span>
                    <span className="text-[10px] uppercase block mt-0.5">On Leave</span>
                  </div>
                  <div className="p-3 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-600">
                    <span className="text-lg font-black block leading-tight">{teamAttendanceBreakdown.wfh}</span>
                    <span className="text-[10px] uppercase block mt-0.5">WFH</span>
                  </div>
                  <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-600">
                    <span className="text-lg font-black block leading-tight">{teamAttendanceBreakdown.absent}</span>
                    <span className="text-[10px] uppercase block mt-0.5">Absent</span>
                  </div>
                </div>

                {/* Team Shift Progress Bar */}
                <div className="space-y-1.5 pt-2 border-t border-border/30">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-muted-foreground">Team Shift Attendance Progress</span>
                    <span className="text-indigo-600 dark:text-indigo-400">
                      {teamAttendanceBreakdown.attendancePercent}% Active
                    </span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-indigo-600 rounded-full transition-all duration-500"
                      style={{ width: `${teamAttendanceBreakdown.attendancePercent}%` }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Team Deliverables & Tasks Section */}
          <div className="rounded-3xl border border-border/70 bg-card p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/40 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-primary/10 text-primary border border-primary/20">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">Team Deliverables & Tasks</h3>
                  <p className="text-xs text-muted-foreground font-medium">Monitor active tasks and assignees across your team.</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none max-w-full py-1 text-xs shrink-0">
                {['ALL', 'PENDING', 'IN_PROGRESS', 'WAITING_FOR_REVIEW', 'APPROVED'].map(f => (
                  <button
                    key={f}
                    onClick={() => setTaskFilter(f)}
                    className={`px-2.5 py-1 rounded-xl font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                      taskFilter === f
                        ? 'btn-primary shadow-xs'
                        : 'bg-muted/40 hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    {f === 'WAITING_FOR_REVIEW' ? 'Review' : f === 'IN_PROGRESS' ? 'Progress' : f}
                  </button>
                ))}
              </div>
            </div>

            <div className="dash-scroll max-h-[340px] space-y-3 pr-0.5">
              {filteredTaskList.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground bg-muted/20 rounded-2xl border border-dashed border-border/60 font-semibold">
                  No tasks assigned under this filter.
                </div>
              ) : (
                filteredTaskList.map(task => (
                  <div
                    key={task.id}
                    className="p-4 rounded-2xl border border-border/60 bg-muted/10 hover:bg-muted/30 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                          task.status === 'APPROVED'
                            ? 'bg-success/10 text-success border border-success/20'
                            : task.status === 'IN_PROGRESS'
                            ? 'bg-blue-500/10 text-blue-600 border border-blue-500/20'
                            : task.status === 'WAITING_FOR_REVIEW'
                            ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20'
                            : 'bg-slate-500/10 text-slate-600 border border-slate-500/20'
                        }`}>
                          {task.status}
                        </span>
                        <h4 className="text-xs font-bold text-foreground truncate">{task.title}</h4>
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-1">{task.description}</p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {task.assignedTo && (
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                          <UserAvatar user={task.assignedTo} className="h-6 w-6 rounded-full" />
                          <span className="truncate max-w-[100px]">{task.assignedTo.name}</span>
                        </div>
                      )}

                      <Link
                        to="/tasks"
                        className="p-1.5 rounded-xl border border-border/60 hover:bg-muted text-muted-foreground cursor-pointer"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Performance Analytics Chart Card with 1W vs 1M Toggle */}
          <div className="rounded-3xl border border-border/70 bg-card p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-primary/10 text-primary border border-primary/20">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">Team Productivity Velocity</h3>
                  <p className="text-xs text-muted-foreground font-medium">Completed task velocity measured directly from live records.</p>
                </div>
              </div>

              <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl border border-border/50 text-xs font-bold">
                <button
                  onClick={() => setChartView('1W')}
                  className={`px-3 py-1 rounded-lg transition-all ${chartView === '1W' ? 'btn-primary shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  This Week
                </button>
                <button
                  onClick={() => setChartView('1M')}
                  className={`px-3 py-1 rounded-lg transition-all ${chartView === '1M' ? 'btn-primary shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  This Month
                </button>
              </div>
            </div>

            <div className="h-64 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={performanceChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tlColorGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chartPrimaryColor} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={chartPrimaryColor} stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(150, 150, 150, 0.15)" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#888' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#888' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--card)',
                      borderColor: 'rgba(150, 150, 150, 0.2)',
                      borderRadius: '16px',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="completed"
                    stroke={chartPrimaryColor}
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#tlColorGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* RIGHT SIDEBAR (4 cols): Leave Balances, Schedule, Team Roster, Announcements */}
        <div className="lg:col-span-4 space-y-6">
          {/* 1. Leave Balances Card */}
          <div className="rounded-[24px] border border-border/70 bg-card p-6 shadow-sm space-y-5 text-left">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-foreground tracking-tight">Leave Balances</h3>
                <span className="inline-flex items-center rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                  {(leaveBalances.allocationMode || '').toUpperCase() === 'MONTHLY' ? 'Monthly Credit' : 'Annual Allocation'}
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
              (leaveBalances.leaveTypes || []).length === 1 ? 'grid-cols-1' :
              (leaveBalances.leaveTypes || []).length === 2 ? 'grid-cols-2' :
              (leaveBalances.leaveTypes || []).length === 3 ? 'grid-cols-3' :
              'grid-cols-2 sm:grid-cols-4'
            }`}>
              {(leaveBalances.leaveTypes || []).length === 0 ? (
                <div className="col-span-full p-4 text-xs text-muted-foreground">No leave balances available.</div>
              ) : (
                leaveBalances.leaveTypes.map((type) => (
                  <div
                    key={type.id || type.code}
                    className="p-3.5 rounded-2xl bg-muted/30 border border-border/50 flex flex-col items-center justify-center text-center min-h-[95px] transition-all hover:bg-muted/50 hover:border-border/70"
                  >
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block text-center leading-tight w-full truncate" title={type.name || type.code}>
                      {type.name || type.code}
                    </span>
                    <span className="text-2xl font-black text-foreground block text-center leading-none my-1.5">
                      {type.available ?? 0}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-medium block text-center">
                      {type.carryForward > 0 ? `Days Left (+${type.carryForward} carried)` : 'Days Left'}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between text-xs font-semibold pt-1 border-t border-border/40">
              <span className="text-muted-foreground">Pending Requests: <strong className="text-amber-500 font-bold">{leaveBalances.pendingRequests ?? 0}</strong></span>
              <span className="text-muted-foreground">Approved: <strong className="text-success font-bold">{leaveBalances.approvedRequests ?? 0}</strong></span>
            </div>
          </div>

          {/* 3. Comprehensive Schedule & Deliverables Card (Meetings, Deadlines, Leaves) */}
          <div className="rounded-3xl border border-border/70 bg-card p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                  <Calendar className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-foreground">Schedule & Events</h3>
              </div>

              <span className="text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                Rolling Week
              </span>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center">
              {rollingWeekDays.map((day) => {
                const selected = selectedDate === day.dateString;
                return (
                  <button
                    key={day.dateString}
                    onClick={() => setSelectedDate(day.dateString)}
                    className={`py-2 px-1 rounded-2xl flex flex-col items-center justify-center transition-all cursor-pointer border ${
                      selected
                        ? 'bg-primary text-white font-extrabold shadow-md shadow-primary/30 scale-105 border-primary ring-2 ring-primary ring-offset-2 dark:ring-offset-slate-900'
                        : day.isToday
                        ? 'bg-primary/10 border-primary/30 text-primary font-extrabold hover:bg-primary/20'
                        : 'bg-muted/30 border-border/40 hover:bg-muted text-foreground font-semibold'
                    }`}
                  >
                    <span className="text-[9px] font-black uppercase">{day.dayName || '—'}</span>
                    <span className="text-sm font-black mt-0.5">{day.dateNum ?? '—'}</span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-2 pt-2 border-t border-border/30">
              <span className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                Schedule for {selectedDate}
              </span>

              <div className="dash-scroll max-h-48 space-y-2 mt-1">
              {selectedDateSchedule.length === 0 ? (
                <p className="text-xs text-muted-foreground p-4 text-center bg-muted/20 rounded-xl font-semibold border border-dashed border-border/50">
                  No schedule for today.
                </p>
              ) : (
                selectedDateSchedule.map((item) => (
                  <div
                    key={item.id}
                    className="p-2.5 rounded-xl border border-border/50 bg-muted/20 flex items-center justify-between text-xs"
                  >
                    <div className="truncate pr-2">
                      <span className="font-bold text-foreground block truncate">{item.title}</span>
                      <span className="text-[10px] text-muted-foreground block truncate">{item.subtitle}</span>
                    </div>

                    <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase shrink-0 ${item.badgeColor}`}>
                      {item.type}
                    </span>
                  </div>
                ))
              )}
              </div>
            </div>
          </div>

          {/* 4. Team Roster & Status Widget */}
          <TeamRosterStatus members={enrichedTeamMembers} />

          {/* Phase 7: Team Leader Shift & Exception Widget */}
          <TeamLeaderShiftWidget organizationId={user?.organizationId} />

          {/* Phase 8: Team Leader Performance & Intelligence View */}
          <TeamLeaderPerformanceView />

          {/* 5. Recent Announcements Widget */}
          <div className="rounded-3xl border border-border/70 bg-card p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-rose-500/10 text-rose-600 border border-rose-500/20">
                  <Megaphone className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-foreground">Announcements</h3>
              </div>

              <Link to="/announcements" className="text-xs font-bold text-primary hover:underline">
                View All
              </Link>
            </div>

            <div className="dash-scroll max-h-52 space-y-2.5">
              {announcements.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6 bg-muted/20 rounded-xl border border-dashed border-border/50 font-semibold">
                  No announcements posted.
                </p>
              ) : (
                announcements.map(anc => (
                  <div key={anc.id} className="p-3 rounded-2xl border border-border/50 bg-muted/20 space-y-1 text-xs">
                    <span className="font-bold text-foreground block">{anc.title}</span>
                    <p className="text-muted-foreground text-[11px] line-clamp-2">{anc.content}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* 5. Shared Apply Leave Modal */}
      <ApplyLeaveModal
        isOpen={isLeaveModalOpen}
        onClose={() => setIsLeaveModalOpen(false)}
        onSuccess={() => {
          fetchTLDashboardData();
          fetchLeaveBalances();
        }}
        userRole={user?.role || 'TEAM_LEADER'}
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
    </motion.div>
  );
};

export default TeamLeaderDashboard;
