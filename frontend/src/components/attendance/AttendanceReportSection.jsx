import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/api';
import { useCompanyScope } from '../../context/CompanyScopeContext';
import {
  FileSpreadsheet,
  Calendar,
  CalendarRange,
  BarChart3,
  Download,
  Filter,
  Users,
  Search,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  Layers,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const resolveTargetOrgId = (selectedOrgId, effectiveOrgId, user, selectedCompany) => {
  if (selectedOrgId && selectedOrgId !== '') return String(selectedOrgId).trim();
  if (effectiveOrgId && effectiveOrgId !== '') return String(effectiveOrgId).trim();
  if (user?.organizationId) return String(user.organizationId).trim();
  if (user?.organization?.id) return String(user.organization.id).trim();
  if (selectedCompany?.id && selectedCompany.id !== 'all') return String(selectedCompany.id).trim();

  try {
    const storedScope = localStorage.getItem('mrf_selected_company_id');
    if (storedScope && storedScope !== '') return String(storedScope).trim();
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const u = JSON.parse(storedUser);
      if (u?.organizationId) return String(u.organizationId).trim();
      if (u?.organization?.id) return String(u.organization.id).trim();
    }
  } catch (e) {
    // quiet
  }

  return 'default';
};

const getSelectionStorageKey = (orgId) => {
  const cleanId = (orgId || '').trim() || 'default';
  return `attendance_audit_selected_members_${cleanId}`;
};

const readSavedSelection = (orgId) => {
  try {
    const key = getSelectionStorageKey(orgId);
    const raw = localStorage.getItem(key);
    if (raw === null) return null; // First visit / uninitialized
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return Array.from(new Set(parsed.map((id) => String(id).trim()).filter(Boolean)));
    }
  } catch (e) {
    console.error(`[AttendanceAudit] Error reading saved selection for ${orgId}:`, e);
  }
  return null;
};

const writeSavedSelection = (orgId, ids) => {
  try {
    const key = getSelectionStorageKey(orgId);
    const normalized = Array.from(
      new Set((ids || []).map((id) => String(id).trim()).filter(Boolean))
    );
    localStorage.setItem(key, JSON.stringify(normalized));
  } catch (e) {
    console.error(`[AttendanceAudit] Error saving selection to localStorage for ${orgId}:`, e);
  }
};

