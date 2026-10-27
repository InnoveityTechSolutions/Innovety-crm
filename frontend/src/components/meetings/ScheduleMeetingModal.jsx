import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Calendar,
  Clock,
  Users,
  Video,
  FolderOpen,
  FileText,
  AlertCircle,
  CheckCircle2,
  Search,
  ShieldAlert,
  Loader2,
  ChevronDown,
  CheckSquare,
  Square,
  Building2,
  Filter
} from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useCompanyScope } from '../../context/CompanyScopeContext';
import UserAvatar from '../common/UserAvatar';
import { getMeetingLocalDateString } from '../../utils/meetingDateUtils';

/**
 * Validates Google Meet URL:
 * Must be https://meet.google.com/xxx-xxxx-xxx (or similar path)
 */
const isValidGoogleMeetUrl = (url) => {
  if (!url || typeof url !== 'string') return true; // Optional field
  const trimmed = url.trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname !== 'meet.google.com' && parsed.hostname !== 'www.meet.google.com') {
      return false;
    }
    const pathPart = parsed.pathname.replace(/^\/+/, '');
    if (!pathPart || pathPart.length < 3) return false;
    return true;
  } catch {
    return false;
  }
};

const ScheduleMeetingModal = ({
  isOpen,
  onClose,
  onSuccess,
  initialDate = '',
  editingMeeting = null
}) => {
  const { user } = useAuth();
  const { selectedOrgId, effectiveOrgId } = useCompanyScope();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const targetOrg = isSuperAdmin ? selectedOrgId : (effectiveOrgId || user?.organizationId);

  const isTeamLeader = user?.role === 'TEAM_LEADER';
  const isEdit = Boolean(editingMeeting);

  // Form State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:00');
  const [scope, setScope] = useState('OWN_TEAM_ONLY'); // 'OWN_TEAM_ONLY' | 'CROSS_TEAM'
  const [selectedAttendees, setSelectedAttendees] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [googleMeetUrl, setGoogleMeetUrl] = useState('');

  // UI state
  const [eligibleUsers, setEligibleUsers] = useState([]);
  const [teamMembersOnly, setTeamMembersOnly] = useState([]);
  const [allOrgUsers, setAllOrgUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [teams, setTeams] = useState([]);
  const [attendeeSearch, setAttendeeSearch] = useState('');
  const [attendeeDeptFilter, setAttendeeDeptFilter] = useState('ALL');
  const [attendeeRoleFilter, setAttendeeRoleFilter] = useState('ALL');
  const [loadingEligible, setLoadingEligible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [clientErrors, setClientErrors] = useState({});

  // Initialize or reset form on open / editingMeeting change
  useEffect(() => {
    if (!isOpen) return;

    setErrorMsg('');
    setClientErrors({});
    setAttendeeSearch('');
    setAttendeeDeptFilter('ALL');
    setAttendeeRoleFilter('ALL');

    if (editingMeeting) {
      setTitle(editingMeeting.title || '');
      setDescription(editingMeeting.description || '');

      // Parse date and times safely without timezone date shift
      const mDateStr = getMeetingLocalDateString(editingMeeting);
      setDate(mDateStr || (editingMeeting.date ? new Date(editingMeeting.date).toISOString().split('T')[0] : ''));

      if (editingMeeting.startTime) {
        const s = new Date(editingMeeting.startTime);
        setStartTime(s.toTimeString().slice(0, 5));
      } else {
        setStartTime('10:00');
      }

      if (editingMeeting.endTime) {
        const e = new Date(editingMeeting.endTime);
        setEndTime(e.toTimeString().slice(0, 5));
      } else {
        setEndTime('11:00');
      }

      setGoogleMeetUrl(editingMeeting.googleMeetUrl || '');
      setProjectId(editingMeeting.projectId || '');
      setTeamId(editingMeeting.teamId || '');
      setScope(editingMeeting.scope || 'OWN_TEAM_ONLY');

      // Pre-populate attendees (excluding organizer)
      if (Array.isArray(editingMeeting.attendees)) {
        const preAttendees = editingMeeting.attendees
          .map(a => a.user || a)
          .filter(u => u && u.id !== user?.id);
        setSelectedAttendees(preAttendees);
      } else {
        setSelectedAttendees([]);
      }
    } else {
      // Create Mode
      setTitle('');
      setDescription('');
      const defaultDate = initialDate || new Date().toISOString().split('T')[0];
      setDate(defaultDate);
      setStartTime('10:00');
      setEndTime('11:00');
      setGoogleMeetUrl('');
      setProjectId('');
      setTeamId('');
      setScope('OWN_TEAM_ONLY');
      setSelectedAttendees([]);
    }
  }, [isOpen, editingMeeting, initialDate, user?.id]);

  // Fetch projects and teams for organization
  useEffect(() => {
    if (!isOpen) return;

    const fetchMeta = async () => {
      try {
        const params = targetOrg ? { organizationId: targetOrg } : {};
        const [projRes, teamRes] = await Promise.all([
          api.get('/projects', { params }).catch(() => ({ data: [] })),
          api.get('/teams', { params }).catch(() => ({ data: [] }))
        ]);

        const loadedProjects = Array.isArray(projRes.data)
          ? projRes.data
          : (projRes.data?.projects || []);
        const loadedTeams = Array.isArray(teamRes.data)
          ? teamRes.data
          : (teamRes.data?.teams || []);

        setProjects(loadedProjects);
        setTeams(loadedTeams);
      } catch (err) {
        console.error('Failed to load project/team metadata:', err);
      }
    };

    fetchMeta();
  }, [isOpen, targetOrg]);

  // Fetch eligible attendees based on role and organization
  useEffect(() => {
    if (!isOpen) return;

    const fetchAttendees = async () => {
      setLoadingEligible(true);
      try {
        const params = targetOrg ? { organizationId: targetOrg } : {};

        // 1. Fetch organization active users
        const usersRes = await api.get('/users', {
          params: { ...params, status: 'ACTIVE', limit: 1000 }
        }).catch(() => ({ data: { users: [] } }));

        const allUsers = (usersRes.data?.users || []).filter(u => u.id !== user?.id);
        setAllOrgUsers(allUsers);

        // 2. If Team Leader, fetch teams to resolve OWN_TEAM_ONLY members
        if (isTeamLeader) {
          const teamsRes = await api.get('/teams', { params }).catch(() => ({ data: [] }));
          const userTeams = Array.isArray(teamsRes.data) ? teamsRes.data : [];

          const memberMap = new Map();
          userTeams.forEach(t => {
            if (t.leader && t.leader.id !== user?.id) {
              memberMap.set(t.leader.id, t.leader);
            }
            if (Array.isArray(t.members)) {
              t.members.forEach(m => {
                const u = m.user || m;
                if (u && u.id !== user?.id) {
                  memberMap.set(u.id, u);
                }
              });
            }
          });

          const ownTeamMembers = Array.from(memberMap.values());
          setTeamMembersOnly(ownTeamMembers);
        }
      } catch (err) {
        console.error('Failed to load attendee choices:', err);
      } finally {
        setLoadingEligible(false);
      }
    };

    fetchAttendees();
  }, [isOpen, targetOrg, isTeamLeader, user?.id]);

  // Determine active eligible users based on scope for Team Leader
  useEffect(() => {
    if (isTeamLeader) {
      if (scope === 'OWN_TEAM_ONLY') {
        setEligibleUsers(teamMembersOnly);

        // Revalidate currently selected attendees: remove any attendee who is NOT in own teams
        const validIds = new Set(teamMembersOnly.map(u => u.id));
        setSelectedAttendees(prev => prev.filter(u => validIds.has(u.id)));
      } else {
        setEligibleUsers(allOrgUsers);
      }
    } else {
      setEligibleUsers(allOrgUsers);
    }
  }, [scope, isTeamLeader, teamMembersOnly, allOrgUsers]);

  // Available departments/teams derived dynamically from loaded eligible users
  const availableDepartments = useMemo(() => {
    const set = new Set();
    eligibleUsers.forEach(u => {
      const dept = u.department || u.departmentRef?.name;
      if (dept && typeof dept === 'string' && dept.trim()) {
        set.add(dept.trim());
      }
      if (Array.isArray(u.teamMembers)) {
        u.teamMembers.forEach(tm => {
          if (tm.team?.name) set.add(tm.team.name.trim());
        });
      }
    });
    return Array.from(set).sort();
  }, [eligibleUsers]);

  // Filter eligible users for attendee picker search and filters
  const filteredAttendees = useMemo(() => {
    return eligibleUsers.filter(emp => {
      const q = attendeeSearch.toLowerCase().trim();
      const matchesSearch =
        !q ||
        emp.name?.toLowerCase().includes(q) ||
        emp.email?.toLowerCase().includes(q) ||
        emp.employeeId?.toLowerCase().includes(q) ||
        emp.role?.toLowerCase().includes(q);

      const userDept = (emp.department || emp.departmentRef?.name || '').toLowerCase();
      const userTeams = Array.isArray(emp.teamMembers)
        ? emp.teamMembers.map(tm => (tm.team?.name || '').toLowerCase())
        : [];

      const matchesDept =
        attendeeDeptFilter === 'ALL' ||
        userDept === attendeeDeptFilter.toLowerCase() ||
        userTeams.includes(attendeeDeptFilter.toLowerCase());

      const matchesRole =
        attendeeRoleFilter === 'ALL' || emp.role === attendeeRoleFilter;

      return matchesSearch && matchesDept && matchesRole;
    });
  }, [eligibleUsers, attendeeSearch, attendeeDeptFilter, attendeeRoleFilter]);

  // Check if all filtered attendees are selected
  const isAllFilteredSelected = useMemo(() => {
    if (filteredAttendees.length === 0) return false;
    const selectedIdSet = new Set(selectedAttendees.map(u => u.id));
    return filteredAttendees.every(emp => selectedIdSet.has(emp.id));
  }, [filteredAttendees, selectedAttendees]);

  // Toggle selection of all currently filtered candidates
  const handleToggleSelectAll = () => {
    if (isAllFilteredSelected) {
      // Deselect only filtered candidates, preserve all other selections
      const filteredIdSet = new Set(filteredAttendees.map(e => e.id));
      setSelectedAttendees(prev => prev.filter(u => !filteredIdSet.has(u.id)));
    } else {
      // Select all filtered candidates, preserve existing selections
      const selectedIdSet = new Set(selectedAttendees.map(u => u.id));
      const newlySelected = filteredAttendees.filter(u => !selectedIdSet.has(u.id));
      setSelectedAttendees(prev => [...prev, ...newlySelected]);
    }
  };

  // Toggle individual attendee selection
  const handleToggleAttendee = (member) => {
    if (!member || member.id === user?.id) return;
    setSelectedAttendees(prev => {
      const exists = prev.some(u => u.id === member.id);
      if (exists) {
        return prev.filter(u => u.id !== member.id);
      } else {
        return [...prev, member];
      }
    });
  };

  // Remove individual attendee
  const handleRemoveAttendee = (userId) => {
    setSelectedAttendees(prev => prev.filter(u => u.id !== userId));
  };

  // Clear all selections
  const handleClearAllSelections = () => {
    setSelectedAttendees([]);
  };

  // Validation
  const validateForm = () => {
    const errors = {};
    if (!title.trim()) {
      errors.title = 'Meeting title is required.';
    }
    if (!date) {
      errors.date = 'Meeting date is required.';
    }
    if (!startTime) {
      errors.startTime = 'Start time is required.';
    }
    if (!endTime) {
      errors.endTime = 'End time is required.';
    } else if (startTime && endTime) {
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      if (endMin <= startMin) {
        errors.endTime = 'End time must be later than start time.';
      }
    }

    if (selectedAttendees.length === 0) {
      errors.attendees = 'Please select at least one attendee.';
    }

    if (googleMeetUrl && !isValidGoogleMeetUrl(googleMeetUrl)) {
      errors.googleMeetUrl = 'Please enter a valid Google Meet link (https://meet.google.com/...).';
    }

    setClientErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Submit Handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!validateForm()) {
      return;
    }

    try {
      setSubmitting(true);

      // Create proper ISO date and times
      const startDateTime = new Date(`${date}T${startTime}:00`);
      const endDateTime = new Date(`${date}T${endTime}:00`);

      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        date: `${date}T00:00:00.000Z`,
        startTime: startDateTime.toISOString(),
        endTime: endDateTime.toISOString(),
        attendeeIds: selectedAttendees.map(u => u.id),
        scope: isTeamLeader ? scope : 'CROSS_TEAM',
        projectId: projectId || undefined,
        teamId: teamId || undefined,
        googleMeetUrl: googleMeetUrl.trim() || undefined
      };

      if (targetOrg) {
        payload.organizationId = targetOrg;
      }

      let res;
      if (isEdit) {
        res = await api.put(`/meetings/${editingMeeting.id}`, payload);
      } else {
        res = await api.post('/meetings', payload);
      }

      if (onSuccess) {
        onSuccess(res.data?.meeting || res.data);
      }
      onClose();
    } catch (err) {
      console.error('Meeting save error:', err);
      const backendMsg = err.response?.data?.message || err.message || 'Failed to save meeting.';
      setErrorMsg(backendMsg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">
                {isEdit ? 'Edit Meeting Details' : 'Schedule New Meeting'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {isEdit ? 'Update agenda, attendees, or timing' : 'Set up a new team collaboration or project review'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Server Error Alert */}
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Meeting Title */}
          <div>
            <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
              Meeting Title <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Sprint Planning, Architecture Sync, Project Review"
              className={`w-full px-3.5 py-2.5 rounded-xl bg-background border ${
                clientErrors.title ? 'border-rose-500 ring-1 ring-rose-500' : 'border-border'
              } text-foreground text-sm focus:outline-hidden focus:ring-2 focus:ring-primary`}
            />
            {clientErrors.title && (
              <p className="text-xs text-rose-500 mt-1">{clientErrors.title}</p>
            )}
          </div>

          {/* Date & Time Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
                Date <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={`w-full px-3.5 py-2.5 rounded-xl bg-background border ${
                    clientErrors.date ? 'border-rose-500 ring-1 ring-rose-500' : 'border-border'
                  } text-foreground text-sm focus:outline-hidden focus:ring-2 focus:ring-primary`}
                />
              </div>
              {clientErrors.date && (
                <p className="text-xs text-rose-500 mt-1">{clientErrors.date}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
                Start Time <span className="text-rose-500">*</span>
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={`w-full px-3.5 py-2.5 rounded-xl bg-background border ${
                  clientErrors.startTime ? 'border-rose-500 ring-1 ring-rose-500' : 'border-border'
                } text-foreground text-sm focus:outline-hidden focus:ring-2 focus:ring-primary`}
              />
              {clientErrors.startTime && (
                <p className="text-xs text-rose-500 mt-1">{clientErrors.startTime}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
                End Time <span className="text-rose-500">*</span>
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={`w-full px-3.5 py-2.5 rounded-xl bg-background border ${
                  clientErrors.endTime ? 'border-rose-500 ring-1 ring-rose-500' : 'border-border'
                } text-foreground text-sm focus:outline-hidden focus:ring-2 focus:ring-primary`}
              />
              {clientErrors.endTime && (
                <p className="text-xs text-rose-500 mt-1">{clientErrors.endTime}</p>
              )}
            </div>
          </div>

          {/* Organizer Info (Auto-populated & Read-only) */}
          <div className="p-3 rounded-xl bg-muted/40 border border-border/60 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <UserAvatar user={user} className="w-8 h-8 rounded-full" />
              <div>
                <span className="text-xs text-muted-foreground block">Organizer</span>
                <span className="text-xs font-semibold text-foreground">{user?.name} ({user?.email})</span>
              </div>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 uppercase">
              {user?.role || 'Host'}
            </span>
          </div>

          {/* Team Leader Invitation Scope Selector */}
          {isTeamLeader && (
            <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Invitation Scope
                </label>
                <span className="text-[11px] text-muted-foreground">Team Leader Control</span>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setScope('OWN_TEAM_ONLY')}
                  className={`p-3 rounded-xl text-left border transition-all ${
                    scope === 'OWN_TEAM_ONLY'
                      ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                      : 'bg-background hover:bg-muted text-muted-foreground border-border'
                  }`}
                >
                  <span className="font-bold text-xs block">Own Team Only</span>
                  <span className="text-[11px] opacity-80 block mt-0.5">
                    Colleagues in your managed team(s)
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setScope('CROSS_TEAM')}
                  className={`p-3 rounded-xl text-left border transition-all ${
                    scope === 'CROSS_TEAM'
                      ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                      : 'bg-background hover:bg-muted text-muted-foreground border-border'
                  }`}
                >
                  <span className="font-bold text-xs block">Cross-Team</span>
                  <span className="text-[11px] opacity-80 block mt-0.5">
                    Colleagues across all org teams
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Attendees Bulk Member Selector */}
          <div className="space-y-3 p-4 rounded-2xl bg-muted/20 border border-border/60">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-4 h-4 text-primary" />
                <span>SELECT MEETING ATTENDEES <span className="text-rose-500">*</span></span>
              </label>

              <span className="px-2.5 py-1 rounded-full text-xs font-extrabold bg-primary/10 text-primary border border-primary/20">
                Selected: {selectedAttendees.length}
              </span>
            </div>

            {/* Candidate Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search candidate..."
                  value={attendeeSearch}
                  onChange={e => setAttendeeSearch(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 bg-card border border-border/60 rounded-xl text-xs text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
                />
                {attendeeSearch && (
                  <button
                    type="button"
                    onClick={() => setAttendeeSearch('')}
                    className="absolute right-2 top-2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <select
                value={attendeeDeptFilter}
                onChange={e => setAttendeeDeptFilter(e.target.value)}
                className="bg-card border border-border/60 rounded-xl px-2 py-1.5 text-xs font-semibold text-foreground cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-primary"
              >
                <option value="ALL">All Depts / Teams</option>
                {availableDepartments.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>

              <select
                value={attendeeRoleFilter}
                onChange={e => setAttendeeRoleFilter(e.target.value)}
                className="bg-card border border-border/60 rounded-xl px-2 py-1.5 text-xs font-semibold text-foreground cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-primary"
              >
                <option value="ALL">All Roles</option>
                <option value="EMPLOYEE">Employees</option>
                <option value="TEAM_LEADER">Team Leaders</option>
                <option value="INTERN">Interns</option>
                <option value="ADMIN">Admins</option>
              </select>
            </div>

            {/* Select All Row */}
            <div className="flex items-center justify-between pt-1 border-t border-border/40 text-xs font-bold">
              <button
                type="button"
                onClick={handleToggleSelectAll}
                className="flex items-center gap-2 text-primary hover:text-primary-hover cursor-pointer select-none"
              >
                {isAllFilteredSelected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4 text-muted-foreground" />}
                <span>Select All Filtered ({filteredAttendees.length})</span>
              </button>

              {selectedAttendees.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAllSelections}
                  className="text-[11px] font-semibold text-muted-foreground hover:text-rose-500 cursor-pointer"
                >
                  Clear All ({selectedAttendees.length})
                </button>
              )}
            </div>

            {/* Candidate Checkbox List */}
            <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1 divide-y divide-border/30">
              {loadingEligible ? (
                <div className="p-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span>Loading eligible members...</span>
                </div>
              ) : filteredAttendees.length === 0 ? (
                <p className="text-xs text-muted-foreground p-4 text-center">
                  {eligibleUsers.length === 0
                    ? 'No eligible members found for this scope.'
                    : 'No matching employees found.'}
                </p>
              ) : (
                filteredAttendees.map(emp => {
                  const isSelected = selectedAttendees.some(u => u.id === emp.id);
                  const deptLabel = emp.department || emp.departmentRef?.name || (emp.teamMembers?.[0]?.team?.name ? `Team: ${emp.teamMembers[0].team.name}` : 'General');
                  return (
                    <div
                      key={emp.id}
                      onClick={() => handleToggleAttendee(emp)}
                      className={`flex items-center justify-between p-2 rounded-xl border transition-all cursor-pointer select-none ${
                        isSelected
                          ? 'bg-primary/10 border-primary/30 text-foreground font-bold'
                          : 'bg-card border-border/50 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <div className="flex items-center gap-2 text-xs min-w-0">
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-muted-foreground shrink-0" />
                        )}
                        <UserAvatar user={emp} className="h-7 w-7 rounded-full shrink-0" />
                        <div className="min-w-0">
                          <span className="font-bold text-foreground block leading-tight truncate">{emp.name}</span>
                          <span className="text-[10px] text-muted-foreground font-mono block truncate">
                            {emp.employeeId || 'ID N/A'} • {deptLabel}
                          </span>
                        </div>
                      </div>

                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                        {emp.role}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Selected Attendees Chips Summary */}
            {selectedAttendees.length > 0 && (
              <div className="pt-2 border-t border-border/40">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    Selected Members:
                  </span>
                </div>
                <div className="max-h-24 overflow-y-auto p-1.5 rounded-xl bg-background/50 border border-border/60 flex flex-wrap items-center gap-1.5">
                  {selectedAttendees.map(u => (
                    <span
                      key={u.id}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium border border-border"
                    >
                      <UserAvatar user={u} className="w-4 h-4 rounded-full text-[9px]" />
                      <span className="truncate max-w-[120px]">{u.name}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveAttendee(u.id);
                        }}
                        className="text-muted-foreground hover:text-rose-500 ml-0.5 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {clientErrors.attendees && (
              <p className="text-xs text-rose-500 mt-1">{clientErrors.attendees}</p>
            )}
          </div>

          {/* Related Project & Team */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
                Related Project (Optional)
              </label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-foreground text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
              >
                <option value="">No Project Linked</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.projectCode ? `(${p.projectCode})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
                Associated Team (Optional)
              </label>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-foreground text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
              >
                <option value="">General / No Team</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Google Meet URL */}
          <div>
            <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
              Google Meet Link (Optional)
            </label>
            <div className="relative">
              <Video className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
              <input
                type="url"
                value={googleMeetUrl}
                onChange={(e) => setGoogleMeetUrl(e.target.value)}
                placeholder="https://meet.google.com/xxx-xxxx-xxx"
                className={`w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-background border ${
                  clientErrors.googleMeetUrl ? 'border-rose-500 ring-1 ring-rose-500' : 'border-border'
                } text-foreground text-sm focus:outline-hidden focus:ring-2 focus:ring-primary`}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Manually paste an active Google Meet room link. Automatic generation is disabled in Phase 3.
            </p>
            {clientErrors.googleMeetUrl && (
              <p className="text-xs text-rose-500 mt-1">{clientErrors.googleMeetUrl}</p>
            )}
          </div>

          {/* Description / Agenda */}
          <div>
            <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
              Agenda & Description (Optional)
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Outline the meeting topics, goals, and preparation requirements..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-foreground text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
            />
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-muted/20 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-md hover:bg-primary-hover transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{isEdit ? 'Saving Changes...' : 'Scheduling...'}</span>
              </>
            ) : (
              <span>{isEdit ? 'Save Changes' : 'Schedule Meeting'}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScheduleMeetingModal;
