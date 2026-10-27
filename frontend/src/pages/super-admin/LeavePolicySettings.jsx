import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CompanyScopeSelector from '../../components/common/CompanyScopeSelector';
import {
  Calendar,
  Settings,
  Plus,
  Edit2,
  Trash2,
  CheckCircle,
  AlertCircle,
  Shield,
  RotateCcw,
  Clock,
  Briefcase,
  FileText,
  Sliders,
  Sparkles,
  Lock,
  Layers,
  Search,
  Check,
  X,
  Stethoscope,
  Award,
  DollarSign,
  Building2,
  Users
} from 'lucide-react';
import api from '../../services/api';
import ConfirmModal from '../../components/common/ConfirmModal';
import ToggleSwitch from '../../components/common/ToggleSwitch';

const extractCompanyList = (responseData) => {
  if (Array.isArray(responseData)) return responseData;
  if (Array.isArray(responseData?.data)) return responseData.data;
  if (Array.isArray(responseData?.organizations)) return responseData.organizations;
  if (Array.isArray(responseData?.companies)) return responseData.companies;
  return [];
};

import { useAuth } from '../../context/AuthContext';
import { useCompanyScope } from '../../context/CompanyScopeContext';

const LeavePolicySettings = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const { selectedOrgId, effectiveOrgId, companies: scopeCompanies } = useCompanyScope();

  const safeCompanies = Array.isArray(scopeCompanies) ? scopeCompanies : [];

  const [policy, setPolicy] = useState({
    allocationType: 'ANNUAL',
    carryForwardEnabled: true,
    maxCarryForwardDays: 5.0,
    halfDayAllowed: true,
    workingDaysOnly: true,
    autoApproval: false,
    compOffValidityDays: 90,
    compOffClaimWindowDays: 30,
    compOffClaimWindowEnabled: true
  });

  const [leaveTypes, setLeaveTypes] = useState([]);
  const [userBalances, setUserBalances] = useState([]);
  const [userSearch, setUserSearch] = useState('');

  const [loading, setLoading] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [alert, setAlert] = useState({ type: '', text: '' });

  // Modals state
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [editingType, setEditingType] = useState(null);
  const [typeFormData, setTypeFormData] = useState({
    name: '',
    code: '',
    description: '',
    color: '#3B82F6',
    icon: 'Calendar',
    displayOrder: 0,
    isPaid: true,
    annualDays: 12,
    monthlyCreditDays: 1,
    minNoticeDays: 0,
    allowCarryForward: false,
    requireDoc: false,
    allowHalfDay: true
  });

  // Manual adjustment modal
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [selectedUserForAdjust, setSelectedUserForAdjust] = useState(null);
  const [adjustFormData, setAdjustFormData] = useState({
    leaveTypeId: '',
    adjustmentDays: 1,
    reason: ''
  });
  const [adjusting, setAdjusting] = useState(false);

  // Annual reset confirm modal
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Leave Type deletion confirm modal
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [typeToDelete, setTypeToDelete] = useState(null);
  const [deletingType, setDeletingType] = useState(false);

  const isProtectedLeaveType = (lt) => {
    if (!lt) return false;
    const protectedCodes = ['CL', 'SL', 'COMP_OFF', 'WFH'];
    const code = (lt.code || '').toUpperCase();
    const name = (lt.name || '').trim().toLowerCase();
    return protectedCodes.includes(code) ||
      name === 'casual leave' ||
      name === 'sick leave' ||
      name === 'compensatory off' ||
      name === 'comp-off' ||
      name === 'work from home' ||
      name === 'wfh' ||
      lt.isSystem === true;
  };

  const [selectedRole, setSelectedRole] = useState('ALL'); // 'ALL' | 'TEAM_LEADER' | 'EMPLOYEE' | 'INTERN'

  const fetchPolicyData = async (orgId = effectiveOrgId, role = selectedRole) => {
    const targetOrg = isSuperAdmin ? orgId : (effectiveOrgId || user?.organizationId);
    try {
      setLoading(true);
      const params = {};
      if (targetOrg) params.organizationId = targetOrg;
      if (role && role !== 'ALL') params.role = role;
      const polRes = await api.get('/leave-policy', { params });

      if (polRes.data?.policy) {
        setPolicy((prev) => ({
          ...prev,
          ...polRes.data.policy,
          compOffClaimWindowEnabled: polRes.data.policy.compOffClaimWindowEnabled !== undefined
            ? polRes.data.policy.compOffClaimWindowEnabled
            : (prev.compOffClaimWindowEnabled !== undefined ? prev.compOffClaimWindowEnabled : true)
        }));
      }
      setLeaveTypes(polRes.data?.leaveTypes || []);
      setAlert({ type: '', text: '' });
    } catch (err) {
      console.error('Fetch leave policy error:', err);
      setAlert({ type: 'error', text: 'Failed to load company leave policy settings.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPolicyData(effectiveOrgId, selectedRole);
  }, [effectiveOrgId, user?.organizationId, selectedRole]);

  const handleSavePolicy = async (e) => {
    e.preventDefault();
    setSavingPolicy(true);
    setAlert({ type: '', text: '' });

    try {
      const allowances = {};
      leaveTypes.forEach((lt) => {
        allowances[lt.code] = {
          annualDays: parseFloat(lt.annualDays) || 0,
          monthlyCreditDays: parseFloat(lt.monthlyCreditDays) || 0
        };
      });

      const res = await api.put('/leave-policy', {
        ...policy,
        organizationId: selectedOrgId,
        role: selectedRole !== 'ALL' ? selectedRole : undefined,
        allowances: allowances
      });
      setPolicy(res.data.policy);
      const currentCompName = safeCompanies.find((c) => c.id === selectedOrgId)?.name || 'Company';
      const roleText = selectedRole !== 'ALL' ? ` (${selectedRole.replace('_', ' ')})` : '';
      setAlert({ type: 'success', text: `${currentCompName}${roleText} Leave Policy updated successfully!` });
      fetchPolicyData(selectedOrgId, selectedRole);
    } catch (err) {
      setAlert({ type: 'error', text: err.response?.data?.message || 'Failed to update leave policy.' });
    } finally {
      setSavingPolicy(false);
    }
  };

  // Auto-generate code e.g. "Marriage Leave" -> "ML"
  const handleNameChange = (e) => {
    const val = e.target.value;
    let autoCode = typeFormData.code;
    if (!editingType && val) {
      const words = val.trim().split(/\s+/);
      if (words.length >= 2) {
        autoCode = (words[0][0] + words[1][0]).toUpperCase();
      } else {
        autoCode = val.substring(0, 3).toUpperCase();
      }
    }
    setTypeFormData({ ...typeFormData, name: val, code: autoCode });
  };

  const openTypeModal = (lt = null) => {
    if (lt) {
      setEditingType(lt);
      const annualVal = lt.annualDays !== undefined && lt.annualDays !== null ? lt.annualDays : 0;
      const monthlyVal = lt.monthlyCreditDays !== undefined && lt.monthlyCreditDays !== null
        ? lt.monthlyCreditDays
        : (lt.monthlyCredit !== undefined && lt.monthlyCredit !== null ? lt.monthlyCredit : 0);

      setTypeFormData({
        name: lt.name || '',
        code: lt.code || '',
        description: lt.description || '',
        color: lt.color || '#3B82F6',
        icon: lt.icon || 'Calendar',
        displayOrder: lt.displayOrder !== undefined ? lt.displayOrder : 0,
        isPaid: lt.isPaid ?? true,
        annualDays: annualVal,
        monthlyCreditDays: monthlyVal,
        monthlyCredit: monthlyVal,
        minNoticeDays: lt.minNoticeDays !== undefined && lt.minNoticeDays !== null ? lt.minNoticeDays : 0,
        allowCarryForward: lt.allowCarryForward ?? false,
        requireDoc: lt.requireDoc ?? false,
        allowHalfDay: lt.allowHalfDay ?? true
      });
    } else {
      setEditingType(null);
      setTypeFormData({
        name: '',
        code: '',
        description: '',
        color: '#3B82F6',
        icon: 'Calendar',
        displayOrder: leaveTypes.length + 1,
        isPaid: true,
        annualDays: 12,
        monthlyCreditDays: 1,
        monthlyCredit: 1,
        minNoticeDays: 0,
        allowCarryForward: false,
        requireDoc: false,
        allowHalfDay: true
      });
    }
    setTypeModalOpen(true);
  };

  const handleSaveLeaveType = async (e) => {
    e.preventDefault();
    const annualDaysNum = typeFormData.annualDays === '' ? 0 : Number(typeFormData.annualDays);
    const monthlyCreditRaw = typeFormData.monthlyCreditDays !== undefined && typeFormData.monthlyCreditDays !== ''
      ? typeFormData.monthlyCreditDays
      : typeFormData.monthlyCredit;
    const monthlyCreditNum = (monthlyCreditRaw === '' || monthlyCreditRaw === undefined) ? 0 : Number(monthlyCreditRaw);
    const minNoticeNum = typeFormData.minNoticeDays === '' ? 0 : Number(typeFormData.minNoticeDays);

    if (isNaN(annualDaysNum) || isNaN(monthlyCreditNum) || annualDaysNum < 0 || monthlyCreditNum < 0) {
      setAlert({ type: 'error', text: 'Leave allowances cannot be negative or invalid numbers.' });
      return;
    }

    if (!Number.isInteger(minNoticeNum) || minNoticeNum < 0) {
      setAlert({ type: 'error', text: 'Minimum Notice (Days) must be a non-negative whole number (0, 1, 2, ...).' });
      return;
    }

    const payload = {
      ...typeFormData,
      annualDays: annualDaysNum,
      monthlyCredit: monthlyCreditNum,
      monthlyCreditDays: monthlyCreditNum,
      minNoticeDays: minNoticeNum,
      organizationId: selectedOrgId,
      role: selectedRole !== 'ALL' ? selectedRole : undefined
    };

    console.log("Before Save", payload);

    try {
      if (editingType) {
        const res = await api.put(`/leave-policy/types/${editingType.id}`, payload);
        const updated = res.data?.leaveType || {
          ...editingType,
          ...payload,
          id: editingType.id
        };

        // Update React state immediately
        setLeaveTypes(prev =>
          prev.map(type =>
            type.id === updated.id ? { ...type, ...updated } : type
          )
        );

        const roleLabel = selectedRole !== 'ALL' ? ` for ${selectedRole.replace('_', ' ')}` : '';
        setAlert({ type: 'success', text: `Leave Type ${typeFormData.name} updated successfully${roleLabel}!` });
      } else {
        const res = await api.post('/leave-policy/types', payload);
        if (res.data?.leaveType) {
          setLeaveTypes(prev => [...prev, res.data.leaveType]);
        }
        setAlert({ type: 'success', text: `Leave Type ${typeFormData.name} created successfully!` });
      }
      setTypeModalOpen(false);
      fetchPolicyData(selectedOrgId, selectedRole);
    } catch (err) {
      setAlert({ type: 'error', text: err.response?.data?.message || 'Failed to save leave type.' });
    }
  };

  const handleToggleStatus = async (lt) => {
    try {
      const res = await api.put(`/leave-policy/types/${lt.id}/status`);
      setAlert({ type: 'success', text: res.data.message });
      fetchPolicyData(selectedOrgId, selectedRole);
    } catch (err) {
      setAlert({ type: 'error', text: 'Failed to toggle leave type status.' });
    }
  };

  const handleDeleteClick = (lt) => {
    setTypeToDelete(lt);
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!typeToDelete) return;
    if (isProtectedLeaveType(typeToDelete)) {
      const code = (typeToDelete.code || '').toUpperCase();
      const name = (typeToDelete.name || '').trim().toLowerCase();
      const isWfh = code === 'WFH' || name === 'work from home' || name === 'wfh';
      setAlert({
        type: 'error',
        text: isWfh
          ? 'Work From Home (WFH) is a built-in system leave type and cannot be deleted. It can only be disabled.'
          : `${typeToDelete.name || 'System policy'} is a mandatory system policy and cannot be deleted.`
      });
      setDeleteConfirmOpen(false);
      setTypeToDelete(null);
      return;
    }
    const deletedId = typeToDelete.id;
    const deletedName = typeToDelete.name;
    try {
      setDeletingType(true);
      const res = await api.delete(`/leave-policy/types/${deletedId}`, {
        params: effectiveOrgId ? { organizationId: effectiveOrgId } : {}
      });
      // Remove the deleted leave type from React state immediately after a successful API response
      setLeaveTypes((prev) => prev.filter((lt) => lt.id !== deletedId));
      setDeleteConfirmOpen(false);
      setTypeToDelete(null);
      setAlert({
        type: 'success',
        text: res.data?.message || `Leave type "${deletedName}" deleted successfully.`
      });
      // Refresh policy list automatically in the background
      fetchPolicyData(selectedOrgId, selectedRole);
    } catch (err) {
      const errMsg = err.response?.data?.message || err.message || 'Failed to delete leave type.';
      setAlert({ type: 'error', text: errMsg });
      setDeleteConfirmOpen(false);
      setTypeToDelete(null);
    } finally {
      setDeletingType(false);
    }
  };

  const handleAdjustBalance = async (e) => {
    e.preventDefault();
    if (!adjustFormData.leaveTypeId || !adjustFormData.reason) {
      setAlert({ type: 'error', text: 'Please fill all required adjustment fields.' });
      return;
    }
    setAdjusting(true);

    try {
      const payload = {
        userId: selectedUserForAdjust.userId,
        leaveTypeId: adjustFormData.leaveTypeId,
        adjustmentDays: adjustFormData.adjustmentDays,
        reason: adjustFormData.reason
      };

      await api.post('/leave-policy/adjust-balance', payload);
      setAlert({ type: 'success', text: 'User leave balance adjusted successfully!' });
      setAdjustModalOpen(false);
      fetchPolicyData(selectedOrgId, selectedRole);
    } catch (err) {
      setAlert({ type: 'error', text: err.response?.data?.message || 'Failed to adjust user leave balance.' });
    } finally {
      setAdjusting(false);
    }
  };

  const handleRunAnnualReset = async () => {
    setResetting(true);
    try {
      const res = await api.post('/leave-policy/annual-reset', { organizationId: selectedOrgId });
      setAlert({ type: 'success', text: res.data.message || 'Annual leave reset executed!' });
      setResetModalOpen(false);
      fetchPolicyData(selectedOrgId, selectedRole);
    } catch (err) {
      setAlert({ type: 'error', text: err.response?.data?.message || 'Failed to execute annual reset.' });
    } finally {
      setResetting(false);
    }
  };

  const currentCompany = safeCompanies.find((c) => c.id === selectedOrgId);

  return (
    <div className="space-y-8 p-4 sm:p-8 max-w-7xl mx-auto text-left">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2.5 rounded-2xl bg-primary/10 text-primary border border-primary/20">
              <Calendar className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
              <span>{currentCompany ? `${currentCompany.name} Leave Policy` : 'Company Leave Policy'}</span>
              <Sparkles className="h-5 w-5 text-primary" />
            </h1>
          </div>
          <p className="text-xs text-muted-foreground font-medium">
            Leave policy governing Interns, Employees, and Team Leaders for {currentCompany?.name || 'selected company'}.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setResetModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 text-xs font-bold transition-all cursor-pointer shadow-xs"
          >
            <RotateCcw className="h-4 w-4" />
            <span>Run Annual Reset</span>
          </button>
          <button
            onClick={() => openTypeModal()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold shadow-md cursor-pointer transition-all"
          >
            <Plus className="h-4 w-4" />
            <span>Add Leave Type</span>
          </button>
        </div>
      </div>

      {/* Shared Company Selector Bar */}
      <CompanyScopeSelector onScopeChange={(newId) => fetchPolicyData(newId, selectedRole)} />

      {/* Role Scope Selector Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-card border border-border/70 rounded-2xl shadow-xs text-left">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-foreground">Target Role Scope</h4>
            <p className="text-[10px] text-muted-foreground font-medium">Configure policies specifically for Team Leaders, Employees, or Interns</p>
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 bg-muted/60 border border-border/50 rounded-xl">
          {[
            { id: 'ALL', label: 'All Roles' },
            { id: 'TEAM_LEADER', label: 'Team Leader' },
            { id: 'EMPLOYEE', label: 'Employee' },
            { id: 'INTERN', label: 'Intern' }
          ].map((r) => {
            const isSelected = selectedRole === r.id;
            return (
              <button
                key={r.id}
                onClick={() => {
                  setSelectedRole(r.id);
                  fetchPolicyData(selectedOrgId, r.id);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-primary text-white shadow-xs font-extrabold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/80'
                }`}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Alert Banner */}
      {alert.text && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-4 rounded-2xl border text-xs font-bold flex items-center justify-between shadow-xs ${
            alert.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-600'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {alert.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            <span>{alert.text}</span>
          </div>
          <button onClick={() => setAlert({ type: '', text: '' })} className="p-1 hover:opacity-75">
            <X className="h-4 w-4" />
          </button>
        </motion.div>
      )}

      {/* SINGLE MERGED CARD: GLOBAL LEAVE POLICY */}
      <div className="bg-card border border-border/80 rounded-3xl p-6 sm:p-8 shadow-md text-left space-y-6">
        {/* Card Header with Save Button */}
        <div className="flex items-center justify-between border-b border-border/40 pb-4">
          <div className="flex items-center gap-2.5">
            <Calendar className="h-5 w-5 text-primary" />
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-extrabold text-foreground">{currentCompany?.name || 'Company'} Leave Policy</h2>
              {selectedRole !== 'ALL' && (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-primary/10 text-primary border border-primary/20">
                  {selectedRole.replace('_', ' ')}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={handleSavePolicy}
            disabled={savingPolicy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold shadow-md cursor-pointer transition-all disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            <span>{savingPolicy ? 'Saving...' : `Save ${selectedRole !== 'ALL' ? selectedRole.replace('_', ' ') + ' ' : ''}Policy`}</span>
          </button>
        </div>

        {/* 1. Allocation Mode Selector */}
        <div className="space-y-3">
          <label className="block text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
            Allocation Mode *
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label
              onClick={() => setPolicy({ ...policy, allocationType: 'ANNUAL' })}
              className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-start gap-3 ${
                policy.allocationType === 'ANNUAL'
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border/60 bg-muted/20 hover:border-border'
              }`}
            >
              <input
                type="radio"
                name="allocationType"
                value="ANNUAL"
                checked={policy.allocationType === 'ANNUAL'}
                onChange={() => {}}
                className="mt-1 text-primary focus:ring-primary"
              />
              <div>
                <h4 className="text-sm font-black text-foreground">Annual Allocation</h4>
                <p className="text-xs text-muted-foreground mt-0.5 font-medium">
                  Allocates total annual leave allowance immediately at the start of each year.
                </p>
              </div>
            </label>

            <label
              onClick={() => setPolicy({ ...policy, allocationType: 'MONTHLY' })}
              className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-start gap-3 ${
                policy.allocationType === 'MONTHLY'
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border/60 bg-muted/20 hover:border-border'
              }`}
            >
              <input
                type="radio"
                name="allocationType"
                value="MONTHLY"
                checked={policy.allocationType === 'MONTHLY'}
                onChange={() => {}}
                className="mt-1 text-primary focus:ring-primary"
              />
              <div>
                <h4 className="text-sm font-black text-foreground">Monthly Automated Credit</h4>
                <p className="text-xs text-muted-foreground mt-0.5 font-medium">
                  Credits configured monthly leave days automatically every 1st of the month.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* 2. Comp-Off (Compensatory Off) Policy Settings */}
        <div className="pt-6 border-t border-border/40 space-y-4">
          <div className="flex items-center gap-2.5">
            <Shield className="h-5 w-5 text-indigo-500" />
            <div>
              <h3 className="text-sm font-extrabold text-foreground">Compensatory Off (Comp-Off) Policy</h3>
              <p className="text-xs text-muted-foreground font-medium">
                Configure retrospective claim windows, claim rule enforcement, and credit validity days.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Toggle 30-Day Rule */}
            <div className="p-4 rounded-2xl border border-border/60 bg-muted/20 space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-foreground">Retrospective Claim Rule</span>
                  <ToggleSwitch
                    id="comp-off-claim-window-toggle"
                    ariaLabel="Retrospective Claim Rule"
                    title={policy.compOffClaimWindowEnabled ? 'Disable Retrospective Claim Rule' : 'Enable Retrospective Claim Rule'}
                    checked={Boolean(policy.compOffClaimWindowEnabled)}
                    onChange={(nextChecked) => setPolicy({ ...policy, compOffClaimWindowEnabled: nextChecked })}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 font-medium leading-relaxed">
                  {policy.compOffClaimWindowEnabled
                    ? 'Active: Retrospective claims must be submitted within the configured claim window.'
                    : 'Disabled: No retrospective age cutoff is enforced on retrospective claims.'}
                </p>
              </div>
              <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md inline-block w-fit ${
                policy.compOffClaimWindowEnabled ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-600 border border-amber-500/20'
              }`}>
                {policy.compOffClaimWindowEnabled ? 'Enforced' : 'Unrestricted'}
              </span>
            </div>

            {/* Claim Window Days */}
            <div className="p-4 rounded-2xl border border-border/60 bg-muted/20 space-y-2">
              <label className="block text-xs font-black text-foreground">
                Retrospective Claim Window
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="365"
                  disabled={!policy.compOffClaimWindowEnabled}
                  value={policy.compOffClaimWindowDays ?? 30}
                  onChange={(e) => setPolicy({ ...policy, compOffClaimWindowDays: parseInt(e.target.value, 10) || 30 })}
                  className="w-full px-3 py-2 text-xs font-bold font-mono rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                />
                <span className="text-xs text-muted-foreground font-bold shrink-0">Days</span>
              </div>
              <p className="text-[10px] text-muted-foreground font-medium">
                Default: 30 calendar days from the worked holiday / weekly off.
              </p>
            </div>

            {/* Validity Days */}
            <div className="p-4 rounded-2xl border border-border/60 bg-muted/20 space-y-2">
              <label className="block text-xs font-black text-foreground">
                Credit Expiry Window
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={policy.compOffValidityDays ?? 90}
                  onChange={(e) => setPolicy({ ...policy, compOffValidityDays: parseInt(e.target.value, 10) || 90 })}
                  className="w-full px-3 py-2 text-xs font-bold font-mono rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20"
                />
                <span className="text-xs text-muted-foreground font-bold shrink-0">Days</span>
              </div>
              <p className="text-[10px] text-muted-foreground font-medium">
                Default: 90 days validity before earned credit expires.
              </p>
            </div>
          </div>
        </div>

        {/* 3. Leave Types List Immediately Below */}
        <div className="pt-6 border-t border-border/40 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-extrabold text-foreground">Leave Types</h3>
              <p className="text-xs text-muted-foreground font-medium">
                Configure allowances, colors, and system status for company leave categories.
              </p>
            </div>
            <button
              onClick={() => openTypeModal()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold transition-all cursor-pointer shadow-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Leave Type</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
            {leaveTypes.map((lt) => {
              const isProtected = isProtectedLeaveType(lt);
              return (
                <div
                  key={lt.id}
                  className={`p-6 rounded-3xl border transition-all flex flex-col justify-between space-y-5 shadow-xs ${
                    lt.isActive ? 'bg-card border-border/80 hover:border-primary/50 hover:shadow-md' : 'bg-muted/30 border-border/40 opacity-60'
                  }`}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="h-4 w-4 rounded-full shrink-0 shadow-xs border border-white/20"
                          style={{ backgroundColor: lt.color }}
                        />
                        <span className="font-mono text-xs font-black text-foreground tracking-wider">{lt.code}</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isProtected && (
                          <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-600 border border-indigo-500/20 flex items-center gap-1" title="System leave type">
                            <Lock className="h-3 w-3" /> System
                          </span>
                        )}
                        <button
                          onClick={() => handleToggleStatus(lt)}
                          className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-full transition-all cursor-pointer ${
                            lt.isActive ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-600 border border-rose-500/20'
                          }`}
                        >
                          {lt.isActive ? 'Active' : 'Disabled'}
                        </button>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-base font-black text-foreground">{lt.name}</h3>
                      <p className="text-xs text-muted-foreground font-medium mt-1 leading-relaxed">
                        {lt.description || 'Configurable organizational leave category'}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-border/40 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="bg-muted/40 p-2.5 rounded-2xl border border-border/40">
                        <span className="text-[9px] text-muted-foreground font-extrabold block uppercase tracking-wider">Annual Allowance</span>
                        <span className="font-black text-xs text-foreground mt-0.5 block">{lt.isPaid ? `${lt.annualDays ?? 0} Days` : 'Unpaid'}</span>
                      </div>
                      <div className="bg-muted/40 p-2.5 rounded-2xl border border-border/40">
                        <span className="text-[9px] text-muted-foreground font-extrabold block uppercase tracking-wider">Monthly Credit</span>
                        <span className="font-black text-xs text-foreground mt-0.5 block">{lt.isPaid ? `${lt.monthlyCreditDays ?? lt.monthlyCredit ?? 0} Days` : 'N/A'}</span>
                      </div>
                      <div className="bg-muted/40 p-2.5 rounded-2xl border border-border/40">
                        <span className="text-[9px] text-muted-foreground font-extrabold block uppercase tracking-wider">Min Notice</span>
                        <span className="font-black text-xs text-foreground mt-0.5 block">{lt.minNoticeDays ? `${lt.minNoticeDays} Day${lt.minNoticeDays > 1 ? 's' : ''}` : 'Same Day'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/40">
                    <button
                      onClick={() => openTypeModal(lt)}
                      className="p-2 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                      title="Edit Leave Type"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    {!isProtected && (
                      <button
                        onClick={() => handleDeleteClick(lt)}
                        className="p-2 rounded-xl text-muted-foreground hover:bg-muted hover:text-rose-600 transition-colors cursor-pointer"
                        title="Delete Leave Type"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* LEAVE TYPE MODAL */}
      {typeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-card border border-border/80 rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-6 text-left max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-border/60 pb-4">
              <h3 className="text-base font-extrabold text-foreground">
                {editingType ? `Edit Leave Type: ${editingType.name}` : 'Create Dynamic Leave Type'}
              </h3>
              <button onClick={() => setTypeModalOpen(false)} className="p-1 rounded-xl text-muted-foreground hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveLeaveType} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">Leave Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Marriage Leave"
                    value={typeFormData.name}
                    onChange={handleNameChange}
                    className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">Leave Code *</label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editingType?.isSystem || isProtectedLeaveType(editingType))}
                    title={editingType?.isSystem || isProtectedLeaveType(editingType) ? "System leave code cannot be modified" : ""}
                    placeholder="e.g. ML"
                    value={typeFormData.code}
                    onChange={(e) => setTypeFormData({ ...typeFormData, code: e.target.value.toUpperCase() })}
                    className={`w-full px-3 py-2 text-xs font-bold uppercase rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20 ${
                      (editingType?.isSystem || isProtectedLeaveType(editingType)) ? 'opacity-60 cursor-not-allowed bg-muted/40' : ''
                    }`}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-foreground mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Leave category policy guidelines for HR..."
                  value={typeFormData.description}
                  onChange={(e) => setTypeFormData({ ...typeFormData, description: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-border bg-background outline-none resize-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">Badge Color</label>
                  <input
                    type="color"
                    value={typeFormData.color}
                    onChange={(e) => setTypeFormData({ ...typeFormData, color: e.target.value })}
                    className="h-9 w-full rounded-xl border border-border bg-background cursor-pointer"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">Display Order</label>
                  <input
                    type="number"
                    value={typeFormData.displayOrder}
                    onChange={(e) => setTypeFormData({ ...typeFormData, displayOrder: parseInt(e.target.value, 10) || 0 })}
                    className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-border bg-background outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">Annual Allowance (Days) *</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={typeFormData.annualDays}
                    onChange={(e) => setTypeFormData({ ...typeFormData, annualDays: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">Monthly Credit (Days) *</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={typeFormData.monthlyCredit !== undefined ? typeFormData.monthlyCredit : (typeFormData.monthlyCreditDays ?? '')}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTypeFormData({
                        ...typeFormData,
                        monthlyCredit: val,
                        monthlyCreditDays: val
                      });
                    }}
                    className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-foreground mb-1">
                  Minimum Notice (Days) *
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  required
                  value={typeFormData.minNoticeDays}
                  onChange={(e) => setTypeFormData({ ...typeFormData, minNoticeDays: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20"
                />
                <p className="text-[11px] text-muted-foreground mt-1 font-medium">
                  Minimum days in advance required before applying for leave. Set to 0 to allow same-day applications.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <label className="flex items-center gap-2 text-xs font-bold text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={typeFormData.isPaid}
                    onChange={(e) => setTypeFormData({ ...typeFormData, isPaid: e.target.checked })}
                    className="rounded text-primary focus:ring-primary"
                  />
                  <span>Paid Leave</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-bold text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={typeFormData.allowCarryForward}
                    onChange={(e) => setTypeFormData({ ...typeFormData, allowCarryForward: e.target.checked })}
                    className="rounded text-primary focus:ring-primary"
                  />
                  <span>Carry Forward</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-bold text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={typeFormData.allowHalfDay}
                    onChange={(e) => setTypeFormData({ ...typeFormData, allowHalfDay: e.target.checked })}
                    className="rounded text-primary focus:ring-primary"
                  />
                  <span>Allow Half Day</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-bold text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={typeFormData.requireDoc}
                    onChange={(e) => setTypeFormData({ ...typeFormData, requireDoc: e.target.checked })}
                    className="rounded text-primary focus:ring-primary"
                  />
                  <span>Require Documents</span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border/60">
                <button
                  type="button"
                  onClick={() => setTypeModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold shadow-md cursor-pointer"
                >
                  Save Leave Type
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* ANNUAL RESET CONFIRM MODAL */}
      {resetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-card border border-border/80 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-6 text-left">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-primary/10 text-primary border border-primary/20">
                <RotateCcw className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-foreground">Execute Annual Leave Reset?</h3>
                <p className="text-xs text-muted-foreground font-medium">
                  Applies carry-forward limits, expires old balances, and initializes new annual leave credits for all users.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border/60">
              <button
                onClick={() => setResetModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleRunAnnualReset}
                disabled={resetting}
                className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold shadow-md cursor-pointer disabled:opacity-50"
              >
                {resetting ? 'Executing Reset...' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRM MODAL */}
      <ConfirmModal
        isOpen={deleteConfirmOpen}
        title="Delete Leave Type"
        message={`Are you sure you want to delete the "${typeToDelete?.name}" leave type? Users will no longer be able to request this leave type. Existing leave history remains unaffected.`}
        confirmText="Delete Leave Type"
        cancelText="Cancel"
        loading={deletingType}
        onConfirm={handleConfirmDelete}
        onClose={() => {
          if (!deletingType) {
            setDeleteConfirmOpen(false);
            setTypeToDelete(null);
          }
        }}
      />
    </div>
  );
};

export default LeavePolicySettings;
