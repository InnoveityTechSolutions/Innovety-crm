import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Settings, X, CheckCircle2, RefreshCw, Bell, ShieldCheck, Zap } from 'lucide-react';
import api from '../../services/api';

const TOGGLES = [
  { key: 'shiftReminder1h', label: '1-Hour Shift Reminder', description: 'Notify employees 1 hour before scheduled shift start time.' },
  { key: 'tomorrowReminder', label: "Tomorrow's Shift Summary", description: 'Send daily evening summary with scheduled hours and work status for next day.' },
  { key: 'lateAlert', label: 'Late Arrival Alerts', description: 'Trigger alert notification when check-in exceeds shift start time + grace period.' },
  { key: 'swapApprovalRequired', label: 'Shift Swap Requires Approval', description: 'Mandate Team Leader and Admin endorsement before executing shift swaps.' },
  { key: 'overrideApprovalRequired', label: 'Temporary Override Requires Approval', description: 'Require managerial approval before temporary shift overrides are active.' },
  { key: 'weekendApprovalRequired', label: 'Weekend Work Approval', description: 'Enforce approval workflow when scheduling shifts on Saturday or Sunday.' },
  { key: 'holidayApprovalRequired', label: 'Holiday Work Approval', description: 'Enforce approval workflow when employees are scheduled on official holidays.' }
];

const ShiftAutomationSettingsModal = ({
  isOpen,
  onClose,
  organizationId,
  onSuccess
}) => {
  const [settings, setSettings] = useState({
    shiftReminder1h: true,
    tomorrowReminder: true,
    overrideApprovalRequired: false,
    swapApprovalRequired: true,
    weekendApprovalRequired: true,
    holidayApprovalRequired: true,
    lateAlert: true
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !organizationId) return;
    const fetchSettings = async () => {
      try {
        setLoading(true);
        const res = await api.get('/workforce/settings', { params: { organizationId } });
        if (res.data?.success && res.data.settings) {
          setSettings(res.data.settings);
        }
      } catch (err) {
        console.error('[AutomationSettings] Fetch error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, [isOpen, organizationId]);

  const handleSave = async () => {
    try {
      setSaving(true);
      await api.put('/workforce/settings', {
        organizationId,
        ...settings
      });
      if (onSuccess) {
        onSuccess('Workforce automation settings updated successfully.');
      }
      onClose();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update automation settings.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg rounded-3xl border border-border/70 bg-card p-6 shadow-2xl space-y-5 text-left my-8"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 pb-3.5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shadow-inner">
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-foreground">
                Workforce Automation Settings
              </h3>
              <p className="text-xs text-muted-foreground font-medium">
                Configure notification triggers, reminders, and approval requirements.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toggles */}
        {loading ? (
          <div className="p-12 text-center text-xs text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
            Loading settings...
          </div>
        ) : (
          <div className="divide-y divide-border/40 max-h-96 overflow-y-auto pr-1">
            {TOGGLES.map(tog => {
              const checked = Boolean(settings[tog.key]);
              return (
                <div key={tog.key} className="py-3 flex items-start justify-between gap-3">
                  <div className="space-y-0.5 pr-2">
                    <span className="text-xs font-extrabold text-foreground block">{tog.label}</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{tog.description}</p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={checked}
                    onClick={() => setSettings({ ...settings, [tog.key]: !checked })}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 ${
                      checked ? 'bg-primary border-primary shadow-xs' : 'bg-slate-300 border-slate-400 dark:bg-slate-700 dark:border-slate-500 shadow-inner'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md border border-black/10 dark:border-white/10 ring-0 transition duration-200 ease-in-out ${
                        checked ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/40">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted border border-border cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-extrabold shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
            <span>Save Preferences</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default ShiftAutomationSettingsModal;
