const prisma = require('../utils/db');
const { createNotification } = require('./notification');
const { logActivity } = require('../utils/activityLogger');
const { getIo } = require('../socket');

/**
 * Broadcast real-time Socket.IO meeting events to connected clients.
 */
const broadcastMeetingEvent = (eventName, data, organizationId) => {
  try {
    const io = getIo();
    if (!io) return;
    const payload = {
      ...data,
      organizationId,
      timestamp: new Date().toISOString()
    };
    if (organizationId) {
      io.to(`org_${organizationId}`).emit(eventName, payload);
    }
    io.emit(eventName, payload);
  } catch (err) {
    console.warn(`[Socket broadcast warning]: Failed to emit ${eventName}`, err.message);
  }
};

/**
 * Validates whether a Google Meet URL is a safe, valid https://meet.google.com link.
 * Rejects javascript:, data:, http:, non-meet domains, and unsafe characters.
 */
const isValidGoogleMeetUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname !== 'meet.google.com' && parsed.hostname !== 'www.meet.google.com') {
      return false;
    }
    const pathPart = parsed.pathname.replace(/^\/+/, '');
    if (!pathPart || pathPart.length < 3) return false;
    if (/[\s<>"'{}|\\^~\[\]`]/.test(trimmed)) return false;
    return true;
  } catch {
    return false;
  }
};

/**
 * Format a Date object into human-readable date & time for notifications.
 */
const formatMeetingDateTime = (dateObj) => {
  try {
    const d = new Date(dateObj);
    return {
      dateStr: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Kolkata' }),
      timeStr: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
    };
  } catch {
    return { dateStr: String(dateObj), timeStr: '' };
  }
};

/**
 * Get all team IDs associated with a user (as leader or member).
 */
const getUserAssociatedTeamIds = async (userId) => {
  const teams = await prisma.team.findMany({
    where: {
      OR: [
        { leaderId: userId },
        { members: { some: { userId } } }
      ]
    },
    select: { id: true }
  });
  return teams.map(t => t.id);
};

/**
 * Validates attendee scope and permissions.
 * Supports:
 * - OWN_TEAM_ONLY (default for Team Leaders)
 * - CROSS_TEAM
 * Enforces organization isolation and duplicate prevention.
 */
const validateAttendeesScope = async ({ user, attendeeIds, scope = 'OWN_TEAM_ONLY', organizationId }) => {
  if (!Array.isArray(attendeeIds) || attendeeIds.length === 0) {
    const err = new Error('At least one attendee is required.');
    err.status = 400;
    throw err;
  }

  // Deduplicate and filter out organizer
  const uniqueAttendeeIds = [...new Set(attendeeIds.map(id => String(id).trim()))].filter(id => id !== user.id);

  if (uniqueAttendeeIds.length === 0) {
    const err = new Error('At least one eligible attendee (excluding the organizer) must be selected.');
    err.status = 400;
    throw err;
  }

  // Validate attendee users in the database and enforce tenant isolation
  const attendees = await prisma.user.findMany({
    where: {
      id: { in: uniqueAttendeeIds },
      organizationId,
      status: 'ACTIVE'
    },
    select: { id: true, name: true, email: true, organizationId: true }
  });

  if (attendees.length !== uniqueAttendeeIds.length) {
    const foundIds = new Set(attendees.map(a => a.id));
    const missingOrForeignIds = uniqueAttendeeIds.filter(id => !foundIds.has(id));
    const err = new Error(`One or more selected attendees are invalid, inactive, or belong to another organization (${missingOrForeignIds.join(', ')}).`);
    err.status = 400;
    throw err;
  }

  // Role-specific attendee scope restrictions
  if (user.role === 'TEAM_LEADER') {
    const normalizedScope = String(scope || 'OWN_TEAM_ONLY').toUpperCase();
    if (normalizedScope !== 'OWN_TEAM_ONLY' && normalizedScope !== 'CROSS_TEAM') {
      const err = new Error('Invalid attendee scope. Must be either "OWN_TEAM_ONLY" or "CROSS_TEAM".');
      err.status = 400;
      throw err;
    }

    if (normalizedScope === 'OWN_TEAM_ONLY') {
      const leaderTeamIds = await getUserAssociatedTeamIds(user.id);
      if (leaderTeamIds.length === 0) {
        const err = new Error('You do not lead or belong to any teams. Cannot schedule meetings under OWN_TEAM_ONLY scope.');
        err.status = 403;
        throw err;
      }

      const teamMembers = await prisma.teamMember.findMany({
        where: { teamId: { in: leaderTeamIds } },
        select: { userId: true }
      });
      const allowedTeamUserIds = new Set(teamMembers.map(tm => tm.userId));

      const unauthorizedAttendees = uniqueAttendeeIds.filter(id => !allowedTeamUserIds.has(id));
      if (unauthorizedAttendees.length > 0) {
        const err = new Error('Under OWN_TEAM_ONLY scope, you may only invite members of your assigned team(s).');
        err.status = 403;
        throw err;
      }
    }
  }

  return uniqueAttendeeIds;
};

