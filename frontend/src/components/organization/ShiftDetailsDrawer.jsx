import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Clock, Calendar, Users, ShieldCheck, History,
  CheckCircle2, AlertCircle, Building2, UserCheck, AlertTriangle,
  Search, Copy, Edit2, ArrowRight, UserMinus, Plus
} from 'lucide-react';
import api from '../../services/api';
import { formatSaturdayPattern } from './ShiftManager';

const format12Hour = (timeStr) => {
  if (!timeStr) return '--:--';
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  if (isNaN(h)) return timeStr;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${String(hour12).padStart(2, '0')}:${mStr || '00'} ${period}`;
};

const actionConfig = {
  SHIFT_CREATED: { label: 'Shift Created', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' },
  SHIFT_EDITED: { label: 'Shift Edited', color: 'text-blue-500 bg-blue-500/10 border-blue-500/20' },
  SHIFT_ACTIVATED: { label: 'Shift Activated', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' },
  SHIFT_DEACTIVATED: { label: 'Shift Deactivated', color: 'text-amber-500 bg-amber-500/10 border-amber-500/20' },
  SHIFT_DUPLICATED: { label: 'Shift Duplicated', color: 'text-purple-500 bg-purple-500/10 border-purple-500/20' },
  MEMBERS_ASSIGNED: { label: 'Members Assigned', color: 'text-teal-500 bg-teal-500/10 border-teal-500/20' },
  MEMBERS_REMOVED: { label: 'Members Removed', color: 'text-rose-500 bg-rose-500/10 border-rose-500/20' }
};

const ShiftDetailsDrawer = ({
  shift,
  isOpen,
  onClose,
  onEdit,
  onDuplicate,
  onAssignMembers,
  analyticsItem = null
}) => {
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'members' | 'history'
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');

  const isDefault = shift?.name === 'Company Default';

  // Fetch shift audit history
  useEffect(() => {
    if (isOpen && shift?.id) {
      setLoadingHistory(true);
      api.get(`/shifts/${shift.id}/history`)
        .then((res) => {
          if (res.data?.success) {
            setHistory(res.data.history || []);
          }
        })
        .catch((err) => {
          console.warn('[ShiftDetailsDrawer] Error fetching history:', err);
        })
        .finally(() => setLoadingHistory(false));
    }
  }, [isOpen, shift?.id]);

  // Dynamically computed departments
  const assignedDepartments = useMemo(() => {
    if (!shift?.members) return shift?.assignedDepartments || [];
    const depts = new Set();
    shift.members.forEach((m) => {
      const d = m.user?.departmentRef?.name || m.user?.department;
      if (d && String(d).trim()) {
        depts.add(String(d).trim());
      }
    });
    return Array.from(depts);
  }, [shift]);

  // Filtered members inside drawer
  const filteredMembers = useMemo(() => {
    if (!shift?.members) return [];
    if (!memberSearch.trim()) return shift.members;
    const q = memberSearch.toLowerCase().trim();
    return shift.members.filter((m) => {
      const u = m.user;
      return (
        u?.name?.toLowerCase().includes(q) ||
        u?.email?.toLowerCase().includes(q) ||
        u?.employeeId?.toLowerCase().includes(q) ||
        u?.department?.toLowerCase().includes(q) ||
        u?.departmentRef?.name?.toLowerCase().includes(q)
      );
    });
  }, [shift?.members, memberSearch]);

  // Live status counts from shift and analytics breakdown
  const memberCount = shift?.members?.length || shift?._count?.members || 0;
  const presentCount = analyticsItem?.presentToday ?? 0;
  const lateCount = analyticsItem?.lateToday ?? 0;
  const wfhCount = analyticsItem?.wfhCount ?? (analyticsItem?.todayStatus === 'WFH' ? memberCount : 0);
  const isHolidayToday = analyticsItem?.todayStatus === 'Holiday';
  const isWorkingToday = analyticsItem?.todayStatus === 'Working';

  if (!isOpen || !shift) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex justify-end">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        />

        {/* Drawer Container */}
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 280 }}
          className="relative w-full max-w-xl bg-card border-l border-border/80 shadow-2xl h-full z-10 flex flex-col overflow-hidden"
        >
          {/* Drawer Header */}
          <div className="p-6 border-b border-border/60 bg-muted/20 flex items-start justify-between gap-4">
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-black text-foreground tracking-tight truncate">
                  {shift.name}
                </h3>
                {isDefault ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                    <ShieldCheck className="h-3 w-3" />
                    <span>Default</span>
                  </span>
                ) : (
                  <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                    shift.status === 'ACTIVE'
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                      : 'bg-muted text-muted-foreground border border-border/60'
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${shift.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
                    <span>{shift.status || 'ACTIVE'}</span>
                  </span>
                )}
              </div>

              {isDefault ? (
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    <span>Company Timing</span>
                    {shift.startTime && shift.endTime && (
                      <span className="text-[11px] text-muted-foreground font-medium">
                        ({format12Hour(shift.startTime)} – {format12Hour(shift.endTime)})
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium pl-5">
                    Uses Company Attendance Settings
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>{shift.startTime} – {shift.endTime}</span>
                  <span className="text-[11px] text-muted-foreground font-medium">
                    ({format12Hour(shift.startTime)} – {format12Hour(shift.endTime)})
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-2xl bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer shrink-0"
              title="Close Drawer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Nav Tabs */}
          <div className="flex border-b border-border/60 px-6 bg-muted/10 gap-2">
            {[
              { id: 'overview', label: 'Overview', icon: Building2 },
              { id: 'members', label: `Members (${memberCount})`, icon: Users },
              { id: 'history', label: `History (${history.length})`, icon: History }
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 py-3 px-3 text-xs font-black border-b-2 transition-all cursor-pointer ${
                    isActive
                      ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Live Member Status Cards */}
                <div>
                  <h4 className="text-[11px] font-black uppercase tracking-wider text-muted-foreground mb-2.5">
                    Live Member Status (Today)
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                      <div className="text-xl font-black text-emerald-600 dark:text-emerald-400">
                        {isWorkingToday ? memberCount : 0}
                      </div>
                      <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                        Working Today
                      </div>
                    </div>

                    <div className="p-3 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-center">
                      <div className="text-xl font-black text-blue-600 dark:text-blue-400">
                        {wfhCount}
                      </div>
                      <div className="text-[10px] font-bold text-blue-700 dark:text-blue-300">
                        WFH Today
                      </div>
                    </div>

                    <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-center">
                      <div className="text-xl font-black text-amber-600 dark:text-amber-400">
                        {isHolidayToday ? memberCount : 0}
                      </div>
                      <div className="text-[10px] font-bold text-amber-700 dark:text-amber-300">
                        Holiday Today
                      </div>
                    </div>

                    <div className="p-3 rounded-2xl bg-teal-500/10 border border-teal-500/20 text-center">
                      <div className="text-xl font-black text-teal-600 dark:text-teal-400">
                        {presentCount}
                      </div>
                      <div className="text-[10px] font-bold text-teal-700 dark:text-teal-300">
                        Present Today
                      </div>
                    </div>

                    <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-center">
                      <div className="text-xl font-black text-rose-600 dark:text-rose-400">
                        {lateCount}
                      </div>
                      <div className="text-[10px] font-bold text-rose-700 dark:text-rose-300">
                        Late Today
                      </div>
                    </div>

                    <div className="p-3 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-center">
                      <div className="text-xl font-black text-purple-600 dark:text-purple-400">
                        {memberCount}
                      </div>
                      <div className="text-[10px] font-bold text-purple-700 dark:text-purple-300">
                        Total Assigned
                      </div>
                    </div>
                  </div>
                </div>

                {/* Assigned Departments (Dynamic) */}
                <div className="space-y-2">
                  <h4 className="text-[11px] font-black uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                    <span>Assigned Departments ({assignedDepartments.length})</span>
                    <span className="text-[10px] font-medium text-muted-foreground normal-case">
                      Calculated from members
                    </span>
                  </h4>
                  {assignedDepartments.length === 0 ? (
                    <div className="p-3 rounded-2xl bg-muted/20 border border-border/50 text-xs text-muted-foreground">
                      No departments assigned to this shift yet.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {assignedDepartments.map((dept, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-card border border-border/70 text-xs font-bold text-foreground shadow-xs"
                        >
                          <Building2 className="h-3 w-3 text-emerald-600" />
                          <span>{dept}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Working Days Matrix */}
                <div className="space-y-2.5">
                  <h4 className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                    Weekly Schedule Matrix
                  </h4>
                  <div className="grid grid-cols-7 gap-1.5">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayShort, idx) => {
                      const fullDay = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'][idx];
                      let rawStatus = fullDay === 'SUNDAY' ? 'Holiday' : 'Working';
                      if (shift.workingDays) {
                        if (Array.isArray(shift.workingDays)) {
                          const m = shift.workingDays.find(d => String(d.day).toUpperCase() === fullDay);
                          if (m) {
                            const candidate = typeof m.status === 'object' && m.status !== null ? m.status.status : m.status;
                            rawStatus = candidate || (m.isWorking ? 'Working' : 'Holiday');
                          }
                        } else if (typeof shift.workingDays === 'object' && shift.workingDays !== null) {
                          const dayVal = shift.workingDays[fullDay];
                          if (dayVal && typeof dayVal === 'object') {
                            rawStatus = dayVal.status || 'Working';
                          } else if (dayVal) {
                            rawStatus = dayVal;
                          }
                        }
                      }

                      // Normalize to clean display string ("Working", "WFH", "Holiday")
                      const normStr = String(rawStatus || '').toUpperCase();
                      const status = normStr === 'WFH' ? 'WFH' : (normStr === 'HOLIDAY' || normStr === 'LEAVE') ? 'Holiday' : 'Working';

                      const badgeClass =
                        status === 'Working'
                          ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                          : status === 'WFH'
                          ? 'bg-blue-500/10 text-blue-600 border-blue-500/20'
                          : 'bg-rose-500/10 text-rose-600 border-rose-500/20';

                      return (
                        <div key={fullDay} className={`p-2 rounded-xl border text-center ${badgeClass}`}>
                          <div className="text-[10px] font-extrabold uppercase">{dayShort}</div>
                          <div className="text-[9px] font-bold truncate mt-0.5">{status}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Saturday Pattern Preview in Shift Details */}
                  {formatSaturdayPattern(shift.workingDays) && (
                    <div className="mt-2.5 p-3 rounded-2xl bg-muted/40 border border-border/70 flex items-center gap-2.5 text-xs">
                      <Calendar className="h-4 w-4 text-emerald-600 shrink-0" />
                      <div className="min-w-0">
                        <span className="font-extrabold text-foreground">Saturday Pattern: </span>
                        <span className="text-muted-foreground font-semibold">
                          {formatSaturdayPattern(shift.workingDays)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Shift Metadata Information */}
                <div className="p-4 rounded-2xl bg-muted/30 border border-border/60 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-medium">Shift ID:</span>
                    <span className="font-mono text-foreground font-semibold">{shift.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-medium">Created On:</span>
                    <span className="text-foreground font-semibold">
                      {shift.createdAt ? new Date(shift.createdAt).toLocaleDateString() : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-medium">Last Modified:</span>
                    <span className="text-foreground font-semibold">
                      {shift.updatedAt ? new Date(shift.updatedAt).toLocaleDateString() : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'members' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search member by name, email, department..."
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 text-xs font-medium rounded-xl border border-border/60 bg-muted/20 focus:bg-background outline-none transition-all"
                    />
                  </div>
                  <button
                    onClick={() => onAssignMembers(shift)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition-all cursor-pointer shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Assign</span>
                  </button>
                </div>

                {filteredMembers.length === 0 ? (
                  <div className="py-12 text-center text-xs text-muted-foreground space-y-2">
                    <Users className="h-8 w-8 mx-auto text-muted-foreground/50" />
                    <p>No assigned members found matching query.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredMembers.map((m) => {
                      const u = m.user;
                      const deptName = u?.departmentRef?.name || u?.department || 'General';
                      return (
                        <div
                          key={m.userId || u?.id}
                          className="p-3 rounded-2xl bg-card border border-border/60 hover:border-border transition-all flex items-center justify-between gap-3 shadow-xs"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-8 w-8 rounded-full bg-emerald-600/10 text-emerald-600 font-extrabold flex items-center justify-center text-xs shrink-0">
                              {u?.name?.charAt(0) || 'U'}
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-extrabold text-foreground truncate">
                                {u?.name}
                              </div>
                              <div className="text-[10px] text-muted-foreground truncate">
                                {u?.email}
                              </div>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="inline-block px-2 py-0.5 rounded-lg bg-muted text-[10px] font-bold text-foreground">
                              {deptName}
                            </span>
                            {u?.employeeId && (
                              <div className="text-[9px] font-mono text-muted-foreground mt-0.5">
                                {u.employeeId}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'history' && (
              <div className="space-y-4">
                {loadingHistory ? (
                  <div className="py-12 text-center text-xs font-bold text-muted-foreground flex items-center justify-center gap-2">
                    <History className="h-4 w-4 animate-spin text-emerald-600" />
                    <span>Loading shift audit history...</span>
                  </div>
                ) : history.length === 0 ? (
                  <div className="py-12 text-center text-xs text-muted-foreground space-y-2">
                    <History className="h-8 w-8 mx-auto text-muted-foreground/40" />
                    <p>No audit timeline history recorded yet for this shift.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {history.map((h) => {
                      const cfg = actionConfig[h.action] || { label: h.action, color: 'text-muted-foreground bg-muted border-border' };
                      return (
                        <div
                          key={h.id}
                          className="p-3 rounded-2xl bg-muted/20 border border-border/50 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-black uppercase ${cfg.color}`}>
                              {cfg.label}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {h.createdAt ? new Date(h.createdAt).toLocaleString() : ''}
                            </span>
                          </div>

                          {h.parsedDetails && (
                            <div className="text-[11px] text-muted-foreground space-y-1 bg-background/50 p-2 rounded-xl border border-border/40">
                              {Object.entries(h.parsedDetails).map(([k, v]) => (
                                <div key={k} className="flex items-start gap-1">
                                  <span className="font-bold text-foreground capitalize">{k}:</span>
                                  <span className="truncate">
                                    {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          {h.user && (
                            <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <span>Action by:</span>
                              <span className="font-bold text-foreground">{h.user.name || h.user.email}</span>
                              <span className="text-[9px] uppercase font-mono">({h.user.role})</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Drawer Footer Actions */}
          <div className="p-4 border-t border-border/60 bg-muted/20 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  onClose();
                  onEdit(shift);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-foreground text-xs font-bold transition-all cursor-pointer"
              >
                <Edit2 className="h-3.5 w-3.5" />
                <span>Edit Shift</span>
              </button>

              <button
                onClick={() => {
                  onClose();
                  onDuplicate(shift);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-foreground text-xs font-bold transition-all cursor-pointer"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>Duplicate</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-foreground text-background text-xs font-extrabold hover:opacity-90 transition-all cursor-pointer"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default ShiftDetailsDrawer;
