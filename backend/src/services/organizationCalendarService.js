const prisma = require('../utils/db');

/**
 * Service to aggregate a unified organization calendar:
 * Holidays, Approved Leaves, Shift Overrides, Birthdays, Work Anniversaries, and Company Events.
 */

const getUnifiedCalendar = async ({
  organizationId,
  branchId,
  department,
  startDate,
  endDate,
  types
}) => {
  const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const end = endDate ? new Date(endDate) : new Date(new Date().getFullYear(), new Date().getMonth() + 2, 0);

  const filterTypes = types && Array.isArray(types) && types.length > 0 ? types : [
    'HOLIDAY',
    'LEAVE',
    'SHIFT_OVERRIDE',
    'BIRTHDAY',
    'WORK_ANNIVERSARY',
    'COMPANY_EVENT',
    'COMP_OFF'
  ];

  const events = [];

  // 1. Company Events
  if (filterTypes.includes('COMPANY_EVENT')) {
    const eventWhere = {
      startDate: { lte: end },
      endDate: { gte: start }
    };
    if (organizationId) eventWhere.organizationId = organizationId;
    if (branchId && branchId !== 'ALL') eventWhere.branchId = branchId;
    if (department && department !== 'ALL') eventWhere.department = department;

    const companyEvents = await prisma.organizationEvent.findMany({
      where: eventWhere,
      include: { branch: true }
    });

    for (const ce of companyEvents) {
      events.push({
        id: `event-${ce.id}`,
        type: 'COMPANY_EVENT',
        category: ce.eventType || 'GENERAL',
        title: ce.title,
        description: ce.description,
        startDate: ce.startDate,
        endDate: ce.endDate,
        location: ce.location || (ce.branch ? ce.branch.name : 'All Locations'),
        isAllDay: ce.isAllDay,
        color: '#6366F1' // Indigo
      });
    }
  }

  // 2. Public Holidays
  if (filterTypes.includes('HOLIDAY')) {
    const holidayWhere = {
      date: { gte: start, lte: end }
    };
    if (organizationId) holidayWhere.organizationId = organizationId;

    const holidays = await prisma.holidayCalendar.findMany({
      where: holidayWhere
    });

    for (const h of holidays) {
      events.push({
        id: `holiday-${h.id}`,
        type: 'HOLIDAY',
        category: 'HOLIDAY',
        title: `🌴 ${h.name}`,
        description: h.description || 'Public Holiday',
        startDate: h.date,
        endDate: h.date,
        isAllDay: true,
        color: '#10B981' // Emerald
      });
    }
  }

  // 3. Approved Leaves
  if (filterTypes.includes('LEAVE')) {
    const leaveWhere = {
      status: 'APPROVED',
      startDate: { lte: end },
      endDate: { gte: start }
    };
    if (organizationId) {
      leaveWhere.user = { organizationId };
    }
    if (branchId && branchId !== 'ALL') {
      leaveWhere.user = { ...leaveWhere.user, branchId };
    }
    if (department && department !== 'ALL') {
      leaveWhere.user = { ...leaveWhere.user, department };
    }

    const leaves = await prisma.leaveRequest.findMany({
      where: leaveWhere,
      include: {
        user: { select: { id: true, name: true, employeeId: true, department: true } }
      }
    });

    for (const l of leaves) {
      events.push({
        id: `leave-${l.id}`,
        type: 'LEAVE',
        category: l.leaveType || 'Leave',
        title: `🏖️ ${l.user.name} - ${l.leaveType || 'On Leave'}`,
        description: l.reason || 'Approved Leave',
        startDate: l.startDate,
        endDate: l.endDate,
        isAllDay: true,
        employeeName: l.user.name,
        color: '#F59E0B' // Amber
      });
    }
  }

  // 4. Shift Overrides & Swaps
  if (filterTypes.includes('SHIFT_OVERRIDE')) {
    const shiftWhere = {
      type: { in: ['OVERRIDE', 'SWAP', 'PLANNED'] },
      status: 'ACTIVE',
      startDate: { lte: end },
      endDate: { gte: start }
    };
    if (organizationId) shiftWhere.organizationId = organizationId;

    const schedules = await prisma.shiftSchedule.findMany({
      where: shiftWhere,
      include: {
        user: { select: { id: true, name: true, department: true } },
        shift: { select: { name: true, startTime: true, endTime: true } }
      }
    });

    for (const s of schedules) {
      events.push({
        id: `shift-override-${s.id}`,
        type: 'SHIFT_OVERRIDE',
        category: s.type,
        title: `🔄 ${s.user.name} (${s.type}): ${s.shift?.name || 'Special Shift'}`,
        description: `Timing: ${s.shift?.startTime} - ${s.shift?.endTime}. Reason: ${s.reason || 'Assigned'}`,
        startDate: s.startDate,
        endDate: s.endDate,
        isAllDay: true,
        employeeName: s.user.name,
        color: '#8B5CF6' // Purple
      });
    }
  }

  // 5. Birthdays & Work Anniversaries
  if (filterTypes.includes('BIRTHDAY') || filterTypes.includes('WORK_ANNIVERSARY')) {
    const userWhere = { status: 'ACTIVE' };
    if (organizationId) userWhere.organizationId = organizationId;
    if (branchId && branchId !== 'ALL') userWhere.branchId = branchId;
    if (department && department !== 'ALL') userWhere.department = department;

    const users = await prisma.user.findMany({
      where: userWhere,
      select: {
        id: true,
        name: true,
        dob: true,
        joiningDate: true,
        department: true
      }
    });

    const queryYear = start.getFullYear();

    for (const u of users) {
      // Birthdays
      if (filterTypes.includes('BIRTHDAY') && u.dob) {
        const bdayThisYear = new Date(queryYear, u.dob.getMonth(), u.dob.getDate());
        if (bdayThisYear >= start && bdayThisYear <= end) {
          events.push({
            id: `bday-${u.id}-${queryYear}`,
            type: 'BIRTHDAY',
            category: 'CELEBRATION',
            title: `🎂 ${u.name}'s Birthday`,
            description: `Happy Birthday to ${u.name} (${u.department || 'Team'})!`,
            startDate: bdayThisYear,
            endDate: bdayThisYear,
            isAllDay: true,
            employeeName: u.name,
            color: '#EC4899' // Pink
          });
        }
      }

      // Work Anniversaries
      if (filterTypes.includes('WORK_ANNIVERSARY') && u.joiningDate) {
        const joinYear = u.joiningDate.getFullYear();
        const yearsCompleted = queryYear - joinYear;
        if (yearsCompleted > 0) {
          const annivThisYear = new Date(queryYear, u.joiningDate.getMonth(), u.joiningDate.getDate());
          if (annivThisYear >= start && annivThisYear <= end) {
            events.push({
              id: `anniv-${u.id}-${queryYear}`,
              type: 'WORK_ANNIVERSARY',
              category: 'CELEBRATION',
              title: `🎖️ ${u.name} - ${yearsCompleted} Year Work Anniversary`,
              description: `Celebrating ${yearsCompleted} year(s) of dedication with the team!`,
              startDate: annivThisYear,
              endDate: annivThisYear,
              isAllDay: true,
              employeeName: u.name,
              color: '#06B6D4' // Cyan
            });
          }
        }
      }
    }
  }

  // 7. Approved Comp-Off Work Dates
  if (filterTypes.includes('COMP_OFF')) {
    const compOffWhere = {
      workDate: { gte: start, lte: end },
      status: 'APPROVED'
    };
    if (organizationId) compOffWhere.organizationId = organizationId;
    if (branchId && branchId !== 'ALL') compOffWhere.user = { branchId };
    if (department && department !== 'ALL') compOffWhere.user = { ...compOffWhere.user, department };

    const approvedPerms = await prisma.compOffPermissionRequest.findMany({
      where: compOffWhere,
      include: { user: { select: { id: true, name: true, employeeId: true } } }
    });

    for (const p of approvedPerms) {
      events.push({
        id: `compoff-${p.id}`,
        type: 'COMP_OFF',
        category: 'COMP_OFF',
        title: `⏰ Comp-Off Work: ${p.user?.name || 'Employee'}`,
        description: p.reason || 'Approved Comp-Off work session',
        startDate: p.workDate,
        endDate: p.workDate,
        isAllDay: true,
        employeeName: p.user?.name,
        color: '#8B5CF6' // Purple/Violet
      });
    }
  }

  // Sort events chronologically
  events.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

  return events;
};