/**
 * List meetings visible to the user within their authorized scope.
 */
const listMeetings = async ({ user, query = {}, organizationId }) => {
  const where = { organizationId };

  // Status filter
  if (query.status && ['UPCOMING', 'COMPLETED', 'RESCHEDULED', 'CANCELLED'].includes(query.status)) {
    where.status = query.status;
  }

  // Date range filter
  if (query.startDate || query.endDate) {
    where.date = {};
    if (query.startDate) where.date.gte = new Date(query.startDate);
    if (query.endDate) where.date.lte = new Date(query.endDate);
  }

  // Related Project / Team filter
  if (query.projectId) where.projectId = query.projectId;
  if (query.teamId) where.teamId = query.teamId;

  // Role-based visibility
  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
    // Admins have organization-wide visibility
  } else if (user.role === 'TEAM_LEADER') {
    const leaderTeamIds = await getUserAssociatedTeamIds(user.id);
    where.OR = [
      { organizerId: user.id },
      { attendees: { some: { userId: user.id } } },
      ...(leaderTeamIds.length > 0 ? [{ teamId: { in: leaderTeamIds } }] : [])
    ];
  } else {
    // EMPLOYEE and INTERN can only see meetings they organize or attend
    where.OR = [
      { organizerId: user.id },
      { attendees: { some: { userId: user.id } } }
    ];
  }

  return prisma.meeting.findMany({
    where,
    include: {
      organizer: {
        select: { id: true, name: true, email: true, profilePic: true, role: true }
      },
      attendees: {
        include: {
          user: {
            select: { id: true, name: true, email: true, profilePic: true, role: true }
          }
        }
      },
      project: {
        select: { id: true, name: true, projectCode: true }
      },
      team: {
        select: { id: true, name: true }
      },
      report: {
        select: { id: true, summary: true, createdAt: true }
      }
    },
    orderBy: { startTime: 'asc' }
  });
};

/**
 * Fetch a single meeting by ID with access control.
 */
const getMeetingById = async ({ id, user, organizationId }) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      organizer: {
        select: { id: true, name: true, email: true, profilePic: true, role: true, organizationId: true }
      },
      attendees: {
        include: {
          user: {
            select: { id: true, name: true, email: true, profilePic: true, role: true, organizationId: true }
          }
        }
      },
      project: {
        select: { id: true, name: true, projectCode: true, organizationId: true }
      },
      team: {
        select: { id: true, name: true, organizationId: true }
      },
      report: {
        include: {
          createdBy: {
            select: { id: true, name: true, email: true, role: true }
          }
        }
      }
    }
  });

  if (!meeting || meeting.organizationId !== organizationId) {
    const err = new Error('Meeting not found.');
    err.status = 404;
    throw err;
  }

  // Access check
  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
    return meeting;
  }

  const isOrganizer = meeting.organizerId === user.id;
  const isAttendee = meeting.attendees.some(a => a.userId === user.id);

  if (user.role === 'TEAM_LEADER') {
    const leaderTeamIds = await getUserAssociatedTeamIds(user.id);
    const isTeamMeeting = meeting.teamId && leaderTeamIds.includes(meeting.teamId);
    if (!isOrganizer && !isAttendee && !isTeamMeeting) {
      const err = new Error('You do not have permission to view this meeting.');
      err.status = 403;
      throw err;
    }
    return meeting;
  }

  // EMPLOYEE / INTERN
  if (!isOrganizer && !isAttendee) {
    const err = new Error('You do not have permission to view this meeting.');
    err.status = 403;
    throw err;
  }

  return meeting;
};

/**
 * Schedule a new meeting transactionally with attendee validation and notifications.
 */
