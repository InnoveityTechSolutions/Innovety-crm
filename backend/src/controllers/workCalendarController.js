const prisma = require('../utils/db');
const { resolveMonthlyCalendar } = require('../services/calendarResolverService');
const { getEffectiveOrgId } = require('../utils/organizationScope');
const { broadcastShiftUpdate } = require('../socket');

/**
 * GET /api/work-calendar
 * Returns resolved monthly calendar for requested month & year for current user,
 * dynamically resolved from their assigned shift.
 */
const getCalendar = async (req, res) => {
  try {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }

    const today = new Date();
    const month = parseInt(req.query.month, 10) || (today.getMonth() + 1);
    const year = parseInt(req.query.year, 10) || today.getFullYear();

    if (month < 1 || month > 12) {
      return res.status(400).json({ message: 'Month must be an integer between 1 and 12.' });
    }
    if (year < 2000 || year > 2100) {
      return res.status(400).json({ message: 'Year must be a valid 4-digit year.' });
    }

    const targetOrgId = getEffectiveOrgId(req);

    // Access control for optional targetUserId query parameter
    let targetUser = req.user;
    const requestedUserId = req.query.userId;

    if (requestedUserId && requestedUserId !== req.user.id) {
      if (['EMPLOYEE', 'INTERN'].includes(req.user.role)) {
        return res.status(403).json({ message: 'You are not authorized to view another employee\'s calendar.' });
      } else if (req.user.role === 'TEAM_LEADER') {
        const membership = await prisma.teamMember.findFirst({
          where: {
            userId: requestedUserId,
            team: { leaderId: req.user.id, organizationId: targetOrgId }
          }
        });
        if (!membership) {
          return res.status(403).json({ message: 'You can only view calendars for members of teams you lead.' });
        }
        targetUser = await prisma.user.findUnique({ where: { id: requestedUserId } });
      } else if (['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
        const u = await prisma.user.findUnique({ where: { id: requestedUserId } });
        if (u && targetOrgId && u.organizationId !== targetOrgId && req.user.role !== 'SUPER_ADMIN') {
          return res.status(403).json({ message: 'Unauthorized organization scope.' });
        }
        if (u) targetUser = u;
      }
    }

    const calendarResult = await resolveMonthlyCalendar({
      user: targetUser,
      month,
      year,
      organizationId: targetOrgId
    });

    return res.json({
      month,
      year,
      shiftName: calendarResult.shiftName || 'Company Default',
      startTime: calendarResult.startTime || '09:00',
      endTime: calendarResult.endTime || '18:00',
      formattedStart: calendarResult.formattedStart || '09:00 AM',
      formattedEnd: calendarResult.formattedEnd || '06:00 PM',
      days: calendarResult.days || []
    });
  } catch (error) {
    console.error('Error fetching work calendar:', error);
    return res.status(500).json({ message: 'Failed to fetch work calendar data.', error: error.message });
  }
};

/**
 * POST /api/work-calendar
 * Create or upsert a calendar override (Super Admin only).
 */
