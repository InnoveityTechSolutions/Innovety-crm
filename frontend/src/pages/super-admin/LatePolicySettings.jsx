import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Clock,
  ShieldCheck,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Users,
  DollarSign,
  Save,
  RotateCcw,
  Sparkles,
  Info
} from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useCompanyScope } from '../../context/CompanyScopeContext';
import CompanyScopeSelector from '../../components/common/CompanyScopeSelector';
import ToggleSwitch from '../../components/common/ToggleSwitch';

const LatePolicySettings = () => {
  const { user } = useAuth();
  const { effectiveOrgId } = useCompanyScope();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Settings State
  const [policy, setPolicy] = useState({
    latePolicyEnabled: true,
    warningLateLimit: 3,
    deductionPerLate: '1_DAY_SALARY',
    latePolicyAppliesTo: ['INTERN', 'EMPLOYEE', 'TEAM_LEADER']
  });

  const fetchLatePolicy = async () => {
    try {
      setLoading(true);
      const res = await api.get('/late-policy', {
        params: effectiveOrgId ? { organizationId: effectiveOrgId } : {}
      });
      if (res.data?.success && res.data?.data) {
        setPolicy({
          latePolicyEnabled: res.data.data.latePolicyEnabled !== false,
          warningLateLimit: res.data.data.warningLateLimit ?? 3,
          deductionPerLate: res.data.data.deductionPerLate || '1_DAY_SALARY',
          latePolicyAppliesTo: Array.isArray(res.data.data.latePolicyAppliesTo)
            ? res.data.data.latePolicyAppliesTo
            : ['INTERN', 'EMPLOYEE', 'TEAM_LEADER']
        });
      }
    } catch (err) {
      console.error('Failed to fetch late policy:', err);
      showToast('error', 'Failed to load late policy settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLatePolicy();
  }, [effectiveOrgId]);

  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  const handleRoleToggle = (role) => {
    setPolicy(prev => {
      const exists = prev.latePolicyAppliesTo.includes(role);
      const nextRoles = exists
        ? prev.latePolicyAppliesTo.filter(r => r !== role)
        : [...prev.latePolicyAppliesTo, role];
      return {
        ...prev,
        latePolicyAppliesTo: nextRoles
      };
    });
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    try {
      setSaving(true);
      const res = await api.put('/late-policy', {
        ...policy,
        organizationId: effectiveOrgId || undefined
      });
      if (res.data?.success) {
        showToast('success', 'Late Policy settings updated successfully.');
      } else {
        showToast('error', res.data?.message || 'Failed to save settings.');
      }
    } catch (err) {
      console.error('Error saving late policy:', err);
      showToast('error', err.response?.data?.message || 'Failed to update late policy.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-300 text-left py-2">
      {/* Toast Notification */}
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-2xl shadow-lg border flex items-center gap-2.5 text-xs font-bold transition-all ${
            toast.type === 'success'
              ? 'bg-emerald-600 text-white border-emerald-500 shadow-emerald-900/20'
              : 'bg-rose-600 text-white border-rose-500 shadow-rose-900/20'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          <span>{toast.message}</span>
        </motion.div>
      )}

      {/* Header with Organization Scope Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-foreground">Late Policy Settings</h1>
              <p className="text-xs text-muted-foreground font-medium">
                Configure monthly late warnings and automated payroll deduction limits.
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <CompanyScopeSelector />
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-muted-foreground">
          <div className="animate-spin w-8 h-8 border-3 border-primary border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-xs font-semibold">Loading Late Policy settings...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Main Card */}
          <div className="bg-card border border-border/80 rounded-3xl p-6 sm:p-8 shadow-sm space-y-8">
            {/* 1. Policy Master Toggle */}
            <div className="flex items-center justify-between p-4 sm:p-5 rounded-2xl bg-muted/20 border border-border/60">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-extrabold text-foreground">Enable Late Policy</span>
                  <span className={`text-[10px] uppercase font-black px-2 py-0.5 rounded-full ${
                    policy.latePolicyEnabled ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' : 'bg-muted text-muted-foreground'
                  }`}>
                    {policy.latePolicyEnabled ? 'Active' : 'Disabled'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  When enabled, employees will receive warnings up to the threshold, after which late deductions apply.
                </p>
              </div>
              <ToggleSwitch
                id="late-policy-enabled-toggle"
                ariaLabel="Enable late attendance policy"
                title={policy.latePolicyEnabled ? 'Disable Late Policy' : 'Enable Late Policy'}
                checked={Boolean(policy.latePolicyEnabled)}
                onChange={(val) => setPolicy({ ...policy, latePolicyEnabled: val })}
              />
            </div>

            {/* 2. Applies To Roles */}
            <div className="space-y-3">
              <div>
                <label className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" />
                  Applies To
                </label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Select which employee roles are governed by the monthly late policy.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { role: 'INTERN', label: 'Intern', desc: 'Applies to active interns' },
                  { role: 'EMPLOYEE', label: 'Employee', desc: 'Applies to general employees' },
                  { role: 'TEAM_LEADER', label: 'Team Leader', desc: 'Applies to team leads' }
                ].map(({ role, label, desc }) => {
                  const isChecked = policy.latePolicyAppliesTo.includes(role);
                  return (
                    <div
                      key={role}
                      onClick={() => handleRoleToggle(role)}
                      className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-start gap-3 select-none ${
                        isChecked
                          ? 'bg-primary/5 border-primary text-foreground shadow-sm'
                          : 'bg-muted/10 border-border/60 text-muted-foreground hover:bg-muted/20'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="mt-0.5 rounded text-primary focus:ring-primary h-4 w-4"
                      />
                      <div>
                        <div className="text-xs font-bold text-foreground">{label}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. Warning Limit & Deduction Per Late */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Warning Limit */}
              <div className="space-y-2">
                <label className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  Warning Late Limit
                </label>
                <p className="text-xs text-muted-foreground">
                  Number of late arrivals permitted per month before salary deductions start.
                </p>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={policy.warningLateLimit}
                    onChange={(e) => setPolicy({ ...policy, warningLateLimit: parseInt(e.target.value, 10) || 1 })}
                    className="w-full bg-background border border-border/80 rounded-2xl px-4 py-2.5 text-sm font-black text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground pointer-events-none">
                    Lates / Month
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground font-medium pt-1">
                  Default is <span className="font-bold text-primary">3 warnings</span>. Salary deduction begins from the 4th late onward.
                </div>
              </div>

              {/* Deduction Per Late */}
              <div className="space-y-2">
                <label className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
                  Deduction Per Late
                </label>
                <p className="text-xs text-muted-foreground">
                  Amount deducted for every late arrival exceeding the warning limit.
                </p>
                <select
                  value={policy.deductionPerLate}
                  onChange={(e) => setPolicy({ ...policy, deductionPerLate: e.target.value })}
                  className="w-full bg-background border border-border/80 rounded-2xl px-4 py-2.5 text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
                >
                  <option value="1_DAY_SALARY">1 Day Salary (Gross Salary ÷ Working Days)</option>
                  <option value="0.5_DAY_SALARY">0.5 Day Salary (Half Day)</option>
                </select>
                <div className="text-[11px] text-muted-foreground font-medium pt-1">
                  Formula: <span className="font-mono font-bold text-foreground">Deduction = (Total Lates - {policy.warningLateLimit}) × Rate</span>
                </div>
              </div>
            </div>

            {/* 4. Monthly Reset Info Card */}
            <div className="p-4 sm:p-5 rounded-2xl bg-muted/20 border border-border/60 flex items-start gap-3">
              <div className="p-2 rounded-xl bg-primary/10 text-primary mt-0.5">
                <Calendar className="w-4 h-4" />
              </div>
              <div className="space-y-0.5">
                <div className="text-xs font-extrabold text-foreground flex items-center gap-2">
                  <span>Monthly Reset</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-primary/10 text-primary rounded-full border border-primary/20">
                    Automatic
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Monthly late arrival counts automatically reset to zero at the start of each calendar month. Each calendar month begins with fresh warning allowances.
                </p>
              </div>
            </div>

            {/* Save Button */}
            <div className="pt-2 flex items-center justify-end gap-3 border-t border-border/60">
              <button
                type="button"
                onClick={fetchLatePolicy}
                disabled={saving}
                className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted transition-colors"
              >
                Reset Changes
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-extrabold shadow-sm hover:opacity-90 transition-all active:scale-95 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>Save Policy Settings</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LatePolicySettings;