const createMeeting = async ({ user, data, organizationId }) => {
  const {
    title,
    description,
    date,
    startTime,
    endTime,
    attendeeIds,
    scope = 'OWN_TEAM_ONLY',
    projectId,
    teamId,
    googleMeetUrl
  } = data;

  if (!title || !title.trim()) {
    const err = new Error('Meeting title is required.');
    err.status = 400;
    throw err;
  }

  if (!date || !startTime || !endTime) {
    const err = new Error('Date, start time, and end time are required.');
    err.status = 400;
    throw err;
  }

  const parsedDate = new Date(date);
  const parsedStart = new Date(startTime);
  const parsedEnd = new Date(endTime);

  if (isNaN(parsedDate.getTime()) || isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
    const err = new Error('Invalid date or time format provided.');
    err.status = 400;
    throw err;
  }

  if (parsedEnd.getTime() <= parsedStart.getTime()) {
    const err = new Error('End time must be after start time.');
    err.status = 400;
    throw err;
  }

  // Validate Google Meet URL if supplied
  let cleanMeetUrl = null;
  if (googleMeetUrl && typeof googleMeetUrl === 'string' && googleMeetUrl.trim()) {
    if (!isValidGoogleMeetUrl(googleMeetUrl)) {
      const err = new Error('Invalid Google Meet URL. Must be a valid "https://meet.google.com/..." link.');
      err.status = 400;
      throw err;
    }
    cleanMeetUrl = googleMeetUrl.trim();
  }

  // Validate optional project reference
  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId }
    });
    if (!project) {
      const err = new Error('Referenced project was not found in your organization.');
      err.status = 400;
      throw err;
    }
  }

  // Validate optional team reference
  if (teamId) {
    const team = await prisma.team.findFirst({
      where: { id: teamId, organizationId }
    });
    if (!team) {
      const err = new Error('Referenced team was not found in your organization.');
      err.status = 400;
      throw err;
    }
  }

  // Validate attendees & scope
  const validatedAttendeeIds = await validateAttendeesScope({
    user,
    attendeeIds,
    scope,
    organizationId
  });

  // Transactional creation
  const createdMeeting = await prisma.$transaction(async (tx) => {
    const meeting = await tx.meeting.create({
      data: {
        organizationId,
        title: title.trim(),
        description: description ? description.trim() : null,
        date: parsedDate,
        startTime: parsedStart,
        endTime: parsedEnd,
        organizerId: user.id,
        googleMeetUrl: cleanMeetUrl,
        status: 'UPCOMING',
        projectId: projectId || null,
        teamId: teamId || null,
        attendees: {
          create: validatedAttendeeIds.map(userId => ({ userId }))
        }
      },
      include: {
        organizer: {
          select: { id: true, name: true, email: true, profilePic: true, role: true }
        },
        attendees: {
          include: {
            user: {
              select: { id: true, name: true, email: true, profilePic: true, role: true }
            }
          }
        },
        project: {
          select: { id: true, name: true, projectCode: true }
        },
        team: {
          select: { id: true, name: true }
        }
      }
    });

    return meeting;
  });

  // Notify invited attendees
  const { dateStr, timeStr } = formatMeetingDateTime(parsedStart);
  await Promise.all(validatedAttendeeIds.map(attendeeId =>
    createNotification({
      userId: attendeeId,
      title: 'New Meeting Invitation',
      message: `${user.name} invited you to "${createdMeeting.title}" on ${dateStr} at ${timeStr}.`,
      type: 'MEETING_SCHEDULED'
    }).catch(err => console.warn('[MeetingNotification Warning]:', err.message))
  ));

  // Audit log
  logActivity({
    userId: user.id,
    organizationId,
    action: 'CREATE_MEETING',
    details: `Scheduled meeting "${createdMeeting.title}" with ${validatedAttendeeIds.length} attendee(s).`
  }).catch(() => {});

  // Real-time broadcast
  broadcastMeetingEvent('meeting_created', { meeting: createdMeeting }, organizationId);

  return createdMeeting;
};

/**
 * Update meeting details.
 * Allowed only for the organizer or an administrator.
 */
