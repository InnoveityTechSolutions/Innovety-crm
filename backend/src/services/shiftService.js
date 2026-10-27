const prisma = require('../utils/db');
const { getEffectiveSettings } = require('../utils/settingsResolver');

const DEFAULT_WORKING_DAYS = [
  { day: 'MONDAY', isWorking: true },
  { day: 'TUESDAY', isWorking: true },
  { day: 'WEDNESDAY', isWorking: true },
  { day: 'THURSDAY', isWorking: true },
  { day: 'FRIDAY', isWorking: true },
  { day: 'SATURDAY', isWorking: true },
  { day: 'SUNDAY', isWorking: false }
];

const DEFAULT_SHIFT_DATA = {
  name: 'Company Default',
  startTime: '09:00',
  endTime: '18:00',
  workingDays: DEFAULT_WORKING_DAYS,
  status: 'ACTIVE'
};

/**
 * Format 24-hour time "HH:mm" to 12-hour "hh:mm AM/PM"
 */
const formatTime12h = (time24) => {
  if (!time24) return '';
  const parts = String(time24).split(':');
  let h = parseInt(parts[0], 10);
  const m = parts[1] || '00';
  if (isNaN(h)) return time24;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  const formattedH = h < 10 ? `0${h}` : `${h}`;
  return `${formattedH}:${m} ${ampm}`;
};

/**
 * Dynamically enriches a shift with organization site settings if it is the Company Default shift.
 * Custom shifts are left completely untouched.
 */
const enrichShiftWithOrgTiming = async (shift, organizationId = null, client = prisma) => {
  if (!shift) return null;
  const isDefault = shift.name === DEFAULT_SHIFT_DATA.name || Boolean(shift.isDefault);
  if (!isDefault) {
    return {
      ...shift,
      isDefault: false
    };
  }

  const targetOrgId = organizationId || shift.organizationId;
  const settings = await getEffectiveSettings(targetOrgId);

  const dynamicStart = settings?.clockInTime || '09:00';
  const dynamicEnd = settings?.clockOutTime || '18:00';

  return {
    ...shift,
    startTime: dynamicStart,
    endTime: dynamicEnd,
    isDefault: true,
    isCompanyTiming: true,
    companyTimingLabel: 'Company Timing',
    companyTimingDescription: 'Uses Company Attendance Settings',
    earlyWindowMinutes: settings?.earlyWindowMinutes !== undefined ? settings.earlyWindowMinutes : 30,
    gracePeriodMinutes: settings?.gracePeriodMinutes !== undefined ? settings.gracePeriodMinutes : 15
  };
};

/**
 * Records an audit entry in ShiftHistory
 */
const recordShiftHistory = async ({ shiftId, userId = null, action, details = null }, client = prisma) => {
  try {
    if (!shiftId || !action) return null;
    const detailsStr = details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null;
    return await client.shiftHistory.create({
      data: {
        shiftId,
        userId: userId || null,
        action,
        details: detailsStr
      }
    });
  } catch (err) {
    console.warn('[shiftService] Failed to record shift history:', err.message);
    return null;
  }
};

/**
 * Creates or retrieves the default company shift and assigns unassigned organization members.
 * Safe and idempotent.
 */
const createDefaultShift = async (organizationId, client = prisma) => {
  if (!organizationId) {
    throw new Error('Organization ID is required to create a default shift.');
  }

  // 1. Check if a default shift already exists
  let shift = await client.shift.findFirst({
    where: {
      organizationId,
      name: DEFAULT_SHIFT_DATA.name
    },
    include: {
      members: true
    }
  });

  // If no "Company Default", check if any shift exists
  if (!shift) {
    const orgSettings = await getEffectiveSettings(organizationId);
    shift = await client.shift.create({
      data: {
        organizationId,
        name: DEFAULT_SHIFT_DATA.name,
        startTime: orgSettings?.clockInTime || DEFAULT_SHIFT_DATA.startTime,
        endTime: orgSettings?.clockOutTime || DEFAULT_SHIFT_DATA.endTime,
        workingDays: DEFAULT_SHIFT_DATA.workingDays,
        status: DEFAULT_SHIFT_DATA.status
      },
      include: {
        members: true
      }
    });

    await recordShiftHistory({
      shiftId: shift.id,
      action: 'SHIFT_CREATED',
      details: { note: 'Initial company default shift generated automatically.' }
    }, client);
  }

  // 2. Automatically assign existing organization users who do not have an assigned shift
  const unassignedUsers = await client.user.findMany({
    where: {
      organizationId,
      shiftAssignment: null
    },
    select: { id: true }
  });

  if (unassignedUsers.length > 0) {
    for (const u of unassignedUsers) {
      await client.shiftMember.upsert({
        where: { userId: u.id },
        create: {
          shiftId: shift.id,
          userId: u.id
        },
        update: {
          shiftId: shift.id
        }
      }).catch(err => {
        console.warn(`[shiftService] Could not assign user ${u.id} to default shift:`, err.message);
      });
    }
  }

  return await enrichShiftWithOrgTiming(shift, organizationId, client);
};

