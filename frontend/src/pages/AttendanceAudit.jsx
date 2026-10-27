import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import UserAvatar from '../components/common/UserAvatar';
import CompanyScopeSelector from '../components/common/CompanyScopeSelector';
import { useCompanyScope } from '../context/CompanyScopeContext';
import { usePermissions } from '../hooks/usePermissions';
import { CRM_MODULE_KEYS } from '../config/crmModules';
import CompanyLeaveAuditModal from '../components/attendance/CompanyLeaveAuditModal';
import AttendanceReportSection from '../components/attendance/AttendanceReportSection';
import AttendanceAuditDetailsModal from '../components/attendance/AttendanceAuditDetailsModal';
import {
  Search,
  Filter,
  X,
  Edit2,
  AlertCircle,
  CheckCircle2,
  Calendar,
  FileText,
  Eye,
  Check,
  CheckCircle,
  XCircle,
  Phone,
  RotateCcw,
  FileSpreadsheet
} from 'lucide-react';

const QUICK_FILTERS = [
  { id: 'ALL', label: 'All Dates' },
  { id: 'TODAY', label: 'Today' },
  { id: 'THIS_WEEK', label: 'This Week' },
  { id: 'THIS_MONTH', label: 'This Month' },
  { id: 'CUSTOM', label: 'Custom Range' }
];

const formatLocalDate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getQuickFilterDates = (preset) => {
  const now = new Date();
  const todayStr = formatLocalDate(now);

  let fromDate = '';
  let toDate = '';

  if (preset === 'TODAY') {
    fromDate = todayStr;
    toDate = todayStr;
  } else if (preset === 'THIS_WEEK') {
    const day = now.getDay();
    const diffToMonday = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.getFullYear(), now.getMonth(), diffToMonday);

    fromDate = formatLocalDate(monday);
    toDate = todayStr; // Clamp to today max
  } else if (preset === 'THIS_MONTH') {
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    fromDate = `${yyyy}-${mm}-01`;
    toDate = todayStr; // Clamp to today max
  }
  return { fromDate, toDate };
};

const formatDateDDMMYYYY = (dateInput) => {
  if (!dateInput) return '—';
  if (typeof dateInput === 'string' && dateInput.includes('T')) {
    const datePart = dateInput.split('T')[0];
    const parts = datePart.split('-');
    if (parts.length === 3) {
      const [yyyy, mm, dd] = parts;
      return `${dd}/${mm}/${yyyy}`;
    }
  } else if (typeof dateInput === 'string' && dateInput.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [yyyy, mm, dd] = dateInput.split('-');
    return `${dd}/${mm}/${yyyy}`;
  }
  const obj = new Date(dateInput);
  if (isNaN(obj.getTime())) return '—';
  const day = String(obj.getUTCDate ? obj.getUTCDate() : obj.getDate()).padStart(2, '0');
  const month = String((obj.getUTCMonth ? obj.getUTCMonth() : obj.getMonth()) + 1).padStart(2, '0');
  const year = obj.getUTCFullYear ? obj.getUTCFullYear() : obj.getFullYear();
  return `${day}/${month}/${year}`;
};

const formatLateMinutes = (totalMinutes) => {
  if (!totalMinutes || totalMinutes <= 0) return '';
  const minsNum = Number(totalMinutes);
  const hours = Math.floor(minsNum / 60);
  const remainingMins = minsNum % 60;

  const hrStr = hours > 0 ? `${hours} ${hours === 1 ? 'hr' : 'hrs'}` : '';
  const minStr = remainingMins > 0 ? `${remainingMins} ${remainingMins === 1 ? 'min' : 'mins'}` : '';

  if (hours > 0 && remainingMins > 0) return `${hrStr} ${minStr}`;
  if (hours > 0) return hrStr;
  return minStr;
};

const parseLocalToISO = (datetimeLocalStr) => {
  if (!datetimeLocalStr) return undefined;
  if (datetimeLocalStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(datetimeLocalStr)) {
    return new Date(datetimeLocalStr).toISOString();
  }
  const parts = datetimeLocalStr.split('T');
  if (parts.length < 2) return new Date(datetimeLocalStr).toISOString();

  const [datePart, timePart] = parts;
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);

  if (!year || !month || !day || isNaN(hour) || isNaN(minute)) {
    return new Date(datetimeLocalStr).toISOString();
  }

  const utcCandidate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const p = {};
  formatter.formatToParts(utcCandidate).forEach(part => {
    if (part.type !== 'literal') p[part.type] = part.value;
  });

  const zYear = parseInt(p.year, 10);
  const zMonth = parseInt(p.month, 10);
  const zDay = parseInt(p.day, 10);
  let zHour = parseInt(p.hour, 10);
  if (zHour === 24) zHour = 0;
  const zMin = parseInt(p.minute, 10);

  const targetMinutes = zHour * 60 + zMin;
  const nominalMinutes = hour * 60 + minute;
  let diffMinutes = targetMinutes - nominalMinutes;

  if (diffMinutes > 720) diffMinutes -= 1440;
  if (diffMinutes < -720) diffMinutes += 1440;

  const result = new Date(utcCandidate.getTime() - diffMinutes * 60 * 1000);
  return result.toISOString();
};