const updateMeeting = async ({ id, user, data, organizationId }) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { attendees: true }
  });

  if (!meeting || meeting.organizationId !== organizationId) {
    const err = new Error('Meeting not found.');
    err.status = 404;
    throw err;
  }

  // Authorization: Organizer or Admin/Super Admin
  const isOrganizer = meeting.organizerId === user.id;
  const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';

  if (!isOrganizer && !isAdmin) {
    const err = new Error('Only the meeting organizer or an administrator may update this meeting.');
    err.status = 403;
    throw err;
  }

  if (meeting.status === 'CANCELLED') {
    const err = new Error('Cannot update a cancelled meeting.');
    err.status = 400;
    throw err;
  }

  const updateData = {};

  if (data.title && data.title.trim()) {
    updateData.title = data.title.trim();
  }

  if (data.description !== undefined) {
    updateData.description = data.description ? data.description.trim() : null;
  }

  if (data.projectId !== undefined) {
    if (data.projectId) {
      const project = await prisma.project.findFirst({ where: { id: data.projectId, organizationId } });
      if (!project) {
        const err = new Error('Referenced project not found in organization.');
        err.status = 400;
        throw err;
      }
    }
    updateData.projectId = data.projectId || null;
  }

  if (data.teamId !== undefined) {
    if (data.teamId) {
      const team = await prisma.team.findFirst({ where: { id: data.teamId, organizationId } });
      if (!team) {
        const err = new Error('Referenced team not found in organization.');
        err.status = 400;
        throw err;
      }
    }
    updateData.teamId = data.teamId || null;
  }

  if (data.googleMeetUrl !== undefined) {
    if (data.googleMeetUrl && data.googleMeetUrl.trim()) {
      if (!isValidGoogleMeetUrl(data.googleMeetUrl)) {
        const err = new Error('Invalid Google Meet URL. Must be a valid "https://meet.google.com/..." link.');
        err.status = 400;
        throw err;
      }
      updateData.googleMeetUrl = data.googleMeetUrl.trim();
    } else {
      updateData.googleMeetUrl = null;
    }
  }

  // Time updates
  let timesChanged = false;
  if (data.startTime || data.endTime || data.date) {
    const newDate = data.date ? new Date(data.date) : meeting.date;
    const newStart = data.startTime ? new Date(data.startTime) : meeting.startTime;
    const newEnd = data.endTime ? new Date(data.endTime) : meeting.endTime;

    if (isNaN(newDate.getTime()) || isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) {
      const err = new Error('Invalid date or time format provided.');
      err.status = 400;
      throw err;
    }

    if (newEnd.getTime() <= newStart.getTime()) {
      const err = new Error('End time must be after start time.');
      err.status = 400;
      throw err;
    }

    updateData.date = newDate;
    updateData.startTime = newStart;
    updateData.endTime = newEnd;
    timesChanged = true;
  }

  // Update attendees if provided
  let newAttendeeIds = null;
  if (Array.isArray(data.attendeeIds)) {
    newAttendeeIds = await validateAttendeesScope({
      user,
      attendeeIds: data.attendeeIds,
      scope: data.scope || 'CROSS_TEAM', // When updating attendees, cross-team or existing
      organizationId
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (newAttendeeIds) {
      // Replace attendees
      await tx.meetingAttendee.deleteMany({ where: { meetingId: id } });
      await tx.meetingAttendee.createMany({
        data: newAttendeeIds.map(userId => ({ meetingId: id, userId }))
      });
    }

    return tx.meeting.update({
      where: { id },
      data: updateData,
      include: {
        organizer: { select: { id: true, name: true, email: true, profilePic: true, role: true } },
        attendees: { include: { user: { select: { id: true, name: true, email: true, profilePic: true, role: true } } } },
        project: { select: { id: true, name: true, projectCode: true } },
        team: { select: { id: true, name: true } },
        report: true
      }
    });
  });

  // Notify attendees if times or link changed
  if (timesChanged || data.googleMeetUrl !== undefined) {
    const { dateStr, timeStr } = formatMeetingDateTime(updated.startTime);
    await Promise.all(updated.attendees.map(attendee => {
      if (attendee.userId !== user.id) {
        return createNotification({
          userId: attendee.userId,
          title: 'Meeting Details Updated',
          message: `The meeting "${updated.title}" has been updated: ${dateStr} at ${timeStr}.`,
          type: 'MEETING_RESCHEDULED'
        }).catch(() => {});
      }
      return Promise.resolve();
    }));
  }

  // Real-time broadcast
  broadcastMeetingEvent('meeting_updated', { meeting: updated }, organizationId);

  return updated;
};

/**
 * Reschedule a meeting to a new date and time range.
 */