const createCompanyEvent = async ({
  organizationId,
  branchId,
  department,
  title,
  description,
  eventType = 'GENERAL',
  startDate,
  endDate,
  location,
  isAllDay = false,
  actorId
}) => {
  if (!title || !startDate || !organizationId) {
    throw new Error('Title, start date, and organization are required.');
  }

  const sDate = new Date(startDate);
  const eDate = endDate ? new Date(endDate) : sDate;

  const event = await prisma.organizationEvent.create({
    data: {
      organizationId,
      branchId: branchId || null,
      department: department || null,
      title: title.trim(),
      description: description ? description.trim() : null,
      eventType: eventType || 'GENERAL',
      startDate: sDate,
      endDate: eDate,
      location: location ? location.trim() : null,
      isAllDay,
      createdById: actorId || null
    },
    include: {
      branch: true
    }
  });

  return event;
};

const deleteCompanyEvent = async (eventId, organizationId) => {
  const where = { id: eventId };
  if (organizationId) where.organizationId = organizationId;

  const event = await prisma.organizationEvent.findFirst({ where });
  if (!event) {
    throw new Error('Event not found.');
  }

  await prisma.organizationEvent.delete({ where: { id: eventId } });
  return { success: true, message: 'Event deleted successfully.' };
};

module.exports = {
  getUnifiedCalendar,
  createCompanyEvent,
  deleteCompanyEvent
};