/**
 * Creates a new custom shift for an organization.
 */
const createShift = async ({
  organizationId,
  name,
  startTime = '09:00',
  endTime = '18:00',
  workingDays = DEFAULT_WORKING_DAYS,
  status = 'ACTIVE'
}, client = prisma, actorUserId = null) => {
  if (!organizationId || !name) {
    throw new Error('organizationId and name are required to create a shift.');
  }

  const shift = await client.shift.create({
    data: {
      organizationId,
      name: name.trim(),
      startTime: startTime.trim(),
      endTime: endTime.trim(),
      workingDays: workingDays || DEFAULT_WORKING_DAYS,
      status: status || 'ACTIVE'
    },
    include: {
      _count: {
        select: { members: true }
      }
    }
  });

  await recordShiftHistory({
    shiftId: shift.id,
    userId: actorUserId,
    action: 'SHIFT_CREATED',
    details: {
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      status: shift.status
    }
  }, client);

  return shift;
};

/**
 * Assigns an array of employee user IDs to a specific shift.
 * Each employee can only have one active shift assignment (userId @unique).
 */
const assignMembers = async (shiftId, userIds, organizationId, client = prisma, actorUserId = null) => {
  if (!shiftId || !Array.isArray(userIds)) {
    throw new Error('shiftId and userIds array are required.');
  }

  // Verify shift belongs to the organization
  const shift = await client.shift.findFirst({
    where: {
      id: shiftId,
      organizationId
    }
  });

  if (!shift) {
    throw new Error('Shift not found or does not belong to this organization.');
  }

  // Ensure default shift exists for organization fallback
  const defaultShift = await createDefaultShift(organizationId, client);

  // If modifying a custom shift, reassign any unchecked/removed members back to Company Default
  let removedCount = 0;
  if (shift.name !== DEFAULT_SHIFT_DATA.name) {
    const currentMembers = await client.shiftMember.findMany({
      where: { shiftId }
    });
    const removedUserIds = currentMembers
      .filter(m => !userIds.includes(m.userId))
      .map(m => m.userId);

    if (removedUserIds.length > 0) {
      await client.shiftMember.updateMany({
        where: {
          shiftId,
          userId: { in: removedUserIds }
        },
        data: {
          shiftId: defaultShift.id
        }
      });
      removedCount = removedUserIds.length;

      await recordShiftHistory({
        shiftId: shift.id,
        userId: actorUserId,
        action: 'MEMBERS_REMOVED',
        details: { count: removedCount, returnedToDefaultShiftId: defaultShift.id }
      }, client);
    }
  }

  let assignedCount = 0;
  for (const userId of userIds) {
    // Verify user belongs to same organization
    const user = await client.user.findFirst({
      where: {
        id: userId,
        organizationId
      }
    });

    if (user) {
      await client.shiftMember.upsert({
        where: { userId },
        create: {
          shiftId,
          userId
        },
        update: {
          shiftId
        }
      });
      assignedCount++;
    }
  }

  if (assignedCount > 0) {
    await recordShiftHistory({
      shiftId: shift.id,
      userId: actorUserId,
      action: 'MEMBERS_ASSIGNED',
      details: { count: assignedCount }
    }, client);
  }

  return {
    shiftId,
    assignedCount,
    removedCount
  };
};

/**
 * Retrieves all shifts for a company with member counts and dynamic departments.
 */