const rescheduleMeeting = async ({ id, user, data, organizationId }) => {
  const { date, startTime, endTime } = data;

  if (!date || !startTime || !endTime) {
    const err = new Error('New date, start time, and end time are required to reschedule.');
    err.status = 400;
    throw err;
  }

  const newDate = new Date(date);
  const newStart = new Date(startTime);
  const newEnd = new Date(endTime);

  if (isNaN(newDate.getTime()) || isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) {
    const err = new Error('Invalid date/time format.');
    err.status = 400;
    throw err;
  }

  if (newEnd.getTime() <= newStart.getTime()) {
    const err = new Error('End time must be after start time.');
    err.status = 400;
    throw err;
  }

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { attendees: true }
  });

  if (!meeting || meeting.organizationId !== organizationId) {
    const err = new Error('Meeting not found.');
    err.status = 404;
    throw err;
  }

  if (meeting.status === 'CANCELLED') {
    const err = new Error('Cannot reschedule a cancelled meeting.');
    err.status = 400;
    throw err;
  }

  const isOrganizer = meeting.organizerId === user.id;
  const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';

  if (!isOrganizer && !isAdmin) {
    const err = new Error('Only the meeting organizer or an administrator may reschedule this meeting.');
    err.status = 403;
    throw err;
  }

  const updated = await prisma.meeting.update({
    where: { id },
    data: {
      date: newDate,
      startTime: newStart,
      endTime: newEnd,
      status: 'RESCHEDULED'
    },
    include: {
      organizer: { select: { id: true, name: true, email: true, profilePic: true, role: true } },
      attendees: { include: { user: { select: { id: true, name: true, email: true, profilePic: true, role: true } } } }
    }
  });

  // Notify attendees
  const { dateStr, timeStr } = formatMeetingDateTime(newStart);
  await Promise.all(updated.attendees.map(attendee => {
    if (attendee.userId !== user.id) {
      return createNotification({
        userId: attendee.userId,
        title: 'Meeting Rescheduled',
        message: `The meeting "${updated.title}" has been rescheduled to ${dateStr} at ${timeStr}.`,
        type: 'MEETING_RESCHEDULED'
      }).catch(() => {});
    }
    return Promise.resolve();
  }));

  // Real-time broadcast
  broadcastMeetingEvent('meeting_rescheduled', { meeting: updated }, organizationId);

  return updated;
};

/**
 * Cancel a meeting.
 */
const cancelMeeting = async ({ id, user, reason, organizationId }) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { attendees: true }
  });

  if (!meeting || meeting.organizationId !== organizationId) {
    const err = new Error('Meeting not found.');
    err.status = 404;
    throw err;
  }

  const isOrganizer = meeting.organizerId === user.id;
  const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';

  if (!isOrganizer && !isAdmin) {
    const err = new Error('Only the meeting organizer or an administrator may cancel this meeting.');
    err.status = 403;
    throw err;
  }

  if (meeting.status === 'CANCELLED') {
    return meeting;
  }

  const updated = await prisma.meeting.update({
    where: { id },
    data: { status: 'CANCELLED' },
    include: {
      organizer: { select: { id: true, name: true, email: true, profilePic: true, role: true } },
      attendees: { include: { user: { select: { id: true, name: true, email: true, profilePic: true, role: true } } } }
    }
  });

  // Notify attendees
  const { dateStr } = formatMeetingDateTime(meeting.startTime);
  const cancelMsg = reason
    ? `The meeting "${meeting.title}" scheduled for ${dateStr} has been cancelled. Reason: ${reason}`
    : `The meeting "${meeting.title}" scheduled for ${dateStr} has been cancelled.`;

  await Promise.all(updated.attendees.map(attendee => {
    if (attendee.userId !== user.id) {
      return createNotification({
        userId: attendee.userId,
        title: 'Meeting Cancelled',
        message: cancelMsg,
        type: 'MEETING_CANCELLED'
      }).catch(() => {});
    }
    return Promise.resolve();
  }));


  // Real-time broadcast
  broadcastMeetingEvent('meeting_cancelled', { meeting: updated }, organizationId);

  return updated;
};

/**
 * Mark a meeting as COMPLETED.
 */
const completeMeeting = async ({ id, user, organizationId }) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id }
  });

  if (!meeting || meeting.organizationId !== organizationId) {
    const err = new Error('Meeting not found.');
    err.status = 404;
    throw err;
  }

  if (meeting.status === 'CANCELLED') {
    const err = new Error('Cannot complete a cancelled meeting.');
    err.status = 400;
    throw err;
  }

  const isOrganizer = meeting.organizerId === user.id;
  const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';

  if (!isOrganizer && !isAdmin) {
    const err = new Error('Only the meeting organizer or an administrator may complete this meeting.');
    err.status = 403;
    throw err;
  }

  const updated = await prisma.meeting.update({
    where: { id },
    data: { status: 'COMPLETED' },
    include: {
      organizer: { select: { id: true, name: true, email: true, role: true } },
      report: true
    }
  });

  // Real-time broadcast
  broadcastMeetingEvent('meeting_updated', { meeting: updated }, organizationId);

  return updated;
};