const createOverride = async (req, res) => {
  try {
    const { date, status, title, reason, isPermanent } = req.body;
    const targetOrgId = getEffectiveOrgId(req);

    if (!date) {
      return res.status(400).json({ message: 'Date string (YYYY-MM-DD) is required.' });
    }

    const allowedStatuses = ['WORKING_DAY', 'WFH', 'HOLIDAY'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Must be WORKING_DAY, WFH, or HOLIDAY.' });
    }

    // Parse date safely
    const [y, m, d] = date.split('-').map(Number);
    const dateObj = new Date(Date.UTC(y, m - 1, d));

    // Check if Sunday (0 = Sunday in UTC/local)
    if (dateObj.getUTCDay() === 0) {
      return res.status(400).json({ message: 'Sunday is a fixed weekly holiday and cannot be modified.' });
    }

    const recurrenceMonth = m;
    const recurrenceDay = d;
    const isPerm = Boolean(isPermanent);

    let resultRecord;

    const cleanTitle = typeof title === 'string' ? (title.trim() || null) : null;
    const cleanReason = typeof reason === 'string' ? (reason.trim() || null) : null;

    const orgFilter = targetOrgId ? {
      OR: [
        { organizationId: targetOrgId },
        { organizationId: null, createdBy: { organizationId: targetOrgId } }
      ]
    } : {};

    if (isPerm) {
      // Check if permanent rule exists for this month & day for this organization
      const existingPerm = await prisma.workCalendar.findFirst({
        where: {
          isPermanent: true,
          recurrenceMonth,
          recurrenceDay,
          ...orgFilter
        }
      });

      if (existingPerm) {
        resultRecord = await prisma.workCalendar.update({
          where: { id: existingPerm.id },
          data: {
            status,
            title: cleanTitle,
            reason: cleanReason,
            createdById: req.user.id,
            ...(targetOrgId ? { organizationId: targetOrgId } : {})
          }
        });
      } else {
        resultRecord = await prisma.workCalendar.create({
          data: {
            date: dateObj,
            status,
            title: cleanTitle,
            reason: cleanReason,
            isPermanent: true,
            recurrenceMonth,
            recurrenceDay,
            createdById: req.user.id,
            ...(targetOrgId ? { organizationId: targetOrgId } : {})
          }
        });
      }
    } else {
      // Check if specific date override exists for this organization
      const existingOverride = await prisma.workCalendar.findFirst({
        where: {
          date: dateObj,
          isPermanent: false,
          ...orgFilter
        }
      });

      if (existingOverride) {
        resultRecord = await prisma.workCalendar.update({
          where: { id: existingOverride.id },
          data: {
            status,
            title: cleanTitle,
            reason: cleanReason,
            createdById: req.user.id,
            ...(targetOrgId ? { organizationId: targetOrgId } : {})
          }
        });
      } else {
        resultRecord = await prisma.workCalendar.create({
          data: {
            date: dateObj,
            status,
            title: cleanTitle,
            reason: cleanReason,
            isPermanent: false,
            createdById: req.user.id,
            ...(targetOrgId ? { organizationId: targetOrgId } : {})
          }
        });
      }
    }

    if (targetOrgId) {
      broadcastShiftUpdate(targetOrgId, { action: 'CALENDAR_OVERRIDE_CREATED' });
    }

    return res.status(201).json({
      message: 'Work calendar override saved successfully.',
      override: resultRecord
    });
  } catch (error) {
    console.error('Error creating work calendar override:', error);
    return res.status(500).json({ message: 'Failed to save calendar override.', error: error.message });
  }
};

/**
 * PUT /api/work-calendar/:id
 * Update an existing calendar override (Admin / Super Admin).
 */
const updateOverride = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, title, reason, isPermanent } = req.body;

    const existing = await prisma.workCalendar.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'Calendar override record not found.' });
    }

    if (existing.date && new Date(existing.date).getUTCDay() === 0) {
      return res.status(400).json({ message: 'Sunday is a fixed weekly holiday and cannot be modified.' });
    }

    const allowedStatuses = ['WORKING_DAY', 'WFH', 'HOLIDAY'];
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Must be WORKING_DAY, WFH, or HOLIDAY.' });
    }

    const cleanTitle = title !== undefined ? (typeof title === 'string' ? (title.trim() || null) : null) : existing.title;
    const cleanReason = reason !== undefined ? (typeof reason === 'string' ? (reason.trim() || null) : null) : existing.reason;

    const updated = await prisma.workCalendar.update({
      where: { id },
      data: {
        status: status || existing.status,
        title: cleanTitle,
        reason: cleanReason,
        isPermanent: isPermanent !== undefined ? Boolean(isPermanent) : existing.isPermanent,
        createdById: req.user.id
      }
    });

    if (existing.organizationId) {
      broadcastShiftUpdate(existing.organizationId, { action: 'CALENDAR_OVERRIDE_UPDATED' });
    }

    return res.json({
      message: 'Calendar override updated successfully.',
      override: updated
    });
  } catch (error) {
    console.error('Error updating work calendar override:', error);
    return res.status(500).json({ message: 'Failed to update calendar override.', error: error.message });
  }
};

/**
 * DELETE /api/work-calendar/:id
 * Delete a calendar override, reverting date to default precedence (Super Admin only).
 */
const deleteOverride = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await prisma.workCalendar.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'Calendar override record not found.' });
    }

    await prisma.workCalendar.delete({ where: { id } });

    if (existing.organizationId) {
      broadcastShiftUpdate(existing.organizationId, { action: 'CALENDAR_OVERRIDE_DELETED' });
    }

    return res.json({
      message: 'Calendar override removed successfully. Date restored to default status.'
    });
  } catch (error) {
    console.error('Error deleting work calendar override:', error);
    return res.status(500).json({ message: 'Failed to delete calendar override.', error: error.message });
  }
};

module.exports = {
  getCalendar,
  createOverride,
  updateOverride,
  deleteOverride
};