const getCompanyShifts = async (organizationId, client = prisma) => {
  if (!organizationId) {
    return [];
  }

  // Ensure default shift exists
  await createDefaultShift(organizationId, client).catch(err => {
    console.warn('[shiftService] Auto-ensure default shift warning:', err.message);
  });

  const [shifts, orgSettings] = await Promise.all([
    client.shift.findMany({
      where: { organizationId },
      include: {
        _count: {
          select: { members: true }
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                employeeId: true,
                role: true,
                status: true,
                department: true,
                departmentRef: {
                  select: { id: true, name: true }
                }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    }),
    getEffectiveSettings(organizationId)
  ]);

  // Attach dynamically computed departments and dynamic timing for Default Shift
  return shifts.map(s => {
    const deptSet = new Set();
    if (s.members && Array.isArray(s.members)) {
      s.members.forEach(m => {
        const d = m.user?.departmentRef?.name || m.user?.department;
        if (d && String(d).trim()) deptSet.add(String(d).trim());
      });
    }

    const isDefault = s.name === DEFAULT_SHIFT_DATA.name || Boolean(s.isDefault);

    if (isDefault) {
      return {
        ...s,
        startTime: orgSettings?.clockInTime || '09:00',
        endTime: orgSettings?.clockOutTime || '18:00',
        isDefault: true,
        isCompanyTiming: true,
        companyTimingLabel: 'Company Timing',
        companyTimingDescription: 'Uses Company Attendance Settings',
        earlyWindowMinutes: orgSettings?.earlyWindowMinutes !== undefined ? orgSettings.earlyWindowMinutes : 30,
        gracePeriodMinutes: orgSettings?.gracePeriodMinutes !== undefined ? orgSettings.gracePeriodMinutes : 15,
        assignedDepartments: Array.from(deptSet)
      };
    }

    return {
      ...s,
      isDefault: false,
      assignedDepartments: Array.from(deptSet)
    };
  });
};

/**
 * Retrieves a single shift with details, dynamic departments, and members.
 */
const getShiftById = async (shiftId, organizationId, client = prisma) => {
  const where = { id: shiftId };
  if (organizationId) where.organizationId = organizationId;

  const shift = await client.shift.findFirst({
    where,
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              employeeId: true,
              role: true,
              status: true,
              department: true,
              departmentRef: {
                select: { id: true, name: true }
              }
            }
          }
        }
      }
    }
  });

  if (!shift) return null;

  const deptSet = new Set();
  if (shift.members && Array.isArray(shift.members)) {
    shift.members.forEach(m => {
      const d = m.user?.departmentRef?.name || m.user?.department;
      if (d && String(d).trim()) deptSet.add(String(d).trim());
    });
  }

  const enriched = await enrichShiftWithOrgTiming(shift, organizationId || shift.organizationId, client);

  return {
    ...enriched,
    assignedDepartments: Array.from(deptSet)
  };
};

/**
 * Updates a shift with safety guards and history tracking.
 */
const updateShift = async (shiftId, organizationId, data, client = prisma, actorUserId = null) => {
  const where = { id: shiftId };
  if (organizationId) where.organizationId = organizationId;

  const existing = await client.shift.findFirst({ where });
  if (!existing) {
    throw new Error('Shift not found.');
  }

  // Permanent protection: Company Default cannot be deactivated
  if (existing.name === DEFAULT_SHIFT_DATA.name && data.status === 'INACTIVE') {
    throw new Error('The default company shift cannot be deactivated.');
  }

  const isDefault = existing.name === DEFAULT_SHIFT_DATA.name || Boolean(existing.isDefault);

  const updatePayload = {};
  const changed = {};

  if (data.name !== undefined && data.name.trim() !== existing.name && !isDefault) {
    updatePayload.name = String(data.name).trim();
    changed.name = { from: existing.name, to: updatePayload.name };
  }
  // For Default Shift: timing is controlled dynamically by Organization Site Settings, do NOT overwrite with static times
  if (!isDefault) {
    if (data.startTime !== undefined && data.startTime.trim() !== existing.startTime) {
      updatePayload.startTime = String(data.startTime).trim();
      changed.startTime = { from: existing.startTime, to: updatePayload.startTime };
    }
    if (data.endTime !== undefined && data.endTime.trim() !== existing.endTime) {
      updatePayload.endTime = String(data.endTime).trim();
      changed.endTime = { from: existing.endTime, to: updatePayload.endTime };
    }
  }
  if (data.workingDays !== undefined) {
    updatePayload.workingDays = data.workingDays;
    changed.workingDays = 'Updated schedule';
  }
  if (data.status !== undefined && data.status !== existing.status) {
    updatePayload.status = data.status;
    changed.status = { from: existing.status, to: data.status };
  }

  const updated = await client.shift.update({
    where: { id: shiftId },
    data: updatePayload
  });

  // History action determination
  let action = 'SHIFT_EDITED';
  if (data.status === 'ACTIVE' && existing.status === 'INACTIVE') action = 'SHIFT_ACTIVATED';
  if (data.status === 'INACTIVE' && existing.status === 'ACTIVE') action = 'SHIFT_DEACTIVATED';

  await recordShiftHistory({
    shiftId,
    userId: actorUserId,
    action,
    details: changed
  }, client);

  return await enrichShiftWithOrgTiming(updated, organizationId || updated.organizationId, client);
};

/**
 * Deletes a shift safely.
 * If members are assigned, reassigns them to the company's default shift.
 */
