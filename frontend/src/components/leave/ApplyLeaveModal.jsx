import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarPlus,
  Calendar,
  Clock,
  FileText,
  Phone,
  X,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Info,
  ShieldCheck
} from 'lucide-react';
import api, { getSocket } from '../../services/api';
import ToggleSwitch from '../common/ToggleSwitch';

const DEFAULT_LEAVE_TYPES = [
  { id: 'CL', label: 'Casual Leave (CL)', desc: 'For planned personal matters or short breaks' },
  { id: 'SL', label: 'Sick Leave (SL)', desc: 'For medical appointments or health recovery' },
  { id: 'EMERGENCY', label: 'Emergency Leave (EL)', desc: 'For unforeseen family or personal emergencies' },
  { id: 'WFH', label: 'Work From Home (WFH)', desc: 'Remote working arrangement request' },
  { id: 'UNPAID', label: 'Loss of Pay / Unpaid Leave (LOP)', desc: 'Leave taken without pay' }
];

const calculateDays = (startStr, endStr, isHalfDay) => {
  if (isHalfDay) return 0.5;
  if (!startStr || !endStr) return 0;
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return 0;
  const diffTime = Math.abs(end - start);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
};

const formatDateForInput = (dateVal) => {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const ApplyLeaveModal = ({
  isOpen,
  onClose,
  onSuccess,
  leaveToEdit = null,
  userRole = 'EMPLOYEE'
}) => {
  const isEditing = Boolean(leaveToEdit);

  const [formData, setFormData] = useState({
    leaveType: 'CL',
    startDate: '',
    endDate: '',
    isHalfDay: false,
    reason: '',
    contactPhone: '',
    attachmentNote: ''
  });

  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [dynamicTypes, setDynamicTypes] = useState([]);
  const [compOffCredits, setCompOffCredits] = useState([]);
  const [loadingCompOffDetails, setLoadingCompOffDetails] = useState(false);

  const fetchLeaveTypesAndBalances = async () => {
    try {
      const res = await api.get('/leaves/balances');
      if (res.data && Array.isArray(res.data.leaveTypes)) {
        setDynamicTypes(res.data.leaveTypes);
      }
    } catch (err) {
      console.warn('Failed to fetch dynamic leave types for modal:', err);
    }
  };

  const fetchCompOffCredits = async () => {
    try {
      setLoadingCompOffDetails(true);
      const res = await api.get('/comp-off/credits', { params: { status: 'APPROVED', limit: 100 } });
      const credits = Array.isArray(res.data?.credits) ? res.data.credits : [];
      setCompOffCredits(credits);
    } catch (err) {
      console.warn('Failed to fetch comp-off credits for modal:', err);
    } finally {
      setLoadingCompOffDetails(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchLeaveTypesAndBalances();
      if (formData.leaveType === 'COMP_OFF') {
        fetchCompOffCredits();
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && formData.leaveType === 'COMP_OFF') {
      fetchCompOffCredits();
    }
  }, [formData.leaveType, isOpen]);

  // Derived Comp-Off metrics
  const compOffMeta = useMemo(() => {
    const compOffType = dynamicTypes.find((lt) => lt.code === 'COMP_OFF');
    const available = compOffType?.available ?? 0;
    const pending = compOffType?.pending ?? 0;
    const used = compOffType?.used ?? 0;

    // Filter unexhausted, non-expired credits sorted by earliest expiry
    const now = new Date();
    const activeCredits = compOffCredits
      .filter((c) => c.status === 'APPROVED' && (c.remainingDays ?? 0) > 0 && new Date(c.expiresAt) > now)
      .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));

    const earliestCredit = activeCredits[0] || null;
    let daysUntilExpiry = null;
    let isNearingExpiry = false;

    if (earliestCredit) {
      const diffMs = new Date(earliestCredit.expiresAt).getTime() - now.getTime();
      daysUntilExpiry = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      isNearingExpiry = daysUntilExpiry <= 14;
    }

    return {
      available,
      pending,
      used,
      earliestCredit,
      daysUntilExpiry,
      isNearingExpiry,
      hasActiveCredits: activeCredits.length > 0
    };
  }, [dynamicTypes, compOffCredits]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handlePolicyUpdate = () => {
      fetchLeaveTypesAndBalances();
      if (formData.leaveType === 'COMP_OFF') {
        fetchCompOffCredits();
      }
    };
    socket.on('organization_leave_policy_updated', handlePolicyUpdate);
    return () => {
      socket.off('organization_leave_policy_updated', handlePolicyUpdate);
    };
  }, [formData.leaveType]);

  const leaveTypeOptions = useMemo(() => {
    if (dynamicTypes.length === 0) {
      return DEFAULT_LEAVE_TYPES.map((t) => ({ ...t, minNoticeDays: 0 }));
    }

    const list = dynamicTypes.map((lt) => ({
      id: lt.code,
      name: lt.name,
      label: `${lt.name} — ${lt.available !== undefined ? lt.available : 0} days left${lt.carryForward > 0 ? ` (incl. ${lt.carryForward} carried)` : ''}`,
      available: lt.available,
      carryForward: lt.carryForward || 0,
      pending: lt.pending,
      minNoticeDays: lt.minNoticeDays ?? 0,
      isPaid: true
    }));

    if (!list.some((o) => o.id === 'UNPAID' || o.id === 'LOP')) {
      list.push({ id: 'UNPAID', name: 'Loss of Pay / Unpaid Leave', label: 'Loss of Pay / Unpaid Leave (LOP)', available: Infinity, isPaid: false, minNoticeDays: 0 });
    }

    return list;
  }, [dynamicTypes]);

  const selectedLeaveType = useMemo(() => {
    if (!formData.leaveType) return leaveTypeOptions[0] || null;
    const direct = leaveTypeOptions.find((o) => o.id === formData.leaveType);
    if (direct) return direct;
    const rawUpper = String(formData.leaveType).toUpperCase();
    if (['CL', 'CASUAL', 'CASUAL_LEAVE', 'CASUAL LEAVE'].includes(rawUpper)) {
      return leaveTypeOptions.find((o) => o.id === 'CL' || o.name?.toLowerCase().includes('casual')) || null;
    }
    if (['SL', 'SICK', 'SICK_LEAVE', 'SICK LEAVE'].includes(rawUpper)) {
      return leaveTypeOptions.find((o) => o.id === 'SL' || o.name?.toLowerCase().includes('sick')) || null;
    }
    return leaveTypeOptions[0] || null;
  }, [leaveTypeOptions, formData.leaveType]);

  const minNoticeDays = selectedLeaveType?.minNoticeDays ?? 0;

  // Calculate earliest permitted start date (today + minNoticeDays)
  const earliestPermittedDateStr = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + (minNoticeDays > 0 ? minNoticeDays : 0));
    return formatDateForInput(d);
  }, [minNoticeDays]);

  // Initialize or reset form state
  useEffect(() => {
    if (leaveToEdit) {
      const isHalf = leaveToEdit.totalDays === 0.5;
      const rawEditType = leaveToEdit.leaveType || leaveToEdit.type || 'CL';
      let resolvedEditType = rawEditType;
      const rawUpper = String(rawEditType).toUpperCase();
      if (['CASUAL', 'CASUAL_LEAVE'].includes(rawUpper)) {
        resolvedEditType = 'CL';
      } else if (['SICK', 'SICK_LEAVE'].includes(rawUpper)) {
        resolvedEditType = 'SL';
      }
      setFormData({
        leaveType: resolvedEditType,
        startDate: formatDateForInput(leaveToEdit.startDate),
        endDate: formatDateForInput(leaveToEdit.endDate || leaveToEdit.startDate),
        isHalfDay: isHalf,
        reason: leaveToEdit.reason || '',
        contactPhone: leaveToEdit.contactPhone || '',
        attachmentNote: ''
      });
    } else {
      const defaultType = dynamicTypes.find((t) =>
        t.code === 'CL' || t.code === 'CASUAL' || (t.name && t.name.toLowerCase().includes('casual'))
      ) || dynamicTypes[0] || null;

      const defaultCode = defaultType?.code || 'CL';
      const reqNotice = defaultType?.minNoticeDays ?? 0;
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + (reqNotice > 0 ? reqNotice : 0));
      const todayStr = formatDateForInput(d);
      setFormData({
        leaveType: defaultCode,
        startDate: todayStr,
        endDate: todayStr,
        isHalfDay: false,
        reason: '',
        contactPhone: '',
        attachmentNote: ''
      });
    }
    setErrors({});
    setServerError(null);
  }, [leaveToEdit, isOpen, dynamicTypes]);

  // Handle Input Changes
  const handleChange = (field, value) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'leaveType') {
        const rawUpper = String(value).toUpperCase();
        const targetType = leaveTypeOptions.find((o) =>
          o.id === value ||
          (['CL', 'CASUAL'].includes(rawUpper) && (o.id === 'CL' || o.name?.toLowerCase().includes('casual'))) ||
          (['SL', 'SICK'].includes(rawUpper) && (o.id === 'SL' || o.name?.toLowerCase().includes('sick')))
        );
        const reqNotice = targetType?.minNoticeDays ?? 0;
        if (reqNotice > 0 && !isEditing) {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          d.setDate(d.getDate() + reqNotice);
          const minDateStr = formatDateForInput(d);
          if (next.startDate && next.startDate < minDateStr) {
            next.startDate = minDateStr;
            if (next.endDate < minDateStr || next.isHalfDay) {
              next.endDate = minDateStr;
            }
          }
        }
      }
      if (field === 'startDate' && next.isHalfDay) {
        next.endDate = value;
      }
      if (field === 'isHalfDay' && value === true) {
        next.endDate = next.startDate;
      }
      return next;
    });

    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
    if (serverError) {
      setServerError(null);
    }
  };

  const totalCalculatedDays = calculateDays(formData.startDate, formData.endDate, formData.isHalfDay);

  // Validate form
  const validate = () => {
    const errs = {};
    if (!formData.leaveType) errs.leaveType = 'Please select a leave type.';
    if (!formData.startDate) errs.startDate = 'Start date is required.';
    if (!formData.endDate) errs.endDate = 'End date is required.';
    if (formData.startDate && formData.endDate && new Date(formData.startDate) > new Date(formData.endDate)) {
      errs.endDate = 'End date cannot be before start date.';
    }

    if (formData.startDate && minNoticeDays > 0 && earliestPermittedDateStr) {
      if (formData.startDate < earliestPermittedDateStr) {
        errs.startDate = `${selectedLeaveType?.name || 'Selected leave type'} requires at least ${minNoticeDays} day(s) advance notice. Earliest permitted start date is ${earliestPermittedDateStr}.`;
      }
    }

    const selectedOpt = leaveTypeOptions.find(o => o.id === formData.leaveType);
    if (selectedOpt && selectedOpt.isPaid && selectedOpt.available !== undefined && selectedOpt.available !== Infinity) {
      if (totalCalculatedDays > selectedOpt.available) {
        errs.leaveType = `Requested duration (${totalCalculatedDays} day(s)) exceeds your remaining ${selectedOpt.name} balance (${selectedOpt.available} day(s) left).`;
      }
    }

    if (formData.leaveType === 'COMP_OFF' && compOffMeta.available !== undefined) {
      if (totalCalculatedDays > compOffMeta.available) {
        errs.leaveType = `Requested duration (${totalCalculatedDays} day(s)) exceeds your available Comp-Off balance (${compOffMeta.available} day(s) left).`;
      }
    }

    if (!formData.reason.trim()) {
      errs.reason = 'Please provide a clear reason for your leave request.';
    } else if (formData.reason.trim().length < 5) {
      errs.reason = 'Reason must be at least 5 characters long.';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // Submit Handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setServerError(null);

    const resolvedType = selectedLeaveType?.id || formData.leaveType;
    const payload = {
      leaveType: resolvedType,
      startDate: formData.startDate,
      endDate: formData.isHalfDay ? formData.startDate : formData.endDate,
      isHalfDay: formData.isHalfDay,
      reason: formData.reason.trim(),
      contactPhone: formData.contactPhone.trim() || undefined,
      letterContent: formData.reason.trim()
    };

    try {
      if (isEditing) {
        await api.put(`/leaves/${leaveToEdit.id}`, payload);
      } else {
        await api.post('/leaves', payload);
      }

      onSuccess?.(isEditing ? 'Leave request updated successfully.' : 'Leave request submitted successfully.');
      onClose();
    } catch (err) {
      console.error('Leave submission error:', err);
      setServerError(err.response?.data?.message || 'Failed to submit leave request. Please check your inputs and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="relative w-[95vw] sm:w-full max-w-xl max-h-[90vh] rounded-3xl border border-border/70 bg-card shadow-2xl text-left font-sans flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Fixed Header */}
          <div className="shrink-0 p-5 sm:p-6 border-b border-border/40 flex items-start justify-between bg-card z-10">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                <CalendarPlus className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-xl font-black tracking-tight text-foreground">
                  {isEditing ? 'Edit Leave Application' : 'Apply for Leave'}
                </h3>
                <p className="text-xs text-muted-foreground font-medium mt-0.5">
                  {isEditing
                    ? 'Modify your pending leave request details before sanction review'
                    : 'Submit a new leave or work-from-home request for approval'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
              title="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Form wrapper */}
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {/* Scrollable Body Container */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
              {/* Server Error Alert */}
              {serverError && (
                <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs font-semibold flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{serverError}</span>
                </div>
              )}

              {/* 1. Leave Type Selector */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-foreground mb-1.5">
                  Leave Type <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formData.leaveType}
                  onChange={(e) => handleChange('leaveType', e.target.value)}
                  className={`w-full h-11 bg-muted/30 border ${
                    errors.leaveType ? 'border-rose-500/80 focus:ring-rose-500/20' : 'border-border/70 focus:ring-primary/20'
                  } rounded-xl px-3.5 py-2 text-xs font-bold text-foreground cursor-pointer focus:outline-none focus:ring-2`}
                >
                  {leaveTypeOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {errors.leaveType && <p className="text-[11px] font-semibold text-rose-500 mt-1">{errors.leaveType}</p>}
              </div>

              {/* Comp-Off Specific Balance & Expiry Intelligence Banner */}
              {formData.leaveType === 'COMP_OFF' && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 rounded-2xl bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-card border border-indigo-500/20 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-500">
                        <ShieldCheck className="h-4 w-4" />
                      </div>
                      <div>
                        <span className="text-xs font-black text-foreground block">Compensatory Off (Comp-Off)</span>
                        <span className="text-[10px] text-muted-foreground block font-medium">Earned through verified holiday or weekend attendance</span>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono font-extrabold px-2.5 py-1 rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30">
                      {compOffMeta.available} Day(s) Available
                    </span>
                  </div>

                  {/* Metric Chips */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl bg-card/60 border border-border/40">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase block">Pending Reserved</span>
                      <span className="text-xs font-mono font-bold text-amber-600 dark:text-amber-400">
                        {compOffMeta.pending} Day(s) in review
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-card/60 border border-border/40">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase block">Earliest Credit Expiry</span>
                      {compOffMeta.earliestCredit ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono font-bold text-foreground">
                            {new Date(compOffMeta.earliestCredit.expiresAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
                          </span>
                          {compOffMeta.isNearingExpiry && (
                            <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-600 border border-rose-500/30 animate-pulse">
                              {compOffMeta.daysUntilExpiry}d left
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">No active credits</span>
                      )}
                    </div>
                  </div>

                  {/* Nearing Expiry Warning Alert */}
                  {compOffMeta.isNearingExpiry && (
                    <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-[11px] font-semibold flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                      <span>
                        <strong>Notice:</strong> You have {compOffMeta.earliestCredit?.remainingDays} Comp-Off credit(s) expiring in {compOffMeta.daysUntilExpiry} day(s) ({new Date(compOffMeta.earliestCredit?.expiresAt).toLocaleDateString()}). Consider applying to utilize them before they lapse.
                      </span>
                    </div>
                  )}

                  {/* Reservation Explanation */}
                  <div className="p-2.5 rounded-xl bg-muted/40 border border-border/40 text-[11px] text-muted-foreground flex items-start gap-2">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-indigo-500" />
                    <span>
                      Submitting this request will reserve your available days to prevent double-booking. Credits are only deducted from your ledger upon final Admin approval.
                    </span>
                  </div>
                </motion.div>
              )}

              {/* 2. Half Day Toggle */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-muted/20 border border-border/50">
                <div className="flex items-center gap-2.5">
                  <Clock className="h-4 w-4 text-primary" />
                  <div>
                    <span className="text-xs font-bold text-foreground block">Half Day Leave</span>
                    <span className="text-[10px] text-muted-foreground block">Count as 0.5 working day</span>
                  </div>
                </div>
                <ToggleSwitch
                  id="half-day-leave-toggle"
                  ariaLabel="Half Day Leave"
                  title={formData.isHalfDay ? 'Disable Half Day' : 'Enable Half Day'}
                  checked={Boolean(formData.isHalfDay)}
                  onChange={(val) => handleChange('isHalfDay', val)}
                />
              </div>

              {/* 3. Dates Range */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-extrabold uppercase tracking-wider text-foreground mb-1.5">
                    Start Date <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="date"
                      min={earliestPermittedDateStr}
                      value={formData.startDate}
                      onChange={(e) => handleChange('startDate', e.target.value)}
                      className={`w-full h-11 bg-muted/30 border ${
                        errors.startDate ? 'border-rose-500/80 focus:ring-rose-500/20' : 'border-border/70 focus:ring-primary/20'
                      } rounded-xl px-3.5 py-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-2`}
                    />
                  </div>
                  {minNoticeDays > 0 ? (
                    <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                      <Clock className="h-3 w-3 shrink-0" />
                      Requires {minNoticeDays} day(s) advance notice. Earliest start: {earliestPermittedDateStr}.
                    </p>
                  ) : (
                    <p className="text-[10px] text-muted-foreground mt-1">Same-day applications permitted.</p>
                  )}
                  {errors.startDate && <p className="text-[11px] font-semibold text-rose-500 mt-1">{errors.startDate}</p>}
                </div>

                <div>
                  <label className="block text-xs font-extrabold uppercase tracking-wider text-foreground mb-1.5">
                    End Date <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="date"
                      value={formData.isHalfDay ? formData.startDate : formData.endDate}
                      disabled={formData.isHalfDay}
                      onChange={(e) => handleChange('endDate', e.target.value)}
                      className={`w-full h-11 bg-muted/30 border ${
                        errors.endDate ? 'border-rose-500/80 focus:ring-rose-500/20' : 'border-border/70 focus:ring-primary/20'
                      } rounded-xl px-3.5 py-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed`}
                    />
                  </div>
                  {errors.endDate && <p className="text-[11px] font-semibold text-rose-500 mt-1">{errors.endDate}</p>}
                </div>
              </div>

              {/* 4. Live Duration Banner */}
              <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-primary/5 border border-primary/20">
                <span className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-primary" />
                  <span>Calculated Duration:</span>
                </span>
                <span className="text-xs font-extrabold font-mono px-2.5 py-0.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                  {totalCalculatedDays === 0.5 ? '0.5 Day (Half Day)' : totalCalculatedDays === 1 ? '1 Working Day' : `${totalCalculatedDays} Working Days`}
                </span>
              </div>

              {/* 5. Reason Textarea */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-foreground mb-1.5">
                  Reason / Purpose <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="Explain the reason for taking leave (e.g. Medical emergency, family function, personal work)..."
                  value={formData.reason}
                  onChange={(e) => handleChange('reason', e.target.value)}
                  className={`w-full bg-muted/30 border ${
                    errors.reason ? 'border-rose-500/80 focus:ring-rose-500/20' : 'border-border/70 focus:ring-primary/20'
                  } rounded-xl p-3 text-xs font-medium text-foreground focus:outline-none focus:ring-2 resize-none`}
                />
                {errors.reason && <p className="text-[11px] font-semibold text-rose-500 mt-1">{errors.reason}</p>}
              </div>

              {/* 6. Emergency Contact Phone (Optional) */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-foreground mb-1.5">
                  Emergency Contact Phone <span className="text-muted-foreground font-normal text-[10px] lowercase">(optional)</span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                  <input
                    type="tel"
                    placeholder="+91 98765 43210"
                    value={formData.contactPhone}
                    onChange={(e) => handleChange('contactPhone', e.target.value)}
                    className="w-full h-11 bg-muted/30 border border-border/70 rounded-xl pl-9 pr-3.5 py-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>
            </div>

            {/* Fixed Modal Actions Footer */}
            <div className="shrink-0 p-4 sm:p-5 border-t border-border/40 bg-card flex items-center justify-end gap-3 z-10">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-5 py-2.5 rounded-xl border border-border/70 bg-card hover:bg-muted text-foreground text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-extrabold shadow-md hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{isEditing ? 'Save Changes' : 'Submit Leave'}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default ApplyLeaveModal;