const AttendanceAudit = () => {
  const { user } = useAuth();
  const { canEdit } = usePermissions();
  const canEditAttendance = canEdit(CRM_MODULE_KEYS.ATTENDANCE_AUDIT);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const { selectedOrgId, effectiveOrgId, selectedCompany } = useCompanyScope();
  const targetOrg = isSuperAdmin ? selectedOrgId : (effectiveOrgId || user?.organizationId);
  const selectedOrgIdRef = useRef(targetOrg);
  useEffect(() => {
    selectedOrgIdRef.current = targetOrg;
  }, [targetOrg]);

  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({
    totalInterns: 0,
    presentToday: 0,
    lateToday: 0,
    halfDayToday: 0,
    absentToday: 0
  });

  const [loading, setLoading] = useState(false);
  const [showReports, setShowReports] = useState(false);

  // Filters
  const [quickFilter, setQuickFilter] = useState('ALL');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [shiftFilter, setShiftFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Dropdown options
  const [allInterns, setAllInterns] = useState([]);

  // Edit Modal State
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [viewDetailsRecord, setViewDetailsRecord] = useState(null);

  const handleOpenViewDetails = async (record) => {
    setViewDetailsRecord(record);
    if (record?.id && !record.isSynthetic && !String(record.id).startsWith('absent_') && !String(record.id).startsWith('holiday_') && !String(record.id).startsWith('leave_')) {
      try {
        const res = await api.get(`/attendance/${record.id}`);
        if (res.data?.success && res.data?.record) {
          setViewDetailsRecord(prev => ({
            ...prev,
            ...res.data.record,
            user: res.data.record.user || prev?.user
          }));
        }
      } catch (err) {
        // Fallback silently to existing record in row
      }
    }
  };
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [editForm, setEditForm] = useState({
    clockIn: '',
    clockOut: '',
    status: '',
    workingHours: ''
  });

  const [alertMsg, setAlertMsg] = useState('');

  // Leaves sanction state
  const [subTab, setSubTab] = useState('Logs');
  const [leaves, setLeaves] = useState([]);
  const [submittingStatus, setSubmittingStatus] = useState(false);

  // Letter view modal
  const [viewingLetter, setViewingLetter] = useState(null);
  const [leaveReportModalOpen, setLeaveReportModalOpen] = useState(false);

  const fetchAllLeaves = async () => {
    try {
      const targetOrg = selectedOrgIdRef.current || selectedOrgId;
      const params = targetOrg ? { organizationId: targetOrg } : {};
      const res = await api.get('/leaves', { params });
      setLeaves(res.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateLeaveStatus = async (id, status) => {
    setSubmittingStatus(true);
    try {
      if (status === 'APPROVED') {
        await api.put(`/leaves/${id}/admin-approve`, { remarks: 'Sanctioned via Attendance Audit' });
      } else {
        await api.put(`/leaves/${id}/reject`, { remarks: 'Declined via Attendance Audit' });
      }
      const actionText = status === 'APPROVED' ? 'sanctioned & attendance updated' : 'declined';
      setAlertMsg(`Leave application letter successfully ${actionText}.`);
      fetchAllLeaves();
      fetchLogsAndAnalytics();
    } catch (err) {
      setAlertMsg(err.response?.data?.message || 'Failed to update leave request status.');
    } finally {
      setSubmittingStatus(false);
    }
  };

  const fetchUsersList = async () => {
    try {
      const targetOrg = selectedOrgIdRef.current || selectedOrgId;
      const params = { limit: 1000, status: 'ACTIVE' };
      if (targetOrg) params.organizationId = targetOrg;
      const res = await api.get('/users', { params });
      const eligibleMembers = (res.data.users || []).filter(
        u => u.role !== 'ADMIN' && u.role !== 'SUPER_ADMIN'
      );
      setAllInterns(eligibleMembers);
    } catch (e) {
      console.error(e);
    }
  };

  const filtersRef = useRef({ userIdFilter, statusFilter, startDate, endDate });
  useEffect(() => {
    filtersRef.current = { userIdFilter, statusFilter, startDate, endDate };
  }, [userIdFilter, statusFilter, startDate, endDate]);

  const fetchLogsAndAnalytics = async (customParams) => {
    try {
      setLoading(true);
      const activeFilters = customParams || filtersRef.current;
      const targetOrg = selectedOrgIdRef.current || selectedOrgId;
      const queryParams = {
        userId: activeFilters.userIdFilter || undefined,
        status: activeFilters.statusFilter || undefined,
        startDate: activeFilters.startDate || undefined,
        endDate: activeFilters.endDate || undefined
      };
      if (targetOrg) queryParams.organizationId = targetOrg;

      const [logsRes, statsRes] = await Promise.all([
        api.get('/attendance/logs', { params: queryParams }),
        api.get('/attendance/analytics', { params: targetOrg ? { organizationId: targetOrg } : {} })
      ]);
      setLogs(logsRes.data || []);
      if (statsRes.data) {
        setStats({
          totalInterns: statsRes.data.totalMembers || statsRes.data.totalInterns || 0,
          presentToday: statsRes.data.presentToday || 0,
          lateToday: statsRes.data.lateToday || 0,
          halfDayToday: statsRes.data.halfDayToday || 0,
          absentToday: statsRes.data.absentToday || 0
        });
      }
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  useEffect(() => {
    setLogs([]);
    setAllInterns([]);
    setLeaves([]);
    setStats({ totalInterns: 0, presentToday: 0, lateToday: 0, halfDayToday: 0, absentToday: 0 });
    setUserIdFilter('');
    setStatusFilter('');
    setSearchQuery('');
    fetchUsersList();
    fetchAllLeaves();
    fetchLogsAndAnalytics();
  }, [targetOrg, user?.organizationId]);

  const formatLeavePeriod = (startDate, endDate) => {
    if (!startDate) return 'N/A';
    const startStr = formatDateDDMMYYYY(startDate);
    const endStr = endDate ? formatDateDDMMYYYY(endDate) : startStr;

    if (startStr === endStr) {
      return startStr;
    }
    return `${startStr} to ${endStr}`;
  };

  const getLeaveDurationDisplay = (l) => {
    if (l.totalDays !== undefined && l.totalDays !== null && Number(l.totalDays) > 0) {
      const days = Number(l.totalDays);
      return days === 1 ? '1 Day' : `${days} Days`;
    }
    if (!l.startDate) return '1 Day';
    const start = new Date(l.startDate);
    const end = l.endDate ? new Date(l.endDate) : start;
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays === 1 ? '1 Day' : `${diffDays} Days`;
  };

  useEffect(() => {
    fetchUsersList();
    if (user.role === 'ADMIN') {
      fetchAllLeaves();
    }

    const pollInterval = setInterval(() => {
      if (user.role === 'ADMIN') {
        fetchAllLeaves();
      }
      fetchLogsAndAnalytics(filtersRef.current);
    }, 4000);

    return () => clearInterval(pollInterval);
  }, [selectedOrgId]);

  useEffect(() => {
    fetchLogsAndAnalytics({ userIdFilter, statusFilter, startDate, endDate });
  }, [userIdFilter, statusFilter, startDate, endDate]);

  const handleQuickFilterClick = (preset) => {
    setQuickFilter(preset);
    setLogs([]); // Immediately purge existing logs so no stale date records show while fetching
    if (preset === 'ALL') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'CUSTOM') {
      // Keep current custom range
    } else {
      const dates = getQuickFilterDates(preset);
      setStartDate(dates.fromDate);
      setEndDate(dates.toDate);
    }
  };

  const handleClearFilters = () => {
    setLogs([]);
    setQuickFilter('ALL');
    setUserIdFilter('');
    setStatusFilter('');
    setShiftFilter('');
    setDepartmentFilter('');
    setSearchQuery('');
    setStartDate('');
    setEndDate('');
  };

  const departmentOptions = Array.from(new Set(allInterns.map(i => i.department).filter(Boolean)));

  const todayLocalStr = formatLocalDate(new Date());

  const rawFilteredLogs = logs.filter(log => {
    if (log.date) {
      const logDateStr = typeof log.date === 'string' ? log.date.split('T')[0] : formatLocalDate(new Date(log.date));
      if (logDateStr > todayLocalStr) return false; // Strictly disallow future dates
    }
    if (shiftFilter && log.shift !== shiftFilter && log.user?.shift !== shiftFilter) return false;
    if (departmentFilter && log.user?.department !== departmentFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const nameMatch = log.user?.name?.toLowerCase().includes(q);
      const empIdMatch = log.user?.employeeId?.toLowerCase().includes(q);
      if (!nameMatch && !empIdMatch) return false;
    }
    return true;
  });

  const filteredLogs = [...rawFilteredLogs].sort((a, b) => {
    // 1. Attendance Date DESC
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    if (dateA !== dateB) {
      return dateB - dateA;
    }

    // 2. Same Date: Real clockIn DESC (nulls last for LEAVE)
    const timeA = a.clockIn ? new Date(a.clockIn).getTime() : null;
    const timeB = b.clockIn ? new Date(b.clockIn).getTime() : null;

    if (timeA !== null && timeB !== null) {
      if (timeA !== timeB) return timeB - timeA;
    } else if (timeA !== null && timeB === null) {
      return -1;
    } else if (timeA === null && timeB !== null) {
      return 1;
    }

    // 3. Fallback: ID DESC
    return (b.id || '').localeCompare(a.id || '');
  });

  const formatDateTimeLocal = (dateVal, recordDate) => {
    if (!dateVal) {
      if (!recordDate) return '';
      if (typeof recordDate === 'string' && recordDate.includes('T')) {
        const datePart = recordDate.split('T')[0];
        return `${datePart}T09:30`;
      }
      const recD = new Date(recordDate);
      if (isNaN(recD.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      return `${recD.getFullYear()}-${pad(recD.getMonth() + 1)}-${pad(recD.getDate())}T09:30`;
    }
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openEditModal = (record) => {
    setSelectedRecord(record);
    setEditForm({
      clockIn: record.clockIn ? formatDateTimeLocal(record.clockIn, record.date) : formatDateTimeLocal(null, record.date),
      clockOut: record.clockOut ? formatDateTimeLocal(record.clockOut, record.date) : '',
      status: record.status,
      workingHours: record.workingHours !== undefined && record.workingHours !== null ? String(record.workingHours) : '',
      errorMsg: ''
    });
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setEditForm(prev => ({ ...prev, errorMsg: '' }));

    const targetStatus = editForm.status;

    // Rule: Protect Leave Management integration
    if (selectedRecord.status === 'LEAVE' && targetStatus !== 'LEAVE') {
      setEditForm(prev => ({
        ...prev,
        errorMsg: 'Approved Leave records are managed via Leave Management. Please resolve leave applications in Leave Management rather than changing Attendance logs directly.'
      }));
      return;
    }

    // Rule: Validate Clock Out >= Clock In for active statuses
    if (['PRESENT', 'LATE', 'HALF_DAY', 'WORK_FROM_HOME'].includes(targetStatus)) {
      if (!editForm.clockIn && targetStatus !== 'WORK_FROM_HOME') {
        setEditForm(prev => ({ ...prev, errorMsg: `Clock In time is required for ${targetStatus} status.` }));
        return;
      }
      if (editForm.clockIn && editForm.clockOut) {
        const tIn = new Date(editForm.clockIn).getTime();
        const tOut = new Date(editForm.clockOut).getTime();
        if (tOut < tIn) {
          setEditForm(prev => ({ ...prev, errorMsg: 'Clock Out cannot be earlier than Clock In.' }));
          return;
        }
      }
    }

    try {
      setLoading(true);
      const clockInISO = ['LEAVE', 'ABSENT'].includes(targetStatus) ? undefined : (editForm.clockIn ? parseLocalToISO(editForm.clockIn) : undefined);
      const clockOutISO = ['LEAVE', 'ABSENT'].includes(targetStatus) ? undefined : (editForm.clockOut ? parseLocalToISO(editForm.clockOut) : undefined);

      await api.put(`/attendance/${selectedRecord.id}`, {
        userId: selectedRecord.userId,
        date: selectedRecord.date,
        status: targetStatus,
        clockIn: clockInISO,
        clockOut: clockOutISO,
        workingHours: editForm.workingHours ? parseFloat(editForm.workingHours) : undefined
      });
      setEditModalOpen(false);

      setSelectedRecord(null);
      setAlertMsg('Attendance log updated successfully.');
      fetchLogsAndAnalytics(filtersRef.current);
    } catch (err) {
      console.error(err);
      setEditForm(prev => ({
        ...prev,
        errorMsg: err.response?.data?.message || 'Failed to update attendance log.'
      }));
    } finally {
      setLoading(false);
    }
  };

  const renderLeavesApprovalTab = () => {
    return (
      <div className="rounded-2xl border border-border/40 bg-card p-6 shadow-premium text-left animate-in fade-in duration-300 space-y-4">
        <div className="flex items-center justify-between border-b border-border/30 pb-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-tight text-foreground/80 flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Leave & WFH Application Letter Review Panel
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Accepting a letter assigns WFH for remote attendance. Declining a letter automatically marks the employee as ABSENT.
            </p>
          </div>
          <span className="text-xs bg-primary/10 text-primary px-3 py-1 rounded-full font-bold">
            {leaves.filter(l => ['PENDING_ADMIN_APPROVAL', 'PENDING_TL_APPROVAL', 'PENDING'].includes(l.status)).length} Pending Review
          </span>
        </div>

        <div className="w-full min-w-0 overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm border-collapse">
            <thead>
              <tr className="text-xs font-semibold text-muted-foreground uppercase border-b border-border/30 bg-muted/20 text-left whitespace-nowrap">
                <th className="px-6 py-4 whitespace-nowrap">Applicant</th>
                <th className="px-6 py-4 whitespace-nowrap">Leave Type</th>
                <th className="px-6 py-4 whitespace-nowrap">Duration</th>
                <th className="px-6 py-4 text-center whitespace-nowrap">Read Letter</th>
                <th className="px-6 py-4 text-right whitespace-nowrap">Admin Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/25">
              {leaves.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-muted-foreground whitespace-nowrap">
                    No leave or WFH application letters submitted.
                  </td>
                </tr>
              ) : (
                leaves.map((l) => (
                  <tr key={l.id} className="hover:bg-muted/10 transition-all text-xs whitespace-nowrap">
                    <td className="px-6 py-4 font-semibold whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-bold text-foreground text-sm">{l.user?.name}</span>
                        <span className="text-[10px] text-muted-foreground">{l.user?.employeeId} ({l.user?.role?.replace('_', ' ')})</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-extrabold font-mono uppercase shadow-2xs ${
                        (l.leaveType || l.type) === 'WFH'
                          ? 'bg-indigo-500/10 text-indigo-600 border border-indigo-500/20'
                          : (l.leaveType || l.type) === 'SICK'
                          ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20'
                          : (l.leaveType || l.type) === 'EMERGENCY'
                          ? 'bg-rose-500/10 text-rose-600 border border-rose-500/20'
                          : 'bg-primary/10 text-primary border border-primary/20'
                      }`}>
                        {l.leaveType || l.type || 'CASUAL'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap font-bold text-foreground text-sm">
                      {getLeaveDurationDisplay(l)}
                    </td>
                    <td className="px-6 py-4 text-center whitespace-nowrap">
                      <button
                        onClick={() => setViewingLetter(l)}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:bg-primary/10 px-3.5 py-1.5 rounded-xl border border-primary/20 transition-all active:scale-95 cursor-pointer"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Read Letter</span>
                      </button>
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      {['PENDING_ADMIN_APPROVAL', 'PENDING_TL_APPROVAL', 'PENDING'].includes(l.status) ? (
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={() => handleUpdateLeaveStatus(l.id, 'APPROVED')}
                            disabled={submittingStatus}
                            className="h-8 w-8 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center shadow-md hover:scale-110 transition-all cursor-pointer disabled:opacity-50"
                            title="Accept & Sanction Leave Application"
                          >
                            <Check className="h-4 w-4 stroke-[3]" />
                          </button>
                          <button
                            onClick={() => handleUpdateLeaveStatus(l.id, 'REJECTED')}
                            disabled={submittingStatus}
                            className="h-8 w-8 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center shadow-md hover:scale-110 transition-all cursor-pointer disabled:opacity-50"
                            title="Decline Leave Application"
                          >
                            <X className="h-4 w-4 stroke-[3]" />
                          </button>
                        </div>
                      ) : (
                        <div className="text-right">
                          {l.status === 'APPROVED' ? (
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                              <Check className="h-3.5 w-3.5 stroke-[3]" />
                              <span>Sanctioned</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-rose-500/10 text-rose-600 border border-rose-500/20">
                              <X className="h-3.5 w-3.5 stroke-[3]" />
                              <span>Declined</span>
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <CompanyScopeSelector />
      {alertMsg && (
        <div className="flex items-center justify-between p-4 rounded-xl border border-primary/20 bg-primary/5 text-primary text-xs font-semibold">
          <span>{alertMsg}</span>
          <button onClick={() => setAlertMsg('')}>✕</button>
        </div>
      )}

      {/* Page Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
            Attendance
          </h1>
          <p className="text-sm text-muted-foreground font-medium">
            Monitor employee attendance records, daily activity, and generate Excel reports.
          </p>
        </div>

        {/* Top Header Export Report Toggle Button */}
        {(user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN') && (
          <button
            id="toggle-attendance-reports-btn"
            onClick={() => setShowReports(prev => !prev)}
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs transition-all shadow-xs active:scale-95 cursor-pointer shrink-0 ${
              showReports
                ? 'bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20'
                : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg'
            }`}
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span>{showReports ? 'Hide Reports Panel' : 'Export Report'}</span>
          </button>
        )}
      </div>

      {/* Main Attendance Audit Logs Panel */}
      <div className="space-y-4">
        {/* Analytics widgets row */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5 text-left">
            <div className="rounded-2xl border border-border/40 bg-card p-4 shadow-premium">
              <span className="text-[10px] font-bold text-muted-foreground uppercase">Total Active Members</span>
              <p className="text-lg font-extrabold mt-1">{stats.totalInterns}</p>
            </div>
            <div className="rounded-2xl border border-border/40 bg-card p-4 shadow-premium">
              <span className="text-[10px] font-bold text-success uppercase">Present / WFH</span>
              <p className="text-lg font-extrabold mt-1">{stats.presentToday}</p>
            </div>
            <div className="rounded-2xl border border-border/40 bg-card p-4 shadow-premium">
              <span className="text-[10px] font-bold text-warning uppercase">Late Arrivals</span>
              <p className="text-lg font-extrabold mt-1">{stats.lateToday}</p>
            </div>
            <div className="rounded-2xl border border-border/40 bg-card p-4 shadow-premium">
              <span className="text-[10px] font-bold text-primary uppercase">Half Day</span>
              <p className="text-lg font-extrabold mt-1">{stats.halfDayToday}</p>
            </div>
            <div className="rounded-2xl border border-border/40 bg-card p-4 shadow-premium col-span-2 sm:col-span-1">
              <span className="text-[10px] font-bold text-danger uppercase">Absent Today</span>
              <p className="text-lg font-extrabold mt-1">{stats.absentToday}</p>
            </div>
          </div>

          {/* Redesigned Attendance Audit Filter Card (Matching Leave History) */}
          <div className="rounded-3xl border border-border/70 bg-card p-6 shadow-sm space-y-4 text-left">
            {/* Row 1: Quick Filter Chips & From/To Date Range */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              {/* Left: Calendar Icon & Quick Filter Chips */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0 text-xs font-bold scrollbar-thin shrink-0">
                <span className="text-xs font-extrabold text-foreground uppercase tracking-wider flex items-center gap-1.5 mr-1">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span>Date Range:</span>
                </span>
                {QUICK_FILTERS.map((q) => {
                  const active = quickFilter === q.id;
                  return (
                    <button
                      key={q.id}
                      onClick={() => handleQuickFilterClick(q.id)}
                      className={`h-9 px-3.5 rounded-xl transition-all cursor-pointer shrink-0 flex items-center justify-center text-xs ${
                        active
                          ? 'bg-primary text-primary-foreground font-black shadow-xs scale-102'
                          : 'bg-card hover:bg-muted text-muted-foreground hover:text-foreground border border-border/60 font-semibold'
                      }`}
                    >
                      {q.label}
                    </button>
                  );
                })}
              </div>

              {/* Right: Date Pickers */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="relative flex items-center">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      setQuickFilter('CUSTOM');
                    }}
                    className="h-10 px-3 rounded-xl border border-border/70 bg-card text-xs font-medium text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer shadow-2xs"
                  />
                </div>
                <span className="text-xs font-bold text-muted-foreground">to</span>
                <div className="relative flex items-center">
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      setQuickFilter('CUSTOM');
                    }}
                    className="h-10 px-3 rounded-xl border border-border/70 bg-card text-xs font-medium text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer shadow-2xs"
                  />
                </div>
              </div>
            </div>

            {/* Row 2: Responsive Filters Grid (4 Columns) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Member Select */}
              <select
                value={userIdFilter}
                onChange={(e) => setUserIdFilter(e.target.value)}
                className="h-11 px-3 rounded-xl border border-border/70 bg-card text-xs font-semibold text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer"
              >
                <option value="">All Members</option>
                {allInterns.map(intern => (
                  <option key={intern.id} value={intern.id}>{intern.name} ({intern.employeeId})</option>
                ))}
              </select>

              {/* Attendance Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-11 px-3 rounded-xl border border-border/70 bg-card text-xs font-semibold text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer"
              >
                <option value="">All Statuses</option>
                <option value="PRESENT">Present</option>
                <option value="LATE">Late</option>
                <option value="HALF_DAY">Half Day</option>
                <option value="ABSENT">Absent</option>
                <option value="LEAVE">On Leave</option>
                <option value="WORK_FROM_HOME">WFH</option>
                <option value="HOLIDAY">Holiday</option>
              </select>

              {/* Search Input */}
              <div className="relative flex items-center">
                <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search Employee / ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 h-11 rounded-xl border border-border/70 bg-card text-xs font-medium text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>

              {/* Clear Filters Button */}
              <button
                onClick={handleClearFilters}
                className="h-11 px-4 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 border border-rose-500/20 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                title="Reset all filters"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Clear Filters</span>
              </button>
            </div>
          </div>

          {/* Attendance Report Section (Admin / Super Admin) Toggle Panel */}
          <AnimatePresence>
            {showReports && (
              <motion.div
                initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
                animate={{ opacity: 1, height: 'auto', overflow: 'visible' }}
                exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
              >
                <AttendanceReportSection user={user} onClose={() => setShowReports(false)} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Clean Logs Table */}
          <div className="w-full min-w-0 overflow-x-auto rounded-2xl border border-border/40 bg-card shadow-premium text-left">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-xs font-semibold text-muted-foreground uppercase border-b border-border/30 bg-muted/20 whitespace-nowrap">
                  <th className="px-6 py-4 whitespace-nowrap">Member</th>
                  <th className="px-6 py-4 whitespace-nowrap">Date</th>
                  <th className="px-6 py-4 whitespace-nowrap">Clock In</th>
                  <th className="px-6 py-4 whitespace-nowrap">Clock Out</th>
                  <th className="px-6 py-4 whitespace-nowrap">Work Location</th>
                  <th className="px-6 py-4 whitespace-nowrap">Hours</th>
                  <th className="px-6 py-4 whitespace-nowrap">Status</th>
                  <th className="px-6 py-4 text-right whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/25">
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-10 text-center text-muted-foreground whitespace-nowrap">
                      No attendance records found{selectedCompany?.name ? ` for ${selectedCompany.name}` : ''}.
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-muted/10 transition-all text-xs whitespace-nowrap">
                      <td className="px-6 py-4 font-semibold whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <UserAvatar
                            user={log.user}
                            className="h-9 w-9 sm:h-11 sm:w-11 rounded-full border border-[#E5E7EB] dark:border-border/50 shrink-0 object-cover"
                          />
                          <div>
                            <span className="font-bold text-foreground text-sm block leading-tight">{log.user?.name || 'Member'}</span>
                            <span className="text-[10px] text-muted-foreground font-mono block mt-0.5">{log.user?.employeeId || 'EM-000'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-medium whitespace-nowrap">{formatDateDDMMYYYY(log.date)}</td>
                      <td className="px-6 py-4 font-mono whitespace-nowrap">
                        {log.clockIn ? new Date(log.clockIn).toLocaleTimeString() : '—'}
                      </td>
                      <td className="px-6 py-4 font-mono whitespace-nowrap">
                        {!log.clockIn ? '—' : log.clockOut ? new Date(log.clockOut).toLocaleTimeString() : 'Shift Active'}
                      </td>
                      <td className="px-6 py-4 font-medium whitespace-nowrap text-muted-foreground">
                        {log.workLocation === 'OTHER' ? (log.workLocationOther || log.clockInLocation || 'Other') : (log.workLocation || log.clockInLocation || '—')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {!log.workingHours || log.workingHours === 0 ? '—' : `${log.workingHours} hrs`}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {log.status === 'PENDING' || !log.status ? (
                          <span className="text-muted-foreground font-bold">—</span>
                        ) : (
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase ${log.status === 'PRESENT' || log.status === 'WORK_FROM_HOME' ? 'bg-emerald-500/10 text-emerald-600' : log.status === 'LATE' ? 'bg-yellow-500/10 text-yellow-600' : log.status === 'HALF_DAY' ? 'bg-purple-500/10 text-purple-600' : log.status === 'ABSENT' ? 'bg-rose-500/10 text-rose-600' : log.status === 'HOLIDAY' ? 'bg-sky-500/10 text-sky-600' : 'bg-amber-500/10 text-amber-600'}`}>
                            {log.status === 'LATE' && log.lateMinutes ? `LATE (${formatLateMinutes(log.lateMinutes)})` : log.status}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => handleOpenViewDetails(log)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all cursor-pointer inline-flex items-center justify-center border border-border/40"
                            title="View Attendance Details"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          {canEditAttendance && (
                            <button
                              onClick={() => openEditModal(log)}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all cursor-pointer inline-flex items-center justify-center border border-border/40"
                              title="Edit Attendance"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
      </div>

      {/* View Full Formal Letter Modal for Admin */}
      {viewingLetter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 text-left">
          <div className="w-full max-w-xl rounded-2xl border border-border/40 bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                <h3 className="text-base font-bold">Formal Leave Application Letter</h3>
              </div>
              <button
                className="rounded-lg p-1 hover:bg-muted"
                onClick={() => setViewingLetter(null)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4 font-sans text-xs">
              <div className="flex justify-between items-center bg-muted/40 p-3.5 rounded-xl border border-border/30">
                <div>
                  <span className="text-[10px] text-muted-foreground font-semibold uppercase block mb-0.5">Applicant Employee</span>
                  <p className="font-bold text-sm text-foreground">{viewingLetter.user?.name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{viewingLetter.user?.employeeId} ({viewingLetter.user?.role?.replace('_', ' ')})</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-muted-foreground font-semibold uppercase block mb-0.5">Leave Type</span>
                  <span className={`inline-block px-2.5 py-0.5 rounded-md text-[10px] font-extrabold font-mono uppercase ${
                    (viewingLetter.leaveType || viewingLetter.type) === 'WFH' ? 'bg-indigo-500/10 text-indigo-600 border border-indigo-500/20' : 'bg-rose-500/10 text-rose-600 border border-rose-500/20'
                  }`}>
                    {viewingLetter.leaveType || viewingLetter.type || 'CASUAL'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 bg-muted/20 p-3 rounded-xl border border-border/30">
                <div>
                  <span className="text-[10px] text-muted-foreground font-bold uppercase block mb-0.5">Duration</span>
                  <p className="font-black text-foreground text-sm">{getLeaveDurationDisplay(viewingLetter)}</p>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground font-bold uppercase block mb-0.5">Start & End Dates</span>
                  <p className="font-medium text-foreground text-xs">{formatLeavePeriod(viewingLetter.startDate, viewingLetter.endDate)}</p>
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground font-bold uppercase">Reason / Application Letter</span>
                <div className="bg-muted/10 p-4 rounded-xl border border-border/40 text-xs whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto font-medium text-foreground">
                  {viewingLetter.reason || viewingLetter.letterContent}
                </div>
              </div>

              {viewingLetter.contactPhone && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Phone className="h-3.5 w-3.5 text-primary" />
                  <span>Contact Phone: <strong className="text-foreground">{viewingLetter.contactPhone}</strong></span>
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-border/40 pt-4">
              <button
                onClick={() => setViewingLetter(null)}
                className="px-4 py-2 text-xs font-bold rounded-xl border hover:bg-muted"
              >
                Close
              </button>

              {['PENDING_ADMIN_APPROVAL', 'PENDING_TL_APPROVAL', 'PENDING'].includes(viewingLetter.status) ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const id = viewingLetter.id;
                      setViewingLetter(null);
                      handleUpdateLeaveStatus(id, 'APPROVED');
                    }}
                    className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer"
                  >
                    <Check className="h-4 w-4 stroke-[3]" />
                    <span>Accept (Sanction)</span>
                  </button>

                  <button
                    onClick={() => {
                      const id = viewingLetter.id;
                      setViewingLetter(null);
                      handleUpdateLeaveStatus(id, 'REJECTED');
                    }}
                    className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer"
                  >
                    <X className="h-4 w-4 stroke-[3]" />
                    <span>Decline (Reject)</span>
                  </button>
                </div>
              ) : (
                <div>
                  {viewingLetter.status === 'APPROVED' ? (
                    <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-black bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                      <Check className="h-3.5 w-3.5 stroke-[3]" />
                      <span>Sanctioned</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-black bg-rose-500/10 text-rose-600 border border-rose-500/20">
                      <X className="h-3.5 w-3.5 stroke-[3]" />
                      <span>Declined</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit attendance log override modal */}
      {editModalOpen && selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border/40 bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200 text-left">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-3">
                <UserAvatar
                  user={selectedRecord.user}
                  className="h-10 w-10 rounded-full border border-border/60 object-cover"
                />
                <div>
                  <h3 className="text-base font-bold leading-tight">{selectedRecord.user?.name}</h3>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                    <span className="font-mono">{selectedRecord.user?.employeeId || 'EM-000'}</span>
                    <span>•</span>
                    <span className="font-semibold text-primary">{formatDateDDMMYYYY(selectedRecord.date)}</span>
                  </div>
                </div>
              </div>
              <button
                className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                onClick={() => {
                  setEditModalOpen(false);
                  setSelectedRecord(null);
                }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="mt-4 space-y-4">
              {editForm.errorMsg && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs font-medium leading-relaxed">
                  {editForm.errorMsg}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Attendance Status</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value, errorMsg: '' })}
                  className="bg-background border border-border/70 px-3 py-2.5 rounded-xl text-xs font-medium focus:ring-2 focus:ring-primary/20"
                >
                  <option value="PRESENT">PRESENT</option>
                  <option value="LATE">LATE</option>
                  <option value="HALF_DAY">HALF_DAY</option>
                  <option value="WORK_FROM_HOME">WORK_FROM_HOME</option>
                  <option value="LEAVE">LEAVE</option>
                  <option value="ABSENT">ABSENT</option>
                </select>
              </div>

              {editForm.status === 'LEAVE' && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs leading-relaxed">
                  <strong>Leave Protection:</strong> Approved Leave records are managed via Leave Management. Clock In and Clock Out timestamps remain <code>—</code>.
                </div>
              )}

              {editForm.status === 'ABSENT' && (
                <div className="p-3.5 rounded-xl bg-muted/40 border border-border/40 text-muted-foreground text-xs leading-relaxed">
                  <strong>Absent Record:</strong> Absent status contains no Clock In or Clock Out timestamps. Changing to PRESENT / LATE will require entering Clock In time.
                </div>
              )}

              {['PRESENT', 'LATE', 'HALF_DAY', 'WORK_FROM_HOME'].includes(editForm.status) && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">Clock In Time</label>
                    <input
                      type="datetime-local"
                      value={editForm.clockIn}
                      onChange={(e) => setEditForm({ ...editForm, clockIn: e.target.value, errorMsg: '' })}
                      className="bg-background border border-border/70 px-3 py-2 rounded-xl text-xs font-mono"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">Clock Out Time (Optional if active shift)</label>
                    <input
                      type="datetime-local"
                      value={editForm.clockOut}
                      onChange={(e) => setEditForm({ ...editForm, clockOut: e.target.value, errorMsg: '' })}
                      className="bg-background border border-border/70 px-3 py-2 rounded-xl text-xs font-mono"
                    />
                  </div>
                </>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border/30">
                <button
                  type="button"
                  onClick={() => {
                    setEditModalOpen(false);
                    setSelectedRecord(null);
                  }}
                  className="px-4 py-2.5 rounded-xl border border-border/50 text-xs font-bold text-muted-foreground hover:bg-muted transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 rounded-xl bg-primary text-xs font-bold text-primary-foreground shadow-md hover:bg-primary-hover active:scale-95 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {loading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewDetailsRecord && (
        <AttendanceAuditDetailsModal
          isOpen={Boolean(viewDetailsRecord)}
          onClose={() => setViewDetailsRecord(null)}
          record={viewDetailsRecord}
        />
      )}
    </div>
  );
};

export default AttendanceAudit;
