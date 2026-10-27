import React, { useState } from 'react';
import {
  Calendar,
  Clock,
  Video,
  Users,
  FolderOpen,
  FileText,
  Search,
  Filter,
  Plus,
  ExternalLink,
  ChevronRight,
  MoreVertical,
  CheckCircle2,
  RotateCcw,
  AlertCircle,
  LayoutGrid,
  ListFilter
} from 'lucide-react';
import UserAvatar from '../common/UserAvatar';
import { formatMeetingDisplayDate, formatMeetingDisplayTime } from '../../utils/meetingDateUtils';

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

const MeetingCalendar = ({
  meetings = [],
  loading = false,
  onSelectMeeting,
  onScheduleNew,
  canSchedule = false,
  projects = [],
  onOpenReport
}) => {
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [projectFilter, setProjectFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewLayout, setViewLayout] = useState('grid'); // 'grid' | 'table'

  // Filter meetings
  const filteredMeetings = meetings.filter((m) => {
    // Status filter
    if (statusFilter !== 'ALL' && m.status !== statusFilter) {
      return false;
    }

    // Project filter
    if (projectFilter !== 'ALL' && m.projectId !== projectFilter) {
      return false;
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const titleMatch = m.title?.toLowerCase().includes(q);
      const descMatch = m.description?.toLowerCase().includes(q);
      const organizerMatch = m.organizer?.name?.toLowerCase().includes(q);
      const attendeeMatch = (m.attendees || []).some((a) =>
        (a.user?.name || a.name || '').toLowerCase().includes(q)
      );
      const projMatch = m.project?.name?.toLowerCase().includes(q);
      return titleMatch || descMatch || organizerMatch || attendeeMatch || projMatch;
    }

    return true;
  });

  const formatDateTime = (dateVal, timeVal) => {
    try {
      const dateStr = formatMeetingDisplayDate(dateVal, timeVal, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
      const timeStr = formatMeetingDisplayTime(timeVal);
      return { dateStr, timeStr };
    } catch {
      return { dateStr: String(dateVal), timeStr: '' };
    }
  };

  return (
    <div className="space-y-6">
      {/* Controls Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-card border border-border rounded-2xl p-4 shadow-xs">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search meetings by title, host, attendee, or project..."
            className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-background border border-border text-xs text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Filters & Layout switch */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Status Tabs */}
          <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl border border-border">
            {['ALL', 'UPCOMING', 'COMPLETED', 'RESCHEDULED', 'CANCELLED'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  statusFilter === st
                    ? 'bg-card text-foreground shadow-xs font-bold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          {/* Project Dropdown Filter */}
          {projects.length > 0 && (
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-background border border-border text-xs font-medium text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
            >
              <option value="ALL">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}

          {/* Layout Toggle */}
          <div className="hidden sm:flex items-center bg-muted/40 p-1 rounded-xl border border-border">
            <button
              onClick={() => setViewLayout('grid')}
              className={`p-1.5 rounded-lg transition-colors ${
                viewLayout === 'grid'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Grid View"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewLayout('table')}
              className={`p-1.5 rounded-lg transition-colors ${
                viewLayout === 'table'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Table View"
            >
              <ListFilter className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="p-16 text-center text-muted-foreground flex flex-col items-center justify-center gap-3">
          <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium">Loading scheduled meetings...</p>
        </div>
      ) : filteredMeetings.length === 0 ? (
        <div className="p-16 text-center bg-card border border-dashed border-border rounded-2xl flex flex-col items-center justify-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center">
            <Calendar className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-foreground">No Meetings Found</h3>
            <p className="text-xs text-muted-foreground max-w-sm">
              {searchQuery || statusFilter !== 'ALL' || projectFilter !== 'ALL'
                ? 'No meetings match your selected filters. Try broadening your criteria.'
                : 'You have no scheduled meetings yet. Create your first session to collaborate with team members.'}
            </p>
          </div>
          {canSchedule && (
            <button
              onClick={onScheduleNew}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-md hover:bg-primary-hover transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Schedule New Meeting</span>
            </button>
          )}
        </div>
      ) : viewLayout === 'grid' ? (
        /* GRID VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredMeetings.map((meeting) => {
            const statusConfig = STATUS_BADGES[meeting.status] || STATUS_BADGES.UPCOMING;
            const { dateStr, timeStr } = formatDateTime(meeting.date, meeting.startTime);
            const endTimeStr = meeting.endTime
              ? new Date(meeting.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '';

            return (
              <div
                key={meeting.id}
                onClick={() => onSelectMeeting(meeting)}
                className="group relative bg-card hover:bg-card/90 border border-border hover:border-primary/40 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between space-y-4"
              >
                {/* Header row */}
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${statusConfig.bg}`}>
                      {statusConfig.label}
                    </span>
                    {meeting.report && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                        Report Available
                      </span>
                    )}
                  </div>

                  <h3 className="text-base font-bold text-foreground group-hover:text-primary transition-colors line-clamp-2">
                    {meeting.title}
                  </h3>

                  {meeting.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {meeting.description}
                    </p>
                  )}
                </div>

                {/* Metadata Row */}
                <div className="space-y-2.5 pt-2 border-t border-border/60 text-xs">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <Calendar className="w-3.5 h-3.5 text-primary" />
                      <span>{dateStr}</span>
                    </div>
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <Clock className="w-3.5 h-3.5 text-primary" />
                      <span>{timeStr} {endTimeStr ? `– ${endTimeStr}` : ''}</span>
                    </div>
                  </div>

                  {meeting.project && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <FolderOpen className="w-3.5 h-3.5 text-primary" />
                      <span className="truncate">{meeting.project.name}</span>
                    </div>
                  )}

                  {/* Organizer & Attendees */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                      <UserAvatar user={meeting.organizer} className="w-6 h-6 rounded-full text-[10px]" />
                      <span className="text-[11px] font-semibold text-foreground truncate max-w-[100px]">
                        {meeting.organizer?.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <div className="flex -space-x-1.5 overflow-hidden">
                        {(meeting.attendees || []).slice(0, 3).map((a, i) => (
                          <UserAvatar
                            key={i}
                            user={a.user || a}
                            className="inline-block w-5 h-5 rounded-full ring-2 ring-background text-[9px]"
                          />
                        ))}
                      </div>
                      {(meeting.attendees || []).length > 3 && (
                        <span className="text-[10px] text-muted-foreground font-bold">
                          +{(meeting.attendees || []).length - 3}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Action Buttons */}
                <div className="pt-2 flex items-center justify-between gap-2 border-t border-border/60">
                  {meeting.googleMeetUrl ? (
                    <a
                      href={meeting.googleMeetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground text-xs font-bold transition-all"
                    >
                      <Video className="w-3.5 h-3.5" />
                      <span>Join Meet</span>
                    </a>
                  ) : (
                    <span className="text-[11px] text-muted-foreground italic">No Meet link</span>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectMeeting(meeting);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  >
                    <span>Details</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="bg-card border border-border rounded-2xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 border-b border-border uppercase font-semibold text-muted-foreground tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Meeting</th>
                  <th className="px-4 py-3.5">Date & Time</th>
                  <th className="px-4 py-3.5">Organizer</th>
                  <th className="px-4 py-3.5">Attendees</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5">Project</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredMeetings.map((meeting) => {
                  const statusConfig = STATUS_BADGES[meeting.status] || STATUS_BADGES.UPCOMING;
                  const { dateStr, timeStr } = formatDateTime(meeting.date, meeting.startTime);

                  return (
                    <tr
                      key={meeting.id}
                      onClick={() => onSelectMeeting(meeting)}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                    >
                      <td className="px-5 py-3.5">
                        <div className="font-bold text-foreground hover:text-primary transition-colors">
                          {meeting.title}
                        </div>
                        {meeting.description && (
                          <div className="text-[11px] text-muted-foreground line-clamp-1 max-w-xs">
                            {meeting.description}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="font-semibold text-foreground">{dateStr}</div>
                        <div className="text-muted-foreground">{timeStr}</div>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <UserAvatar user={meeting.organizer} className="w-6 h-6 rounded-full text-[10px]" />
                          <span className="font-medium text-foreground">{meeting.organizer?.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="font-semibold text-foreground">
                          {(meeting.attendees || []).length} participants
                        </span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusConfig.bg}`}>
                          {statusConfig.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-muted-foreground">
                        {meeting.project ? meeting.project.name : '—'}
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                          {meeting.googleMeetUrl && (
                            <a
                              href={meeting.googleMeetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                              title="Join Meet"
                            >
                              <Video className="w-3.5 h-3.5" />
                            </a>
                          )}
                          <button
                            onClick={() => onSelectMeeting(meeting)}
                            className="px-2.5 py-1 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold transition-colors"
                          >
                            Details
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
      )}
    </div>
  );
};

export default MeetingCalendar;