export default function AttendanceReportSection({ user, onClose }) {
  const { selectedOrgId, effectiveOrgId, selectedCompany } = useCompanyScope();
  const targetOrgId = resolveTargetOrgId(selectedOrgId, effectiveOrgId, user, selectedCompany);

  // Report Type: 'daily' | 'weekly' | 'monthly'
  const [reportType, setReportType] = useState('daily');

  // Filters State
  const todayStr = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(todayStr);

  // Weekly filters
  const [weekNumber, setWeekNumber] = useState(() => {
    const now = new Date();
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  });
  const [weekYear, setWeekYear] = useState(new Date().getFullYear());

  // Monthly filters
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  // Common filters
  const [teamFilter, setTeamFilter] = useState('ALL');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Teams options
  const [teams, setTeams] = useState([]);

  // Data preview state
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Member selection state (remembered in browser localStorage per organization)
  const [selectedUserIds, setSelectedUserIds] = useState(() => {
    return readSavedSelection(targetOrgId); // returns string[] or null (null indicates uninitialized / first visit)
  });

  // Track the organization ID to handle switches between companies
  const prevOrgIdRef = useRef(targetOrgId);
  const initializedOrgRef = useRef({});

  // When target organization changes, load that organization's saved selection
  useEffect(() => {
    if (prevOrgIdRef.current !== targetOrgId) {
      prevOrgIdRef.current = targetOrgId;
      const saved = readSavedSelection(targetOrgId);
      setSelectedUserIds(saved);
    }
  }, [targetOrgId]);

  // Reconcile selection when reportData records load
  useEffect(() => {
    const records = reportData?.records;
    if (!records || records.length === 0) return;

    const currentMemberIds = Array.from(
      new Set(records.map((r) => String(r.userId).trim()).filter(Boolean))
    );
    if (currentMemberIds.length === 0) return;

    const saved = readSavedSelection(targetOrgId);

    if (saved === null) {
      // FIRST VISIT BEHAVIOR:
      // If there is no saved selection for that organization, select all currently displayed members by default.
      setSelectedUserIds(currentMemberIds);
      writeSavedSelection(targetOrgId, currentMemberIds);
      initializedOrgRef.current[targetOrgId] = true;
    } else {
      // SUBSEQUENT VISITS:
      // A saved selection exists. Restore only IDs that still exist in the current member list,
      // but only on the first reconciliation pass for this organization when viewing unfiltered data.
      if (!initializedOrgRef.current[targetOrgId]) {
        initializedOrgRef.current[targetOrgId] = true;
        const isUnfiltered =
          teamFilter === 'ALL' &&
          roleFilter === 'ALL' &&
          !employeeSearch.trim() &&
          statusFilter === 'ALL';

        if (isUnfiltered) {
          const currentSet = new Set(currentMemberIds);
          const restoredIds = saved.filter((id) => currentSet.has(id));
          setSelectedUserIds(restoredIds);
          if (restoredIds.length !== saved.length) {
            writeSavedSelection(targetOrgId, restoredIds);
          }
        } else {
          setSelectedUserIds(saved);
        }
      }
    }
  }, [reportData?.records, targetOrgId, teamFilter, roleFilter, employeeSearch, statusFilter]);

  const displayedRecords = reportData?.records || [];
  const displayedUserIds = displayedRecords
    .map((r) => (r.userId ? String(r.userId).trim() : ''))
    .filter(Boolean);
  const currentSelectedIds = selectedUserIds || [];

  const selectedInDisplayCount = displayedUserIds.filter((id) =>
    currentSelectedIds.includes(id)
  ).length;

  const isAllSelected =
    displayedUserIds.length > 0 &&
    selectedInDisplayCount === displayedUserIds.length;

  const isIndeterminate =
    selectedInDisplayCount > 0 &&
    selectedInDisplayCount < displayedUserIds.length;

  const saveSelection = (newIds) => {
    const normalized = Array.from(
      new Set((newIds || []).map((id) => String(id).trim()).filter(Boolean))
    );
    setSelectedUserIds(normalized);
    if (targetOrgId) {
      writeSavedSelection(targetOrgId, normalized);
    }
  };

  const handleToggleSelectAll = () => {
    if (displayedUserIds.length === 0) return;

    if (isAllSelected) {
      // Unselect all currently displayed members
      const displayedSet = new Set(displayedUserIds);
      const newSelection = currentSelectedIds.filter((id) => !displayedSet.has(id));
      saveSelection(newSelection);
    } else {
      // Select all currently displayed members
      const newSelection = Array.from(
        new Set([...currentSelectedIds, ...displayedUserIds])
      );
      saveSelection(newSelection);
    }
  };

  const handleToggleMember = (userId) => {
    if (!userId) return;
    const strId = String(userId).trim();
    let newSelection;
    if (currentSelectedIds.includes(strId)) {
      newSelection = currentSelectedIds.filter((id) => id !== strId);
    } else {
      newSelection = [...currentSelectedIds, strId];
    }
    saveSelection(newSelection);
  };

  // Fetch Teams
  useEffect(() => {
    const fetchTeams = async () => {
      try {
        const params = targetOrgId ? { organizationId: targetOrgId } : {};
        const res = await api.get('/teams', { params });
        setTeams(Array.isArray(res.data) ? res.data : (res.data?.teams || []));
      } catch (err) {
        console.warn('Failed to fetch teams:', err);
      }
    };
    fetchTeams();
  }, [targetOrgId]);

  // Fetch Report Preview Data
  const fetchReportPreview = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const params = {
        organizationId: targetOrgId,
        teamId: teamFilter !== 'ALL' ? teamFilter : undefined,
        role: roleFilter !== 'ALL' ? roleFilter : undefined,
        employeeName: employeeSearch.trim() || undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined
      };

      let endpoint = '';
      if (reportType === 'daily') {
        endpoint = '/reports/attendance/daily';
        params.date = date;
      } else if (reportType === 'weekly') {
        endpoint = '/reports/attendance/weekly';
        params.week = weekNumber;
        params.year = weekYear;
      } else if (reportType === 'monthly') {
        endpoint = '/reports/attendance/monthly';
        params.month = selectedMonth;
        params.year = selectedYear;
      }

      const res = await api.get(endpoint, { params });
      setReportData(res.data);
    } catch (err) {
      console.error('Fetch attendance report error:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to load attendance report preview.');
    } finally {
      setLoading(false);
    }
  }, [
    reportType,
    targetOrgId,
    date,
    weekNumber,
    weekYear,
    selectedMonth,
    selectedYear,
    teamFilter,
    roleFilter,
    employeeSearch,
    statusFilter
  ]);

  useEffect(() => {
    fetchReportPreview();
  }, [fetchReportPreview]);

  // Export to Excel
  const handleExport = async () => {
    setErrorMsg('');
    setSuccessMsg('');

    // Check member selection: must have at least one displayed member selected
    const activeSelectedInDisplay = displayedUserIds.filter((id) =>
      currentSelectedIds.includes(id)
    );
    if (activeSelectedInDisplay.length === 0) {
      setErrorMsg('Please select at least one member to export.');
      return;
    }

    setExporting(true);
    try {
      const params = {
        type: reportType,
        organizationId: targetOrgId,
        teamId: teamFilter !== 'ALL' ? teamFilter : undefined,
        role: roleFilter !== 'ALL' ? roleFilter : undefined,
        employeeName: employeeSearch.trim() || undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined
      };

      // If not all displayed members are selected, restrict export to only selected members
      if (!isAllSelected) {
        params.userIds = activeSelectedInDisplay.join(',');
      }

      if (reportType === 'daily') {
        params.date = date;
      } else if (reportType === 'weekly') {
        params.week = weekNumber;
        params.year = weekYear;
      } else if (reportType === 'monthly') {
        params.month = selectedMonth;
        params.year = selectedYear;
      }

      const res = await api.get('/reports/attendance/export', {
        params,
        responseType: 'blob'
      });

      // Extract filename from header or fallback
      let filename = `Attendance_${reportType.toUpperCase()}_Report.xlsx`;
      const disposition = res.headers['content-disposition'];
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) {
          filename = match[1];
        }
      } else {
        if (reportType === 'daily') {
          const [y, m, d] = (date || todayStr).split('-');
          filename = `Attendance_Daily_${d}-${m}-${y}.xlsx`;
        } else if (reportType === 'weekly') {
          const wStr = String(weekNumber).padStart(2, '0');
          filename = `Attendance_Weekly_Week${wStr}_${weekYear}.xlsx`;
        } else if (reportType === 'monthly') {
          const mName = MONTH_NAMES[selectedMonth - 1] || 'Month';
          filename = `Attendance_Monthly_${mName}_${selectedYear}.xlsx`;
        }
      }

      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setSuccessMsg(`Report exported successfully: ${filename}`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      console.error('Export report error:', err);
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const parsed = JSON.parse(text);
          setErrorMsg(parsed.message || 'Failed to export attendance report to Excel.');
          return;
        } catch (e) {
          // ignore
        }
      }
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to export attendance report to Excel.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="rounded-3xl border border-border/80 bg-card p-6 sm:p-7 shadow-sm text-left space-y-6">
      {/* Header with Icon, Title & Action Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/50 pb-5">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-xs">
            <FileSpreadsheet className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-black tracking-tight text-foreground">
                Attendance Reports
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                Excel Export
              </span>
            </div>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">
              Generate formatted Daily, Weekly, and Monthly attendance reports using company attendance data.
            </p>
          </div>
        </div>

        {/* Export Button */}
        <div className="flex items-center gap-2">
          <button
            onClick={fetchReportPreview}
            disabled={loading}
            className="p-2.5 rounded-xl border border-border/70 hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer"
            title="Refresh Report Data"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-primary' : ''}`} />
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold shadow-md hover:shadow-lg transition-all active:scale-95 cursor-pointer disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            <span>{exporting ? 'Generating Excel...' : 'Export Report'}</span>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2.5 rounded-xl border border-border/70 hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer"
              title="Close Report Panel"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Notifications */}
      {errorMsg && (
        <div className="p-3.5 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-600 text-xs font-bold flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg('')} className="p-1 hover:opacity-75">✕</button>
        </div>
      )}
      {successMsg && (
        <div className="p-3.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 text-xs font-bold flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg('')} className="p-1 hover:opacity-75">✕</button>
        </div>
      )}

      {/* Row 1: Report Type Tabs (Segmented Buttons) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <label className="block text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground mb-2">
            Report Type
          </label>
          <div className="inline-flex items-center gap-1.5 p-1 bg-muted/60 border border-border/50 rounded-2xl shadow-xs">
            {[
              { id: 'daily', label: 'Daily', icon: Calendar },
              { id: 'weekly', label: 'Weekly', icon: CalendarRange },
              { id: 'monthly', label: 'Monthly', icon: BarChart3 }
            ].map((t) => {
              const Icon = t.icon;
              const isActive = reportType === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setReportType(t.id)}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-primary text-white shadow-xs font-extrabold scale-102'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/80'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{t.label} Report</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Dynamic Period Information Box */}
        <div className="p-3 rounded-2xl bg-muted/30 border border-border/50 text-right">
          <span className="text-[10px] font-bold text-muted-foreground uppercase block">
            Selected Scope
          </span>
          <span className="text-xs font-black text-foreground block mt-0.5">
            {reportType === 'daily' && `Daily: ${reportData?.date || date}`}
            {reportType === 'weekly' && (reportData?.weekLabel || `Week ${weekNumber}, ${weekYear}`)}
            {reportType === 'monthly' && (reportData?.monthYearLabel || `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}`)}
          </span>
        </div>
      </div>

      {/* Row 2: Responsive Filters Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 p-4 rounded-2xl bg-muted/20 border border-border/50">
        {/* Date / Period Picker */}
        <div>
          <label className="block text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground mb-1.5">
            {reportType === 'daily' ? 'Date *' : reportType === 'weekly' ? 'Week & Year *' : 'Month & Year *'}
          </label>
          {reportType === 'daily' && (
            <input
              type="date"
              value={date}
              max={todayStr}
              onChange={(e) => setDate(e.target.value)}
              className="w-full h-10 px-3 text-xs font-semibold rounded-xl border border-border/70 bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer shadow-2xs"
            />
          )}

          {reportType === 'weekly' && (
            <div className="grid grid-cols-2 gap-1.5">
              <select
                value={weekNumber}
                onChange={(e) => setWeekNumber(Number(e.target.value))}
                className="h-10 px-2 text-xs font-semibold rounded-xl border border-border/70 bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer shadow-2xs"
              >
                {Array.from({ length: 53 }, (_, i) => i + 1).map((w) => (
                  <option key={w} value={w}>Wk {w}</option>
                ))}
              </select>
              <select
                value={weekYear}
                onChange={(e) => setWeekYear(Number(e.target.value))}
                className="h-10 px-2 text-xs font-semibold rounded-xl border border-border/70 bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer shadow-2xs"
              >
                {[2024, 2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}

          {reportType === 'monthly' && (
            <div className="grid grid-cols-2 gap-1.5">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="h-10 px-2 text-xs font-semibold rounded-xl border border-border/70 bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer shadow-2xs"
              >
                {MONTH_NAMES.map((m, idx) => (
                  <option key={m} value={idx + 1}>{m.substring(0, 3)}</option>
                ))}
              </select>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="h-10 px-2 text-xs font-semibold rounded-xl border border-border/70 bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer shadow-2xs"
              >
                {[2024, 2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Team Filter */}
        <div>
          <label className="block text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground mb-1.5">
            Team
          </label>
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="w-full h-10 px-3 text-xs font-semibold rounded-xl border border-border/70 bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer shadow-2xs"
          >
            <option value="ALL">All Teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* Member Type Filter */}
        <div>
          <label className="block text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground mb-1.5">
            Member Type
          </label>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="w-full h-10 px-3 text-xs font-semibold rounded-xl border border-border/70 bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer shadow-2xs"
          >
            <option value="ALL">All Types</option>
            <option value="EMPLOYEE">Employee</option>
            <option value="INTERN">Intern</option>
            <option value="TEAM_LEADER">Team Leader</option>
          </select>
        </div>

        {/* Attendance Status Filter */}
        <div>
          <label className="block text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground mb-1.5">
            Status
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full h-10 px-3 text-xs font-semibold rounded-xl border border-border/70 bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer shadow-2xs"
          >
            <option value="ALL">All Statuses</option>
            <option value="PRESENT">Present</option>
            <option value="LATE">Late</option>
            <option value="ABSENT">Absent</option>
            <option value="WFH">WFH</option>
            <option value="LEAVE">On Leave</option>
            <option value="LOP">Loss of Pay (LOP)</option>
          </select>
        </div>

        {/* Member Name Filter */}
        <div>
          <label className="block text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground mb-1.5">
            Search Member
          </label>
          <div className="relative flex items-center">
            <Search className="absolute left-3 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search member by name / ID..."
              value={employeeSearch}
              onChange={(e) => setEmployeeSearch(e.target.value)}
              className="w-full h-10 pl-8.5 pr-3 text-xs font-medium rounded-xl border border-border/70 bg-card text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-2xs"
            />
          </div>
        </div>
      </div>

      {/* Row 3: Summary Metrics Bar (For Weekly & Monthly Reports) */}
      {(reportType === 'weekly' || reportType === 'monthly') && reportData?.summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-2xl bg-muted/40 border border-border/40 text-center">
            <span className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-wider block">
              Total Working Days
            </span>
            <span className="text-xl font-black text-foreground mt-0.5 block">
              {reportData.summary.totalWorkingDays} Days
            </span>
          </div>
          <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20 text-center">
            <span className="text-[10px] font-extrabold text-primary uppercase tracking-wider block">
              Average Attendance %
            </span>
            <span className="text-xl font-black text-primary mt-0.5 block">
              {reportData.summary.averageAttendancePercent || reportData.summary.averageAttendance}
            </span>
          </div>
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-center">
            <span className="text-[10px] font-extrabold text-rose-600 uppercase tracking-wider block">
              Total Loss of Pay (LOP)
            </span>
            <span className="text-xl font-black text-rose-600 mt-0.5 block">
              {reportData.summary.totalLopDays ?? 0} Days
            </span>
          </div>
        </div>
      )}

      {/* Row 4: Live Data Preview Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground">
              Report Data Preview ({reportData?.records?.length || 0} Records
              {displayedRecords.length > 0 && ` • ${selectedInDisplayCount} Selected`})
            </h4>
          </div>
          <span className="text-[11px] font-semibold text-muted-foreground">
            {reportData?.companyName || selectedCompany?.name || 'Innovety Tech'}
          </span>
        </div>

        {(() => {
          const rawLeaveTypes = reportData?.leaveTypes && reportData.leaveTypes.length > 0
            ? reportData.leaveTypes
            : [
                { id: 'cl', name: 'Casual Leave', code: 'CL' },
                { id: 'sl', name: 'Sick Leave', code: 'SL' },
                { id: 'comp_off', name: 'Compensatory Off', code: 'COMP_OFF' }
              ];
          const dynamicLeaveTypes = rawLeaveTypes.filter(
            (lt) => !['WFH', 'WORK_FROM_HOME'].includes((lt.code || '').toUpperCase()) &&
                    !lt.name?.toUpperCase().includes('WFH') &&
                    !lt.name?.toUpperCase().includes('WORK FROM HOME')
          );
          const periodicColSpan = 6 + dynamicLeaveTypes.length;

          return (
            <div className="w-full min-w-0 overflow-x-auto rounded-2xl border border-border/50 bg-card shadow-xs">
              <table className="w-full text-xs border-collapse">
            <thead>
              {reportType === 'daily' && (
                <tr className="border-b border-border/40 bg-muted/30 text-muted-foreground font-black uppercase text-[10px] tracking-wider whitespace-nowrap">
                  <th className="px-5 py-3 text-left">
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        id="select-all-daily"
                        ref={(el) => {
                          if (el) el.indeterminate = isIndeterminate;
                        }}
                        checked={isAllSelected}
                        onChange={handleToggleSelectAll}
                        disabled={displayedRecords.length === 0}
                        className="h-4 w-4 rounded border-border/80 text-primary focus:ring-primary/20 accent-primary cursor-pointer disabled:opacity-40"
                        title={isAllSelected ? "Unselect all displayed members" : "Select all displayed members"}
                      />
                      <span>Members</span>
                    </div>
                  </th>
                  <th className="px-5 py-3 text-center">Attendance</th>
                  <th className="px-5 py-3 text-center">Login Time</th>
                  <th className="px-5 py-3 text-center">Login Status</th>
                </tr>
              )}

              {(reportType === 'weekly' || reportType === 'monthly') && (
                <tr className="border-b border-border/40 bg-muted/30 text-muted-foreground font-black uppercase text-[10px] tracking-wider whitespace-nowrap">
                  <th className="px-5 py-3 text-left">
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        id={`select-all-${reportType}`}
                        ref={(el) => {
                          if (el) el.indeterminate = isIndeterminate;
                        }}
                        checked={isAllSelected}
                        onChange={handleToggleSelectAll}
                        disabled={displayedRecords.length === 0}
                        className="h-4 w-4 rounded border-border/80 text-primary focus:ring-primary/20 accent-primary cursor-pointer disabled:opacity-40"
                        title={isAllSelected ? "Unselect all displayed members" : "Select all displayed members"}
                      />
                      <span>Members</span>
                    </div>
                  </th>
                  <th className="px-5 py-3 text-center">Working Days</th>
                  <th className="px-5 py-3 text-center">Present</th>
                  <th className="px-5 py-3 text-center">WFH</th>
                  <th className="px-5 py-3 text-center">Late</th>
                  {dynamicLeaveTypes.map((lt) => (
                    <th key={lt.id || lt.name} className="px-5 py-3 text-center">
                      {lt.name}
                    </th>
                  ))}
                  <th className="px-5 py-3 text-center">Loss of Pay (LOP)</th>
                </tr>
              )}
            </thead>

            <tbody className="divide-y divide-border/25">
              {loading ? (
                <tr>
                  <td colSpan={reportType === 'daily' ? 4 : periodicColSpan} className="px-5 py-8 text-center text-muted-foreground font-semibold">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto text-primary mb-2" />
                    <span>Loading report preview...</span>
                  </td>
                </tr>
              ) : !reportData?.records || reportData.records.length === 0 ? (
                <tr>
                  <td colSpan={reportType === 'daily' ? 4 : periodicColSpan} className="px-5 py-8 text-center text-muted-foreground font-semibold">
                    No attendance records match the selected filters.
                  </td>
                </tr>
              ) : (
                reportData.records.map((rec, idx) => (
                  <tr key={rec.userId || idx} className="hover:bg-muted/10 transition-colors">
                    {/* Employee info column with selection checkbox */}
                    <td className="px-5 py-3.5 whitespace-nowrap font-bold text-foreground">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          id={`select-member-${rec.userId}`}
                          checked={currentSelectedIds.includes(String(rec.userId).trim())}
                          onChange={() => handleToggleMember(rec.userId)}
                          className="h-4 w-4 rounded border-border/80 text-primary focus:ring-primary/20 accent-primary cursor-pointer shrink-0"
                          title={`Select ${rec.employee}`}
                        />
                        <div className="flex flex-col">
                          <span className="text-xs font-black">{rec.employee}</span>
                          <span className="text-[10px] font-mono text-muted-foreground font-semibold">
                            {rec.employeeId} • {rec.role?.replace('_', ' ')}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Daily Columns */}
                    {reportType === 'daily' && (
                      <>
                        <td className="px-5 py-3.5 text-center whitespace-nowrap">
                          <span
                            className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                              rec.attendance === 'Present'
                                ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                                : rec.attendance === 'WFH'
                                ? 'bg-purple-500/10 text-purple-600 border border-purple-500/20'
                                : rec.attendance === 'Half Day'
                                ? 'bg-indigo-500/10 text-indigo-600 border border-indigo-500/20'
                                : rec.attendance === 'Holiday'
                                ? 'bg-sky-500/10 text-sky-600 border border-sky-500/20'
                                : rec.attendance === 'On Leave'
                                ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20'
                                : 'bg-rose-500/10 text-rose-600 border border-rose-500/20'
                            }`}
                          >
                            {rec.attendance}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-center font-mono font-bold text-foreground whitespace-nowrap">
                          {rec.loginTime}
                        </td>
                        <td className="px-5 py-3.5 text-center whitespace-nowrap">
                          <span
                            className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                              rec.loginStatus === 'On Time'
                                ? 'bg-emerald-500/10 text-emerald-600'
                                : rec.loginStatus === 'Late'
                                ? 'bg-amber-500/10 text-amber-600 font-extrabold'
                                : rec.loginStatus === 'WFH'
                                ? 'bg-purple-500/10 text-purple-600'
                                : rec.loginStatus === 'Holiday'
                                ? 'bg-sky-500/10 text-sky-600'
                                : 'bg-rose-500/10 text-rose-600'
                            }`}
                          >
                            {rec.loginStatus}
                          </span>
                        </td>
                      </>
                    )}

                    {/* Weekly & Monthly Unified Columns */}
                    {(reportType === 'weekly' || reportType === 'monthly') && (
                      <>
                        <td className="px-5 py-3.5 text-center font-bold text-foreground whitespace-nowrap">
                          {rec.workingDays}
                        </td>
                        <td className="px-5 py-3.5 text-center font-bold text-emerald-600 whitespace-nowrap">
                          {rec.present}
                        </td>
                        <td className="px-5 py-3.5 text-center font-bold text-purple-600 whitespace-nowrap">
                          {rec.wfh}
                        </td>
                        <td className="px-5 py-3.5 text-center font-bold text-amber-600 whitespace-nowrap">
                          {rec.late}
                        </td>
                        {dynamicLeaveTypes.map((lt) => {
                          const count = rec.leaveTypeCounts?.[lt.name] ?? rec.leaveTypeCounts?.[lt.code] ?? rec[lt.name] ?? 0;
                          return (
                            <td key={lt.id || lt.name} className="px-5 py-3.5 text-center font-bold text-sky-600 whitespace-nowrap">
                              {count}
                            </td>
                          );
                        })}
                        <td className="px-5 py-3.5 text-center font-bold text-rose-600 whitespace-nowrap">
                          {rec.unpaidLeave ?? rec.lop ?? 0}
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
          );
        })()}
      </div>
    </div>
  );
}
