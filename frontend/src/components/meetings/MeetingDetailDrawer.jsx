import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Calendar,
  Clock,
  Video,
  ExternalLink,
  Users,
  User,
  FolderOpen,
  Briefcase,
  FileText,
  Edit,
  Trash2,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Loader2,
  AlertTriangle
} from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import UserAvatar from '../common/UserAvatar';
import { formatMeetingDisplayDate, getMeetingLocalDateString } from '../../utils/meetingDateUtils';

const STATUS_BADGES = {
  UPCOMING: {
    label: 'Upcoming',
    bg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
  },
  RESCHEDULED: {
    label: 'Rescheduled',
    bg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
  },
  COMPLETED: {
    label: 'Completed',
    bg: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20'
  },
  CANCELLED: {
    label: 'Cancelled',
    bg: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
  }
};

const MeetingDetailDrawer = ({
  isOpen,
  onClose,
  meeting,
  onEdit,
  onOpenReport,
  onMeetingUpdated
}) => {
  const { user } = useAuth();
  const { canEdit } = usePermissions();

  const isOrganizer = meeting?.organizerId === user?.id || meeting?.organizer?.id === user?.id;
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role);
  const canManageMeeting = canEdit('meetings') && (isOrganizer || isAdmin);

  // In-drawer Reschedule state
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleStartTime, setRescheduleStartTime] = useState('10:00');
  const [rescheduleEndTime, setRescheduleEndTime] = useState('11:00');

  // In-drawer Cancel state
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // Processing state
  const [loadingAction, setLoadingAction] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Refs for drawer scroll container and cancel confirmation card
  const scrollContainerRef = useRef(null);
  const cancelCardRef = useRef(null);

  // Smoothly scroll the drawer's content area until the cancellation card is fully visible
  const scrollToCancelCard = () => {
    if (!cancelCardRef.current || !scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    const card = cancelCardRef.current;

    const containerRect = container.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();

    // If card is already comfortably visible, do not perform unnecessary scrolling
    if (cardRect.top >= containerRect.top && cardRect.bottom <= containerRect.bottom) {
      return;
    }

    if (typeof container.scrollTo === 'function') {
      const currentScroll = container.scrollTop;
      const cardContentBottom = (cardRect.bottom - containerRect.top) + currentScroll;
      const cardContentTop = (cardRect.top - containerRect.top) + currentScroll;
      const containerHeight = container.clientHeight;

      let targetScrollTop;
      if (card.offsetHeight <= containerHeight) {
        // Position card comfortably in view with 20px padding above bottom
        targetScrollTop = cardContentBottom - containerHeight + 20;
      } else {
        targetScrollTop = cardContentTop - 16;
      }

      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth'
      });
    } else if (typeof card.scrollIntoView === 'function') {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  // Automatically scroll when cancellation confirmation becomes active
  useEffect(() => {
    if (isCancelling) {
      const timer = setTimeout(() => {
        scrollToCancelCard();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isCancelling]);

  const handleStartCancel = () => {
    setIsRescheduling(false);
    setIsCancelling(true);
    setTimeout(() => {
      scrollToCancelCard();
    }, 50);
  };

  if (!isOpen || !meeting) return null;

  const statusConfig = STATUS_BADGES[meeting.status] || STATUS_BADGES.UPCOMING;

  // Format dates & times
  const meetingDateStr = formatMeetingDisplayDate(meeting.date, meeting.startTime, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  const formatTimeStr = (dateObj) => {
    if (!dateObj) return '';
    try {
      return new Date(dateObj).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const startFormatted = formatTimeStr(meeting.startTime);
  const endFormatted = formatTimeStr(meeting.endTime);

  // Reschedule Submit Handler
  const handleRescheduleSubmit = async (e) => {
    e.preventDefault();
    if (!rescheduleDate || !rescheduleStartTime || !rescheduleEndTime) {
      setErrorMsg('Please select a valid date, start time, and end time.');
      return;
    }

    const [sh, sm] = rescheduleStartTime.split(':').map(Number);
    const [eh, em] = rescheduleEndTime.split(':').map(Number);
    if (eh * 60 + em <= sh * 60 + sm) {
      setErrorMsg('End time must be later than start time.');
      return;
    }

    try {
      setLoadingAction(true);
      setErrorMsg('');

      const startDateTime = new Date(`${rescheduleDate}T${rescheduleStartTime}:00`);
      const endDateTime = new Date(`${rescheduleDate}T${rescheduleEndTime}:00`);

      const payload = {
        date: `${rescheduleDate}T00:00:00.000Z`,
        startTime: startDateTime.toISOString(),
        endTime: endDateTime.toISOString()
      };

      const res = await api.put(`/meetings/${meeting.id}/reschedule`, payload);
      setSuccessMsg('Meeting rescheduled successfully.');
      setIsRescheduling(false);
      if (onMeetingUpdated) {
        onMeetingUpdated(res.data?.meeting || res.data);
      }
    } catch (err) {
      console.error('Reschedule error:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to reschedule meeting.');
    } finally {
      setLoadingAction(false);
    }
  };

  // Cancel Meeting Handler
  const handleCancelSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoadingAction(true);
      setErrorMsg('');

      const payload = {
        reason: cancelReason.trim() || undefined
      };

      const res = await api.put(`/meetings/${meeting.id}/cancel`, payload);
      setSuccessMsg('Meeting has been cancelled.');
      setIsCancelling(false);
      if (onMeetingUpdated) {
        onMeetingUpdated(res.data?.meeting || res.data);
      }
    } catch (err) {
      console.error('Cancel error:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to cancel meeting.');
    } finally {
      setLoadingAction(false);
    }
  };

  // Complete Meeting Handler
  const handleCompleteSubmit = async () => {
    try {
      setLoadingAction(true);
      setErrorMsg('');

      const res = await api.put(`/meetings/${meeting.id}/complete`);
      setSuccessMsg('Meeting marked as completed.');
      if (onMeetingUpdated) {
        onMeetingUpdated(res.data?.meeting || res.data);
      }
    } catch (err) {
      console.error('Complete error:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to mark meeting complete.');
    } finally {
      setLoadingAction(false);
    }
  };

  const startReschedulingFlow = () => {
    const defaultDate = getMeetingLocalDateString(meeting);
    setRescheduleDate(defaultDate);
    if (meeting.startTime) {
      setRescheduleStartTime(new Date(meeting.startTime).toTimeString().slice(0, 5));
    }
    if (meeting.endTime) {
      setRescheduleEndTime(new Date(meeting.endTime).toTimeString().slice(0, 5));
    }
    setIsCancelling(false);
    setIsRescheduling(true);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-card border-l border-border h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        {/* Drawer Header */}
        <div className="p-5 border-b border-border flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-2.5">
            <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${statusConfig.bg}`}>
              {statusConfig.label}
            </span>
            {meeting.report && (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                Report Filed
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Body */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Notifications */}
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

          {/* Meeting Title & Time */}
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-foreground leading-tight">
              {meeting.title}
            </h1>
            <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary shrink-0" />
                <span className="font-semibold text-foreground">{meetingDateStr}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary shrink-0" />
                <span>{startFormatted} – {endFormatted}</span>
              </div>
            </div>
          </div>

          {/* Google Meet Join Card */}
          {meeting.googleMeetUrl ? (
            <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase tracking-wider">
                  <Video className="w-4 h-4" />
                  <span>Google Meet</span>
                </div>
                <span className="text-[11px] text-muted-foreground">Online Session</span>
              </div>
              <a
                href={meeting.googleMeetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-md hover:bg-primary-hover transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Join Google Meet</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-muted/40 border border-border text-xs text-muted-foreground flex items-center gap-2">
              <Video className="w-4 h-4 text-muted-foreground/60" />
              <span>No Google Meet link attached to this meeting.</span>
            </div>
          )}

          {/* Agenda & Description */}
          {meeting.description && (
            <div className="space-y-1.5">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Agenda & Description
              </h3>
              <p className="text-xs text-foreground/90 bg-muted/30 p-3.5 rounded-xl border border-border whitespace-pre-wrap leading-relaxed">
                {meeting.description}
              </p>
            </div>
          )}

          {/* Project & Team Badges */}
          {(meeting.project || meeting.team) && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Associated Workspace
              </h3>
              <div className="flex flex-wrap gap-2 text-xs">
                {meeting.project && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-muted border border-border font-medium text-foreground">
                    <FolderOpen className="w-3.5 h-3.5 text-primary" />
                    <span>{meeting.project.name}</span>
                  </span>
                )}
                {meeting.team && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-muted border border-border font-medium text-foreground">
                    <Briefcase className="w-3.5 h-3.5 text-primary" />
                    <span>{meeting.team.name}</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Organizer */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Organizer
            </h3>
            <div className="p-3 rounded-xl bg-muted/30 border border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <UserAvatar user={meeting.organizer} className="w-9 h-9 rounded-full text-xs" />
                <div>
                  <p className="text-xs font-bold text-foreground">{meeting.organizer?.name}</p>
                  <p className="text-[11px] text-muted-foreground">{meeting.organizer?.email}</p>
                </div>
              </div>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary uppercase">
                {meeting.organizer?.role || 'Host'}
              </span>
            </div>
          </div>

          {/* Attendees List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Invited Attendees
              </h3>
              <span className="text-xs text-muted-foreground font-semibold">
                {(meeting.attendees || []).length} Invited
              </span>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {(meeting.attendees || []).map((attendee) => {
                const u = attendee.user || attendee;
                return (
                  <div
                    key={u.id || attendee.id}
                    className="p-2.5 rounded-xl bg-background border border-border/80 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2.5">
                      <UserAvatar user={u} className="w-7 h-7 rounded-full text-xs" />
                      <div>
                        <p className="text-xs font-semibold text-foreground">{u.name}</p>
                        <p className="text-[10px] text-muted-foreground">{u.email}</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-muted text-muted-foreground">
                      {u.role}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Inline Reschedule Form */}
          {isRescheduling && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-3 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reschedule Meeting</span>
                </h4>
                <button
                  type="button"
                  onClick={() => setIsRescheduling(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <div>
                  <label className="text-[10px] font-semibold text-foreground block mb-1">New Date</label>
                  <input
                    type="date"
                    value={rescheduleDate}
                    onChange={(e) => setRescheduleDate(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-semibold text-foreground block mb-1">Start Time</label>
                    <input
                      type="time"
                      value={rescheduleStartTime}
                      onChange={(e) => setRescheduleStartTime(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-background border border-border text-foreground"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-foreground block mb-1">End Time</label>
                    <input
                      type="time"
                      value={rescheduleEndTime}
                      onChange={(e) => setRescheduleEndTime(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-background border border-border text-foreground"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsRescheduling(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRescheduleSubmit}
                  disabled={loadingAction}
                  className="px-3.5 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold shadow-xs hover:bg-amber-700 transition-all flex items-center gap-1.5"
                >
                  {loadingAction && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>Confirm Reschedule</span>
                </button>
              </div>
            </div>
          )}

          {/* Inline Cancel Confirmation Form */}
          {isCancelling && (
            <div ref={cancelCardRef} className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 space-y-3 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-rose-700 dark:text-rose-300 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Cancel Meeting</span>
                </h4>
                <button
                  type="button"
                  onClick={() => setIsCancelling(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Are you sure you want to cancel this meeting? All attendees will receive a cancellation notification.
              </p>
              <div>
                <input
                  type="text"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Optional cancellation reason (e.g. Host unavailable)..."
                  className="w-full px-3 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsCancelling(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-muted"
                >
                  Keep Meeting
                </button>
                <button
                  type="button"
                  onClick={handleCancelSubmit}
                  disabled={loadingAction}
                  className="px-3.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold shadow-xs hover:bg-rose-700 transition-all flex items-center gap-1.5"
                >
                  {loadingAction && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>Confirm Cancellation</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Drawer Action Bar */}
        <div className="p-4 border-t border-border bg-muted/20 flex flex-col gap-2">
          {/* Top row actions: Report button */}
          <button
            type="button"
            onClick={() => onOpenReport(meeting)}
            className="w-full py-2.5 px-4 rounded-xl bg-card border border-border text-foreground hover:bg-muted text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs"
          >
            <FileText className="w-4 h-4 text-primary" />
            <span>{meeting.report ? 'View Meeting Report' : 'Record Meeting Report'}</span>
          </button>

          {/* Organizer / Admin Actions */}
          {canManageMeeting && meeting.status !== 'CANCELLED' && (
            <div className="grid grid-cols-3 gap-2 pt-1">
              {/* Edit Details */}
              <button
                type="button"
                onClick={() => onEdit(meeting)}
                disabled={loadingAction}
                className="py-2 px-2.5 rounded-xl border border-border bg-background hover:bg-muted text-[11px] font-bold text-foreground flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Edit className="w-3.5 h-3.5" />
                <span>Edit</span>
              </button>

              {/* Reschedule */}
              <button
                type="button"
                onClick={startReschedulingFlow}
                disabled={loadingAction}
                className="py-2 px-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 text-[11px] font-bold text-amber-600 dark:text-amber-400 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reschedule</span>
              </button>

              {/* Complete or Cancel */}
              {meeting.status !== 'COMPLETED' ? (
                <button
                  type="button"
                  onClick={handleCompleteSubmit}
                  disabled={loadingAction}
                  className="py-2 px-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Complete</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartCancel}
                  disabled={loadingAction}
                  className="py-2 px-2.5 rounded-xl border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10 text-[11px] font-bold text-rose-600 dark:text-rose-400 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Cancel</span>
                </button>
              )}
            </div>
          )}

          {canManageMeeting && meeting.status !== 'CANCELLED' && meeting.status !== 'COMPLETED' && (
            <button
              type="button"
              onClick={handleStartCancel}
              disabled={loadingAction}
              className="text-rose-500 hover:text-rose-600 text-[11px] font-semibold py-1 text-center transition-colors cursor-pointer"
            >
              Cancel this meeting
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MeetingDetailDrawer;