const deleteShift = async (shiftId, organizationId, client = prisma, actorUserId = null) => {
  const shift = await client.shift.findFirst({
    where: { id: shiftId, organizationId }
  });

  if (!shift) {
    throw new Error('Shift not found.');
  }

  if (shift.name === DEFAULT_SHIFT_DATA.name) {
    throw new Error('The default company shift cannot be deleted.');
  }

  const defaultShift = await createDefaultShift(organizationId, client);

  // Count assigned members before reassignment
  const memberCount = await client.shiftMember.count({
    where: { shiftId }
  });

  // Reassign members to default shift before deleting
  if (memberCount > 0) {
    await client.shiftMember.updateMany({
      where: { shiftId },
      data: { shiftId: defaultShift.id }
    });

    await recordShiftHistory({
      shiftId: defaultShift.id,
      userId: actorUserId,
      action: 'MEMBERS_ASSIGNED',
      details: {
        note: `${memberCount} members reassigned from deleted shift "${shift.name}".`
      }
    }, client);
  }

  await client.shift.delete({
    where: { id: shiftId }
  });

  return {
    success: true,
    reassignedCount: memberCount,
    message: `Shift deleted successfully. ${memberCount} member(s) returned to Company Default.`
  };
};

/**
 * Duplicates an existing shift configuration.
 */
const duplicateShift = async (shiftId, organizationId, actorUserId = null, client = prisma) => {
  const shift = await client.shift.findFirst({
    where: { id: shiftId, organizationId }
  });

  if (!shift) {
    throw new Error('Shift not found or does not belong to this organization.');
  }

  let newName = `${shift.name} (Copy)`;
  const existingName = await client.shift.findFirst({
    where: { organizationId, name: newName }
  });
  if (existingName) {
    newName = `${shift.name} (Copy ${Date.now().toString().slice(-4)})`;
  }

  const duplicated = await client.shift.create({
    data: {
      organizationId,
      name: newName,
      startTime: shift.startTime,
      endTime: shift.endTime,
      workingDays: shift.workingDays,
      status: 'ACTIVE'
    },
    include: {
      _count: { select: { members: true } }
    }
  });

  await recordShiftHistory({
    shiftId: duplicated.id,
    userId: actorUserId,
    action: 'SHIFT_DUPLICATED',
    details: { originalShiftId: shift.id, originalShiftName: shift.name }
  }, client);

  return duplicated;
};

/**
 * Bulk updates shifts (Activate or Deactivate).
 */
const bulkUpdateShifts = async (shiftIds, organizationId, action, actorUserId = null, client = prisma) => {
  if (!Array.isArray(shiftIds) || shiftIds.length === 0) {
    throw new Error('shiftIds must be a non-empty array.');
  }

  const targetStatus = action === 'ACTIVATE' ? 'ACTIVE' : action === 'DEACTIVATE' ? 'INACTIVE' : null;
  if (!targetStatus) {
    throw new Error('Invalid bulk action. Allowed values: ACTIVATE, DEACTIVATE.');
  }

  const shifts = await client.shift.findMany({
    where: {
      id: { in: shiftIds },
      organizationId
    }
  });

  let modifiedCount = 0;
  const warnings = [];

  for (const shift of shifts) {
    if (action === 'DEACTIVATE' && shift.name === DEFAULT_SHIFT_DATA.name) {
      warnings.push(`Company Default shift cannot be deactivated.`);
      continue;
    }

    if (shift.status !== targetStatus) {
      await client.shift.update({
        where: { id: shift.id },
        data: { status: targetStatus }
      });

      await recordShiftHistory({
        shiftId: shift.id,
        userId: actorUserId,
        action: action === 'ACTIVATE' ? 'SHIFT_ACTIVATED' : 'SHIFT_DEACTIVATED',
        details: { bulkAction: true }
      }, client);

      modifiedCount++;
    }
  }

  return {
    success: true,
    modifiedCount,
    warnings
  };
};

/**
 * Retrieves shift audit history.
 */
