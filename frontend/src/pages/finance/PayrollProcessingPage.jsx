import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import {
  Play, Lock, Eye, CheckCircle2, RotateCcw, Layers, Clock,
  Calendar, CheckCircle, AlertTriangle, ChevronRight, ChevronLeft,
  User, DollarSign, FileText, ArrowRight, ShieldCheck, Info, ExternalLink,
  Search, Filter, BarChart3, Users
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { CRM_MODULE_KEYS } from '../../config/crmModules';
import CompanyScopeSelector from '../../components/common/CompanyScopeSelector';
import { useCompanyScope } from '../../context/CompanyScopeContext';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function PayrollProcessingPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const navigate = useNavigate();
  const { selectedOrgId, effectiveOrgId, loading: orgsLoading, selectedCompany } = useCompanyScope();
  const targetOrg = isSuperAdmin ? selectedOrgId : (effectiveOrgId || user?.organizationId);
  const selectedOrgIdRef = useRef(targetOrg);

  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [activeStep, setActiveStep] = useState(1);
  const [currentBatch, setCurrentBatch] = useState(null);
  const [loading, setLoading] = useState(true);

  // Pre-calculation Validation Stats
  const [validatingStructures, setValidatingStructures] = useState(false);
  const [structureStats, setStructureStats] = useState({
    totalUsers: 0,
    assignedCount: 0,
    missingCount: 0
  });

  // Stage 2 Filters
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Modal States
  const [showLockModal, setShowLockModal] = useState(false);
  const [showRollbackModal, setShowRollbackModal] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState(null);

  // Selected Employee Audit Detail Modal
  const [auditEmployeePayslip, setAuditEmployeePayslip] = useState(null);

  const fetchBatchDetails = async () => {
    try {
      setLoading(true);
      const activeTargetOrg = selectedOrgIdRef.current || targetOrg;
      const params = activeTargetOrg ? { organizationId: activeTargetOrg } : {};
      const res = await api.get(`/payroll/batches?month=${selectedMonth}&year=${selectedYear}`, { params });
      const batchList = Array.isArray(res.data) ? res.data : res.data?.batches || [];
      if (batchList.length > 0) {
        const fullRes = await api.get(`/payroll/batches/${batchList[0].id}`, { params });
        const batch = fullRes.data;
        setCurrentBatch(batch);

        // Synchronize active wizard step based on batch status (4-Stage Mapping)
        if (batch.status === 'PUBLISHED') {
          setActiveStep(4);
        } else if (batch.status === 'REVIEW' || batch.status === 'LOCKED') {
          setActiveStep(3);
        } else if (['PREVIEW', 'DRAFT', 'ROLLED_BACK'].includes(batch.status)) {
          setActiveStep(2);
        } else {
          setActiveStep(1);
        }
      } else {
        setCurrentBatch(null);
        setActiveStep(1);
      }
    } catch (err) {
      console.error('Failed to fetch batch details:', err);
      setCurrentBatch(null);
      setActiveStep(1);
    } finally {
      setLoading(false);
    }
  };

  const fetchStructureValidationStats = async () => {
    try {
      setValidatingStructures(true);
      const activeTargetOrg = selectedOrgIdRef.current || targetOrg;
      const params = activeTargetOrg ? { organizationId: activeTargetOrg } : {};
      const [usersRes, structuresRes] = await Promise.all([
        api.get('/users?limit=1000', { params }).catch(() => ({ data: [] })),
        api.get('/payroll/salary-structures/all', { params }).catch(() => ({ data: [] }))
      ]);

      const usersList = Array.isArray(usersRes.data) ? usersRes.data : usersRes.data?.users || [];
      const structuresList = Array.isArray(structuresRes.data) ? structuresRes.data : [];

      // A user is counted as having an assigned salary structure only when the actual
      // salary structure exists and meets non-zero salary eligibility
      const assignedIds = new Set();
      structuresList.forEach(item => {
        const ss = item.salaryStructure;
        if (ss) {
          const basic = Number(ss.basicSalary || ss.template?.baseSalary || 0);
          const gross = Number(ss.grossSalary || 0);
          const net = Number(ss.netSalary || 0);
          if (basic > 0 || gross > 0 || net > 0) {
            assignedIds.add(item.id);
          }
        } else if (item.userId && (Number(item.basicSalary) > 0 || Number(item.grossSalary) > 0 || Number(item.netSalary) > 0)) {
          assignedIds.add(item.userId);
        }
      });

      // Eligible users for payroll processing: Active users with employee roles, plus Admins only if assigned a salary structure
      const eligibleUsers = usersList.filter(u => {
        if (u.status !== 'ACTIVE') return false;
        if (['INTERN', 'EMPLOYEE', 'TEAM_LEADER'].includes(u.role)) return true;
        if (u.role === 'ADMIN' && assignedIds.has(u.id)) return true;
        return false;
      });

      const assignedCount = eligibleUsers.filter(u => assignedIds.has(u.id)).length;
      const missingCount = Math.max(0, eligibleUsers.length - assignedCount);

      setStructureStats({
        totalUsers: eligibleUsers.length,
        assignedCount,
        missingCount
      });
    } catch (err) {
      console.error('Validation error:', err);
    } finally {
      setValidatingStructures(false);
    }
  };

  useEffect(() => {
    selectedOrgIdRef.current = targetOrg;
    setCurrentBatch(null);
    setActiveStep(1);
    if (orgsLoading) return;
    fetchBatchDetails();
    fetchStructureValidationStats();
  }, [selectedMonth, selectedYear, targetOrg, user?.organizationId, orgsLoading]);

  // Stage 1 Action: Process / Calculate Batch
  const handleProcess = async () => {
    try {
      setActionLoading(true);
      setActionError(null);
      const activeTargetOrg = selectedOrgIdRef.current || targetOrg;
      const res = await api.post('/payroll/batches/process', {
        month: selectedMonth,
        year: selectedYear,
        organizationId: activeTargetOrg
      });
      const batchData = res.data?.batch || res.data;
      setCurrentBatch(batchData);
      await fetchBatchDetails();
      setActiveStep(2);
    } catch (err) {
      setActionError(err.response?.data?.message || err.message || 'Failed to process payroll batch.');
    } finally {
      setActionLoading(false);
    }
  };

  // Stage 3 Action: Controlled Lock & Review Lifecycle Sequence
  const handleLockAndApprove = async () => {
    if (!currentBatch) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const activeTargetOrg = selectedOrgIdRef.current || targetOrg;

      // Sequence 1: If not locked yet, trigger backend lock
      if (currentBatch.status !== 'LOCKED' && currentBatch.status !== 'REVIEW') {
        await api.put(`/payroll/batches/${currentBatch.id}/status`, { status: 'LOCKED' });
      }

      // Sequence 2: Trigger backend review transition
      await api.put(`/payroll/batches/${currentBatch.id}/status`, { status: 'REVIEW' });

      // Refresh full details to sync audit timestamps
      const fullRes = await api.get(`/payroll/batches/${currentBatch.id}`, {
        params: activeTargetOrg ? { organizationId: activeTargetOrg } : {}
      });
      setCurrentBatch(fullRes.data);
      setShowLockModal(false);
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to lock and approve payroll batch.');
      await fetchBatchDetails();
    } finally {
      setActionLoading(false);
    }
  };

  // Stage 4 Action: Publish Batch
  const confirmPublishPayslips = async () => {
    if (!currentBatch) return;
    try {
      setActionLoading(true);
      setActionError(null);
      await api.post(`/payroll/batches/${currentBatch.id}/publish`);
      await fetchBatchDetails();
      setShowPublishModal(false);
      setActiveStep(4);
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to publish payslips.');
    } finally {
      setActionLoading(false);
    }
  };

  // Rollback Action
  const confirmRollbackBatch = async () => {
    if (!currentBatch) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const res = await api.post(`/payroll/batches/${currentBatch.id}/rollback`);
      const updatedBatch = res.data?.batch || res.data;
      setCurrentBatch(updatedBatch);
      await fetchBatchDetails();
      setShowRollbackModal(false);
      setActiveStep(2);
    } catch (err) {
      setActionError(err.response?.data?.message || err.message || 'Failed to rollback payroll batch.');
    } finally {
      setActionLoading(false);
    }
  };

  const formatINR = (val) => `₹${Number(val || 0).toLocaleString('en-IN')}`;
  const { canEdit } = usePermissions();
  const isAdminOrSuperAdmin = canEdit(CRM_MODULE_KEYS.PAYROLL_PROCESS);

  // 4 Consolidated Workflow Stages
  const steps = [
    { title: 'Period & Calculate', stepNum: 1 },
    { title: 'Review Payroll', stepNum: 2 },
    { title: 'Lock & Approve', stepNum: 3 },
    { title: 'Publish Payslips', stepNum: 4 }
  ];

  const getStepStatus = (stepNum) => {
    const statusOrder = {
      'ROLLED_BACK': 2,
      'PREVIEW': 2,
      'DRAFT': 2,
      'LOCKED': 3,
      'REVIEW': 3,
      'PUBLISHED': 4
    };
    const maxCompletedStep = currentBatch ? (statusOrder[currentBatch.status] || 1) : 1;

    if (stepNum === activeStep) return 'active';
    if (stepNum < maxCompletedStep || stepNum < activeStep) return 'completed';
    return 'pending';
  };

  // Unique departments for Stage 2 filtering
  const departmentsList = useMemo(() => {
    if (!currentBatch?.payslips) return ['ALL'];
    const depts = new Set();
    currentBatch.payslips.forEach(ps => {
      const d = ps.user?.department;
      if (d) depts.add(d);
    });
    return ['ALL', ...Array.from(depts)];
  }, [currentBatch]);

  // Filtered employee payslips for Stage 2
  const filteredPayslips = useMemo(() => {
    if (!currentBatch?.payslips) return [];
    return currentBatch.payslips.filter(ps => {
      const name = ps.user?.name?.toLowerCase() || '';
      const email = ps.user?.email?.toLowerCase() || '';
      const empId = (ps.user?.employeeId || '').toLowerCase();
      const q = employeeSearch.toLowerCase();
      const matchesSearch = !q || name.includes(q) || email.includes(q) || empId.includes(q);

      const dept = ps.user?.department || 'General';
      const matchesDept = departmentFilter === 'ALL' || dept === departmentFilter;

      const isAssigned = ps.allowancesJson?.structureAssigned !== false && (ps.basicSalary > 0 || ps.grossSalary > 0);
      const matchesStatus = statusFilter === 'ALL'
        || (statusFilter === 'READY' && isAssigned)
        || (statusFilter === 'MISSING' && !isAssigned);

      return matchesSearch && matchesDept && matchesStatus;
    });
  }, [currentBatch, employeeSearch, departmentFilter, statusFilter]);

  return (
    <div className="space-y-6 text-left font-sans w-full max-w-7xl mx-auto">
      {/* Company Scope Selector */}
      <CompanyScopeSelector />

      {/* 1. Header */}
      <div className="bg-card border border-border/80 p-6 rounded-2xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-foreground flex items-center gap-2">
            <Layers className="w-6 h-6 text-primary" /> Payroll Processing Desk
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            4-Stage streamlined monthly payroll: configure period, review calculations, lock & approve, and publish payslips.
          </p>
        </div>

        {/* Selected Period Badge in Header */}
        <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 text-primary px-3 py-1.5 rounded-xl text-xs font-bold">
          <Calendar className="w-4 h-4" />
          <span>{MONTH_NAMES[selectedMonth - 1]} {selectedYear}</span>
          {currentBatch && (
            <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
              currentBatch.status === 'PUBLISHED' ? 'bg-success/20 text-success' :
              currentBatch.status === 'REVIEW' ? 'bg-blue-500/20 text-blue-600' :
              currentBatch.status === 'LOCKED' ? 'bg-amber-500/20 text-amber-600' :
              'bg-primary/20 text-primary'
            }`}>
              {currentBatch.status}
            </span>
          )}
        </div>
      </div>

      {/* 2. Stepper Indicator (4 Clean Stages) */}
      <div className="bg-card border border-border/80 p-5 rounded-2xl shadow-sm">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {steps.map((step) => {
            const status = getStepStatus(step.stepNum);
            const statusOrder = { 'ROLLED_BACK': 2, 'PREVIEW': 2, 'DRAFT': 2, 'LOCKED': 3, 'REVIEW': 3, 'PUBLISHED': 4 };
            const maxAllowed = currentBatch ? (statusOrder[currentBatch.status] || 1) : 1;
            const canClick = step.stepNum <= activeStep || step.stepNum <= maxAllowed;

            return (
              <button
                key={step.stepNum}
                disabled={!canClick}
                onClick={() => {
                  if (canClick) {
                    setActiveStep(step.stepNum);
                  }
                }}
                className={`p-3.5 rounded-xl border text-center transition-all ${
                  canClick ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                } ${
                  status === 'completed'
                    ? 'bg-primary/10 border-primary/30 text-primary font-bold'
                    : status === 'active'
                    ? 'bg-primary text-white font-black shadow-md shadow-primary/20 border-primary ring-2 ring-primary/20'
                    : 'bg-muted/30 border-border/60 text-muted-foreground hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center justify-center gap-1 text-[10px] font-black uppercase tracking-wider mb-1">
                  {status === 'completed' ? (
                    <CheckCircle className="w-3.5 h-3.5 text-primary" />
                  ) : null}
                  <span>Stage {step.stepNum}</span>
                </div>
                <span className="text-xs font-extrabold block truncate">{step.title}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Error Alert if any action failed */}
      {actionError && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 text-xs font-bold flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-xs hover:underline cursor-pointer">Dismiss</button>
        </div>
      )}

      {/* ==================== STAGE 1: PERIOD & CALCULATE ==================== */}
      {activeStep === 1 && (
        <div className="bg-card border border-border/80 p-6 sm:p-8 rounded-2xl shadow-sm space-y-6 max-w-3xl mx-auto">
          <div className="space-y-2 text-center">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
              <Calendar className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-black text-foreground tracking-tight">Stage 1 — Select Period & Calculate</h2>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Select the payroll month and year, inspect active employee eligibility, and run calculations.
            </p>
          </div>

          {/* Period Selector Form */}
          <div className="grid grid-cols-2 gap-4 max-w-md mx-auto bg-muted/30 p-5 rounded-2xl border border-border/60">
            <div className="space-y-1 text-left">
              <label className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground block">Month</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="w-full bg-background border border-border/80 rounded-xl px-3 py-2 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
              >
                {MONTH_NAMES.map((name, idx) => (
                  <option key={idx + 1} value={idx + 1}>{name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1 text-left">
              <label className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground block">Year</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="w-full bg-background border border-border/80 rounded-xl px-3 py-2 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
              >
                {[2024, 2025, 2026, 2027].map((yr) => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Eligibility & Structure Validation KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-xl border border-border/60 bg-muted/20 text-left">
              <span className="text-[10px] font-extrabold uppercase text-muted-foreground block">Active Staff Employees</span>
              <span className="text-xl font-black text-foreground mt-1 block">
                {validatingStructures ? '...' : structureStats.totalUsers}
              </span>
              <p className="text-[11px] text-muted-foreground mt-1">Eligible active payroll personnel</p>
            </div>

            <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 text-left">
              <span className="text-[10px] font-extrabold uppercase text-primary block">Structures Assigned</span>
              <span className="text-xl font-black text-primary mt-1 block">
                {validatingStructures ? '...' : structureStats.assignedCount}
              </span>
              <p className="text-[11px] text-muted-foreground mt-1">Ready for automated calculation</p>
            </div>

            <div className={`p-4 rounded-xl border text-left ${structureStats.missingCount > 0 ? 'border-amber-500/30 bg-amber-500/5' : 'border-border/60 bg-muted/20'}`}>
              <span className={`text-[10px] font-extrabold uppercase block ${structureStats.missingCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                Missing Structures
              </span>
              <span className={`text-xl font-black mt-1 block ${structureStats.missingCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                {validatingStructures ? '...' : structureStats.missingCount}
              </span>
              <p className="text-[11px] text-muted-foreground mt-1">Excluded until structure is assigned</p>
            </div>
          </div>

          {/* Missing Structure Warning & Link */}
          {structureStats.missingCount > 0 && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-bold flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-left">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
                <span>
                  ⚠ {structureStats.missingCount} employee(s) lack assigned salary structures and will be excluded from payroll calculation.
                </span>
              </div>
              <button
                onClick={() => navigate('/payroll/structures')}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
              >
                Assign Structures
              </button>
            </div>
          )}

          {/* Existing Batch Notice */}
          {currentBatch && (
            <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 text-xs flex items-center justify-between">
              <div>
                <span className="font-bold text-foreground">Existing Batch Found for {MONTH_NAMES[selectedMonth - 1]} {selectedYear}: </span>
                <span className="font-extrabold text-primary">{currentBatch.status}</span>
                <span className="text-muted-foreground ml-2">({currentBatch.totalEmployees} employees • Net: {formatINR(currentBatch.totalNet)})</span>
              </div>
              <button
                onClick={() => setActiveStep(2)}
                className="text-xs font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>View Batch</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Stage 1 Actions */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
            {isAdminOrSuperAdmin && (
              <button
                onClick={handleProcess}
                disabled={actionLoading}
                className="w-full sm:w-auto px-6 py-3 bg-primary hover:bg-primary-hover text-white font-black text-xs rounded-xl shadow-lg shadow-primary/20 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>{actionLoading ? 'Calculating Payroll...' : currentBatch ? 'Recalculate Payroll Batch' : 'Calculate Payroll'}</span>
              </button>
            )}

            {currentBatch && (
              <button
                onClick={() => setActiveStep(2)}
                className="w-full sm:w-auto px-6 py-3 border border-border text-foreground hover:bg-muted font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <span>Continue to Review</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ==================== STAGE 2: REVIEW EMPLOYEE PAYROLL ==================== */}
      {activeStep === 2 && (
        <div className="space-y-6">
          <div className="bg-card border border-border/80 p-6 rounded-2xl shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
              <div>
                <h2 className="text-lg font-black text-foreground">
                  Stage 2 — Review Employee Payroll ({MONTH_NAMES[selectedMonth - 1]} {selectedYear})
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Audit itemized salaries, allowances, attendance, and deductions before proceeding to lock & approval.
                </p>
              </div>

              {currentBatch && (
                <span className={`px-3 py-1 rounded-full text-xs font-black uppercase ${
                  currentBatch.status === 'PUBLISHED' ? 'bg-success/10 text-success border border-success/20' :
                  currentBatch.status === 'LOCKED' ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20' :
                  currentBatch.status === 'REVIEW' ? 'bg-blue-500/10 text-blue-600 border border-blue-500/20' :
                  'bg-primary/10 text-primary border border-primary/20'
                }`}>
                  Batch Status: {currentBatch.status}
                </span>
              )}
            </div>

            {/* Batch Totals Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-4 rounded-xl border border-border/60 bg-muted/20 text-left">
                <span className="text-[10px] font-extrabold uppercase text-muted-foreground block">Employees Included</span>
                <span className="text-xl font-black text-foreground mt-1 block">
                  {currentBatch?.payslips?.length || currentBatch?.totalEmployees || 0}
                </span>
              </div>
              <div className="p-4 rounded-xl border border-border/60 bg-muted/20 text-left">
                <span className="text-[10px] font-extrabold uppercase text-muted-foreground block">Gross Payroll</span>
                <span className="text-xl font-black text-foreground mt-1 block">
                  {currentBatch ? formatINR(currentBatch.totalGross) : '₹0'}
                </span>
              </div>
              <div className="p-4 rounded-xl border border-border/60 bg-muted/20 text-left">
                <span className="text-[10px] font-extrabold uppercase text-muted-foreground block">Total Deductions</span>
                <span className="text-xl font-black text-destructive mt-1 block">
                  {currentBatch ? `-${formatINR(currentBatch.totalDeductions)}` : '₹0'}
                </span>
              </div>
              <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 text-left">
                <span className="text-[10px] font-extrabold uppercase text-primary block">Net Payroll</span>
                <span className="text-xl font-black text-primary mt-1 block">
                  {currentBatch ? formatINR(currentBatch.totalNet) : '₹0'}
                </span>
              </div>
            </div>

            {/* Search and Filters Toolbar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
              <div className="flex flex-wrap items-center gap-2 flex-1">
                <div className="relative flex-1 sm:w-64">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search by name, ID or email..."
                    value={employeeSearch}
                    onChange={(e) => setEmployeeSearch(e.target.value)}
                    className="w-full bg-muted/40 border border-border rounded-xl pl-9 pr-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="bg-muted/40 border border-border rounded-xl px-3 py-1.5 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                >
                  {departmentsList.map(d => (
                    <option key={d} value={d}>{d === 'ALL' ? 'All Departments' : d}</option>
                  ))}
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-muted/40 border border-border rounded-xl px-3 py-1.5 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="READY">Ready</option>
                  <option value="MISSING">Missing Structure</option>
                </select>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveStep(1)}
                  className="px-3.5 py-2 border border-border rounded-xl text-xs font-bold text-foreground hover:bg-muted transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <ChevronLeft className="w-4 h-4" /> Change Period
                </button>

                {isAdminOrSuperAdmin && (
                  <button
                    onClick={handleProcess}
                    disabled={actionLoading}
                    className="px-4 py-2 border border-border rounded-xl text-xs font-bold text-foreground hover:bg-muted transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Recalculate
                  </button>
                )}

                {isAdminOrSuperAdmin && currentBatch && (
                  <button
                    onClick={() => setActiveStep(3)}
                    className="px-5 py-2 bg-primary hover:bg-primary-hover text-white font-bold text-xs rounded-xl shadow-md shadow-primary/20 transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <span>Proceed to Lock & Approve</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Itemized Employee Table */}
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading batch details...</p>
          ) : currentBatch && currentBatch.payslips?.length > 0 ? (
            <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
              <div className="p-4 bg-muted/40 border-b border-border flex items-center justify-between">
                <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  Itemized Payroll Ledger ({filteredPayslips.length} of {currentBatch.payslips.length} Members)
                </h3>
                <span className="text-xs text-muted-foreground font-semibold">
                  Gross: {formatINR(currentBatch.totalGross)} | Deductions: {formatINR(currentBatch.totalDeductions)} | Net: {formatINR(currentBatch.totalNet)}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 border-b border-border text-muted-foreground font-bold uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-3 px-3.5 text-left min-w-[220px]">Members</th>
                      <th className="py-3 px-3 text-right min-w-[90px]">Basic</th>
                      <th className="py-3 px-3 text-right min-w-[95px]">Allowances</th>
                      <th className="py-3 px-3.5 text-left min-w-[190px]">ATTENDANCE (PRESENT / TOTAL WORKING DAYS)</th>
                      <th className="py-3 px-3 text-right min-w-[115px]">LOP Deduction</th>
                      <th className="py-3 px-3 text-right min-w-[110px]">Late Deduction</th>
                      <th className="py-3 px-3 text-right min-w-[125px]">Other Deductions</th>
                      <th className="py-3 px-3 text-right min-w-[110px]">Gross Salary</th>
                      <th className="py-3 px-3 text-right min-w-[120px]">Total Deductions</th>
                      <th className="py-3 px-3.5 text-right min-w-[120px]">Net Salary</th>
                      <th className="py-3 px-3 text-center min-w-[105px]">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredPayslips.map(ps => {
                      const isAssigned = ps.allowancesJson?.structureAssigned !== false && (ps.basicSalary > 0 || ps.grossSalary > 0);
                      const allowancesTotal = Math.max(0, ps.grossSalary - ps.basicSalary);
                      const leaveDeduction = ps.deductionsJson?.leaveDeduction || 0;
                      const lateDeduction = ps.lateDeduction || ps.deductionsJson?.lateDeduction || 0;
                      const totalDeductions = Math.max(0, ps.grossSalary - ps.netSalary);
                      const otherDeductions = Math.max(0, totalDeductions - leaveDeduction - lateDeduction);

                      return (
                        <tr key={ps.id} className={`hover:bg-muted/30 transition-colors ${!isAssigned ? 'bg-amber-500/5' : ''}`}>
                          {/* Members: Name, ID, Department on one single line */}
                          <td className="py-3 px-3.5 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-foreground text-xs truncate max-w-[140px]" title={ps.user?.name}>
                                {ps.user?.name}
                              </span>
                              <span className="text-[11px] text-muted-foreground font-mono shrink-0">
                                {ps.user?.employeeId || 'EMP-' + ps.user?.id?.substring(0, 4)}
                              </span>
                              <span
                                className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 shrink-0 whitespace-nowrap truncate max-w-[120px]"
                                title={ps.user?.department || 'General'}
                              >
                                {ps.user?.department || 'General'}
                              </span>
                            </div>
                          </td>

                          {/* Basic Salary */}
                          <td className="py-3 px-3 text-right font-semibold whitespace-nowrap">
                            {isAssigned ? formatINR(ps.basicSalary) : <span className="text-muted-foreground">—</span>}
                          </td>

                          {/* Allowances Total */}
                          <td className="py-3 px-3 text-right text-muted-foreground whitespace-nowrap">
                            {isAssigned ? formatINR(allowancesTotal) : <span className="text-muted-foreground">—</span>}
                          </td>

                          {/* Compact Attendance Summary */}
                          <td className="py-3 px-3.5 text-left leading-tight whitespace-nowrap">
                            <div className="flex items-center gap-1.5 font-bold text-foreground">
                              <span>{ps.presentDays} / {ps.workingDays} days</span>
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                              <span>Paid: {ps.paidLeaveDays || 0}d</span>
                              <span>•</span>
                              <span className={ps.unpaidAbsentDays > 0 ? "text-destructive font-bold" : ""}>
                                LOP: {ps.unpaidAbsentDays || 0}d
                              </span>
                              {ps.presentDays === 0 && isAssigned && (
                                <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1 py-0.2 rounded border border-amber-500/20 ml-1">
                                  No clock-ins
                                </span>
                              )}
                            </div>
                          </td>

                          {/* LOP Deduction */}
                          <td className="py-3 px-3 text-right font-semibold whitespace-nowrap">
                            {isAssigned && leaveDeduction > 0 ? (
                              <span className="text-destructive font-bold">-{formatINR(leaveDeduction)}</span>
                            ) : (
                              <span className="text-muted-foreground">₹0</span>
                            )}
                          </td>

                          {/* Late Deduction */}
                          <td className="py-3 px-3 text-right font-semibold whitespace-nowrap">
                            {isAssigned && lateDeduction > 0 ? (
                              <span className="text-destructive font-bold">-{formatINR(lateDeduction)}</span>
                            ) : (
                              <span className="text-muted-foreground">₹0</span>
                            )}
                          </td>

                          {/* Other Deductions (Statutory PF/ESI/PT/Tax + Custom) */}
                          <td className="py-3 px-3 text-right font-semibold whitespace-nowrap">
                            {isAssigned && otherDeductions > 0 ? (
                              <span className="text-destructive font-medium" title="Statutory PF, ESI, Taxes & Structure Deductions">
                                -{formatINR(otherDeductions)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">₹0</span>
                            )}
                          </td>

                          {/* Gross Salary (Visually Prominent) */}
                          <td className="py-3 px-3 text-right font-black text-foreground whitespace-nowrap">
                            {isAssigned ? formatINR(ps.grossSalary) : <span className="text-muted-foreground">—</span>}
                          </td>

                          {/* Total Deductions (Visually Prominent) */}
                          <td className="py-3 px-3 text-right font-bold text-destructive whitespace-nowrap">
                            {isAssigned && totalDeductions > 0 ? (
                              `-${formatINR(totalDeductions)}`
                            ) : isAssigned ? (
                              <span className="text-muted-foreground">₹0</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>

                          {/* Net Salary (Visually Prominent) */}
                          <td className="py-3 px-3.5 text-right font-black text-sm whitespace-nowrap">
                            {isAssigned ? (
                              <span className="text-primary font-black bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-lg inline-block">
                                {formatINR(ps.netSalary)}
                              </span>
                            ) : (
                              <span className="text-amber-600 font-bold">₹0</span>
                            )}
                          </td>

                          {/* Status & View Details Action */}
                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1.5">
                              {isAssigned ? (
                                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/20">
                                  Ready
                                </span>
                              ) : (
                                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20">
                                  Missing
                                </span>
                              )}
                              <button
                                onClick={() => setAuditEmployeePayslip(ps)}
                                className="px-2 py-0.5 bg-primary/10 hover:bg-primary/20 text-primary font-bold text-[11px] rounded-lg transition-all cursor-pointer"
                                title="View detailed calculation breakdown"
                              >
                                View
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-2xl p-12 text-center text-muted-foreground space-y-2">
              <Clock className="w-8 h-8 mx-auto opacity-50 text-primary" />
              <p className="font-bold text-foreground">No Payroll Batch Processed for {MONTH_NAMES[selectedMonth - 1]} {selectedYear}</p>
              <p className="text-xs">Click "Calculate Payroll" in Stage 1 to generate batch calculations.</p>
              <button
                onClick={() => setActiveStep(1)}
                className="mt-3 px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl"
              >
                Go to Stage 1
              </button>
            </div>
          )}
        </div>
      )}

      {/* ==================== STAGE 3: LOCK & APPROVE ==================== */}
      {activeStep === 3 && (
        <div className="bg-card border border-border/80 p-6 sm:p-8 rounded-2xl shadow-sm space-y-6 max-w-3xl mx-auto text-left">
          <div className="flex items-center justify-between border-b border-border/40 pb-4">
            <div className="space-y-1">
              <h2 className="text-xl font-black text-foreground">Stage 3 — Lock & Approve Batch</h2>
              <p className="text-xs text-muted-foreground">
                Freeze batch against retroactive mutations and execute final administrative review before publication.
              </p>
            </div>

            <span className={`px-3 py-1 rounded-full text-xs font-black uppercase ${
              currentBatch?.status === 'REVIEW' ? 'bg-blue-500/10 text-blue-600 border border-blue-500/20' :
              currentBatch?.status === 'LOCKED' ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20' :
              'bg-primary/10 text-primary border border-primary/20'
            }`}>
              Status: {currentBatch?.status || 'PREVIEW'}
            </span>
          </div>

          {/* Batch Metrics Summary Card */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-muted/20 p-5 rounded-2xl border border-border/60">
            <div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase block">Period</span>
              <span className="text-sm font-black text-foreground">{MONTH_NAMES[selectedMonth - 1]} {selectedYear}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase block">Employees</span>
              <span className="text-sm font-black text-foreground">{currentBatch?.totalEmployees || 0}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase block">Total Deductions</span>
              <span className="text-sm font-black text-destructive">-{formatINR(currentBatch?.totalDeductions)}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase block">Net Payout</span>
              <span className="text-sm font-black text-primary">{formatINR(currentBatch?.totalNet)}</span>
            </div>
          </div>

          {/* Status-specific Safeguard Feedback */}
          {currentBatch?.status === 'REVIEW' ? (
            <div className="p-5 rounded-2xl bg-blue-500/10 border border-blue-500/20 space-y-2">
              <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 font-bold text-sm">
                <CheckCircle className="w-5 h-5 text-blue-600" />
                <span>✓ Payroll Batch Locked & Approved for Publication</span>
              </div>
              <p className="text-xs text-muted-foreground">
                All itemized records are frozen and verified. You may proceed to Stage 4 to publish official employee payslips.
              </p>
            </div>
          ) : currentBatch?.status === 'LOCKED' ? (
            <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/20 space-y-2">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 font-bold text-sm">
                <CheckCircle className="w-5 h-5 text-amber-600" />
                <span>✓ Payroll Batch Locked</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Calculations are locked. Confirm administrative review to authorize publication.
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-medium flex items-center gap-2">
              <Info className="w-4 h-4 shrink-0" />
              <span>Locking & approving will freeze employee attendance, leaves, and salary structures for this cycle.</span>
            </div>
          )}

          {/* Audit Verification Checklist */}
          <div className="bg-primary/5 border border-primary/20 p-4 rounded-xl text-left space-y-2">
            <span className="text-xs font-extrabold text-primary uppercase tracking-wider block">
              Pre-Approval Safeguards Verified
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-semibold text-foreground">
              <span className="flex items-center gap-1.5 text-primary">
                <CheckCircle className="w-4 h-4" /> Structure assignments verified
              </span>
              <span className="flex items-center gap-1.5 text-primary">
                <CheckCircle className="w-4 h-4" /> Attendance & leave days reconciled
              </span>
              <span className="flex items-center gap-1.5 text-primary">
                <CheckCircle className="w-4 h-4" /> Statutory deductions computed
              </span>
              <span className="flex items-center gap-1.5 text-primary">
                <CheckCircle className="w-4 h-4" /> Net pay sums equal batch total
              </span>
              <span className="flex items-center gap-1.5 text-primary">
                <CheckCircle className="w-4 h-4" /> No duplicate records
              </span>
              <span className="flex items-center gap-1.5 text-primary">
                <CheckCircle className="w-4 h-4" /> Tenant isolation enforced
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-border/40">
            <button
              onClick={() => setActiveStep(2)}
              className="px-4 py-2 border border-border rounded-xl text-xs font-bold text-foreground hover:bg-muted transition-all cursor-pointer flex items-center gap-1.5"
            >
              <ChevronLeft className="w-4 h-4" /> Back to Review
            </button>

            {isAdminOrSuperAdmin && (
              <div className="flex items-center gap-2">
                {/* Rollback allowed only if not published */}
                {['LOCKED', 'REVIEW', 'PREVIEW'].includes(currentBatch?.status) && (
                  <button
                    onClick={() => setShowRollbackModal(true)}
                    className="px-4 py-2 bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/20 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-4 h-4" /> Rollback & Recalculate
                  </button>
                )}

                {currentBatch?.status === 'REVIEW' ? (
                  <button
                    onClick={() => setActiveStep(4)}
                    className="px-5 py-2.5 bg-primary hover:bg-primary-hover text-white font-bold text-xs rounded-xl shadow-md shadow-primary/20 transition-all cursor-pointer flex items-center gap-2"
                  >
                    <span>Continue to Publish</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => setShowLockModal(true)}
                    disabled={actionLoading || !currentBatch}
                    className="px-5 py-2.5 bg-primary hover:bg-primary-hover text-white font-bold text-xs rounded-xl shadow-md shadow-primary/20 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50"
                  >
                    <Lock className="w-4 h-4" />
                    <span>{actionLoading ? 'Locking...' : 'Lock & Approve Batch'}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== STAGE 4: PUBLISH PAYSLIPS ==================== */}
      {activeStep === 4 && (
        <div className="bg-card border border-border/80 p-6 sm:p-8 rounded-2xl shadow-sm space-y-6 max-w-3xl mx-auto text-left">
          <div className="flex items-center justify-between border-b border-border/40 pb-4">
            <div className="space-y-1">
              <h2 className="text-xl font-black text-foreground">Stage 4 — Publish Payslips</h2>
              <p className="text-xs text-muted-foreground">
                Finalize this payroll batch and release official employee payslips to employee portals.
              </p>
            </div>

            <span className={`px-3 py-1 rounded-full text-xs font-black uppercase ${
              currentBatch?.status === 'PUBLISHED' ? 'bg-success/10 text-success border border-success/20' : 'bg-blue-500/10 text-blue-600 border border-blue-500/20'
            }`}>
              {currentBatch?.status || 'REVIEW'}
            </span>
          </div>

          {/* Final Summary Card */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-muted/20 p-5 rounded-2xl border border-border/60">
            <div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase block">Payroll Period</span>
              <span className="text-sm font-black text-foreground">{MONTH_NAMES[selectedMonth - 1]} {selectedYear}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase block">Employees Paid</span>
              <span className="text-sm font-black text-foreground">{currentBatch?.totalEmployees || 0}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase block">Gross Payroll</span>
              <span className="text-sm font-black text-foreground">{formatINR(currentBatch?.totalGross)}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase block">Net Payout</span>
              <span className="text-sm font-black text-primary">{formatINR(currentBatch?.totalNet)}</span>
            </div>
          </div>

          {currentBatch?.status === 'PUBLISHED' ? (
            <div className="p-6 rounded-2xl bg-success/10 border border-success/20 space-y-4">
              <div className="flex items-center gap-2 text-success font-black text-base">
                <CheckCircle className="w-6 h-6" />
                <span>✓ Payroll Published Successfully</span>
              </div>
              <p className="text-xs text-muted-foreground">
                All employee payslips for {MONTH_NAMES[selectedMonth - 1]} {selectedYear} are now finalized and accessible in the employee portal.
              </p>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2 border-t border-success/20">
                <span className="text-xs text-muted-foreground">
                  Published By: <strong className="text-foreground">{currentBatch.processedBy?.name || 'System Admin'}</strong>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate('/payroll/payslips')}
                    className="px-5 py-2 bg-primary hover:bg-primary-hover text-white rounded-xl font-bold text-xs transition-all shadow-md shadow-primary/20 cursor-pointer flex items-center gap-1.5"
                  >
                    <FileText className="w-4 h-4" /> Go to Payslip Desk
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 text-xs font-medium flex items-center gap-2">
                <Info className="w-4 h-4 shrink-0" />
                <span>Publishing will finalize this payroll batch and generate individual employee payslips.</span>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-border/40">
                <button
                  onClick={() => setActiveStep(3)}
                  className="px-4 py-2 border border-border rounded-xl text-xs font-bold text-foreground hover:bg-muted transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <ChevronLeft className="w-4 h-4" /> Back to Lock & Approve
                </button>

                {isAdminOrSuperAdmin && (
                  <button
                    onClick={() => setShowPublishModal(true)}
                    disabled={actionLoading || !currentBatch}
                    className="px-6 py-3 bg-primary hover:bg-primary-hover text-white font-black text-xs rounded-xl shadow-lg shadow-primary/20 transition-all cursor-pointer flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Publish Payslips</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== MODALS ==================== */}

      {/* Lock & Approve Modal */}
      {showLockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card border border-border/80 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl text-left">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-foreground">Lock & Approve Payroll Batch?</h3>
                <p className="text-xs text-muted-foreground">{MONTH_NAMES[selectedMonth - 1]} {selectedYear}</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              You are about to lock and approve calculations for {MONTH_NAMES[selectedMonth - 1]} {selectedYear} ({currentBatch?.totalEmployees || 0} employees). Once locked, figures cannot be edited without rolling back.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowLockModal(false)}
                disabled={actionLoading}
                className="px-4 py-2 border border-border rounded-xl text-xs font-bold text-foreground hover:bg-muted cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleLockAndApprove}
                disabled={actionLoading}
                className="px-5 py-2 bg-primary hover:bg-primary-hover text-white font-bold text-xs rounded-xl shadow-md shadow-primary/20 cursor-pointer flex items-center gap-1.5"
              >
                {actionLoading ? 'Approving...' : 'Lock & Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Publish Payslips Modal */}
      {showPublishModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card border border-border/80 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl text-left">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-foreground">Publish Payslips?</h3>
                <p className="text-xs text-muted-foreground">{MONTH_NAMES[selectedMonth - 1]} {selectedYear}</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              You are about to publish official employee payslips for {MONTH_NAMES[selectedMonth - 1]} {selectedYear}. Affected employees will be notified immediately.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowPublishModal(false)}
                disabled={actionLoading}
                className="px-4 py-2 border border-border rounded-xl text-xs font-bold text-foreground hover:bg-muted cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmPublishPayslips}
                disabled={actionLoading}
                className="px-5 py-2 bg-primary hover:bg-primary-hover text-white font-bold text-xs rounded-xl shadow-md shadow-primary/20 cursor-pointer flex items-center gap-1.5"
              >
                {actionLoading ? 'Publishing...' : 'Publish Payslips'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rollback Modal */}
      {showRollbackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card border border-border/80 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl text-left">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center font-bold">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-foreground">Rollback Payroll Batch?</h3>
                <p className="text-xs text-muted-foreground">{MONTH_NAMES[selectedMonth - 1]} {selectedYear}</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to roll back this payroll batch? The batch will return to a recalculable state.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowRollbackModal(false)}
                disabled={actionLoading}
                className="px-4 py-2 border border-border rounded-xl text-xs font-bold text-foreground hover:bg-muted cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmRollbackBatch}
                disabled={actionLoading}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5"
              >
                {actionLoading ? 'Rolling Back...' : 'Rollback'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Employee Audit Details Modal */}
      {auditEmployeePayslip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card border border-border/80 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl text-left max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div>
                <h3 className="text-sm font-black text-foreground">{auditEmployeePayslip.user?.name}</h3>
                <p className="text-[11px] text-muted-foreground">
                  {auditEmployeePayslip.user?.employeeId || 'EMP-' + auditEmployeePayslip.user?.id?.substring(0, 6)} • {auditEmployeePayslip.user?.role} • {auditEmployeePayslip.user?.department || 'General'}
                </p>
              </div>
              <button onClick={() => setAuditEmployeePayslip(null)} className="text-xs font-bold text-muted-foreground hover:text-foreground cursor-pointer">✕</button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Structure Check */}
              <div className="p-3 rounded-xl bg-muted/30 border border-border/60 space-y-1">
                <span className="font-extrabold text-foreground uppercase tracking-wider block text-[10px]">Salary Structure Summary</span>
                <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                  <p>Basic Salary: <strong className="text-foreground">{formatINR(auditEmployeePayslip.basicSalary)}</strong></p>
                  <p>HRA: <strong className="text-foreground">{formatINR(auditEmployeePayslip.hra)}</strong></p>
                </div>
              </div>

              {/* Attendance Breakdown */}
              <div className="p-3 rounded-xl bg-muted/30 border border-border/60 space-y-1">
                <span className="font-extrabold text-foreground uppercase tracking-wider block text-[10px]">Attendance & Schedule Breakdown</span>
                <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                  <p>Scheduled Working Days: <strong className="text-foreground">{auditEmployeePayslip.workingDays || 0}d</strong></p>
                  <p>Present Days: <strong className="text-foreground">{auditEmployeePayslip.presentDays || 0}d</strong></p>
                  <p>Paid Leave Days: <strong className="text-foreground">{auditEmployeePayslip.paidLeaveDays || 0}d</strong></p>
                  <p>Unpaid / LOP Days: <strong className="text-destructive">{auditEmployeePayslip.unpaidAbsentDays || 0}d</strong></p>
                  <p>Payable Days: <strong className="text-primary font-bold">{auditEmployeePayslip.allowancesJson?.payableDays ?? Math.max(0, (auditEmployeePayslip.workingDays || 0) - (auditEmployeePayslip.unpaidAbsentDays || 0))}d</strong></p>
                  <p>WFH Days: <strong className="text-foreground">{auditEmployeePayslip.wfhDays || 0}d</strong></p>
                </div>
              </div>

              {/* Missing Attendance Warnings */}
              {auditEmployeePayslip.presentDays === 0 && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                  <span>Warning: No attendance records found for scheduled working days in this payroll period. Full unpaid absence deductions applied.</span>
                </div>
              )}
              {auditEmployeePayslip.presentDays > 0 && auditEmployeePayslip.unpaidAbsentDays > 0 && (
                <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Warning: {auditEmployeePayslip.unpaidAbsentDays} day(s) missing attendance / unpaid absence deducted (-{formatINR(auditEmployeePayslip.deductionsJson?.leaveDeduction || 0)}).</span>
                </div>
              )}

              {/* Overtime & Holiday Work */}
              <div className="p-3 rounded-xl bg-muted/30 border border-border/60 space-y-1">
                <span className="font-extrabold text-foreground uppercase tracking-wider block text-[10px]">Additional Earnings</span>
                <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                  <p>Overtime ({auditEmployeePayslip.overtimeHours}h): <strong className="text-primary">+{formatINR(auditEmployeePayslip.overtimePay)}</strong></p>
                  <p>Holiday ({auditEmployeePayslip.holidayDaysWorked}d): <strong className="text-primary">+{formatINR(auditEmployeePayslip.holidayPay)}</strong></p>
                </div>
              </div>

              {/* Itemized Deductions */}
              <div className="p-3 rounded-xl bg-muted/30 border border-border/60 space-y-1">
                <span className="font-extrabold text-foreground uppercase tracking-wider block text-[10px]">Deductions</span>
                <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                  <p>PF Deduction: <strong className="text-destructive">-{formatINR(auditEmployeePayslip.deductionsJson?.pfDeduction)}</strong></p>
                  <p>ESI Deduction: <strong className="text-destructive">-{formatINR(auditEmployeePayslip.deductionsJson?.esiDeduction)}</strong></p>
                  <p>Prof Tax: <strong className="text-destructive">-{formatINR(auditEmployeePayslip.deductionsJson?.profTax)}</strong></p>
                  <p>Income Tax: <strong className="text-destructive">-{formatINR(auditEmployeePayslip.deductionsJson?.incomeTax)}</strong></p>
                  <p>Other Deductions: <strong className="text-destructive">-{formatINR(auditEmployeePayslip.deductionsJson?.otherDeductions || 0)}</strong></p>
                  <p>Late Deduction{auditEmployeePayslip.deductionsJson?.deductibleLates > 0 ? ` (Late ${auditEmployeePayslip.deductionsJson.deductibleLates})` : ''}: <strong className="text-destructive">-{formatINR(auditEmployeePayslip.lateDeduction)}</strong></p>
                  <p>Leave LOP Deduction: <strong className="text-destructive">-{formatINR(auditEmployeePayslip.deductionsJson?.leaveDeduction)}</strong></p>
                </div>
              </div>

              {/* Final Totals */}
              <div className="p-4 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-between text-foreground font-black text-sm">
                <span>Net Salary Payable:</span>
                <span className="text-primary">{formatINR(auditEmployeePayslip.netSalary)}</span>
              </div>
            </div>

            <button
              onClick={() => setAuditEmployeePayslip(null)}
              className="w-full bg-primary text-white font-bold py-2 rounded-xl text-xs transition-all cursor-pointer"
            >
              Close Details
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
