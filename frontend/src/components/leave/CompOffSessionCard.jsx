import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';
import ClockInModal from '../attendance/ClockInModal';
import { formatDurationHours, formatCompOffWorkedDuration } from '../../utils/attendanceFormatter';
import {
  Clock,
  Play,
  Square,
  Sparkles,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  MapPin,
  ShieldCheck,
  Timer
} from 'lucide-react';

export default function CompOffSessionCard({ onSessionChange, compact = false }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [now, setNow] = useState(new Date());

  // Live timer for active session
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchTodayStatus = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/comp-off/sessions/today-status');
      setStatus(res.data);
      setErrorMessage('');
      if (onSessionChange) {
        onSessionChange(res.data);
      }
    } catch (err) {
      console.error('Failed to fetch today comp-off session status:', err);
    } finally {
      setLoading(false);
    }
  }, [onSessionChange]);

  useEffect(() => {
    fetchTodayStatus();
    const interval = setInterval(fetchTodayStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchTodayStatus]);

  const activeElapsedText = useMemo(() => {
    if (!status?.session?.loginTime || status.session.clockOutTime) return '00h 00m 00s';
    const start = new Date(status.session.loginTime).getTime();
    const diff = Math.max(0, now.getTime() - start);
    const secs = Math.floor(diff / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }, [status?.session?.loginTime, status?.session?.clockOutTime, now]);

  const handleClockOut = async () => {
    try {
      setActionLoading(true);
      setErrorMessage('');
      await api.post('/comp-off/sessions/clock-out', {
        sessionId: status?.session?.id
      });
      await fetchTodayStatus();
    } catch (err) {
      console.error('Comp-Off Clock Out error:', err);
      setErrorMessage(err.response?.data?.message || err.message || 'Failed to clock out of Comp-Off session.');
    } finally {
      setActionLoading(false);
    }
  };

  // If loading or no approved permission for today, do NOT display this card
  if (loading && !status) return null;
  if (!status?.hasApprovedPermission) return null;

  const permission = status.permission;
  const session = status.session;

  const formatTime = (isoStr) => {
    if (!isoStr) return '—';
    return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Compact variant for EmployeeDashboard
  if (compact) {
    return (
      <div className="w-full">
        {status.canLogin && (
          <button
            onClick={() => setIsLoginModalOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shadow-sm transition active:scale-95 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
            <span>Comp-Off Login</span>
          </button>
        )}

        {status.isSessionActive && (
          <div className="flex flex-col gap-1 w-full">
            <button
              onClick={handleClockOut}
              disabled={actionLoading}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black text-white bg-gradient-to-r from-purple-600 to-rose-600 hover:from-purple-700 hover:to-rose-700 shadow-sm transition active:scale-95 cursor-pointer disabled:opacity-50"
            >
              {actionLoading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Square className="w-3.5 h-3.5 fill-current" />
              )}
              <span>Comp-Off Clock-Out</span>
            </button>
            <span className="text-[10px] font-mono font-bold text-violet-600 dark:text-violet-400 text-center">
              Active: {activeElapsedText}
            </span>
          </div>
        )}

        {status.isSessionCompleted && (
          <div className="px-3 py-1 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-700 dark:text-violet-300 text-[11px] font-bold text-center">
            Comp-Off Worked: {formatCompOffWorkedDuration(session?.durationHours, 'h', 'Completed')}
          </div>
        )}

        <ClockInModal
          isOpen={isLoginModalOpen}
          onClose={() => setIsLoginModalOpen(false)}
          onSuccess={() => fetchTodayStatus()}
          mode="COMPOFF"
          permission={permission}
        />
      </div>
    );
  }

  // Full Featured Banner for Attendance Page
  return (
    <div className="w-full rounded-3xl border border-violet-500/30 bg-gradient-to-br from-violet-500/5 via-purple-500/5 to-indigo-500/10 p-6 backdrop-blur-md shadow-lg text-left space-y-4 animate-in fade-in duration-300">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-violet-500/20 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-600/20">
            <Sparkles className="w-6 h-6 text-yellow-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-black text-foreground">
                Approved Comp-Off Available Today
              </h3>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/30">
                Off-Day Work
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Holiday / Off: <strong className="text-foreground">{permission?.holidayTitle || 'Company Holiday'}</strong>
              {permission?.reason && ` • Reason: ${permission.reason}`}
            </p>
          </div>
        </div>

        {/* Status Indicator Pill */}
        <div className="flex items-center gap-2">
          {status.canLogin && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              Session Not Started
            </span>
          )}
          {status.isSessionActive && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Session In Progress</span>
            </span>
          )}
          {status.isSessionCompleted && (
            <span className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Session Completed</span>
            </span>
          )}
        </div>
      </div>

      {/* Main Body per Status */}
      {status.canLogin && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1">
          <div className="space-y-1 max-w-xl">
            <p className="text-xs font-semibold text-foreground">
              You are approved to work today. Comp-Off work sessions are completely independent of normal attendance.
            </p>
            <p className="text-[11px] text-muted-foreground">
              Starting a Comp-Off session records your exact working hours and will <strong className="text-foreground font-semibold">never mark you late</strong>.
            </p>
          </div>

          <button
            onClick={() => setIsLoginModalOpen(true)}
            className="flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white text-xs font-black shadow-lg shadow-violet-600/30 transition-all active:scale-95 cursor-pointer shrink-0"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Comp-Off Login</span>
          </button>
        </div>
      )}

      {status.isSessionActive && (
        <div className="space-y-4 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-2xl bg-card border border-border/60 text-left">
              <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-violet-500" />
                <span>Session Login Time</span>
              </span>
              <p className="text-sm font-black text-foreground mt-1 font-mono">
                {formatTime(session?.loginTime)}
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-card border border-border/60 text-left">
              <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5">
                <Timer className="w-3.5 h-3.5 text-violet-500" />
                <span>Elapsed Duration</span>
              </span>
              <p className="text-sm font-black text-violet-600 dark:text-violet-400 mt-1 font-mono">
                {activeElapsedText}
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-card border border-border/60 text-left">
              <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-violet-500" />
                <span>Location Status</span>
              </span>
              <div className="mt-1 flex items-center gap-1.5">
                {session?.locationStatus === 'INSIDE' ? (
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Inside Geofence</span>
                  </span>
                ) : (
                  <span className="text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1" title={session?.locationReason}>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Outside Geofence</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-violet-500/10 border border-violet-500/20">
            <div className="text-xs text-muted-foreground">
              {status.autoClockOutEnabled ? (
                <p>
                  ⚡ <strong className="text-foreground">Auto Clock-Out Enabled:</strong> Target auto-close is <strong className="text-violet-600 dark:text-violet-400 font-mono">{formatTime(session?.autoClockOutTarget)}</strong> ({status.configuredDailyHours}h configured daily duration).
                </p>
              ) : (
                <p>
                  📌 <strong className="text-foreground">Manual Clock-Out Mode:</strong> This session will remain active until you manually clock out.
                </p>
              )}
            </div>

            <button
              onClick={handleClockOut}
              disabled={actionLoading}
              className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-2xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-700 hover:to-red-700 text-white text-xs font-black shadow-lg shadow-rose-600/25 transition-all active:scale-95 cursor-pointer disabled:opacity-50 shrink-0"
            >
              {actionLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Clocking Out...</span>
                </>
              ) : (
                <>
                  <Square className="w-4 h-4 fill-current" />
                  <span>Comp-Off Clock-Out</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {status.isSessionCompleted && (
        <div className="p-4 rounded-2xl bg-card border border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-foreground">
                Off-Day Work Summary:
              </span>
              <span className="px-2.5 py-0.5 rounded-md text-[11px] font-mono font-black bg-violet-500/10 text-violet-700 dark:text-violet-300 border border-violet-500/20">
                {formatDurationHours(session?.durationHours) || '0.0'} Hours Logged
              </span>
              <span className="text-[10px] uppercase font-bold text-muted-foreground">
                ({session?.clockOutType === 'AUTO' ? 'Auto-Clocked Out' : 'Manual Clock-Out'})
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Logged from {formatTime(session?.loginTime)} to {formatTime(session?.clockOutTime)}.
              {session?.flaggedForReview && (
                <span className="text-amber-600 dark:text-amber-400 ml-1">
                  • Location flagged for Admin review ({session.locationReason || 'Outside geofence'}).
                </span>
              )}
            </p>
          </div>

          <div className="text-[11px] font-bold text-muted-foreground bg-muted/40 px-3 py-1.5 rounded-xl border border-border/40 shrink-0 text-center">
            Phase 2 Logged • Ready for Admin Verification
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Login Modal (Reusing ClockInModal in COMPOFF mode) */}
      <ClockInModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onSuccess={() => fetchTodayStatus()}
        mode="COMPOFF"
        permission={permission}
      />
    </div>
  );
}
