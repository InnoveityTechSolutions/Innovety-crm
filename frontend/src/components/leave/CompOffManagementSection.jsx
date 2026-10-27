import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Info,
  Search,
  Check,
  X,
  Award,
  ArrowRight,
  RotateCcw,
  RefreshCw,
  FileText,
  ChevronDown,
  ChevronUp,
  History,
  Download,
  CalendarPlus,
  CalendarCheck,
  Sliders,
  Send,
  Calendar,
  Sparkles
} from 'lucide-react';
import api from '../../services/api';
import UserAvatar from '../common/UserAvatar';
import CompOffCalendarPicker from './CompOffCalendarPicker';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { CRM_MODULE_KEYS } from '../../config/crmModules';

const CompOffManagementSection = ({ userRole, onRefreshParent }) => {
  const { user: currentUser } = useAuth();
  const { canEdit } = usePermissions();
  const canEditLeave = canEdit(CRM_MODULE_KEYS.LEAVE_MANAGEMENT);

  const effectiveRole = userRole || currentUser?.role;
  const isSuperAdmin = effectiveRole === 'SUPER_ADMIN';
  const isAdmin = effectiveRole === 'ADMIN';
  const isTL = effectiveRole === 'TEAM_LEADER';
  const isManagement = isAdmin || isTL || isSuperAdmin;
  const isEmployee = !isManagement;

  // Role permissions
  const canVerify = (isAdmin || isTL) && canEditLeave;
  const canAdminApprove = isAdmin && canEditLeave;

  // Active sub-tab
  const [activeTab, setActiveTab] = useState(isEmployee ? 'history' : 'ledger'); // 'ledger' | 'advance' | 'verify' | 'queue' | 'history'

  // Employee View State
  const [empHistoryFilter, setEmpHistoryFilter] = useState('ALL'); // 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED'
  const [empHistorySearch, setEmpHistorySearch] = useState('');

  const todayStr = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);

  // Toast notifications
  const [toast, setToast] = useState({ type: '', text: '' });
  const showToast = (text, type = 'success') => {
    setToast({ type, text });
    setTimeout(() => setToast({ type: '', text: '' }), 4500);
  };

  // -------------------------------------------------------------
  // TAB 1: LEDGER & AUDIT STATE
  // -------------------------------------------------------------
  const [credits, setCredits] = useState([]);
  const [loadingCredits, setLoadingCredits] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCreditForAudit, setSelectedCreditForAudit] = useState(null);
  const [expandedConsumptionId, setExpandedConsumptionId] = useState(null);

  const fetchCredits = useCallback(async () => {
    try {
      setLoadingCredits(true);
      const params = { limit: 200 };
      if (statusFilter !== 'ALL') {
        params.status = statusFilter;
      }
      const res = await api.get('/comp-off/credits', { params });
      const list = Array.isArray(res.data?.credits) ? res.data.credits : [];
      setCredits(list);
    } catch (err) {
      console.error('Failed to load comp-off credits:', err);
      showToast(err.response?.data?.message || 'Failed to load comp-off ledger.', 'error');
    } finally {
      setLoadingCredits(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  // Filtered credits
  const filteredCredits = useMemo(() => {
    return credits.filter((c) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const userName = c.user?.name?.toLowerCase() || '';
        const empId = c.user?.employeeId?.toLowerCase() || '';
        const reason = c.reason?.toLowerCase() || '';
        const workDate = c.workDate?.toLowerCase() || '';
        if (!userName.includes(q) && !empId.includes(q) && !reason.includes(q) && !workDate.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [credits, searchQuery]);

  // Ledger Summary Metrics
  const ledgerMetrics = useMemo(() => {
    let totalAuthorized = 0;
    let totalAvailable = 0;
    let totalPending = 0;
    let totalConsumed = 0;
    let totalExpired = 0;
    const now = new Date();

    credits.forEach((c) => {
      const days = Number(c.creditDays) || 0;
      const rem = Number(c.remainingDays) || 0;
      const isExp = c.status === 'EXPIRED' || (c.status === 'APPROVED' && rem > 0 && new Date(c.expiresAt) <= now);

      if (c.status === 'APPROVED') {
        totalAuthorized += days;
        if (!isExp) {
          totalAvailable += rem;
        }
        totalConsumed += (days - rem);
      } else if (c.status === 'PENDING_ADMIN_APPROVAL') {
        totalPending += days;
      }
      if (isExp) {
        totalExpired += rem;
      }
    });

    return { totalAuthorized, totalAvailable, totalPending, totalConsumed, totalExpired };
  }, [credits]);

  // Export Ledger to CSV
  const handleExportCSV = useCallback(() => {
    if (!filteredCredits || filteredCredits.length === 0) return;
    const headers = [
      'Employee Name',
      'Employee ID',
      'Work Date',
      'Credit Days',
      'Used Days',
      'Available Days',
      'Status',
      'Earned Date',
      'Expires At',
      'Verifier / Approver',
      'Remarks'
    ];
    const rows = filteredCredits.map((c) => {
      const empName = c.user?.name || '';
      const empId = c.user?.employeeId || '';
      const wDate = c.workDate ? new Date(c.workDate).toISOString().split('T')[0] : '';
      const cDays = c.creditDays ?? 1.0;
      const uDays = c.usedDays ?? 0.0;
      const aDays = c.availableDays ?? (c.remainingDays ?? 0.0);
      const stat = c.status || 'APPROVED';
      const eDate = c.earnedAt ? new Date(c.earnedAt).toISOString().split('T')[0] : '';
      const expDate = c.expiresAt ? new Date(c.expiresAt).toISOString().split('T')[0] : '';
      const approver = c.adminApprover?.name || c.tlApprover?.name || c.claimedByRole || 'System';
      const rem = c.reason || c.adminRemarks || c.tlRemarks || '';
      return [
        `"${empName.replace(/"/g, '""')}"`,
        `"${empId.replace(/"/g, '""')}"`,
        wDate,
        cDays,
        uDays,
        aDays,
        stat,
        eDate,
        expDate,
        `"${approver.replace(/"/g, '""')}"`,
        `"${rem.replace(/"/g, '""')}"`
      ];
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `compoff_ledger_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [filteredCredits]);

  // -------------------------------------------------------------
  // TAB 2: VERIFICATION & AUTHORIZATION FORM STATE
  // -------------------------------------------------------------
  const [eligibleUsers, setEligibleUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [workDate, setWorkDate] = useState('');
  const [creditDays, setCreditDays] = useState(1.0);
  const [remarks, setRemarks] = useState('');
  const [submittingAuth, setSubmittingAuth] = useState(false);

  // Diagnostic Evidence State
  const [checkingEvidence, setCheckingEvidence] = useState(false);
  const [evidenceData, setEvidenceData] = useState(null);
  const [evidenceError, setEvidenceError] = useState(null);

  // -------------------------------------------------------------
  // POLICY & WINDOW BOUNDS STATE
  // -------------------------------------------------------------
  const [compOffPolicy, setCompOffPolicy] = useState({
    claimWindowEnabled: true,
    claimWindowDays: 30,
    validityDays: 90
  });

  const fetchPolicy = useCallback(async () => {
    try {
      const res = await api.get('/comp-off/policy');
      if (res.data?.policy) {
        setCompOffPolicy(res.data.policy);
      }
    } catch (err) {
      console.warn('Failed to fetch comp-off policy:', err);
    }
  }, []);

  useEffect(() => {
    fetchPolicy();
  }, [fetchPolicy]);

  const handleTogglePolicyRule = async () => {
    if (!isAdmin && !isSuperAdmin) return;
    try {
      const newVal = !compOffPolicy.claimWindowEnabled;
      const res = await api.put('/comp-off/policy', {
        claimWindowEnabled: newVal,
        claimWindowDays: compOffPolicy.claimWindowDays || 30
      });
      setCompOffPolicy(res.data.policy);
      showToast(`Retrospective 30-day claim rule ${newVal ? 'ENABLED' : 'DISABLED'}!`, 'success');
    } catch (err) {
      console.error('Failed to update policy setting:', err);
      showToast(err.response?.data?.message || 'Failed to update policy setting.', 'error');
    }
  };

  // -------------------------------------------------------------
  // TAB 2: ADVANCE PERMISSION WORKFLOW STATE
  // -------------------------------------------------------------
  const [permissionRequests, setPermissionRequests] = useState([]);
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const [permStatusFilter, setPermStatusFilter] = useState('ALL');
  const [permSearchQuery, setPermSearchQuery] = useState('');

  // Apply Modal State (Employee)
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [eligibleDates, setEligibleDates] = useState([]);
  const [loadingEligibleDates, setLoadingEligibleDates] = useState(false);
  const [selectedAdvDate, setSelectedAdvDate] = useState('');
  const [advReason, setAdvReason] = useState('');
  const [submittingAdvRequest, setSubmittingAdvRequest] = useState(false);

  // Review Modal State (Admin)
  const [reviewPermModal, setReviewPermModal] = useState(null);
  const [reviewPermAction, setReviewPermAction] = useState('APPROVE'); // 'APPROVE' | 'REJECT'
  const [reviewPermRemarks, setReviewPermRemarks] = useState('');
  const [submittingPermReview, setSubmittingPermReview] = useState(false);

  const fetchPermissionRequests = useCallback(async () => {
    try {
      setLoadingPermissions(true);
      const params = { limit: 200 };
      if (permStatusFilter !== 'ALL') {
        params.status = permStatusFilter;
      }
      const res = await api.get('/comp-off/permission-requests', { params });
      setPermissionRequests(res.data?.requests || []);
    } catch (err) {
      console.error('Failed to load advance permission requests:', err);
      showToast(err.response?.data?.message || 'Failed to load advance permission requests.', 'error');
    } finally {
      setLoadingPermissions(false);
    }
  }, [permStatusFilter]);

  useEffect(() => {
    if (activeTab === 'advance' || isEmployee) {
      fetchPermissionRequests();
    }
  }, [activeTab, isEmployee, fetchPermissionRequests]);

  // -------------------------------------------------------------
  // TAB 3: COMP-OFF WORKING SESSIONS STATE (Phase 2 & 3)
  // -------------------------------------------------------------
  const [compOffSessions, setCompOffSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionStatusFilter, setSessionStatusFilter] = useState('ALL');
  const [sessionApprovalFilter, setSessionApprovalFilter] = useState('ALL');
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');

  // Review Modal State for Off-Day Sessions (Phase 3 Admin Verification)
  const [reviewSessionModal, setReviewSessionModal] = useState(null);
  const [reviewSessionAction, setReviewSessionAction] = useState('APPROVE'); // 'APPROVE' | 'REJECT'
  const [reviewSessionRemarks, setReviewSessionRemarks] = useState('');
  const [submittingSessionReview, setSubmittingSessionReview] = useState(false);

  const fetchCompOffSessions = useCallback(async () => {
    try {
      setLoadingSessions(true);
      const params = { limit: 200 };
      if (sessionStatusFilter !== 'ALL') {
        params.status = sessionStatusFilter;
      }
      if (sessionApprovalFilter !== 'ALL') {
        params.approvalStatus = sessionApprovalFilter;
      }
      const res = await api.get('/comp-off/sessions', { params });
      setCompOffSessions(res.data?.sessions || []);
    } catch (err) {
      console.error('Failed to load comp-off sessions:', err);
    } finally {
      setLoadingSessions(false);
    }
  }, [sessionStatusFilter, sessionApprovalFilter]);

  useEffect(() => {
    if (activeTab === 'sessions' || isEmployee) {
      fetchCompOffSessions();
    }
  }, [activeTab, isEmployee, fetchCompOffSessions]);

  const handleOpenReviewSessionModal = (session, action) => {
    setReviewSessionModal(session);
    setReviewSessionAction(action);
    setReviewSessionRemarks(action === 'APPROVE' ? 'Approved upon administrative verification.' : '');
  };

  const handleConfirmSessionReview = async () => {
    if (!reviewSessionModal) return;
    if (isSuperAdmin) {
      alert('Super Admin is strictly read-only.');
      return;
    }
    if (reviewSessionAction === 'REJECT' && (!reviewSessionRemarks.trim() || reviewSessionRemarks.trim().length < 4)) {
      showToast('Rejection reason is mandatory (at least 4 characters).', 'error');
      return;
    }

    try {
      setSubmittingSessionReview(true);
      if (reviewSessionAction === 'APPROVE') {
        const res = await api.post(`/comp-off/sessions/${reviewSessionModal.id}/approve`, {
          remarks: reviewSessionRemarks.trim() || 'Approved by Admin'
        });
        const granted = res.data?.credit?.creditDays || reviewSessionModal.calculatedCredit || 1.0;
        showToast(`Comp-Off session approved! Granted ${granted} day(s) credit.`, 'success');
      } else {
        await api.post(`/comp-off/sessions/${reviewSessionModal.id}/reject`, {
          rejectionReason: reviewSessionRemarks.trim(),
          adminRemarks: reviewSessionRemarks.trim()
        });
        showToast('Comp-Off session rejected.', 'success');
      }

      setReviewSessionModal(null);
      setReviewSessionRemarks('');
      fetchCompOffSessions();
      fetchCredits();
      if (onRefreshParent) onRefreshParent();
    } catch (err) {
      console.error('Session review error:', err);
      showToast(err.response?.data?.message || 'Failed to process session verification action.', 'error');
    } finally {
      setSubmittingSessionReview(false);
    }
  };

  const filteredCompOffSessions = useMemo(() => {
    return compOffSessions.filter((s) => {
      if (sessionSearchQuery.trim()) {
        const q = sessionSearchQuery.toLowerCase();
        const userName = s.user?.name?.toLowerCase() || '';
        const empId = s.user?.employeeId?.toLowerCase() || '';
        const locReason = s.locationReason?.toLowerCase() || '';
        const dateStr = s.workDate?.toLowerCase() || '';
        if (!userName.includes(q) && !empId.includes(q) && !locReason.includes(q) && !dateStr.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [compOffSessions, sessionSearchQuery]);

  const handleOpenApplyModal = async () => {
    setApplyModalOpen(true);
    setSelectedAdvDate('');
    setAdvReason('');
    try {
      setLoadingEligibleDates(true);
      const res = await api.get('/comp-off/eligible-future-dates', { params: { days: 60 } });
      setEligibleDates(res.data?.dates || []);
    } catch (err) {
      console.error('Failed to fetch eligible future dates:', err);
    } finally {
      setLoadingEligibleDates(false);
    }
  };

  const handleSubmitAdvanceRequest = async (e) => {
    e.preventDefault();
    if (!selectedAdvDate) {
      showToast('Please select an eligible future company holiday or weekly off.', 'error');
      return;
    }
    if (!advReason.trim() || advReason.trim().length < 5) {
      showToast('Please provide a detailed reason (at least 5 characters).', 'error');
      return;
    }

    try {
      setSubmittingAdvRequest(true);
      await api.post('/comp-off/permission-requests', {
        workDate: selectedAdvDate,
        reason: advReason.trim()
      });

      showToast('Advance permission request submitted! Awaiting Admin approval.', 'success');
      setApplyModalOpen(false);
      setSelectedAdvDate('');
      setAdvReason('');
      fetchPermissionRequests();
      if (isEmployee) {
        fetchCompOffSessions();
        fetchCredits();
      }
    } catch (err) {
      console.error('Submit advance request error:', err);
      showToast(err.response?.data?.message || 'Failed to submit advance permission request.', 'error');
    } finally {
      setSubmittingAdvRequest(false);
    }
  };

  const handleOpenReviewPermModal = (request, action) => {
    setReviewPermModal(request);
    setReviewPermAction(action);
    setReviewPermRemarks(action === 'APPROVE' ? 'Approved upon administrative verification.' : '');
  };

  const handleConfirmPermReview = async () => {
    if (!reviewPermModal) return;
    if (isSuperAdmin) {
      alert('Super Admin is strictly read-only.');
      return;
    }
    if (reviewPermAction === 'REJECT' && (!reviewPermRemarks.trim() || reviewPermRemarks.trim().length < 4)) {
      showToast('Rejection reason is mandatory (at least 4 characters).', 'error');
      return;
    }

    try {
      setSubmittingPermReview(true);
      if (reviewPermAction === 'APPROVE') {
        await api.put(`/comp-off/permission-requests/${reviewPermModal.id}/approve`, {
          remarks: reviewPermRemarks.trim() || 'Approved by Admin'
        });
        showToast('Advance permission approved! Permission to work granted (no credits created yet).', 'success');
      } else {
        await api.put(`/comp-off/permission-requests/${reviewPermModal.id}/reject`, {
          rejectionReason: reviewPermRemarks.trim()
        });
        showToast('Advance permission request rejected.', 'success');
      }

      setReviewPermModal(null);
      setReviewPermRemarks('');
      fetchPermissionRequests();
    } catch (err) {
      console.error('Review advance request error:', err);
      showToast(err.response?.data?.message || 'Failed to process advance permission review.', 'error');
    } finally {
      setSubmittingPermReview(false);
    }
  };

  const filteredPermissionRequests = useMemo(() => {
    return permissionRequests.filter((r) => {
      if (permSearchQuery.trim()) {
        const q = permSearchQuery.toLowerCase();
        const userName = r.user?.name?.toLowerCase() || '';
        const empId = r.user?.employeeId?.toLowerCase() || '';
        const reason = r.reason?.toLowerCase() || '';
        const dateStr = r.workDate?.toLowerCase() || '';
        if (!userName.includes(q) && !empId.includes(q) && !reason.includes(q) && !dateStr.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [permissionRequests, permSearchQuery]);

  const permMetrics = useMemo(() => {
    const total = permissionRequests.length;
    const pending = permissionRequests.filter((r) => r.status === 'PENDING').length;
    const approved = permissionRequests.filter((r) => r.status === 'APPROVED').length;
    const rejected = permissionRequests.filter((r) => r.status === 'REJECTED').length;
    return { total, pending, approved, rejected };
  }, [permissionRequests]);

  // Retrospective Claim Window Bounds
  const dateBounds = useMemo(() => {
    const today = new Date();
    const formatYMD = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    let minStr = '';
    if (compOffPolicy.claimWindowEnabled) {
      const minD = new Date();
      minD.setDate(today.getDate() - (compOffPolicy.claimWindowDays || 30));
      minStr = formatYMD(minD);
    }

    return {
      min: minStr,
      max: formatYMD(today)
    };
  }, [compOffPolicy]);

  // Fetch eligible users scoped to permissions
  useEffect(() => {
    if (!canVerify && !isSuperAdmin) return;

    const fetchUsers = async () => {
      try {
        setLoadingUsers(true);
        if (isTL) {
          // Team leader: get team members
          const [teamsRes, usersRes] = await Promise.all([
            api.get('/teams').catch(() => ({ data: [] })),
            api.get('/users', { params: { limit: 1000, status: 'ACTIVE' } }).catch(() => ({ data: { users: [] } }))
          ]);

          const teams = Array.isArray(teamsRes.data) ? teamsRes.data : [];
          const userTeam = teams.find((t) => t.leaderId === currentUser?.id || t.members?.some((m) => m.id === currentUser?.id));
          const allUsers = usersRes.data?.users || usersRes.data || [];

          let members = [];
          if (userTeam && Array.isArray(userTeam.members)) {
            members = userTeam.members.map((m) => m.user || m);
          } else {
            members = Array.isArray(allUsers)
              ? allUsers.filter((u) => u.department === currentUser?.department && u.id !== currentUser?.id)
              : [];
          }

          // Filter out self and peer team leaders
          const selectable = members.filter((m) => m.id !== currentUser?.id && m.role !== 'TEAM_LEADER' && m.role !== 'ADMIN');
          setEligibleUsers(selectable);
        } else {
          // Admin / Super Admin: all active employees
          const res = await api.get('/users', { params: { limit: 1000, status: 'ACTIVE' } });
          const all = Array.isArray(res.data?.users) ? res.data.users : Array.isArray(res.data) ? res.data : [];
          const selectable = all.filter((u) => u.role === 'EMPLOYEE' || u.role === 'INTERN' || (isAdmin && u.role === 'TEAM_LEADER'));
          setEligibleUsers(selectable);
        }
      } catch (err) {
        console.warn('Failed to load eligible users for comp-off verification:', err);
      } finally {
        setLoadingUsers(false);
      }
    };

    fetchUsers();
  }, [canVerify, isSuperAdmin, isTL, isAdmin, currentUser]);

  // Live Evidence Diagnostic Hook
  useEffect(() => {
    if (!selectedUserId || !workDate) {
      setEvidenceData(null);
      setEvidenceError(null);
      return;
    }

    const checkEvidence = async () => {
      try {
        setCheckingEvidence(true);
        setEvidenceError(null);
        const res = await api.get('/comp-off/evidence', {
          params: { userId: selectedUserId, workDate }
        });
        const raw = res.data;
        const attendance = raw.attendanceEvidence?.details || raw.attendance;
        const reasonText = raw.workdayEligibility?.error || raw.claimWindow?.error || raw.attendanceEvidence?.missingReason || raw.attendanceEvidence?.validationError || raw.reason || (raw.canAuthorize ? 'Eligible for Compensatory Off' : 'Ineligible for Compensatory Off');
        const isEligible = Boolean(raw.canAuthorize ?? raw.eligible ?? raw.workdayEligibility?.isEligible);
        const dayType = raw.workdayEligibility?.reason === 'COMPANY_HOLIDAY' || raw.dayType === 'COMPANY_HOLIDAY' ? 'COMPANY_HOLIDAY' : 'WEEKLY_OFF';

        const normalized = {
          ...raw,
          canAuthorize: Boolean(raw.canAuthorize),
          eligible: isEligible,
          reason: reasonText,
          dayType,
          attendance
        };
        setEvidenceData(normalized);

        // Auto-suggest credit amount based on working hours if eligible
        if (normalized.canAuthorize && attendance) {
          const hrs = Number(attendance.workingHours) || 0;
          if (hrs >= 8) {
            setCreditDays(1.0);
          } else if (hrs >= 4) {
            setCreditDays(0.5);
          }
        }
      } catch (err) {
        console.error('Evidence check error:', err);
        setEvidenceError(err.response?.data?.message || 'Failed to inspect attendance evidence.');
        setEvidenceData(null);
      } finally {
        setCheckingEvidence(false);
      }
    };

    const debounceTimer = setTimeout(checkEvidence, 250);
    return () => clearTimeout(debounceTimer);
  }, [selectedUserId, workDate]);

  // Handle Verification / Authorization Submission
  const handleAuthorizeSubmit = async (e) => {
    e.preventDefault();
    if (isSuperAdmin) {
      alert('Super Admin is strictly read-only.');
      return;
    }
    if (!selectedUserId) {
      showToast('Please select an employee.', 'error');
      return;
    }
    if (!workDate) {
      showToast('Please select a valid work date.', 'error');
      return;
    }
    if (!evidenceData?.canAuthorize) {
      showToast(evidenceData?.reason || 'Cannot authorize credit: attendance or date requirements not met.', 'error');
      return;
    }
    if (!remarks.trim() || remarks.trim().length < 5) {
      showToast('Please provide a verification remark (at least 5 characters).', 'error');
      return;
    }

    try {
      setSubmittingAuth(true);
      const res = await api.post('/comp-off/authorize', {
        userId: selectedUserId,
        workDate,
        creditDays: Number(creditDays),
        reason: evidenceData?.dayType === 'COMPANY_HOLIDAY' ? 'COMPANY_HOLIDAY' : 'WEEKLY_OFF',
        remarks: remarks.trim()
      });

      const creditObj = res.data?.credit || res.data;
      const isPending = creditObj?.status === 'PENDING_ADMIN_APPROVAL';
      const msg = isPending
        ? 'Verification submitted successfully! Routed to Admin Approval Queue.'
        : `Comp-Off credit (${creditDays} day(s)) successfully authorized and credited!`;

      showToast(msg, 'success');

      // Reset form
      setWorkDate('');
      setRemarks('');
      setEvidenceData(null);

      // Refresh ledger & parent metrics
      fetchCredits();
      if (onRefreshParent) onRefreshParent();
    } catch (err) {
      console.error('Authorization submission failed:', err);
      showToast(err.response?.data?.message || 'Failed to authorize comp-off credit.', 'error');
    } finally {
      setSubmittingAuth(false);
    }
  };

  // -------------------------------------------------------------
  // TAB 3: ADMIN APPROVAL QUEUE STATE
  // -------------------------------------------------------------
  const pendingQueue = useMemo(() => {
    return credits.filter((c) => c.status === 'PENDING_ADMIN_APPROVAL');
  }, [credits]);

  const [reviewModalCredit, setReviewModalCredit] = useState(null);
  const [reviewAction, setReviewAction] = useState('APPROVE'); // 'APPROVE' | 'REJECT'
  const [reviewRemarks, setReviewRemarks] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  const handleOpenReviewModal = (credit, action) => {
    setReviewModalCredit(credit);
    setReviewAction(action);
    setReviewRemarks(action === 'APPROVE' ? 'Approved upon administrative verification.' : '');
  };

  const handleConfirmReview = async () => {
    if (!reviewModalCredit) return;
    if (isSuperAdmin) {
      alert('Super Admin is strictly read-only.');
      return;
    }
    if (reviewAction === 'REJECT' && (!reviewRemarks.trim() || reviewRemarks.trim().length < 4)) {
      showToast('Rejection remarks are mandatory (at least 4 characters).', 'error');
      return;
    }

    try {
      setSubmittingReview(true);
      if (reviewAction === 'APPROVE') {
        await api.put(`/comp-off/credits/${reviewModalCredit.id}/admin-approve`, {
          remarks: reviewRemarks.trim() || 'Approved by Admin'
        });
        showToast('Comp-Off credit sanctioned & approved successfully.', 'success');
      } else {
        await api.put(`/comp-off/credits/${reviewModalCredit.id}/reject`, {
          remarks: reviewRemarks.trim()
        });
        showToast('Comp-Off claim rejected.', 'success');
      }

      setReviewModalCredit(null);
      setReviewRemarks('');
      fetchCredits();
      if (onRefreshParent) onRefreshParent();
    } catch (err) {
      console.error('Admin review error:', err);
      showToast(err.response?.data?.message || 'Failed to process admin review action.', 'error');
    } finally {
      setSubmittingReview(false);
    }
  };

  // -------------------------------------------------------------
  // Helper Formatters
  // -------------------------------------------------------------
  const formatDateDisplay = (dateVal) => {
    if (!dateVal) return '—';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const getStatusBadge = (status, remainingDays, expiresAt) => {
    const isExpired = status === 'APPROVED' && Number(remainingDays) > 0 && new Date(expiresAt) <= new Date();

    if (isExpired || status === 'EXPIRED') {
      return (
        <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-500 border border-rose-500/20">
          Expired
        </span>
      );
    }
    if (status === 'APPROVED') {
      if (Number(remainingDays) === 0) {
        return (
          <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-slate-500/10 text-slate-500 border border-slate-500/20">
            Exhausted
          </span>
        );
      }
      return (
        <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          <span>Active</span>
        </span>
      );
    }
    if (status === 'PENDING_ADMIN_APPROVAL') {
      return (
        <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
          <Clock className="h-3 w-3" />
          <span>Pending Admin</span>
        </span>
      );
    }
    if (status === 'REJECTED') {
      return (
        <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 flex items-center gap-1">
          <XCircle className="h-3 w-3" />
          <span>Rejected</span>
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-muted text-muted-foreground border border-border/60">
        {status}
      </span>
    );
  };

  const getDayNameDisplay = (dateVal) => {
    if (!dateVal) return '';
    if (typeof dateVal === 'string' && dateVal.includes('-')) {
      const parts = dateVal.slice(0, 10).split('-').map(Number);
      if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        const d = new Date(parts[0], parts[1] - 1, parts[2]);
        return d.toLocaleDateString('en-US', { weekday: 'short' });
      }
    }
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  };

  // -------------------------------------------------------------
  // EMPLOYEE COMP-OFF HISTORY COMPILATION
  // -------------------------------------------------------------
  const employeeHistoryItems = useMemo(() => {
    if (!isEmployee) return [];

    // Map sessions by permissionRequestId or by workDate string (YYYY-MM-DD)
    const sessionByReqId = new Map();
    const sessionByDate = new Map();
    (compOffSessions || []).forEach((sess) => {
      if (sess.permissionRequestId) sessionByReqId.set(sess.permissionRequestId, sess);
      if (sess.workDate) {
        const dStr = typeof sess.workDate === 'string' ? sess.workDate.slice(0, 10) : new Date(sess.workDate).toISOString().slice(0, 10);
        sessionByDate.set(dStr, sess);
      }
    });

    // Map credits by sessionId or by workDate string (YYYY-MM-DD)
    const creditBySessionId = new Map();
    const creditByDate = new Map();
    (credits || []).forEach((c) => {
      if (c.sessionId) creditBySessionId.set(c.sessionId, c);
      if (c.workDate) {
        const dStr = typeof c.workDate === 'string' ? c.workDate.slice(0, 10) : new Date(c.workDate).toISOString().slice(0, 10);
        creditByDate.set(dStr, c);
      }
    });

    // Process each permission request
    const items = (permissionRequests || []).map((req) => {
      const dStr = typeof req.workDate === 'string' ? req.workDate.slice(0, 10) : new Date(req.workDate).toISOString().slice(0, 10);
      const session = sessionByReqId.get(req.id) || sessionByDate.get(dStr);
      const credit = session ? creditBySessionId.get(session.id) : creditByDate.get(dStr);

      return {
        id: req.id,
        workDate: req.workDate,
        dateStr: dStr,
        dayName: getDayNameDisplay(req.workDate),
        holidayType: req.holidayType,
        reason: req.reason,
        requestStatus: req.status, // 'PENDING' | 'APPROVED' | 'REJECTED'
        adminRemarks: req.adminRemarks,
        rejectionReason: req.rejectionReason,
        createdAt: req.createdAt,
        // Session details
        session: session || null,
        durationHours: session?.durationHours !== undefined && session?.durationHours !== null ? parseFloat(session.durationHours) : null,
        sessionStatus: session?.status || null, // 'ACTIVE' | 'COMPLETED'
        sessionApprovalStatus: session?.approvalStatus || null, // 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'
        // Credit details
        credit: credit || null,
        creditStatus: credit?.status || null, // 'APPROVED' | 'EXHAUSTED' | 'EXPIRED'
        creditDays: credit?.creditDays || null
      };
    });

    // Include any sessions without a matching permission request
    const seenDates = new Set(items.map((i) => i.dateStr));
    (compOffSessions || []).forEach((sess) => {
      const dStr = typeof sess.workDate === 'string' ? sess.workDate.slice(0, 10) : new Date(sess.workDate).toISOString().slice(0, 10);
      if (!seenDates.has(dStr)) {
        seenDates.add(dStr);
        const credit = creditBySessionId.get(sess.id) || creditByDate.get(dStr);

        items.push({
          id: `sess-${sess.id}`,
          workDate: sess.workDate,
          dateStr: dStr,
          dayName: getDayNameDisplay(sess.workDate),
          holidayType: 'OFF_DAY',
          reason: sess.locationReason || 'Off-Day Working Session',
          requestStatus: 'APPROVED',
          adminRemarks: sess.adminRemarks,
          rejectionReason: sess.rejectionReason,
          createdAt: sess.loginTime || sess.createdAt,
          session: sess,
          durationHours: sess.durationHours !== undefined && sess.durationHours !== null ? parseFloat(sess.durationHours) : null,
          sessionStatus: sess.status,
          sessionApprovalStatus: sess.approvalStatus,
          credit: credit || null,
          creditStatus: credit?.status || null,
          creditDays: credit?.creditDays || null
        });
      }
    });

    // Include any credits without a matching request or session
    (credits || []).forEach((c) => {
      const dStr = typeof c.workDate === 'string' ? c.workDate.slice(0, 10) : new Date(c.workDate).toISOString().slice(0, 10);
      if (!seenDates.has(dStr)) {
        seenDates.add(dStr);

        items.push({
          id: `cred-${c.id}`,
          workDate: c.workDate,
          dateStr: dStr,
          dayName: getDayNameDisplay(c.workDate),
          holidayType: 'OFF_DAY',
          reason: c.reason || 'Comp-Off Credit',
          requestStatus: 'APPROVED',
          adminRemarks: c.adminRemarks || c.reason,
          rejectionReason: null,
          createdAt: c.earnedAt || c.createdAt,
          session: null,
          durationHours: null,
          sessionStatus: 'COMPLETED',
          sessionApprovalStatus: 'APPROVED',
          credit: c,
          creditStatus: c.status,
          creditDays: c.creditDays
        });
      }
    });

    // Sort by workDate descending (most recent first)
    items.sort((a, b) => new Date(b.workDate) - new Date(a.workDate));

    return items;
  }, [isEmployee, permissionRequests, compOffSessions, credits]);

  const filteredEmployeeHistory = useMemo(() => {
    return employeeHistoryItems.filter((item) => {
      if (empHistoryFilter !== 'ALL') {
        if (empHistoryFilter === 'PENDING' && item.requestStatus !== 'PENDING') return false;
        if (empHistoryFilter === 'APPROVED' && item.requestStatus !== 'APPROVED') return false;
        if (empHistoryFilter === 'REJECTED' && item.requestStatus !== 'REJECTED') return false;
        if (empHistoryFilter === 'COMPLETED' && item.sessionStatus !== 'COMPLETED' && !item.credit) return false;
      }
      if (empHistorySearch.trim()) {
        const q = empHistorySearch.toLowerCase();
        const dateMatch = (item.dateStr || '').toLowerCase().includes(q);
        const reasonMatch = (item.reason || '').toLowerCase().includes(q);
        const typeMatch = (item.holidayType || '').toLowerCase().includes(q);
        if (!dateMatch && !reasonMatch && !typeMatch) return false;
      }
      return true;
    });
  }, [employeeHistoryItems, empHistoryFilter, empHistorySearch]);

  return (
    <div className="space-y-6 text-left font-sans w-full">
      {/* Toast Alert */}
      {toast.text && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 fade-in duration-200">
          <div
            className={`p-4 rounded-2xl text-xs font-bold flex items-center gap-2.5 shadow-2xl border backdrop-blur-md ${
              toast.type === 'success'
                ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/40'
                : 'bg-rose-950/90 text-rose-200 border-rose-500/40'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            )}
            <span>{toast.text}</span>
          </div>
        </div>
      )}

      {isEmployee ? (
        /* ========================================================= */
        /* SIMPLIFIED EMPLOYEE VIEW                                  */
        /* ========================================================= */
        <div className="space-y-5">
          {/* Action Header Banner with Apply Button */}
          <div className="p-5 sm:p-6 rounded-3xl bg-card border border-border/70 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="p-3.5 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 shadow-2xs">
                <CalendarCheck className="h-7 w-7" />
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">
                  Compensatory Off (Comp-Off)
                </h2>
                <p className="text-xs sm:text-sm text-muted-foreground font-medium mt-0.5">
                  Request advance permission to work on company holidays or weekly offs, and track your Comp-Off history.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleOpenApplyModal}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl bg-primary hover:bg-primary-hover active:scale-95 text-white text-xs font-black shadow-md cursor-pointer transition-all shrink-0"
            >
              <CalendarPlus className="h-4 w-4" />
              <span>Apply for Comp-Off</span>
            </button>
          </div>

          {/* Comp-Off History Section */}
          <div className="p-5 sm:p-6 rounded-3xl bg-card border border-border/70 shadow-2xs space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-border/40 pb-4">
              <div>
                <h3 className="text-base font-black text-foreground flex items-center gap-2">
                  <History className="h-4 w-4 text-indigo-500" />
                  <span>Comp-Off History</span>
                </h3>
                <p className="text-xs text-muted-foreground font-medium">
                  Your advance permission requests, off-day work authorization, recorded hours, and credit status.
                </p>
              </div>

              {/* Filters & Search */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'].map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setEmpHistoryFilter(st)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        empHistoryFilter === st
                          ? 'bg-primary text-white shadow-xs'
                          : 'bg-muted/30 hover:bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {st === 'ALL'
                        ? 'All History'
                        : st === 'PENDING'
                        ? 'Pending'
                        : st === 'APPROVED'
                        ? 'Approved'
                        : st === 'REJECTED'
                        ? 'Rejected'
                        : 'Completed Work'}
                    </button>
                  ))}
                </div>

                <div className="relative min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search history..."
                    value={empHistorySearch}
                    onChange={(e) => setEmpHistorySearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>
            </div>

            {loadingPermissions || loadingSessions ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                <p className="font-semibold">Loading your Comp-Off history...</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border/40 text-[11px] font-extrabold text-muted-foreground uppercase tracking-wider">
                      <th className="pb-3 pl-2">Work Date</th>
                      <th className="pb-3">Off-Day Type</th>
                      <th className="pb-3">Request Reason</th>
                      <th className="pb-3">Approval Status</th>
                      <th className="pb-3">Actual Work Duration</th>
                      <th className="pb-3">Credit Status</th>
                      <th className="pb-3 pr-2">Decision / Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {filteredEmployeeHistory.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-xs text-muted-foreground">
                          <div className="flex flex-col items-center justify-center space-y-3">
                            <CalendarCheck className="h-10 w-10 text-muted-foreground/30" />
                            <div>
                              <p className="font-bold text-foreground text-sm">No Comp-Off requests found.</p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                Click "Apply for Comp-Off" above to request permission to work on an upcoming company holiday or weekly off.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={handleOpenApplyModal}
                              className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-black shadow-xs cursor-pointer inline-flex items-center gap-1.5 transition-all"
                            >
                              <CalendarPlus className="h-3.5 w-3.5" />
                              <span>Apply for Comp-Off</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredEmployeeHistory.map((item) => (
                        <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3.5 pl-2 font-mono font-bold text-foreground">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                            <span>{formatDateDisplay(item.workDate)}</span>
                            {item.dayName && (
                              <span className="text-[10px] text-muted-foreground font-sans font-medium">({item.dayName})</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5">
                          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                            item.holidayType === 'COMPANY_HOLIDAY'
                              ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20'
                              : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20'
                          }`}>
                            {item.holidayType === 'COMPANY_HOLIDAY' ? 'Company Holiday' : 'Weekly Off'}
                          </span>
                        </td>
                        <td className="py-3.5 max-w-xs">
                          <p className="text-xs text-foreground font-medium truncate" title={item.reason}>
                            {item.reason}
                          </p>
                        </td>
                        <td className="py-3.5">
                          {item.requestStatus === 'PENDING' && (
                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1 w-fit">
                              <Clock className="h-3 w-3" />
                              <span>Pending Review</span>
                            </span>
                          )}
                          {item.requestStatus === 'APPROVED' && (
                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1 w-fit">
                              <CheckCircle2 className="h-3 w-3" />
                              <span>Work Authorized</span>
                            </span>
                          )}
                          {item.requestStatus === 'REJECTED' && (
                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 flex items-center gap-1 w-fit">
                              <XCircle className="h-3 w-3" />
                              <span>Rejected</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3.5">
                          {item.durationHours !== null && item.durationHours !== undefined ? (
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-foreground">{item.durationHours} hrs</span>
                              <span className="text-[10px] text-muted-foreground font-medium">({item.sessionStatus === 'COMPLETED' ? 'Completed' : 'Active'})</span>
                            </div>
                          ) : item.sessionStatus === 'ACTIVE' ? (
                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 animate-pulse">
                              In Progress
                            </span>
                          ) : item.requestStatus === 'APPROVED' ? (
                            <span className="text-[11px] text-muted-foreground font-medium">
                              {item.dateStr > todayStr ? 'Upcoming' : item.dateStr === todayStr ? 'Ready to Work' : 'Not Clocked In'}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50 font-mono">—</span>
                          )}
                        </td>
                        <td className="py-3.5">
                          {item.credit ? (
                            <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1 w-fit ${
                              item.creditStatus === 'APPROVED'
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20'
                                : item.creditStatus === 'EXHAUSTED'
                                ? 'bg-muted/60 text-muted-foreground border border-border/60'
                                : 'bg-rose-500/10 text-rose-600 border border-rose-500/20'
                            }`}>
                              <Award className="h-3 w-3" />
                              <span>
                                {item.creditStatus === 'APPROVED'
                                  ? `${item.creditDays || 1.0} Day Credited`
                                  : item.creditStatus === 'EXHAUSTED'
                                  ? `Used (${item.creditDays}d)`
                                  : 'Expired'}
                              </span>
                            </span>
                          ) : item.sessionStatus === 'COMPLETED' ? (
                            item.sessionApprovalStatus === 'PENDING_REVIEW' ? (
                              <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase bg-amber-500/10 text-amber-600 border border-amber-500/20">
                                Pending Verification
                              </span>
                            ) : item.sessionApprovalStatus === 'REJECTED' ? (
                              <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase bg-rose-500/10 text-rose-600 border border-rose-500/20">
                                Not Granted
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">In Review</span>
                            )
                          ) : (
                            <span className="text-muted-foreground/50 font-mono">—</span>
                          )}
                        </td>
                        <td className="py-3.5 pr-2 max-w-xs">
                          {item.requestStatus === 'REJECTED' ? (
                            <p className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold truncate" title={item.rejectionReason}>
                              {item.rejectionReason}
                            </p>
                          ) : item.requestStatus === 'APPROVED' ? (
                            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium truncate" title={item.adminRemarks || 'Work Authorized'}>
                              {item.adminRemarks || 'Work Authorized'}
                            </p>
                          ) : (
                            <span className="text-[11px] text-muted-foreground italic">Awaiting review</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ========================================================= */
        /* ADMINISTRATIVE MANAGEMENT VIEW (Admin, TL, Super Admin)    */
        /* ========================================================= */
        <>
          {/* Header Banner */}
          <div className="p-5 sm:p-6 rounded-3xl bg-card border border-border/70 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="p-3.5 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 shadow-2xs">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">
                Compensatory Off (Comp-Off) Hub
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black tracking-wider uppercase bg-primary/10 text-primary border border-primary/20">
                Phase 4 Verified
              </span>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground font-medium mt-0.5">
              Manage earned credits, attendance verification, admin sanctioning, and audit ledgers.
            </p>
          </div>
        </div>

        {/* Tab Switcher Pills */}
        <div className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-muted/30 border border-border/50 self-start md:self-auto overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveTab('ledger')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'ledger'
                ? 'bg-card text-foreground shadow-sm border border-border/60'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            <span>Credit Ledger & Audit</span>
            <span className="px-1.5 py-0.2 rounded-md bg-muted text-[10px] font-mono">
              {filteredCredits.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('advance')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'advance'
                ? 'bg-card text-foreground shadow-sm border border-border/60'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <CalendarCheck className="h-3.5 w-3.5" />
            <span>Advance Permissions</span>
            {permMetrics.pending > 0 && (isAdmin || isTL) ? (
              <span className="px-1.5 py-0.2 rounded-md bg-amber-500/20 text-amber-600 dark:text-amber-400 font-mono text-[10px] animate-pulse">
                {permMetrics.pending}
              </span>
            ) : (
              <span className="px-1.5 py-0.2 rounded-md bg-muted text-[10px] font-mono">
                {permissionRequests.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('sessions')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'sessions'
                ? 'bg-card text-foreground shadow-sm border border-border/60'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>Off-Day Sessions</span>
            <span className="px-1.5 py-0.2 rounded-md bg-muted text-[10px] font-mono">
              {compOffSessions.length}
            </span>
          </button>

          {(canVerify || isSuperAdmin) && (
            <button
              onClick={() => setActiveTab('verify')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === 'verify'
                  ? 'bg-card text-foreground shadow-sm border border-border/60'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Award className="h-3.5 w-3.5" />
              <span>Verify & Credit</span>
            </button>
          )}

          {(canAdminApprove || isSuperAdmin) && (
            <button
              onClick={() => setActiveTab('queue')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === 'queue'
                  ? 'bg-card text-foreground shadow-sm border border-border/60'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>Admin Queue</span>
              {pendingQueue.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-md bg-amber-500/20 text-amber-600 dark:text-amber-400 font-mono text-[10px] animate-pulse">
                  {pendingQueue.length}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 sm:p-5 rounded-3xl bg-card border border-border/60 shadow-2xs space-y-1">
          <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block">
            Total Authorized
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black font-mono text-foreground">
              {ledgerMetrics.totalAuthorized}
            </span>
            <span className="text-xs text-muted-foreground font-medium">Days</span>
          </div>
          <span className="text-[10px] text-muted-foreground block">
            Approved holiday & weekly-off work
          </span>
        </div>

        <div className="p-4 sm:p-5 rounded-3xl bg-card border border-border/60 shadow-2xs space-y-1">
          <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block">
            Available Balance
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black font-mono text-emerald-600 dark:text-emerald-400">
              {ledgerMetrics.totalAvailable}
            </span>
            <span className="text-xs text-emerald-600/70 font-medium">Days left</span>
          </div>
          <span className="text-[10px] text-muted-foreground block">
            Ready for employee leave reservation
          </span>
        </div>

        <div className="p-4 sm:p-5 rounded-3xl bg-card border border-border/60 shadow-2xs space-y-1">
          <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block">
            Pending Sanction
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black font-mono text-amber-600 dark:text-amber-400">
              {ledgerMetrics.totalPending}
            </span>
            <span className="text-xs text-amber-600/70 font-medium">In Queue</span>
          </div>
          <span className="text-[10px] text-muted-foreground block">
            TL verified, awaiting admin sign-off
          </span>
        </div>

        <div className="p-4 sm:p-5 rounded-3xl bg-card border border-border/60 shadow-2xs space-y-1">
          <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block">
            Consumed / Expired
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black font-mono text-muted-foreground">
              {ledgerMetrics.totalConsumed}
            </span>
            <span className="text-xs text-muted-foreground font-medium">
              / {ledgerMetrics.totalExpired} Exp
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground block">
            Used in approved leave applications
          </span>
        </div>
      </div>

      {/* ========================================================= */}
      {/* TAB 1: CREDIT LEDGER & AUDIT                              */}
      {/* ========================================================= */}
      {activeTab === 'ledger' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="p-4 rounded-3xl bg-card border border-border/60 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-muted-foreground mr-1">Status:</span>
              {['ALL', 'APPROVED', 'PENDING_ADMIN_APPROVAL', 'REJECTED', 'EXHAUSTED', 'EXPIRED'].map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    statusFilter === s
                      ? 'bg-primary text-primary-foreground shadow-2xs'
                      : 'bg-muted/30 hover:bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {s === 'ALL'
                    ? 'All Records'
                    : s === 'PENDING_ADMIN_APPROVAL'
                    ? 'Pending Queue'
                    : s === 'APPROVED'
                    ? 'Active'
                    : s.charAt(0) + s.slice(1).toLowerCase()}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-full md:w-64">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search user, work date, remarks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-9 bg-muted/20 border border-border/60 rounded-xl pl-9 pr-3 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <button
                onClick={handleExportCSV}
                disabled={loadingCredits || filteredCredits.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border hover:bg-muted text-xs font-semibold text-foreground cursor-pointer disabled:opacity-50 transition-all shadow-2xs"
                title="Export Filtered Comp-Off Ledger to CSV"
              >
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="hidden sm:inline">Export CSV</span>
              </button>

              <button
                onClick={fetchCredits}
                disabled={loadingCredits}
                className="p-2 rounded-xl border border-border hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-50"
                title="Refresh Ledger"
              >
                <RefreshCw className={`h-4 w-4 ${loadingCredits ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Ledger Table */}
          <div className="rounded-3xl border border-border/70 bg-card shadow-sm overflow-hidden">
            {loadingCredits ? (
              <div className="p-12 text-center text-xs text-muted-foreground">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent mb-2" />
                <p className="font-semibold text-foreground">Loading Comp-Off ledger entries...</p>
              </div>
            ) : filteredCredits.length === 0 ? (
              <div className="p-12 text-center text-xs text-muted-foreground space-y-2">
                <ShieldCheck className="h-10 w-10 text-muted-foreground/40 mx-auto" />
                <p className="text-sm font-bold text-foreground">No Comp-Off records found</p>
                <p>No credit ledger entries match the selected status filter or search parameters.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/40 border-b border-border/50 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="py-3.5 px-4">Employee</th>
                      <th className="py-3.5 px-4">Work Date</th>
                      <th className="py-3.5 px-4">Credit Days</th>
                      <th className="py-3.5 px-4">Status</th>
                      <th className="py-3.5 px-4">Balance</th>
                      <th className="py-3.5 px-4">Validity / Expiry</th>
                      <th className="py-3.5 px-4">Verifiers</th>
                      <th className="py-3.5 px-4 text-right">Audit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40 font-medium">
                    {filteredCredits.map((credit) => {
                      const now = new Date();
                      const isExpired =
                        credit.status === 'APPROVED' &&
                        Number(credit.remainingDays) > 0 &&
                        new Date(credit.expiresAt) <= now;
                      const daysUntilExp = credit.expiresAt
                        ? Math.max(0, Math.ceil((new Date(credit.expiresAt) - now) / (1000 * 60 * 60 * 24)))
                        : null;
                      const isExpSoon = !isExpired && credit.status === 'APPROVED' && daysUntilExp !== null && daysUntilExp <= 14 && Number(credit.remainingDays) > 0;
                      const hasConsumptions = Array.isArray(credit.consumptions) && credit.consumptions.length > 0;
                      const isExpanded = expandedConsumptionId === credit.id;

                      return (
                        <React.Fragment key={credit.id}>
                          <tr className="hover:bg-muted/20 transition-colors">
                            {/* Employee */}
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-2.5">
                                <UserAvatar user={credit.user} className="h-8 w-8 rounded-full" />
                                <div>
                                  <span className="font-bold text-foreground block">
                                    {credit.user?.name || 'Unknown User'}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground font-mono">
                                    {credit.user?.employeeId || 'EM-000'} • {credit.user?.department || 'General'}
                                  </span>
                                </div>
                              </div>
                            </td>

                            {/* Work Date */}
                            <td className="py-3.5 px-4">
                              <div>
                                <span className="font-mono font-bold text-foreground block">
                                  {formatDateDisplay(credit.workDate)}
                                </span>
                                <span className="text-[10px] font-semibold text-muted-foreground">
                                  {credit.reason === 'COMPANY_HOLIDAY' ? 'Company Holiday' : 'Weekly Off'}
                                </span>
                              </div>
                            </td>

                            {/* Credit Days */}
                            <td className="py-3.5 px-4">
                              <span className="px-2 py-0.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-mono font-extrabold border border-indigo-500/20">
                                {credit.creditDays} Day{Number(credit.creditDays) > 1 ? 's' : ''}
                              </span>
                            </td>

                            {/* Status */}
                            <td className="py-3.5 px-4">
                              {getStatusBadge(credit.status, credit.remainingDays, credit.expiresAt)}
                            </td>

                            {/* Balance Remaining vs Used */}
                            <td className="py-3.5 px-4">
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-1.5 font-mono">
                                  <span className="font-bold text-foreground">
                                    {credit.remainingDays}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">left of</span>
                                  <span className="text-[10px] text-muted-foreground">
                                    {credit.creditDays}d
                                  </span>
                                </div>
                                {hasConsumptions && (
                                  <button
                                    onClick={() => setExpandedConsumptionId(isExpanded ? null : credit.id)}
                                    className="text-[10px] text-primary hover:underline font-bold flex items-center gap-0.5 cursor-pointer"
                                  >
                                    <span>{credit.consumptions.length} consumption(s)</span>
                                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                  </button>
                                )}
                              </div>
                            </td>

                            {/* Expiry Date */}
                            <td className="py-3.5 px-4">
                              <div>
                                <span className="font-mono text-xs block text-foreground">
                                  {credit.expiresAt ? formatDateDisplay(credit.expiresAt) : '—'}
                                </span>
                                {isExpSoon && (
                                  <span className="text-[9px] font-black uppercase text-amber-600 dark:text-amber-400 block animate-pulse">
                                    Expiring in {daysUntilExp}d
                                  </span>
                                )}
                                {isExpired && (
                                  <span className="text-[9px] font-black uppercase text-rose-500 block">
                                    Lapsed
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Verifiers Audit */}
                            <td className="py-3.5 px-4">
                              <div className="text-[11px] space-y-0.5">
                                {credit.tlApprover && (
                                  <div className="text-muted-foreground">
                                    TL: <span className="text-foreground font-semibold">{credit.tlApprover.name}</span>
                                  </div>
                                )}
                                {credit.adminApprover ? (
                                  <div className="text-muted-foreground">
                                    Admin: <span className="text-foreground font-semibold">{credit.adminApprover.name}</span>
                                  </div>
                                ) : (
                                  <div className="text-amber-600 dark:text-amber-400 font-semibold text-[10px]">
                                    Awaiting Admin Final Review
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* Audit Details Button */}
                            <td className="py-3.5 px-4 text-right">
                              <button
                                onClick={() => setSelectedCreditForAudit(credit)}
                                className="px-2.5 py-1.5 rounded-xl border border-border/70 hover:bg-muted text-muted-foreground hover:text-foreground text-[11px] font-bold transition-all cursor-pointer"
                              >
                                View Audit
                              </button>
                            </td>
                          </tr>

                          {/* Expandable Consumptions Sub-Row */}
                          {isExpanded && hasConsumptions && (
                            <tr className="bg-muted/10 border-b border-border/40">
                              <td colSpan={8} className="p-4 pl-12 space-y-2">
                                <span className="text-[11px] font-black uppercase text-muted-foreground block tracking-wider">
                                  Linked Leave Request Deductions & Restorations:
                                </span>
                                <div className="space-y-2">
                                  {credit.consumptions.map((cons) => (
                                    <div
                                      key={cons.id}
                                      className="p-3 rounded-2xl bg-card border border-border/50 text-xs flex flex-wrap items-center justify-between gap-3 shadow-2xs"
                                    >
                                      <div className="flex items-center gap-3">
                                        <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500">
                                          <FileText className="h-4 w-4" />
                                        </div>
                                        <div>
                                          <div className="flex items-center gap-2">
                                            <span className="font-bold text-foreground">
                                              Leave: {formatDateDisplay(cons.leaveRequest?.startDate)} – {formatDateDisplay(cons.leaveRequest?.endDate || cons.leaveRequest?.startDate)}
                                            </span>
                                            <span className="px-2 py-0.2 rounded-md bg-muted text-[10px] font-mono font-bold text-muted-foreground">
                                              {cons.leaveRequest?.status}
                                            </span>
                                          </div>
                                          <p className="text-[11px] text-muted-foreground mt-0.5">
                                            Reason: "{cons.leaveRequest?.reason || 'No description'}"
                                          </p>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-3">
                                        <div className="text-right">
                                          <span className="font-mono font-black text-rose-600 dark:text-rose-400 block">
                                            -{cons.consumedDays ?? cons.daysDeducted} Day(s) Deducted
                                          </span>
                                          <span className="text-[10px] text-muted-foreground font-mono">
                                            {new Date(cons.createdAt).toLocaleString()}
                                          </span>
                                        </div>

                                        {cons.leaveRequest?.status === 'CANCELLED' && (
                                          <div className="px-2.5 py-1 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-bold flex items-center gap-1">
                                            <RotateCcw className="h-3 w-3" />
                                            <span>Restored to Balance</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 2: ADVANCE PERMISSION WORKFLOW                        */}
      {/* ========================================================= */}
      {activeTab === 'advance' && (
        <div className="space-y-5">
          {/* Information & Action Header */}
          <div className="p-5 sm:p-6 rounded-3xl bg-card border border-border/70 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                  <CalendarCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-foreground">
                    Advance Permission to Work on Off-Days
                  </h3>
                  <p className="text-xs text-muted-foreground font-medium">
                    Request authorization to work on an upcoming company holiday or weekly off. Approval grants permission to work (credits are granted post-work).
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Admin Quick Policy Toggle */}
                {(isAdmin || isSuperAdmin) && (
                  <button
                    onClick={handleTogglePolicyRule}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      compOffPolicy.claimWindowEnabled
                        ? 'bg-muted/40 hover:bg-muted text-foreground border-border/60'
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                    }`}
                    title="Toggle the 30-day retrospective claim cutoff rule"
                  >
                    <Sliders className="h-3.5 w-3.5 text-indigo-500" />
                    <span>30-Day Retrospective Rule: {compOffPolicy.claimWindowEnabled ? 'Active' : 'Disabled'}</span>
                  </button>
                )}

                {/* Request Advance Permission Action Button */}
                <button
                  onClick={handleOpenApplyModal}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-black shadow-md cursor-pointer transition-all"
                >
                  <CalendarPlus className="h-4 w-4" />
                  <span>Request Advance Permission</span>
                </button>
              </div>
            </div>

            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-border/40">
              <div className="p-3 rounded-2xl bg-muted/20 border border-border/40">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">Total Requests</span>
                <span className="text-lg font-black font-mono text-foreground mt-0.5 block">{permMetrics.total}</span>
              </div>
              <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 block">Pending Review</span>
                <span className="text-lg font-black font-mono text-amber-600 dark:text-amber-400 mt-0.5 block">{permMetrics.pending}</span>
              </div>
              <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">Approved (Work Authorized)</span>
                <span className="text-lg font-black font-mono text-emerald-600 dark:text-emerald-400 mt-0.5 block">{permMetrics.approved}</span>
              </div>
              <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20">
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 block">Rejected</span>
                <span className="text-lg font-black font-mono text-rose-600 dark:text-rose-400 mt-0.5 block">{permMetrics.rejected}</span>
              </div>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="p-4 rounded-3xl bg-card border border-border/60 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {['ALL', 'PENDING', 'APPROVED', 'REJECTED'].map((st) => (
                <button
                  key={st}
                  onClick={() => setPermStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    permStatusFilter === st
                      ? 'bg-primary text-white shadow-xs'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {st === 'ALL' ? 'All Requests' : st.charAt(0) + st.slice(1).toLowerCase()}
                </button>
              ))}
            </div>

            <div className="relative min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by name, date, or reason..."
                value={permSearchQuery}
                onChange={(e) => setPermSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          {/* Requests Table / Cards */}
          <div className="p-4 sm:p-5 rounded-3xl bg-card border border-border/60 shadow-2xs">
            {loadingPermissions ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                <p className="font-semibold">Loading advance permission requests...</p>
              </div>
            ) : filteredPermissionRequests.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground space-y-2">
                <CalendarCheck className="h-8 w-8 mx-auto text-muted-foreground/40 mb-1" />
                <p className="font-bold text-foreground">No advance permission requests found.</p>
                <p className="text-[11px]">Click "Request Advance Permission" to request permission to work on an upcoming off-day.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border/40 text-[11px] font-extrabold text-muted-foreground uppercase tracking-wider">
                      <th className="pb-3 pl-2">Requested Work Date</th>
                      <th className="pb-3">Day / Holiday Type</th>
                      <th className="pb-3">Employee</th>
                      <th className="pb-3">Reason</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3">Decision / Remarks</th>
                      {(isAdmin || isSuperAdmin) && <th className="pb-3 text-right pr-2">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {filteredPermissionRequests.map((req) => {
                      const dateObj = new Date(req.workDate);
                      const dayName = isNaN(dateObj.getTime()) ? '' : dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                      const formattedDate = formatDateDisplay(req.workDate);
                      const isPending = req.status === 'PENDING';

                      return (
                        <tr key={req.id} className="hover:bg-muted/30 transition-colors">
                          <td className="py-3 pl-2 font-mono font-bold text-foreground">
                            <div className="flex items-center gap-1.5">
                              <Calendar className="h-3.5 w-3.5 text-indigo-500" />
                              <span>{formattedDate}</span>
                              <span className="text-[10px] text-muted-foreground font-sans font-medium">({dayName})</span>
                            </div>
                          </td>
                          <td className="py-3">
                            <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                              req.holidayType === 'COMPANY_HOLIDAY'
                                ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20'
                                : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20'
                            }`}>
                              {req.holidayType === 'COMPANY_HOLIDAY' ? 'Company Holiday' : 'Weekly Off'}
                            </span>
                          </td>
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <UserAvatar user={req.user} size="sm" />
                              <div>
                                <span className="font-bold text-foreground block">{req.user?.name || 'Unknown'}</span>
                                <span className="text-[10px] text-muted-foreground block font-mono">{req.user?.employeeId || '—'}</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 max-w-xs">
                            <p className="text-xs text-foreground font-medium truncate" title={req.reason}>
                              {req.reason}
                            </p>
                          </td>
                          <td className="py-3">
                            {req.status === 'PENDING' && (
                              <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1 w-fit">
                                <Clock className="h-3 w-3" />
                                <span>Pending Admin</span>
                              </span>
                            )}
                            {req.status === 'APPROVED' && (
                              <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1 w-fit">
                                <CheckCircle2 className="h-3 w-3" />
                                <span>Work Authorized</span>
                              </span>
                            )}
                            {req.status === 'REJECTED' && (
                              <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 flex items-center gap-1 w-fit">
                                <XCircle className="h-3 w-3" />
                                <span>Rejected</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3 max-w-xs">
                            {req.status === 'REJECTED' ? (
                              <p className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold truncate" title={req.rejectionReason}>
                                Reason: {req.rejectionReason}
                              </p>
                            ) : req.status === 'APPROVED' ? (
                              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium truncate" title={req.adminRemarks || 'Approved'}>
                                {req.adminRemarks || 'Approved by Admin'}
                              </p>
                            ) : (
                              <span className="text-[11px] text-muted-foreground italic">Awaiting review</span>
                            )}
                          </td>
                          {(isAdmin || isSuperAdmin) && (
                            <td className="py-3 text-right pr-2">
                              {isPending ? (
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => handleOpenReviewPermModal(req, 'APPROVE')}
                                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition-all cursor-pointer shadow-xs"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    onClick={() => handleOpenReviewPermModal(req, 'REJECT')}
                                    className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] transition-all cursor-pointer shadow-xs"
                                  >
                                    Reject
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  {req.approvedBy?.name ? `by ${req.approvedBy.name.split(' ')[0]}` : 'Reviewed'}
                                </span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 3: OFF-DAY WORKING SESSIONS (Phase 2)                 */}
      {/* ========================================================= */}
      {activeTab === 'sessions' && (
        <div className="space-y-4">
          {/* Header Info */}
          <div className="p-5 sm:p-6 rounded-3xl bg-card border border-border/70 shadow-2xs space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-foreground">
                    Comp-Off Off-Day Working Sessions
                  </h3>
                  <p className="text-xs text-muted-foreground font-medium">
                    Actual recorded work sessions conducted on approved holidays and weekly offs. Completely isolated from normal attendance.
                  </p>
                </div>
              </div>
              <button
                onClick={fetchCompOffSessions}
                disabled={loadingSessions}
                className="p-2 rounded-xl border border-border hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer self-start sm:self-auto"
                title="Refresh Sessions"
              >
                <RefreshCw className={`h-4 w-4 ${loadingSessions ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="p-4 rounded-3xl bg-card border border-border/60 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold text-muted-foreground mr-1">Status:</span>
              {['ALL', 'ACTIVE', 'COMPLETED'].map((st) => (
                <button
                  key={st}
                  onClick={() => setSessionStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    sessionStatusFilter === st
                      ? 'bg-primary text-white shadow-xs'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()}
                </button>
              ))}

              <span className="text-border mx-1 hidden sm:inline">|</span>

              <span className="text-[11px] font-bold text-muted-foreground mr-1">Verification:</span>
              {['ALL', 'PENDING', 'APPROVED', 'REJECTED'].map((ast) => (
                <button
                  key={ast}
                  onClick={() => setSessionApprovalFilter(ast)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    sessionApprovalFilter === ast
                      ? 'bg-violet-600 text-white shadow-xs'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {ast === 'ALL' ? 'All' : ast === 'PENDING' ? 'Awaiting Review' : ast.charAt(0) + ast.slice(1).toLowerCase()}
                </button>
              ))}
            </div>

            <div className="relative min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search employee, date, reason..."
                value={sessionSearchQuery}
                onChange={(e) => setSessionSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          {/* Sessions Table */}
          <div className="p-4 sm:p-5 rounded-3xl bg-card border border-border/60 shadow-2xs">
            {loadingSessions ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                <p className="font-semibold">Loading Comp-Off working sessions...</p>
              </div>
            ) : filteredCompOffSessions.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground space-y-2">
                <Clock className="h-8 w-8 mx-auto text-muted-foreground/40 mb-1" />
                <p className="font-bold text-foreground">No Comp-Off sessions recorded.</p>
                <p className="text-[11px]">Sessions are logged when employees use Comp-Off Login on approved off-days.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border/40 text-[11px] font-extrabold text-muted-foreground uppercase tracking-wider">
                      <th className="pb-3 pl-2">Work Date</th>
                      <th className="pb-3">Employee</th>
                      <th className="pb-3">Session Time</th>
                      <th className="pb-3">Duration / Target</th>
                      <th className="pb-3">Credit Eligibility</th>
                      <th className="pb-3">Geofence Compliance</th>
                      <th className="pb-3">Review Status</th>
                      {(isAdmin || isSuperAdmin) && <th className="pb-3 text-right pr-2">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {filteredCompOffSessions.map((s) => {
                      const dateObj = new Date(s.workDate);
                      const dayName = isNaN(dateObj.getTime()) ? '' : dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                      const formattedDate = formatDateDisplay(s.workDate);
                      const loginTimeStr = s.loginTime ? new Date(s.loginTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
                      const clockOutTimeStr = s.clockOutTime ? new Date(s.clockOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

                      return (
                        <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                          <td className="py-3 pl-2 font-mono font-bold text-foreground">
                            <div className="flex items-center gap-1.5">
                              <Calendar className="h-3.5 w-3.5 text-indigo-500" />
                              <span>{formattedDate}</span>
                              <span className="text-[10px] text-muted-foreground font-sans font-medium">({dayName})</span>
                            </div>
                          </td>

                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <UserAvatar user={s.user} size="sm" />
                              <div>
                                <span className="font-bold text-foreground block">{s.user?.name || 'Unknown'}</span>
                                <span className="text-[10px] text-muted-foreground block font-mono">{s.user?.employeeId || '—'}</span>
                              </div>
                            </div>
                          </td>

                          <td className="py-3 font-mono">
                            <div className="text-xs">
                              <span className="text-foreground font-semibold">{loginTimeStr}</span>
                              <span className="text-muted-foreground mx-1.5">→</span>
                              {clockOutTimeStr ? (
                                <span className="text-foreground font-semibold">{clockOutTimeStr}</span>
                              ) : (
                                <span className="text-emerald-600 dark:text-emerald-400 font-bold inline-flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                  <span>In Progress</span>
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground block">
                              {s.clockOutType === 'AUTO' ? '⚡ Auto-Closed' : s.clockOutType === 'MANUAL' ? 'Manual Clock-Out' : ''}
                            </span>
                          </td>

                          <td className="py-3 font-mono">
                            <div className="text-xs">
                              <span className="font-extrabold text-indigo-600 dark:text-indigo-400">
                                {Number(s.durationHours) > 0 ? `${s.durationHours} hrs` : 'In progress'}
                              </span>
                              {s.configuredDailyDuration && (
                                <span className="text-[10px] text-muted-foreground block font-sans">
                                  Target: {s.configuredDailyDuration} hrs
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-3">
                            {s.status === 'ACTIVE' ? (
                              <span className="text-[10px] text-muted-foreground font-medium italic">
                                Active session
                              </span>
                            ) : s.calculatedCredit >= 1.0 ? (
                              <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 inline-flex items-center gap-1" title={s.creditEligibility?.reason}>
                                <Sparkles className="h-3 w-3 text-yellow-500" />
                                <span>1.0 Day Credit</span>
                              </span>
                            ) : s.calculatedCredit >= 0.5 ? (
                              <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 inline-flex items-center gap-1" title={s.creditEligibility?.reason}>
                                <CheckCircle2 className="h-3 w-3" />
                                <span>0.5 Day Credit</span>
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20" title={s.creditEligibility?.reason || 'Worked duration below 50% threshold'}>
                                0 Credit (&lt;50%)
                              </span>
                            )}
                          </td>

                          <td className="py-3">
                            <div className="space-y-1">
                              {s.locationStatus === 'INSIDE' ? (
                                <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 inline-flex items-center gap-1">
                                  <ShieldCheck className="h-3 w-3" />
                                  <span>Inside ({s.locationName || 'Office'})</span>
                                </span>
                              ) : (
                                <div className="space-y-0.5">
                                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 inline-flex items-center gap-1">
                                    <AlertCircle className="h-3 w-3 text-amber-500" />
                                    <span>Outside Geofence</span>
                                  </span>
                                  {s.flaggedForReview && (
                                    <span className="ml-1 px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-rose-500/10 text-rose-600 border border-rose-500/20">
                                      Flagged
                                    </span>
                                  )}
                                  {s.locationReason && (
                                    <p className="text-[10px] text-muted-foreground italic truncate max-w-xs" title={s.locationReason}>
                                      "{s.locationReason}"
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>

                          <td className="py-3">
                            {s.approvalStatus === 'PENDING' ? (
                              <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 inline-flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                <span>Pending Review</span>
                              </span>
                            ) : s.approvalStatus === 'APPROVED' ? (
                              <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 inline-flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" />
                                <span>Credit Granted</span>
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 inline-flex items-center gap-1" title={s.rejectionReason}>
                                <XCircle className="h-3 w-3" />
                                <span>Rejected</span>
                              </span>
                            )}
                          </td>

                          {(isAdmin || isSuperAdmin) && (
                            <td className="py-3 text-right pr-2">
                              {s.approvalStatus === 'PENDING' && s.status === 'COMPLETED' ? (
                                <div className="flex items-center justify-end gap-1.5">
                                  {s.canApprove ? (
                                    <button
                                      onClick={() => handleOpenReviewSessionModal(s, 'APPROVE')}
                                      disabled={isSuperAdmin}
                                      className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition-all cursor-pointer shadow-xs disabled:opacity-50"
                                      title="Verify and grant credit"
                                    >
                                      Approve
                                    </button>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground font-semibold px-1">
                                      &lt;50%
                                    </span>
                                  )}
                                  <button
                                    onClick={() => handleOpenReviewSessionModal(s, 'REJECT')}
                                    disabled={isSuperAdmin}
                                    className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] transition-all cursor-pointer shadow-xs disabled:opacity-50"
                                    title="Reject session"
                                  >
                                    Reject
                                  </button>
                                </div>
                              ) : s.approvalStatus === 'APPROVED' ? (
                                <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                                  +{s.calculatedCredit || 1}d credited
                                </span>
                              ) : s.approvalStatus === 'REJECTED' ? (
                                <span className="text-[10px] font-mono text-rose-500" title={s.rejectionReason}>
                                  Declined
                                </span>
                              ) : (
                                <span className="text-[10px] text-muted-foreground italic">In progress</span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}


      {/* ========================================================= */}
      {/* TAB 2: VERIFICATION & AUTHORIZATION FORM                  */}
      {/* ========================================================= */}
      {activeTab === 'verify' && (
        <div className="w-full space-y-5">
          {/* Policy Information Box */}
          <div className="p-4 sm:p-5 rounded-3xl bg-card border border-border/70 shadow-2xs space-y-2">
            <div className="flex items-center gap-2 text-indigo-500">
              <Info className="h-4 w-4" />
              <span className="text-xs font-black uppercase tracking-wider text-foreground">
                Comp-Off Authorization Policy & Rules
              </span>
            </div>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>
                <strong>Eligible workdays:</strong> Weekly-off days and officially recognized company holidays only.
              </li>
              <li>
                <strong>30-Day Claim Window:</strong> Verification must be filed within 30 calendar days from the work date.
              </li>
              <li>
                <strong>Evidence Requirement:</strong> Attendance records must show clock-in and clock-out with at least 4.0 hours for half-day credit or 8.0 hours for full-day credit.
              </li>
              <li>
                <strong>Approval Routing:</strong> Team Leaders verify team members (submitted to Admin Approval Queue). Admins can directly sanction and credit the ledger.
              </li>
            </ul>
          </div>

          {/* Form Card */}
          <form
            onSubmit={handleAuthorizeSubmit}
            className="p-5 sm:p-7 rounded-3xl bg-card border border-border/70 shadow-sm space-y-5"
          >
            <div className="border-b border-border/40 pb-4">
              <h3 className="text-base font-black text-foreground">
                Authorize Compensatory Off Credit
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Verify weekend or holiday attendance and allocate earned comp-off days.
              </p>
            </div>

            {/* Responsive Grid for Employee and Date Picker */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
              {/* 1. Employee Selection */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-foreground mb-1.5">
                  Target Employee <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  disabled={loadingUsers}
                  className="w-full h-11 bg-muted/30 border border-border/70 rounded-xl px-3.5 py-2 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer disabled:opacity-50"
                >
                  <option value="">-- Choose Employee / Team Member --</option>
                  {eligibleUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.employeeId || 'EM-000'}) — {u.department || 'General'}
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Eligible Work Date Picker */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                    Eligible Work Date <span className="text-rose-500">*</span>
                  </label>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    Claim window: {dateBounds.min} to {dateBounds.max}
                  </span>
                </div>
                <input
                  type="date"
                  min={dateBounds.min}
                  max={dateBounds.max}
                  value={workDate}
                  onChange={(e) => setWorkDate(e.target.value)}
                  className="w-full h-11 bg-muted/30 border border-border/70 rounded-xl px-3.5 py-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                />
              </div>
            </div>

            {/* 3. Live Diagnostic Evidence Inspector */}
            {checkingEvidence && (
              <div className="p-4 rounded-2xl bg-muted/20 border border-border/40 text-xs text-muted-foreground flex items-center gap-2.5">
                <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span>Inspecting backend attendance logs and holiday schedules...</span>
              </div>
            )}

            {evidenceError && (
              <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs font-semibold flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{evidenceError}</span>
              </div>
            )}

            {evidenceData && !checkingEvidence && (
              <div
                className={`p-4 rounded-2xl border text-xs space-y-3 ${
                  evidenceData.canAuthorize
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-200'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-900 dark:text-rose-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  {evidenceData.canAuthorize ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0" />
                  )}
                  <span className="font-extrabold text-sm">
                    {evidenceData.canAuthorize ? 'Work Date Eligible for Comp-Off' : 'Ineligible for Comp-Off'}
                  </span>
                </div>

                <p className="font-medium text-xs leading-relaxed">
                  {evidenceData.reason}
                </p>

                {/* Attendance Summary */}
                {evidenceData.attendance && (
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/20 text-center font-mono">
                    <div className="p-2 rounded-xl bg-card/60">
                      <span className="text-[10px] text-muted-foreground uppercase block font-sans">Clock In</span>
                      <span className="font-bold text-xs text-foreground">
                        {evidenceData.attendance.clockIn
                          ? new Date(evidenceData.attendance.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </span>
                    </div>

                    <div className="p-2 rounded-xl bg-card/60">
                      <span className="text-[10px] text-muted-foreground uppercase block font-sans">Clock Out</span>
                      <span className="font-bold text-xs text-foreground">
                        {evidenceData.attendance.clockOut
                          ? new Date(evidenceData.attendance.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </span>
                    </div>

                    <div className="p-2 rounded-xl bg-card/60">
                      <span className="text-[10px] text-muted-foreground uppercase block font-sans">Working Hours</span>
                      <span className="font-extrabold text-xs text-foreground">
                        {evidenceData.attendance.workingHours} hrs
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 4. Credit Amount Selector */}
            <div>
              <label className="block text-xs font-extrabold uppercase tracking-wider text-foreground mb-1.5">
                Credit Days Amount <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setCreditDays(1.0)}
                  className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                    creditDays === 1.0
                      ? 'border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-extrabold shadow-sm'
                      : 'border-border/70 hover:bg-muted text-muted-foreground font-semibold'
                  }`}
                >
                  <span className="text-sm font-mono block">1.0 Day</span>
                  <span className="text-[10px] block opacity-80">Full Day Credit (&ge; 8.0 hrs)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCreditDays(0.5)}
                  className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                    creditDays === 0.5
                      ? 'border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-extrabold shadow-sm'
                      : 'border-border/70 hover:bg-muted text-muted-foreground font-semibold'
                  }`}
                >
                  <span className="text-sm font-mono block">0.5 Day</span>
                  <span className="text-[10px] block opacity-80">Half Day Credit (&ge; 4.0 hrs)</span>
                </button>
              </div>
            </div>

            {/* 5. Verification Remarks */}
            <div>
              <label className="block text-xs font-extrabold uppercase tracking-wider text-foreground mb-1.5">
                Verification Remarks / Justification <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={3}
                placeholder="State the verified business requirement, deployment, or event attendance..."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="w-full bg-muted/30 border border-border/70 rounded-xl p-3 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              />
            </div>

            {/* 6. Submission Button */}
            <div className="pt-3 border-t border-border/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground font-medium">
                {isTL
                  ? 'Submits request to Admin queue for final review'
                  : 'Immediately authorizes and adds credit to employee balance'}
              </span>

              <button
                type="submit"
                disabled={submittingAuth || !evidenceData?.canAuthorize || isSuperAdmin}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-extrabold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {submittingAuth ? (
                  <>
                    <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Processing Authorization...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" />
                    <span>
                      {isTL ? 'Submit for Admin Approval' : 'Authorize & Credit Directly'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 3: ADMIN APPROVAL QUEUE                               */}
      {/* ========================================================= */}
      {activeTab === 'queue' && (
        <div className="space-y-4">
          <div className="p-4 rounded-3xl bg-card border border-border/60 shadow-2xs flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-foreground">
                  Admin Comp-Off Sanction Queue
                </h3>
                <p className="text-xs text-muted-foreground">
                  Review claims verified by Team Leaders requiring final sanction.
                </p>
              </div>
            </div>

            <span className="px-3 py-1 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono font-bold text-xs border border-amber-500/20">
              {pendingQueue.length} Pending
            </span>
          </div>

          {pendingQueue.length === 0 ? (
            <div className="p-12 text-center text-xs text-muted-foreground space-y-2 rounded-3xl border border-border/70 bg-card">
              <CheckCircle2 className="h-10 w-10 text-emerald-500/60 mx-auto" />
              <p className="text-sm font-bold text-foreground">All Clear!</p>
              <p>There are no pending Comp-Off credit claims awaiting Admin review.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pendingQueue.map((item) => (
                <div
                  key={item.id}
                  className="p-5 rounded-3xl bg-card border border-border/70 shadow-sm space-y-4 text-xs"
                >
                  {/* Top user row */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <UserAvatar user={item.user} className="h-9 w-9 rounded-full" />
                      <div>
                        <span className="font-bold text-foreground block text-sm">
                          {item.user?.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {item.user?.employeeId || 'EM-000'} • {item.user?.department || 'General'}
                        </span>
                      </div>
                    </div>

                    <span className="px-2.5 py-1 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-mono font-extrabold border border-indigo-500/20">
                      {item.creditDays} Day{Number(item.creditDays) > 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Evidence Summary Card */}
                  <div className="p-3 rounded-2xl bg-muted/20 border border-border/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase">Eligible Work Date:</span>
                      <span className="font-mono font-bold text-foreground">
                        {formatDateDisplay(item.workDate)} ({item.reason === 'COMPANY_HOLIDAY' ? 'Holiday' : 'Weekly Off'})
                      </span>
                    </div>

                    {item.attendance && (
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Attendance Evidence:</span>
                        <span className="font-mono font-bold text-foreground">
                          {item.attendance.workingHours} hrs worked
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Validity (90 Days):</span>
                      <span className="font-mono text-foreground">
                        Expires {formatDateDisplay(item.expiresAt)}
                      </span>
                    </div>
                  </div>

                  {/* TL Remarks */}
                  {item.tlApprover && (
                    <div className="p-3 rounded-2xl bg-amber-500/5 border border-amber-500/20 text-xs space-y-1">
                      <div className="flex items-center justify-between text-amber-700 dark:text-amber-300 font-bold text-[11px]">
                        <span>Verified by TL: {item.tlApprover.name}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {new Date(item.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-muted-foreground italic">
                        "{item.tlRemarks || 'Verified holiday work requirement.'}"
                      </p>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="pt-2 border-t border-border/40 flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleOpenReviewModal(item, 'REJECT')}
                      disabled={isSuperAdmin}
                      className="px-4 py-2 rounded-xl border border-rose-500/40 hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold transition-all cursor-pointer disabled:opacity-50"
                    >
                      Reject Claim
                    </button>
                    <button
                      onClick={() => handleOpenReviewModal(item, 'APPROVE')}
                      disabled={isSuperAdmin}
                      className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5 stroke-[3]" />
                      <span>Approve & Credit</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* AUDIT DETAILS MODAL                                       */}
      {/* ========================================================= */}
      {selectedCreditForAudit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setSelectedCreditForAudit(null)}
        >
          <div
            className="w-full max-w-lg rounded-3xl border border-border/70 bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200 text-left space-y-4 font-sans"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-3">
                <UserAvatar user={selectedCreditForAudit.user} className="h-10 w-10 rounded-full" />
                <div>
                  <h3 className="text-base font-bold text-foreground">
                    {selectedCreditForAudit.user?.name || 'Applicant'}
                  </h3>
                  <p className="text-xs text-muted-foreground font-mono">
                    {selectedCreditForAudit.user?.employeeId || 'EM-000'} • {selectedCreditForAudit.user?.department || 'General'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedCreditForAudit(null)}
                className="p-1.5 rounded-xl border border-border hover:bg-muted text-muted-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Overview Grid */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-2xl bg-muted/20 border border-border/40">
                <span className="text-[10px] font-bold text-muted-foreground uppercase block">Work Date</span>
                <span className="font-mono font-bold text-foreground">
                  {formatDateDisplay(selectedCreditForAudit.workDate)}
                </span>
              </div>
              <div className="p-3 rounded-2xl bg-muted/20 border border-border/40">
                <span className="text-[10px] font-bold text-muted-foreground uppercase block">Credit Amount</span>
                <span className="font-mono font-bold text-foreground">
                  {selectedCreditForAudit.creditDays} Day(s) (Remaining: {selectedCreditForAudit.remainingDays}d)
                </span>
              </div>
              <div className="p-3 rounded-2xl bg-muted/20 border border-border/40">
                <span className="text-[10px] font-bold text-muted-foreground uppercase block">Status</span>
                <span className="font-bold text-foreground">
                  {selectedCreditForAudit.status}
                </span>
              </div>
              <div className="p-3 rounded-2xl bg-muted/20 border border-border/40">
                <span className="text-[10px] font-bold text-muted-foreground uppercase block">Expiry Date</span>
                <span className="font-mono font-bold text-foreground">
                  {formatDateDisplay(selectedCreditForAudit.expiresAt)}
                </span>
              </div>
            </div>

            {/* Attendance Snapshot */}
            {selectedCreditForAudit.attendance && (
              <div className="p-3 rounded-2xl bg-muted/20 border border-border/40 text-xs space-y-1">
                <span className="text-[10px] font-bold text-muted-foreground uppercase block">Attendance Evidence</span>
                <div className="flex justify-between text-muted-foreground">
                  <span>Hours Worked: <strong className="text-foreground">{selectedCreditForAudit.attendance.workingHours} hrs</strong></span>
                  <span>Status: <strong className="text-foreground">{selectedCreditForAudit.attendance.status}</strong></span>
                </div>
              </div>
            )}

            {/* Verification Remarks Timeline */}
            <div className="p-3 rounded-2xl bg-muted/20 border border-border/40 text-xs space-y-2">
              <span className="text-[10px] font-bold text-muted-foreground uppercase block">Verification Timeline</span>
              {selectedCreditForAudit.tlApprover && (
                <div className="border-l-2 border-amber-500 pl-2.5 py-0.5 space-y-0.5">
                  <span className="text-[11px] font-bold text-foreground block">
                    TL Review: {selectedCreditForAudit.tlApprover.name}
                  </span>
                  <p className="text-muted-foreground italic text-[11px]">
                    "{selectedCreditForAudit.tlRemarks || 'Verified.'}"
                  </p>
                </div>
              )}
              {selectedCreditForAudit.adminApprover && (
                <div className="border-l-2 border-emerald-500 pl-2.5 py-0.5 space-y-0.5">
                  <span className="text-[11px] font-bold text-foreground block">
                    Admin Sanction: {selectedCreditForAudit.adminApprover.name}
                  </span>
                  <p className="text-muted-foreground italic text-[11px]">
                    "{selectedCreditForAudit.adminRemarks || 'Approved.'}"
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-border/40">
              <button
                onClick={() => setSelectedCreditForAudit(null)}
                className="px-4 py-2 text-xs font-bold rounded-xl border border-border hover:bg-muted text-muted-foreground cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* ADMIN APPROVE / REJECT MODAL                              */}
      {/* ========================================================= */}
      {reviewModalCredit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setReviewModalCredit(null)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-border/70 bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200 text-left space-y-4 font-sans"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2.5">
                <div className={`p-2 rounded-xl ${reviewAction === 'APPROVE' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>
                  {reviewAction === 'APPROVE' ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                </div>
                <h3 className="text-base font-black text-foreground">
                  {reviewAction === 'APPROVE' ? 'Approve Comp-Off Credit' : 'Reject Comp-Off Claim'}
                </h3>
              </div>
              <button
                onClick={() => setReviewModalCredit(null)}
                className="p-1 rounded-xl text-muted-foreground hover:bg-muted cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              {reviewAction === 'APPROVE'
                ? `You are sanctioning ${reviewModalCredit.creditDays} day(s) for ${reviewModalCredit.user?.name}. This will credit their active leave balance immediately.`
                : `You are rejecting the claim for ${reviewModalCredit.user?.name}. Please state the reason for audit records.`}
            </p>

            <div>
              <label className="block text-xs font-extrabold uppercase tracking-wider text-foreground mb-1.5">
                Admin Remarks {reviewAction === 'REJECT' && <span className="text-rose-500">*</span>}
              </label>
              <textarea
                rows={3}
                placeholder={reviewAction === 'APPROVE' ? 'Approval notes (optional)...' : 'Reason for rejection (mandatory)...'}
                value={reviewRemarks}
                onChange={(e) => setReviewRemarks(e.target.value)}
                className="w-full bg-muted/30 border border-border/70 rounded-xl p-3 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
              <button
                type="button"
                onClick={() => setReviewModalCredit(null)}
                disabled={submittingReview}
                className="px-4 py-2 rounded-xl border border-border hover:bg-muted text-xs font-bold text-muted-foreground cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReview}
                disabled={submittingReview}
                className={`px-5 py-2 rounded-xl text-white text-xs font-extrabold transition-all cursor-pointer ${
                  reviewAction === 'APPROVE'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {submittingReview ? 'Processing...' : reviewAction === 'APPROVE' ? 'Confirm Approval' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}

      {/* ========================================================= */}
      {/* EMPLOYEE ADVANCE PERMISSION REQUEST MODAL                 */}
      {/* ========================================================= */}
      {applyModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setApplyModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-3xl border border-border/70 bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200 text-left space-y-4 font-sans max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-primary/10 text-primary">
                  <CalendarPlus className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-foreground">
                    Request Advance Permission to Work
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Select an upcoming holiday or weekly off to request permission to work.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setApplyModalOpen(false)}
                className="p-1 rounded-xl text-muted-foreground hover:bg-muted cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitAdvanceRequest} className="space-y-4">
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-foreground mb-1.5">
                  Select Eligible Off-Day <span className="text-rose-500">*</span>
                </label>
                <CompOffCalendarPicker
                  selectedDate={selectedAdvDate}
                  onSelectDate={(dateStr) => setSelectedAdvDate(dateStr)}
                  eligibleDates={eligibleDates}
                  loadingEligibleDates={loadingEligibleDates}
                />
              </div>

              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-foreground mb-1.5">
                  Business Justification / Reason <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="Explain why working on this off-day is necessary (e.g., client deployment, emergency support, project milestone)..."
                  value={advReason}
                  onChange={(e) => setAdvReason(e.target.value)}
                  className="w-full bg-muted/30 border border-border/70 rounded-xl p-3 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                />
              </div>

              <div className="p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-700 dark:text-indigo-300 flex items-start gap-2.5">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  <strong>Important Notice:</strong> Advance approval grants permission to work on this off-day. <em>It does not grant a Comp-Off credit or change your balance.</em> Credit verification will take place following attendance completion.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
                <button
                  type="button"
                  onClick={() => setApplyModalOpen(false)}
                  disabled={submittingAdvRequest}
                  className="px-4 py-2 rounded-xl border border-border hover:bg-muted text-xs font-bold text-muted-foreground cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAdvRequest || loadingEligibleDates || !selectedAdvDate}
                  className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-hover active:scale-95 text-white text-xs font-extrabold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{submittingAdvRequest ? 'Submitting...' : 'Submit Request'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* ADMIN REVIEW ADVANCE PERMISSION MODAL                     */}
      {/* ========================================================= */}
      {reviewPermModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setReviewPermModal(null)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-border/70 bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200 text-left space-y-4 font-sans"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={`p-2 rounded-xl ${
                    reviewPermAction === 'APPROVE'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {reviewPermAction === 'APPROVE' ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <XCircle className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-black text-foreground">
                    {reviewPermAction === 'APPROVE'
                      ? 'Approve Advance Permission'
                      : 'Reject Advance Permission'}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {reviewPermAction === 'APPROVE'
                      ? 'Authorize employee to work on the designated date.'
                      : 'Decline advance permission request.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReviewPermModal(null)}
                className="p-1 rounded-xl text-muted-foreground hover:bg-muted cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Request Summary */}
            <div className="p-3 rounded-2xl bg-muted/20 border border-border/40 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-semibold">Employee:</span>
                <span className="font-bold text-foreground">
                  {reviewPermModal.user?.name} ({reviewPermModal.user?.employeeId || 'EM-000'})
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-semibold">Target Off-Day:</span>
                <span className="font-mono font-bold text-foreground">
                  {formatDateDisplay(reviewPermModal.workDate)} (
                  {reviewPermModal.holidayType === 'COMPANY_HOLIDAY' ? 'Holiday' : 'Weekly Off'}
                  )
                </span>
              </div>
              <div className="space-y-1 pt-1 border-t border-border/30">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                  Employee's Reason:
                </span>
                <p className="text-foreground bg-card/60 p-2.5 rounded-xl border border-border/40 font-medium italic">
                  "{reviewPermModal.reason}"
                </p>
              </div>
            </div>

            {reviewPermAction === 'APPROVE' ? (
              <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-800 dark:text-emerald-300">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                  <p className="text-[11px] leading-relaxed">
                    <strong>Zero-Credit Authorization:</strong> Approving this request grants permission to work on this off-day. <em>It does not issue any Comp-Off balance or credit now.</em> Credit eligibility is evaluated after actual attendance is recorded.
                  </p>
                </div>
              </div>
            ) : null}

            <div>
              <label className="block text-xs font-extrabold uppercase tracking-wider text-foreground mb-1.5">
                {reviewPermAction === 'APPROVE' ? 'Admin Remarks (Optional)' : 'Rejection Reason'}{' '}
                {reviewPermAction === 'REJECT' && <span className="text-rose-500">*</span>}
              </label>
              <textarea
                rows={3}
                placeholder={
                  reviewPermAction === 'APPROVE'
                    ? 'Optional approval remarks for audit records...'
                    : 'Explain clearly why permission to work is declined (mandatory)...'
                }
                value={reviewPermRemarks}
                onChange={(e) => setReviewPermRemarks(e.target.value)}
                className="w-full bg-muted/30 border border-border/70 rounded-xl p-3 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
              <button
                type="button"
                onClick={() => setReviewPermModal(null)}
                disabled={submittingPermReview}
                className="px-4 py-2 rounded-xl border border-border hover:bg-muted text-xs font-bold text-muted-foreground cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPermReview}
                disabled={submittingPermReview}
                className={`px-5 py-2 rounded-xl text-white text-xs font-extrabold transition-all cursor-pointer ${
                  reviewPermAction === 'APPROVE'
                    ? 'bg-emerald-600 hover:bg-emerald-700 active:scale-95'
                    : 'bg-rose-600 hover:bg-rose-700 active:scale-95'
                }`}
              >
                {submittingPermReview
                  ? 'Processing...'
                  : reviewPermAction === 'APPROVE'
                  ? 'Grant Permission'
                  : 'Reject Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: ADMIN REVIEW OFF-DAY WORKING SESSION (Phase 3)      */}
      {/* ========================================================= */}
      {reviewSessionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-card border border-border/80 rounded-3xl shadow-2xl p-6 space-y-4 text-left animate-in zoom-in-95 duration-200 text-foreground">
            <div className="flex items-center justify-between pb-3 border-b border-border/40">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2.5 rounded-2xl ${
                    reviewSessionAction === 'APPROVE'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {reviewSessionAction === 'APPROVE' ? (
                    <Sparkles className="h-5 w-5" />
                  ) : (
                    <XCircle className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-black text-foreground">
                    {reviewSessionAction === 'APPROVE'
                      ? 'Approve Comp-Off Session & Grant Credit'
                      : 'Reject Comp-Off Session'}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {reviewSessionAction === 'APPROVE'
                      ? 'Validate actual working duration and issue compensatory leave credit.'
                      : 'Decline this off-day work session. No credit will be granted.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReviewSessionModal(null)}
                className="p-1 rounded-xl text-muted-foreground hover:bg-muted cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Session Verification Breakdown */}
            <div className="p-3.5 rounded-2xl bg-muted/20 border border-border/40 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-semibold">Employee:</span>
                <span className="font-bold text-foreground">
                  {reviewSessionModal.user?.name} ({reviewSessionModal.user?.employeeId || 'EM-000'})
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-semibold">Work Date:</span>
                <span className="font-mono font-bold text-foreground">
                  {formatDateDisplay(reviewSessionModal.workDate)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-semibold">Recorded Working Duration:</span>
                <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                  {reviewSessionModal.durationHours} hrs
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-semibold">Configured Daily Target:</span>
                <span className="font-mono font-bold text-foreground">
                  {reviewSessionModal.configuredDailyDuration || 8.0} hrs
                </span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-border/30">
                <span className="text-muted-foreground font-semibold">Calculated Eligible Credit:</span>
                <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-sm">
                  {reviewSessionModal.calculatedCredit || reviewSessionModal.creditEligibility?.eligibleCredit || 0.0} Day(s)
                </span>
              </div>
              {reviewSessionModal.flaggedForReview && (
                <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-800 dark:text-amber-300">
                  <div className="flex items-center gap-1.5 font-bold">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span>Location Flagged for Review:</span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground italic">
                    "{reviewSessionModal.locationReason || 'Outside permitted geofence'}"
                  </p>
                </div>
              )}
            </div>

            {reviewSessionAction === 'APPROVE' && (
              <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-800 dark:text-emerald-300">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                  <p className="text-[11px] leading-relaxed">
                    <strong>90-Day Validity Rule:</strong> Approving this session will grant <strong className="text-foreground">{reviewSessionModal.calculatedCredit} day(s)</strong> of Comp-Off credit. The 90-day validity window begins today (the grant date).
                  </p>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-extrabold uppercase tracking-wider text-foreground mb-1.5">
                {reviewSessionAction === 'APPROVE' ? 'Admin Remarks (Optional)' : 'Rejection Reason'}{' '}
                {reviewSessionAction === 'REJECT' && <span className="text-rose-500">*</span>}
              </label>
              <textarea
                rows={3}
                placeholder={
                  reviewSessionAction === 'APPROVE'
                    ? 'Optional approval remarks for ledger records...'
                    : 'Explain clearly why this work session is declined (mandatory)...'
                }
                value={reviewSessionRemarks}
                onChange={(e) => setReviewSessionRemarks(e.target.value)}
                className="w-full bg-muted/30 border border-border/70 rounded-xl p-3 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
              <button
                type="button"
                onClick={() => setReviewSessionModal(null)}
                disabled={submittingSessionReview}
                className="px-4 py-2 rounded-xl border border-border hover:bg-muted text-xs font-bold text-muted-foreground cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSessionReview}
                disabled={submittingSessionReview}
                className={`px-5 py-2 rounded-xl text-white text-xs font-extrabold transition-all cursor-pointer ${
                  reviewSessionAction === 'APPROVE'
                    ? 'bg-emerald-600 hover:bg-emerald-700 active:scale-95'
                    : 'bg-rose-600 hover:bg-rose-700 active:scale-95'
                }`}
              >
                {submittingSessionReview
                  ? 'Processing...'
                  : reviewSessionAction === 'APPROVE'
                  ? `Grant ${reviewSessionModal.calculatedCredit} Day(s) Credit`
                  : 'Reject Session'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompOffManagementSection;