const getShiftHistory = async (shiftId, organizationId, client = prisma) => {
  const shift = await client.shift.findFirst({
    where: organizationId ? { id: shiftId, organizationId } : { id: shiftId }
  });
  if (!shift) {
    throw new Error('Shift not found.');
  }

  const history = await client.shiftHistory.findMany({
    where: { shiftId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  return history.map(h => {
    let parsedDetails = null;
    if (h.details) {
      try {
        parsedDetails = JSON.parse(h.details);
      } catch (e) {
        parsedDetails = h.details;
      }
    }
    return {
      ...h,
      parsedDetails
    };
  });
};

/**
 * Retrieves the assigned shift for a specific user, with fallback to company default.
 * Priority 1: Temporary Override, Swap, or Planned Schedule
 * Priority 2: Permanent Shift Assignment (ShiftMember)
 * Priority 3: Company Default Shift
 */
const getEmployeeShift = async (userId, client = prisma, targetDate = new Date()) => {
  if (!userId) return null;

  const target = targetDate instanceof Date ? targetDate : new Date(targetDate);
  const targetDayStart = new Date(target.toISOString().split('T')[0] + 'T00:00:00.000Z');
  const targetDayEnd = new Date(target.toISOString().split('T')[0] + 'T23:59:59.999Z');

  const finalizeShift = async (s, targetOrgId = null) => {
    if (!s) return null;
    return await enrichShiftWithOrgTiming(s, targetOrgId || s.organizationId, client);
  };

  // Priority 1: Active temporary override, swap, or planned schedule
  try {
    const activeSchedule = await client.shiftSchedule.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        startDate: { lte: targetDayEnd },
        endDate: { gte: targetDayStart }
      },
      include: {
        shift: true
      },
      orderBy: { createdAt: 'desc' }
    });

    if (activeSchedule?.shift) {
      return await finalizeShift({
        ...activeSchedule.shift,
        isOverride: activeSchedule.type !== 'PERMANENT',
        scheduleType: activeSchedule.type,
        scheduleReason: activeSchedule.reason
      }, activeSchedule.shift.organizationId);
    }
  } catch (err) {
    console.warn('[shiftService] Schedule check fallback:', err.message);
  }

  // Priority 2: Permanent Shift Assignment
  const member = await client.shiftMember.findUnique({
    where: { userId },
    include: {
      shift: true
    }
  });

  if (member?.shift) {
    return await finalizeShift(member.shift, member.shift.organizationId);
  }

  // Priority 3: Fallback to user.shiftId if set
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { id: true, organizationId: true, shiftId: true }
  });

  if (user?.shiftId) {
    const assignedShift = await client.shiftMaster.findUnique({
      where: { id: user.shiftId }
    });
    if (assignedShift) {
      await client.shiftMember.upsert({
        where: { userId },
        create: { shiftId: assignedShift.id, userId },
        update: { shiftId: assignedShift.id }
      }).catch(() => {});
      return await finalizeShift(assignedShift, user?.organizationId);
    }
  }

  // Priority 4: Fallback to Company Default shift
  if (user?.organizationId) {
    const defaultShift = await createDefaultShift(user.organizationId, client);
    await client.shiftMember.upsert({
      where: { userId },
      create: { shiftId: defaultShift.id, userId },
      update: { shiftId: defaultShift.id }
    }).catch(() => {});
    return await finalizeShift(defaultShift, user.organizationId);
  }

  return null;
};

/**
 * Safe utility to ensure all existing companies in database have a default shift
 * and assign existing unassigned employees.
 */
const ensureDefaultShiftsForExistingOrgs = async (client = prisma) => {
  const orgs = await client.organization.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true }
  });

  const results = [];
  for (const org of orgs) {
    const shift = await createDefaultShift(org.id, client);
    results.push({
      organizationId: org.id,
      organizationName: org.name,
      shiftId: shift.id
    });
  }

  return results;
};

/**
 * Returns uppercase weekday name for a date in the given timezone.
 */
const getDayName = (date = new Date(), timeZone = 'Asia/Kolkata') => {
  try {
    const d = date instanceof Date ? date : new Date(date);
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(d);
    return weekday.toUpperCase();
  } catch (err) {
    const d = date instanceof Date ? date : new Date(date);
    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    return days[d.getDay()];
  }
};

/**
 * Returns the status of a specific day for a shift: 'Working', 'WFH', or 'Holiday'.
 * Sunday is permanently locked as 'Holiday'.
 * For Saturday: supports pattern { '1': 'LEAVE', '2': 'WORKING', ... } evaluated against date.
 */
const getShiftDayStatus = (shift, dayName, date = null) => {
  const normDay = String(dayName || '').toUpperCase();

  if (!shift || !shift.workingDays) {
    return normDay === 'SUNDAY' ? 'Holiday' : 'Working';
  }

  // Handle Array format: [{ day: 'MONDAY', isWorking: true }, ...]
  if (Array.isArray(shift.workingDays)) {
    const match = shift.workingDays.find(d => String(d.day).toUpperCase() === normDay);
    if (match) {
      if (normDay === 'SATURDAY' && match.pattern && date) {
        const targetDate = date instanceof Date ? date : new Date(date);
        const satIndex = Math.min(5, Math.max(1, Math.ceil(targetDate.getDate() / 7)));
        const pVal = String(match.pattern[String(satIndex)] || match.pattern[satIndex] || match.status || '').toUpperCase();
        if (pVal === 'LEAVE' || pVal === 'HOLIDAY') return 'Holiday';
        if (pVal === 'WFH') return 'WFH';
        if (pVal === 'WORKING') return 'Working';
      }
      if (match.status) {
        const s = String(match.status).toUpperCase();
        return s === 'WFH' ? 'WFH' : s === 'HOLIDAY' ? 'Holiday' : 'Working';
      }
      if (match.isWorking === false) return 'Holiday';
      if (match.isWorking === true) return 'Working';
    }
    return normDay === 'SUNDAY' ? 'Holiday' : 'Working';
  }

  // Handle Object format: { MONDAY: 'Working', TUESDAY: 'WFH', SATURDAY: { status: 'WORKING', pattern: { ... } }, ... }
  if (typeof shift.workingDays === 'object' && shift.workingDays !== null) {
    const val = shift.workingDays[normDay];

    // Check if Saturday is configured as an object with status and pattern
    if (normDay === 'SATURDAY' && val && typeof val === 'object') {
      const satStatus = String(val.status || 'WORKING').toUpperCase();
      if (satStatus === 'HOLIDAY') return 'Holiday';

      if (val.pattern && date) {
        const targetDate = date instanceof Date ? date : new Date(date);
        const satIndex = Math.min(5, Math.max(1, Math.ceil(targetDate.getDate() / 7)));
        const pVal = String(val.pattern[String(satIndex)] || val.pattern[satIndex] || satStatus).toUpperCase();
        if (pVal === 'LEAVE' || pVal === 'HOLIDAY') return 'Holiday';
        if (pVal === 'WFH') return 'WFH';
        if (pVal === 'WORKING') return 'Working';
      }

      return satStatus === 'WFH' ? 'WFH' : satStatus === 'HOLIDAY' ? 'Holiday' : 'Working';
    }

    if (val !== undefined && val !== null) {
      if (val === 'Working' || val === 'WFH' || val === 'Holiday') return val;
      if (typeof val === 'string') {
        const uVal = val.toUpperCase();
        if (uVal === 'WORKING') return 'Working';
        if (uVal === 'WFH') return 'WFH';
        if (uVal === 'HOLIDAY') return 'Holiday';
      }
      if (val === true) return 'Working';
      if (val === false) return 'Holiday';
    }
    return normDay === 'SUNDAY' ? 'Holiday' : 'Working';
  }

  return normDay === 'SUNDAY' ? 'Holiday' : 'Working';
};

