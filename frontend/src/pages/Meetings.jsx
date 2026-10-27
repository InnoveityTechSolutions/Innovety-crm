import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  Plus,
  Video,
  Clock,
  CheckCircle2,
  RotateCcw,
  Users,
  ShieldAlert,
  Loader2,
  RefreshCw
} from 'lucide-react';
import api, { getSocket } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useCompanyScope } from '../context/CompanyScopeContext';
import { usePermissions } from '../hooks/usePermissions';
import CompanyScopeSelector from '../components/common/CompanyScopeSelector';
import MeetingCalendar from '../components/meetings/MeetingCalendar';
import ScheduleMeetingModal from '../components/meetings/ScheduleMeetingModal';
import MeetingDetailDrawer from '../components/meetings/MeetingDetailDrawer';
import MeetingReportModal from '../components/meetings/MeetingReportModal';

const Meetings = () => {
  const { user } = useAuth();
  const { canEdit } = usePermissions();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const { selectedOrgId, effectiveOrgId, loading: orgsLoading } = useCompanyScope();
  const targetOrg = isSuperAdmin ? selectedOrgId : (effectiveOrgId || user?.organizationId);

  const canSchedule = canEdit('meetings');

  // State
  const [meetings, setMeetings] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  // Modals & Drawers
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState(null);

  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const selectedMeetingRef = React.useRef(selectedMeeting);
  useEffect(() => {
    selectedMeetingRef.current = selectedMeeting;
  }, [selectedMeeting]);

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const [reportMeeting, setReportMeeting] = useState(null);
  const [isReportOpen, setIsReportOpen] = useState(false);

  // Fetch meetings
  const fetchMeetings = useCallback(async () => {
    if (orgsLoading) return;
    try {
      setLoading(true);
      setErrorMsg('');

      const params = targetOrg ? { organizationId: targetOrg } : {};
      const [meetingsRes, projectsRes] = await Promise.all([
        api.get('/meetings', { params }),
        api.get('/projects', { params }).catch(() => ({ data: [] }))
      ]);

      const loadedMeetings = meetingsRes.data?.meetings || [];
      const loadedProjects = Array.isArray(projectsRes.data)
        ? projectsRes.data
        : (projectsRes.data?.projects || []);

      setMeetings(loadedMeetings);
      setProjects(loadedProjects);

      // If drawer is currently viewing a meeting, update its details
      if (selectedMeetingRef.current) {
        const refreshed = loadedMeetings.find(m => m.id === selectedMeetingRef.current.id);
        if (refreshed) setSelectedMeeting(refreshed);
      }
    } catch (err) {
      console.error('Failed to load meetings:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to fetch meetings.');
    } finally {
      setLoading(false);
    }
  }, [targetOrg, orgsLoading]);

  useEffect(() => {
    fetchMeetings();
  }, [targetOrg, orgsLoading]);

  // Real-time synchronization
  useEffect(() => {
    const handleUpdate = () => {
      fetchMeetings();
    };

    window.addEventListener('meeting_created', handleUpdate);
    window.addEventListener('meeting_updated', handleUpdate);
    window.addEventListener('meeting_rescheduled', handleUpdate);
    window.addEventListener('meeting_cancelled', handleUpdate);

    const socket = getSocket();
    if (socket) {
      socket.on('meeting_created', handleUpdate);
      socket.on('meeting_updated', handleUpdate);
      socket.on('meeting_rescheduled', handleUpdate);
      socket.on('meeting_cancelled', handleUpdate);
    }

    return () => {
      window.removeEventListener('meeting_created', handleUpdate);
      window.removeEventListener('meeting_updated', handleUpdate);
      window.removeEventListener('meeting_rescheduled', handleUpdate);
      window.removeEventListener('meeting_cancelled', handleUpdate);
      if (socket) {
        socket.off('meeting_created', handleUpdate);
        socket.off('meeting_updated', handleUpdate);
        socket.off('meeting_rescheduled', handleUpdate);
        socket.off('meeting_cancelled', handleUpdate);
      }
    };
  }, [fetchMeetings]);

  // Handlers
  const handleOpenSchedule = () => {
    setEditingMeeting(null);
    setIsScheduleOpen(true);
  };

  const handleEditMeeting = (meeting) => {
    setEditingMeeting(meeting);
    setIsScheduleOpen(true);
  };

  const handleSelectMeeting = (meeting) => {
    setSelectedMeeting(meeting);
    setIsDrawerOpen(true);
  };

  const handleOpenReport = (meeting) => {
    setReportMeeting(meeting);
    setIsReportOpen(true);
  };

  const handleMeetingSaved = () => {
    fetchMeetings();
  };

  // Metrics summary
  const upcomingCount = meetings.filter(m => m.status === 'UPCOMING' || m.status === 'RESCHEDULED').length;
  const completedCount = meetings.filter(m => m.status === 'COMPLETED').length;
  const totalCount = meetings.length;

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-150">
      <CompanyScopeSelector />

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border/40 pb-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Video className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
              Meetings
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Schedule, collaborate, join Google Meet sessions, and record post-meeting action reports.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-stretch sm:self-auto">
          <button
            onClick={() => fetchMeetings()}
            disabled={loading}
            className="p-2.5 rounded-xl border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Refresh Meetings"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-primary' : ''}`} />
          </button>

          {canSchedule && (
            <button
              onClick={handleOpenSchedule}
              className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-md hover:bg-primary-hover transition-all flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Schedule Meeting</span>
            </button>
          )}
        </div>
      </div>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-2xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Upcoming Sessions</span>
            <p className="text-2xl font-black text-foreground mt-0.5">{upcomingCount}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Completed Sessions</span>
            <p className="text-2xl font-black text-foreground mt-0.5">{completedCount}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Total Managed</span>
            <p className="text-2xl font-black text-foreground mt-0.5">{totalCount}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Calendar className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Error Toast */}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            onClick={() => fetchMeetings()}
            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-rose-500/20 hover:bg-rose-500/30 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Main Meetings Listing & Views */}
      <MeetingCalendar
        meetings={meetings}
        loading={loading}
        onSelectMeeting={handleSelectMeeting}
        onScheduleNew={handleOpenSchedule}
        canSchedule={canSchedule}
        projects={projects}
        onOpenReport={handleOpenReport}
      />

      {/* Modals & Drawers */}
      <ScheduleMeetingModal
        isOpen={isScheduleOpen}
        onClose={() => {
          setIsScheduleOpen(false);
          setEditingMeeting(null);
        }}
        onSuccess={handleMeetingSaved}
        editingMeeting={editingMeeting}
      />

      <MeetingDetailDrawer
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setSelectedMeeting(null);
        }}
        meeting={selectedMeeting}
        onEdit={(m) => {
          setIsDrawerOpen(false);
          handleEditMeeting(m);
        }}
        onOpenReport={(m) => {
          setIsDrawerOpen(false);
          handleOpenReport(m);
        }}
        onMeetingUpdated={handleMeetingSaved}
      />

      <MeetingReportModal
        isOpen={isReportOpen}
        onClose={() => {
          setIsReportOpen(false);
          setReportMeeting(null);
        }}
        meeting={reportMeeting}
        onSuccess={handleMeetingSaved}
      />
    </div>
  );
};

export default Meetings;
