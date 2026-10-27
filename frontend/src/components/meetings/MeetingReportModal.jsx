import React, { useState, useEffect } from 'react';
import {
  X,
  FileText,
  Calendar,
  Clock,
  User,
  Users,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  CheckSquare
} from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import UserAvatar from '../common/UserAvatar';

const PRIORITIES = [
  { value: 'LOW', label: 'Low', color: 'text-slate-500 bg-slate-500/10 border-slate-500/20' },
  { value: 'MEDIUM', label: 'Medium', color: 'text-sky-600 bg-sky-500/10 border-sky-500/20' },
  { value: 'HIGH', label: 'High', color: 'text-amber-600 bg-amber-500/10 border-amber-500/20' },
  { value: 'URGENT', label: 'Urgent', color: 'text-rose-600 bg-rose-500/10 border-rose-500/20' }
];

const MeetingReportModal = ({
  isOpen,
  onClose,
  meeting,
  onSuccess
}) => {
  const { user } = useAuth();
  const { canEdit } = usePermissions();

  const isOrganizer = meeting?.organizerId === user?.id || meeting?.organizer?.id === user?.id;
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role);
  const canModifyReport = canEdit('meetings') && (isOrganizer || isAdmin);

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reportId, setReportId] = useState(null);
  const [summary, setSummary] = useState('');
  const [followUpTasks, setFollowUpTasks] = useState([]);
  const [createdByInfo, setCreatedByInfo] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Format date and time
  const formattedDate = meeting?.date
    ? new Date(meeting.date).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
    : '';

  const formattedTime = meeting?.startTime
    ? `${new Date(meeting.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${
        meeting.endTime
          ? new Date(meeting.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : ''
      }`
    : '';

  // Eligible task assignees: meeting attendees + organizer
  const eligibleAssignees = React.useMemo(() => {
    const list = [];
    if (meeting?.organizer) list.push(meeting.organizer);
    if (Array.isArray(meeting?.attendees)) {
      meeting.attendees.forEach(a => {
        const u = a.user || a;
        if (u && !list.some(item => item.id === u.id)) {
          list.push(u);
        }
      });
    }
    return list;
  }, [meeting]);

  // Fetch existing report if one exists
  useEffect(() => {
    if (!isOpen || !meeting?.id) return;

    setErrorMsg('');
    setSuccessMsg('');
    setSummary('');
    setFollowUpTasks([]);
    setReportId(null);
    setCreatedByInfo(null);

    const fetchReport = async () => {
      setLoading(true);
      try {
        const res = await api.get(`/meetings/${meeting.id}/report`);
        if (res.data?.success && res.data?.report) {
          const r = res.data.report;
          setReportId(r.id);
          setSummary(r.summary || '');
          setCreatedByInfo(r.createdBy || null);

          if (Array.isArray(r.followUpTasks)) {
            setFollowUpTasks(r.followUpTasks);
          } else if (r.followUpTasks && typeof r.followUpTasks === 'object') {
            setFollowUpTasks(Array.isArray(r.followUpTasks.tasks) ? r.followUpTasks.tasks : []);
          } else {
            setFollowUpTasks([]);
          }
        }
      } catch (err) {
        // 404 means no report filed yet, which is expected for new reports
        if (err.response?.status !== 404) {
          console.error('Failed to load meeting report:', err);
          setErrorMsg(err.response?.data?.message || 'Failed to load report.');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [isOpen, meeting?.id]);

  // Follow-up tasks handlers
  const handleAddTask = () => {
    setFollowUpTasks(prev => [
      ...prev,
      {
        title: '',
        description: '',
        priority: 'MEDIUM',
        assigneeId: eligibleAssignees[0]?.id || '',
        deadline: ''
      }
    ]);
  };

  const handleUpdateTask = (index, field, value) => {
    setFollowUpTasks(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const handleRemoveTask = (index) => {
    setFollowUpTasks(prev => prev.filter((_, i) => i !== index));
  };

  // Submit Handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canModifyReport) return;

    if (!summary.trim()) {
      setErrorMsg('Meeting summary is required.');
      return;
    }

    // Validate tasks if any
    for (let i = 0; i < followUpTasks.length; i++) {
      if (!followUpTasks[i].title || !followUpTasks[i].title.trim()) {
        setErrorMsg(`Task #${i + 1} must have a title.`);
        return;
      }
    }

    try {
      setSubmitting(true);
      setErrorMsg('');

      const payload = {
        summary: summary.trim(),
        followUpTasks: followUpTasks.map(t => ({
          title: t.title.trim(),
          description: t.description ? t.description.trim() : '',
          priority: t.priority || 'MEDIUM',
          assigneeId: t.assigneeId || null,
          deadline: t.deadline || null
        }))
      };

      const res = await api.post(`/meetings/${meeting.id}/report`, payload);

      setSuccessMsg('Meeting report saved successfully.');
      if (onSuccess) {
        onSuccess(res.data?.report || res.data);
      }
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      console.error('Save meeting report error:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to save meeting report.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !meeting) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">
                {reportId ? 'Meeting Summary & Report' : 'Record Meeting Report'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {canModifyReport
                  ? 'Summarize meeting discussions and assign follow-up action items'
                  : 'View meeting recap and agreed follow-up tasks'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Messages */}
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Meeting Metadata Card (Read-only from server) */}
          <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                  Meeting Title
                </span>
                <h3 className="text-sm font-bold text-foreground">{meeting.title}</h3>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 bg-background px-2.5 py-1 rounded-lg border border-border">
                  <Calendar className="w-3.5 h-3.5 text-primary" />
                  <span>{formattedDate}</span>
                </span>
                <span className="inline-flex items-center gap-1 bg-background px-2.5 py-1 rounded-lg border border-border">
                  <Clock className="w-3.5 h-3.5 text-primary" />
                  <span>{formattedTime}</span>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Organizer:</span>
                <UserAvatar user={meeting.organizer} className="w-5 h-5 rounded-full text-[10px]" />
                <span className="font-semibold text-foreground">{meeting.organizer?.name}</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Attendees:</span>
                <div className="flex -space-x-1.5 overflow-hidden">
                  {(meeting.attendees || []).slice(0, 5).map((a, idx) => (
                    <UserAvatar
                      key={idx}
                      user={a.user || a}
                      className="inline-block w-5 h-5 rounded-full ring-2 ring-background text-[9px]"
                    />
                  ))}
                </div>
                <span className="font-semibold text-foreground">
                  {(meeting.attendees || []).length} participants
                </span>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="py-12 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span>Loading report details...</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Meeting Summary */}
              <div>
                <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
                  Meeting Summary & Key Takeaways <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={4}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  disabled={!canModifyReport || submitting}
                  placeholder="Record discussion outcomes, key decisions made, action points, and blockers..."
                  className={`w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-foreground text-sm focus:outline-hidden focus:ring-2 focus:ring-primary ${
                    !canModifyReport ? 'opacity-85 cursor-not-allowed bg-muted/30' : ''
                  }`}
                />
              </div>

              {/* Follow-up Tasks */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                      Follow-up Tasks & Action Items
                    </label>
                    <p className="text-[11px] text-muted-foreground">
                      Structured tasks assigned to participants resulting from this meeting
                    </p>
                  </div>
                  {canModifyReport && (
                    <button
                      type="button"
                      onClick={handleAddTask}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-bold transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Task</span>
                    </button>
                  )}
                </div>

                {followUpTasks.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground">
                    No follow-up tasks recorded for this session.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {followUpTasks.map((task, idx) => (
                      <div
                        key={idx}
                        className="p-3.5 rounded-xl bg-muted/20 border border-border space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <input
                            type="text"
                            value={task.title}
                            disabled={!canModifyReport || submitting}
                            onChange={(e) => handleUpdateTask(idx, 'title', e.target.value)}
                            placeholder={`Task #${idx + 1} title (e.g. Implement schema migration)`}
                            className="flex-1 px-3 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground font-semibold focus:outline-hidden focus:ring-1 focus:ring-primary"
                          />
                          {canModifyReport && (
                            <button
                              type="button"
                              onClick={() => handleRemoveTask(idx)}
                              className="p-1.5 rounded-lg hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500 transition-colors"
                              title="Remove Task"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                          {/* Assignee */}
                          <div>
                            <label className="text-[10px] text-muted-foreground block mb-0.5">Assignee</label>
                            <select
                              value={task.assigneeId || ''}
                              disabled={!canModifyReport || submitting}
                              onChange={(e) => handleUpdateTask(idx, 'assigneeId', e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground"
                            >
                              <option value="">Unassigned</option>
                              {eligibleAssignees.map(u => (
                                <option key={u.id} value={u.id}>
                                  {u.name} ({u.role})
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Priority */}
                          <div>
                            <label className="text-[10px] text-muted-foreground block mb-0.5">Priority</label>
                            <select
                              value={task.priority || 'MEDIUM'}
                              disabled={!canModifyReport || submitting}
                              onChange={(e) => handleUpdateTask(idx, 'priority', e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground"
                            >
                              {PRIORITIES.map(p => (
                                <option key={p.value} value={p.value}>
                                  {p.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Deadline */}
                          <div>
                            <label className="text-[10px] text-muted-foreground block mb-0.5">Deadline</label>
                            <input
                              type="date"
                              value={task.deadline ? task.deadline.split('T')[0] : ''}
                              disabled={!canModifyReport || submitting}
                              onChange={(e) => handleUpdateTask(idx, 'deadline', e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Created By Info metadata footer */}
              {createdByInfo && (
                <p className="text-[11px] text-muted-foreground pt-1">
                  Report submitted by <strong>{createdByInfo.name}</strong> ({createdByInfo.role})
                </p>
              )}
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-muted/20 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            Close
          </button>

          {canModifyReport && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || loading}
              className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-md hover:bg-primary-hover transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving Report...</span>
                </>
              ) : (
                <span>{reportId ? 'Update Report' : 'Save & Complete Meeting'}</span>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MeetingReportModal;