/**
 * Fetch report for a meeting.
 */
const getMeetingReport = async ({ meetingId, user, organizationId }) => {
  const meeting = await getMeetingById({ id: meetingId, user, organizationId });

  const report = await prisma.meetingReport.findUnique({
    where: { meetingId },
    include: {
      createdBy: {
        select: { id: true, name: true, email: true, role: true }
      }
    }
  });

  if (!report) {
    const err = new Error('No report has been submitted for this meeting.');
    err.status = 404;
    throw err;
  }

  return {
    ...report,
    meetingTitle: meeting.title,
    meetingDate: meeting.date,
    meetingStartTime: meeting.startTime,
    meetingEndTime: meeting.endTime,
    attendees: meeting.attendees.map(a => a.user)
  };
};

/**
 * Create or update the single report associated with a meeting (Idempotent Upsert).
 */
const upsertMeetingReport = async ({ meetingId, user, data, organizationId }) => {
  const meeting = await getMeetingById({ id: meetingId, user, organizationId });

  const isOrganizer = meeting.organizerId === user.id;
  const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';

  if (!isOrganizer && !isAdmin) {
    const err = new Error('Only the meeting organizer or an administrator may record meeting reports.');
    err.status = 403;
    throw err;
  }

  if (meeting.status === 'CANCELLED') {
    const err = new Error('Cannot submit a report for a cancelled meeting.');
    err.status = 400;
    throw err;
  }

  const { summary, followUpTasks } = data;

  if (!summary || !summary.trim()) {
    const err = new Error('Meeting summary is required.');
    err.status = 400;
    throw err;
  }

  // Validate followUpTasks JSON format and enforce tenant boundary on assignees
  let sanitizedTasks = null;
  if (followUpTasks) {
    if (Array.isArray(followUpTasks)) {
      const rawAssigneeIds = followUpTasks
        .map(t => t.assigneeId)
        .filter(id => id && typeof id === 'string');

      if (rawAssigneeIds.length > 0) {
        const validUsers = await prisma.user.findMany({
          where: {
            id: { in: rawAssigneeIds },
            organizationId,
            status: 'ACTIVE'
          },
          select: { id: true }
        });
        const validUserIds = new Set(validUsers.map(u => u.id));

        const invalidAssignees = rawAssigneeIds.filter(id => !validUserIds.has(id));
        if (invalidAssignees.length > 0) {
          const err = new Error('One or more task assignees are invalid, inactive, or belong to another organization.');
          err.status = 400;
          throw err;
        }
      }

      sanitizedTasks = followUpTasks.map(t => ({
        title: String(t.title || '').trim(),
        description: t.description ? String(t.description).trim() : '',
        priority: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(t.priority) ? t.priority : 'MEDIUM',
        assigneeId: t.assigneeId || null,
        deadline: t.deadline || null
      }));
    } else {
      sanitizedTasks = followUpTasks;
    }
  }

  // Automatically mark meeting as COMPLETED when a report is filed, if still UPCOMING/RESCHEDULED
  if (meeting.status !== 'COMPLETED') {
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'COMPLETED' }
    });
  }

  const report = await prisma.meetingReport.upsert({
    where: { meetingId },
    create: {
      meetingId,
      summary: summary.trim(),
      followUpTasks: sanitizedTasks || undefined,
      createdById: user.id
    },
    update: {
      summary: summary.trim(),
      followUpTasks: sanitizedTasks || undefined,
      createdById: user.id
    },
    include: {
      createdBy: {
        select: { id: true, name: true, email: true, role: true }
      }
    }
  });

  // Real-time broadcast
  broadcastMeetingEvent('meeting_updated', { meetingId, report }, organizationId);

  return {
    ...report,
    meetingTitle: meeting.title,
    meetingDate: meeting.date,
    meetingStartTime: meeting.startTime,
    meetingEndTime: meeting.endTime,
    attendees: meeting.attendees.map(a => a.user)
  };
};

module.exports = {
  isValidGoogleMeetUrl,
  listMeetings,
  getMeetingById,
  createMeeting,
  updateMeeting,
  rescheduleMeeting,
  cancelMeeting,
  completeMeeting,
  getMeetingReport,
  upsertMeetingReport,
  validateAttendeesScope
};