/**
 * Calculates the next upcoming working day (including WFH) for a shift.
 * Looks ahead up to 7 days.
 */
const getNextWorkingDay = (shift, fromDate = new Date(), timeZone = 'Asia/Kolkata') => {
  if (!shift || !shift.workingDays) return null;
  const base = fromDate instanceof Date ? fromDate : new Date(fromDate);

  for (let i = 1; i <= 7; i++) {
    const targetDate = new Date(base.getTime() + i * 24 * 60 * 60 * 1000);
    const dayName = getDayName(targetDate, timeZone);
    const status = getShiftDayStatus(shift, dayName, targetDate);

    if (status === 'Working' || status === 'WFH') {
      const isTomorrow = i === 1;
      const formattedStart = formatTime12h(shift.startTime);
      const formattedEnd = formatTime12h(shift.endTime);
      const dayLabel = isTomorrow ? 'Tomorrow' : (dayName.charAt(0) + dayName.slice(1).toLowerCase());

      return {
        daysAhead: i,
        isTomorrow,
        date: targetDate.toISOString().split('T')[0],
        dayName,
        status,
        startTime: shift.startTime,
        endTime: shift.endTime,
        formattedStart,
        formattedEnd,
        formattedText: `${dayLabel}: ${formattedStart} – ${formattedEnd}`
      };
    }
  }

  return null;
};

/**
 * Aggregated live analytics & shift breakdown for an organization.
 */
const getShiftAnalytics = async (organizationId, client = prisma) => {
  if (!organizationId) {
    throw new Error('Organization ID is required for analytics.');
  }

  const [shifts, orgSettings] = await Promise.all([
    client.shift.findMany({
      where: { organizationId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                employeeId: true,
                department: true,
                departmentRef: {
                  select: { id: true, name: true }
                }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    }),
    getEffectiveSettings(organizationId)
  ]);

  const now = new Date();
  const timeZone = 'Asia/Kolkata';
  const todayDayName = getDayName(now, timeZone);

  // UTC boundaries for today in local timezone
  const todayDateStr = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const startOfToday = new Date(`${todayDateStr}T00:00:00.000Z`);
  const endOfToday = new Date(`${todayDateStr}T23:59:59.999Z`);

  // Collect all assigned user IDs
  const allUserIds = [];
  shifts.forEach(s => {
    s.members.forEach(m => {
      if (m.userId) allUserIds.push(m.userId);
    });
  });

  let todayAttendances = [];
  let todayApprovedLeaves = [];
  if (allUserIds.length > 0) {
    todayAttendances = await client.attendance.findMany({
      where: {
        userId: { in: allUserIds },
        date: { gte: startOfToday, lte: endOfToday }
      }
    });

    todayApprovedLeaves = await client.leaveRequest.findMany({
      where: {
        userId: { in: allUserIds },
        status: 'APPROVED',
        startDate: { lte: endOfToday },
        endDate: { gte: startOfToday }
      }
    });
  }

  const attendanceMap = new Map();
  todayAttendances.forEach(a => attendanceMap.set(a.userId, a));

  const leaveMap = new Map();
  todayApprovedLeaves.forEach(l => leaveMap.set(l.userId, l));

  let totalMembers = 0;
  let workingTodayCount = 0;
  let wfhTodayCount = 0;
  let holidayTodayCount = 0;

  const breakdown = shifts.map(shift => {
    const todayStatus = getShiftDayStatus(shift, todayDayName, now);
    const memberCount = shift.members.length;
    totalMembers += memberCount;

    if (todayStatus === 'Working') {
      workingTodayCount += memberCount;
    } else if (todayStatus === 'WFH') {
      wfhTodayCount += memberCount;
    } else {
      holidayTodayCount += memberCount;
    }

    // Dynamic departments list
    const deptSet = new Set();
    shift.members.forEach(m => {
      const dName = m.user?.departmentRef?.name || m.user?.department;
      if (dName && String(dName).trim()) {
        deptSet.add(String(dName).trim());
      }
    });
    const assignedDepartments = Array.from(deptSet);

    let presentToday = 0;
    let lateToday = 0;
    let wfhCount = 0;
    let onLeaveToday = 0;

    shift.members.forEach(m => {
      const att = attendanceMap.get(m.userId);
      const leave = leaveMap.get(m.userId);

      if (leave) {
        onLeaveToday++;
      }
      if (att) {
        if (att.status === 'PRESENT' || att.status === 'HALF_DAY') {
          presentToday++;
        } else if (att.status === 'LATE') {
          lateToday++;
          presentToday++;
        } else if (att.status === 'WORK_FROM_HOME') {
          wfhCount++;
          presentToday++;
        }
      }
    });

    const isDefault = shift.name === DEFAULT_SHIFT_DATA.name || Boolean(shift.isDefault);
    const effectiveStart = isDefault ? (orgSettings?.clockInTime || '09:00') : shift.startTime;
    const effectiveEnd = isDefault ? (orgSettings?.clockOutTime || '18:00') : shift.endTime;

    return {
      shiftId: shift.id,
      shiftName: shift.name,
      startTime: effectiveStart,
      endTime: effectiveEnd,
      isDefault,
      isCompanyTiming: isDefault,
      status: shift.status,
      todayStatus,
      assignedCount: memberCount,
      assignedDepartments,
      presentToday,
      lateToday,
      wfhCount,
      onLeaveToday
    };
  });

  return {
    kpis: {
      totalShifts: shifts.length,
      assignedMembers: totalMembers,
      workingToday: workingTodayCount,
      wfhToday: wfhTodayCount,
      holidayToday: holidayTodayCount
    },
    breakdown
  };
};

/**
 * Retrieves the assigned shift for a user, enriched with schedule status and next working day.
 */
const getEmployeeShiftWithSchedule = async (userId, date = new Date(), timeZone = 'Asia/Kolkata', client = prisma) => {
  const shift = await getEmployeeShift(userId, client, date);
  if (!shift) return null;

  const dayName = getDayName(date, timeZone);
  const todayStatus = getShiftDayStatus(shift, dayName, date);
  const nextWorkingDay = getNextWorkingDay(shift, date, timeZone);

  // Check if today is specifically a scheduled Saturday Leave
  let isSaturdayLeave = false;
  const normDay = String(dayName).toUpperCase();
  if (normDay === 'SATURDAY' && shift.workingDays) {
    const satVal = Array.isArray(shift.workingDays)
      ? shift.workingDays.find(d => String(d.day).toUpperCase() === 'SATURDAY')
      : (shift.workingDays['SATURDAY'] || shift.workingDays['Saturday']);
    if (satVal && typeof satVal === 'object' && satVal.pattern) {
      const targetDate = date instanceof Date ? date : new Date(date);
      const satIndex = Math.min(5, Math.max(1, Math.ceil(targetDate.getDate() / 7)));
      const patternVal = String(satVal.pattern[String(satIndex)] || satVal.pattern[satIndex] || '').toUpperCase();
      if (patternVal === 'LEAVE' || patternVal === 'HOLIDAY') {
        isSaturdayLeave = true;
      }
    }
  }

  return {
    ...shift,
    dayName,
    todayStatus,
    nextWorkingDay,
    isSaturdayLeave
  };
};

/**
 * Retrieves upcoming schedule (Today, Tomorrow, and Next 7 Days) for an employee
 */
const getEmployeeUpcomingSchedule = async (userId, fromDate = new Date(), daysCount = 7, timeZone = 'Asia/Kolkata', client = prisma) => {
  if (!userId) return null;

  const base = fromDate instanceof Date ? fromDate : new Date(fromDate);
  const scheduleDays = [];

  for (let i = 0; i < daysCount; i++) {
    const targetDate = new Date(base.getTime() + i * 24 * 60 * 60 * 1000);
    const dayName = getDayName(targetDate, timeZone);
    const shift = await getEmployeeShift(userId, client, targetDate);

    if (shift) {
      const status = getShiftDayStatus(shift, dayName, targetDate);
      const isToday = i === 0;
      const isTomorrow = i === 1;

      scheduleDays.push({
        date: targetDate.toISOString().split('T')[0],
        dayName,
        isToday,
        isTomorrow,
        status, // Working | WFH | Holiday
        shiftId: shift.id,
        shiftName: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
        formattedStart: formatTime12h(shift.startTime),
        formattedEnd: formatTime12h(shift.endTime),
        isOverride: Boolean(shift.isOverride),
        scheduleType: shift.scheduleType || 'PERMANENT',
        scheduleReason: shift.scheduleReason || null
      });
    }
  }

  const today = scheduleDays.find(d => d.isToday) || null;
  const tomorrow = scheduleDays.find(d => d.isTomorrow) || null;

  return {
    today,
    tomorrow,
    upcomingDays: scheduleDays
  };
};

/**
 * Creates a batch shift resolver for multiple users across a date range.
 * Resolves Priority 1: ShiftSchedule (overrides/swaps/planned),
 *          Priority 2: ShiftMember (permanent shift),
 *          Priority 3: ShiftRef (legacy ShiftMaster),
 *          Priority 4: Company Default Shift.
 */
const createBatchShiftResolver = async ({ userIds = [], organizationId = null, startDate = new Date(), endDate = new Date(), client = prisma }) => {
  const minDate = startDate instanceof Date ? startDate : new Date(startDate);
  const maxDate = endDate instanceof Date ? endDate : new Date(endDate);
  const minDayStart = new Date(minDate.toISOString().split('T')[0] + 'T00:00:00.000Z');
  const maxDayEnd = new Date(maxDate.toISOString().split('T')[0] + 'T23:59:59.999Z');

  const [schedules, defaultShift, usersWithShifts] = await Promise.all([
    client.shiftSchedule.findMany({
      where: {
        userId: { in: userIds },
        status: 'ACTIVE',
        startDate: { lte: maxDayEnd },
        endDate: { gte: minDayStart }
      },
      include: { shift: true },
      orderBy: { createdAt: 'desc' }
    }),
    organizationId ? client.shift.findFirst({
      where: { organizationId, name: DEFAULT_SHIFT_DATA.name }
    }) : null,
    client.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        organizationId: true,
        shiftAssignment: { include: { shift: true } },
        shiftRef: true
      }
    })
  ]);

  const userShiftMap = new Map();
  usersWithShifts.forEach(u => userShiftMap.set(u.id, u));

  const getShift = (userId, targetDate) => {
    if (!userId) return null;
    const target = targetDate instanceof Date ? targetDate : new Date(targetDate);
    const targetYMD = target.toISOString().split('T')[0];
    const targetDayStart = new Date(targetYMD + 'T00:00:00.000Z');
    const targetDayEnd = new Date(targetYMD + 'T23:59:59.999Z');

    // Priority 1: Active ShiftSchedule for target date
    const activeSched = schedules.find(s =>
      s.userId === userId &&
      new Date(s.startDate) <= targetDayEnd &&
      new Date(s.endDate) >= targetDayStart
    );
    if (activeSched?.shift) {
      return activeSched.shift;
    }

    // Priority 2: ShiftMember permanent assignment
    const u = userShiftMap.get(userId);
    if (u?.shiftAssignment?.shift) {
      return u.shiftAssignment.shift;
    }

    // Priority 3: shiftRef (legacy ShiftMaster)
    if (u?.shiftRef) {
      return u.shiftRef;
    }

    // Priority 4: Company Default Shift
    return defaultShift;
  };

  const getDayStatus = (userId, targetDate, timeZone = 'Asia/Kolkata') => {
    const shift = getShift(userId, targetDate);
    const dayName = getDayName(targetDate, timeZone);
    const status = getShiftDayStatus(shift, dayName, targetDate);
    return {
      shift,
      dayName,
      status,
      isHoliday: status === 'Holiday',
      isWFH: status === 'WFH',
      isWorking: status === 'Working'
    };
  };

  return {
    getShift,
    getDayStatus,
    isShiftHoliday: (userId, targetDate, timeZone = 'Asia/Kolkata') => getDayStatus(userId, targetDate, timeZone).isHoliday,
    defaultShift
  };
};

module.exports = {
  DEFAULT_SHIFT_DATA,
  DEFAULT_WORKING_DAYS,
  formatTime12h,
  recordShiftHistory,
  createDefaultShift,
  createShift,
  assignMembers,
  getCompanyShifts,
  getShiftById,
  updateShift,
  deleteShift,
  duplicateShift,
  bulkUpdateShifts,
  getShiftHistory,
  getShiftAnalytics,
  getNextWorkingDay,
  getEmployeeShift,
  ensureDefaultShiftsForExistingOrgs,
  getDayName,
  getShiftDayStatus,
  getEmployeeShiftWithSchedule,
  getEmployeeUpcomingSchedule,
  createBatchShiftResolver
};

