const cron = require('node-cron');
const prisma = require('../utils/db');
const { logActivity } = require('../utils/activityLogger');
const { createNotification } = require('./notification');
const { getSystemTimeZone, getZonedParts, createZonedDate, format12Hour } = require('../utils/attendanceUtils');
const { getEffectiveSettings } = require('../utils/settingsResolver');
const { broadcastAttendanceEvent } = require('../socket');
const shiftService = require('./shiftService');

/**
 * Executes automatic clock-out for all active attendance records whose scheduled shift end has arrived.
 * Uses historical attendance shift snapshot (shiftEndAt, scheduledEndTime, assigned shift, company defaults).
 *
 * Priority Order:
 *  1. Attendance.shiftEndAt (highest priority - snapshot stored during clock-in)
 *  2. Attendance.scheduledEndTime
 *  3. Assigned Shift.endTime
 *  4. Company default settings (fallback only)
 *
 * @param {Date|null} [simulatedNow=null] - Optional reference time for testing/simulation
 * @returns {Promise<{ processedCount: number, autoClockedOutCount: number, skippedCount: number, results: Array }>}
 */
const processAutoClockOut = async (simulatedNow = null) => {
  const now = simulatedNow instanceof Date ? simulatedNow : new Date();
  const summary = {
    processedCount: 0,
    autoClockedOutCount: 0,
    skippedCount: 0,
    results: []
  };

  try {
    // 1. Find ALL active attendances where clockOut is null and clockIn is not null
    const activeAttendances = await prisma.attendance.findMany({
      where: {
        clockOut: null,
        clockIn: { not: null }
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            employeeId: true,
            role: true,
            organizationId: true,
            autoClockOutEnabled: true
          }
        }
      }
    });

    if (!activeAttendances || activeAttendances.length === 0) {
      return summary;
    }

    summary.processedCount = activeAttendances.length;

    // 2. Group active attendances by organizationId
    const orgGroups = new Map();
    for (const record of activeAttendances) {
      const orgId = record.organizationId || record.user?.organizationId || 'GLOBAL';
      if (!orgGroups.has(orgId)) {
        orgGroups.set(orgId, []);
      }
      orgGroups.get(orgId).push(record);
    }

    // 3. Process each organization independently using its own settings and timezone
    for (const [orgId, records] of orgGroups.entries()) {
      try {
        const settings = await getEffectiveSettings(orgId === 'GLOBAL' ? null : orgId);

        const isAutoClockOutEnabled = settings?.autoClockOutEnabled !== false;
        if (!isAutoClockOutEnabled) {
          for (const rec of records) {
            const empId = rec.user?.employeeId || rec.user?.name || rec.userId;
            const shiftName = rec.shiftName || 'Company Default';
            console.log(`(AutoClockOut) Employee: ${empId} Shift: ${shiftName} Action: SKIPPED (Auto clock-out disabled for organization ${orgId})`);
            summary.skippedCount++;
            summary.results.push({ id: rec.id, userId: rec.userId, action: 'SKIPPED', reason: 'DISABLED' });
          }
          continue;
        }

        const timeZone = getSystemTimeZone(settings);

        for (const record of records) {
          try {
            const recordDate = record.date || record.clockIn;
            const { year, month, day } = getZonedParts(recordDate, timeZone);

            let effectiveEnd = null;
            let resolutionSource = 'DEFAULT';
            let scheduledEndDisplay = record.scheduledEndTime || '18:00';

            // Priority 1: Attendance.shiftEndAt (highest priority - snapshot from clock-in)
            if (record.shiftEndAt) {
              const d = new Date(record.shiftEndAt);
              if (!isNaN(d.getTime())) {
                effectiveEnd = d;
                resolutionSource = 'ATTENDANCE_SHIFT_END_AT';
                if (!record.scheduledEndTime) {
                  const z = getZonedParts(d, timeZone);
                  scheduledEndDisplay = `${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}`;
                }
              }
            }

            // Priority 2: Attendance.scheduledEndTime
            if (!effectiveEnd && record.scheduledEndTime) {
              const [h, m] = String(record.scheduledEndTime).split(':').map(Number);
              if (!isNaN(h) && !isNaN(m)) {
                effectiveEnd = createZonedDate(year, month, day, h, m, timeZone);
                // Handle overnight shift if scheduledStartTime is provided
                if (record.scheduledStartTime) {
                  const [sH, sM] = String(record.scheduledStartTime).split(':').map(Number);
                  if (h * 60 + m < sH * 60 + sM) {
                    effectiveEnd = new Date(effectiveEnd.getTime() + 24 * 60 * 60 * 1000);
                  }
                }
                resolutionSource = 'ATTENDANCE_SCHEDULED_END_TIME';
                scheduledEndDisplay = record.scheduledEndTime;
              }
            }

            // Priority 3: Assigned Shift.endTime
            if (!effectiveEnd) {
              let shift = null;
              if (record.shiftId) {
                shift = await prisma.shift.findUnique({ where: { id: record.shiftId } }).catch(() => null);
              }
              if (!shift) {
                const member = await prisma.shiftMember.findUnique({
                  where: { userId: record.userId },
                  include: { shift: true }
                }).catch(() => null);
                if (member?.shift) shift = member.shift;
              }
              if (!shift && shiftService?.getEmployeeShift) {
                shift = await shiftService.getEmployeeShift(record.userId, prisma, recordDate).catch(() => null);
              }

              if (shift?.endTime) {
                const [h, m] = String(shift.endTime).split(':').map(Number);
                if (!isNaN(h) && !isNaN(m)) {
                  effectiveEnd = createZonedDate(year, month, day, h, m, timeZone);
                  if (shift.startTime) {
                    const [sH, sM] = String(shift.startTime).split(':').map(Number);
                    if (h * 60 + m < sH * 60 + sM) {
                      effectiveEnd = new Date(effectiveEnd.getTime() + 24 * 60 * 60 * 1000);
                    }
                  }
                  resolutionSource = 'ASSIGNED_SHIFT_END';
                  scheduledEndDisplay = shift.endTime;
                }
              }
            }

            // Priority 4: Company default settings (fallback only)
            if (!effectiveEnd) {
              const fallbackStr = settings?.clockOutTime || (
                (record.user?.role === 'TEAM_LEADER' || record.user?.role === 'ADMIN')
                  ? (settings?.tlShiftEnd || '18:00')
                  : (settings?.internShiftEnd || '18:00')
              );
              const [h, m] = fallbackStr.split(':').map(Number);
              effectiveEnd = createZonedDate(year, month, day, isNaN(h) ? 18 : h, isNaN(m) ? 0 : m, timeZone);
              resolutionSource = 'COMPANY_DEFAULT';
              scheduledEndDisplay = fallbackStr;
            }

            const currentZoned = getZonedParts(now, timeZone);
            const currentTimeStr = `${String(currentZoned.hour).padStart(2, '0')}:${String(currentZoned.minute).padStart(2, '0')}`;
            const empIdentifier = record.user?.employeeId || record.user?.name || record.userId;
            const shiftName = record.shiftName || 'Company Default';

            // Check individual employee Auto Clock-Out setting
            const isIndividualAutoClockOutEnabled = record.user?.autoClockOutEnabled !== false;
            if (!isIndividualAutoClockOutEnabled) {
              // If shift end has arrived, send a manual clock-out reminder without duplicates
              if (now >= effectiveEnd) {
                try {
                  const existingReminder = await prisma.notification.findFirst({
                    where: {
                      userId: record.userId,
                      type: 'ATTENDANCE_MANUAL_CLOCKOUT_REMINDER',
                      createdAt: { gte: record.date || record.clockIn }
                    }
                  });

                  if (!existingReminder) {
                    await createNotification({
                      userId: record.userId,
                      title: 'Shift Ended 🕒',
                      message: `Your scheduled shift (${shiftName}) ended at ${scheduledEndDisplay}. Please remember to clock out manually with your location.`,
                      type: 'ATTENDANCE_MANUAL_CLOCKOUT_REMINDER'
                    });
                  }
                } catch (notifErr) {
                  console.warn('[AutoClockOutService] Failed to send manual clock-out reminder:', notifErr.message);
                }
              }

              console.log(`(AutoClockOut) Employee: ${empIdentifier} Shift: ${shiftName} Action: SKIPPED (Auto clock-out disabled for individual employee)`);
              summary.skippedCount++;
              summary.results.push({ id: record.id, userId: record.userId, action: 'SKIPPED', reason: 'INDIVIDUAL_DISABLED' });
              continue;
            }

            // Check if current server time has reached or passed effective shift end time
            if (now < effectiveEnd) {
              console.log(`(AutoClockOut) Employee: ${empIdentifier} Shift: ${shiftName} Scheduled End: ${scheduledEndDisplay} Current Time: ${currentTimeStr} Action: SKIPPED`);
              summary.skippedCount++;
              summary.results.push({ id: record.id, userId: record.userId, action: 'SKIPPED', reason: 'SHIFT_NOT_ENDED' });
              continue;
            }

            // Shift end has arrived or elapsed: Execute automatic clock-out
            console.log(`(AutoClockOut) Employee: ${empIdentifier} Shift: ${shiftName} Scheduled End: ${scheduledEndDisplay} Current Time: ${currentTimeStr} Action: AUTO CLOCKED OUT`);

            const clockInTime = new Date(record.clockIn);
            const clockOutTime = now;
            const diffMs = Math.max(0, clockOutTime.getTime() - clockInTime.getTime());
            const workingHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;

            // Preserve attendance status (e.g. WORK_FROM_HOME, LATE, PRESENT)
            let status = record.status;
            if (workingHours < 4 && status !== 'WORK_FROM_HOME') {
              status = 'HALF_DAY';
            }

            // Idempotent update: atomic check that clockOut is still null to avoid overwriting manual clock-outs
            const updateResult = await prisma.attendance.updateMany({
              where: {
                id: record.id,
                clockOut: null
              },
              data: {
                clockOut: clockOutTime,
                shiftEndAt: record.shiftEndAt || effectiveEnd,
                workingHours,
                status,
                autoClockOut: true,
                clockOutReason: 'AUTO'
              }
            });

            if (updateResult.count === 0) {
              console.log(`(AutoClockOut) Employee: ${empIdentifier} Shift: ${shiftName} Action: SKIPPED (Already clocked out)`);
              summary.skippedCount++;
              summary.results.push({ id: record.id, userId: record.userId, action: 'SKIPPED', reason: 'ALREADY_CLOCKED_OUT' });
              continue;
            }

            const updated = await prisma.attendance.findUnique({
              where: { id: record.id }
            });

            await logActivity({
              userId: record.userId,
              action: 'AUTO_CLOCK_OUT',
              details: `(AutoClockOut) Employee: ${empIdentifier} Shift: ${shiftName} Scheduled End: ${scheduledEndDisplay} Current Time: ${currentTimeStr} Action: AUTO CLOCKED OUT. Worked: ${workingHours} hrs. Status: ${status}`
            }).catch(() => {});

            await createNotification({
              userId: record.userId,
              title: 'Shift Ended 🕒',
              message: `You were automatically clocked out at ${currentTimeStr} for your scheduled shift (${shiftName}).`,
              type: 'ATTENDANCE_AUTO_CLOCK_OUT'
            }).catch(e => console.warn('Failed to send auto clock-out notification:', e));

            broadcastAttendanceEvent('attendance_clock_out', {
              userId: record.userId,
              organizationId: orgId !== 'GLOBAL' ? orgId : undefined,
              record: { ...updated, clockOutMethod: 'AUTO' },
              autoClockOut: true,
              clockOutMethod: 'AUTO'
            });

            summary.autoClockedOutCount++;
            summary.results.push({
              id: record.id,
              userId: record.userId,
              action: 'AUTO_CLOCKED_OUT',
              clockOut: clockOutTime,
              shiftEndAt: record.shiftEndAt || effectiveEnd,
              workingHours,
              status
            });
          } catch (itemError) {
            console.error(`[AutoClockOutService] Failed to auto clock out record ${record.id}:`, itemError);
          }
        }
      } catch (orgError) {
        console.error(`[AutoClockOutService] Failed to process organization ${orgId}:`, orgError);
      }
    }
  } catch (error) {
    console.error('[AutoClockOutService] Cron run error:', error);
  }

  // 4. Dedicated Comp-Off Working Sessions Auto Clock-Out (Phase 2)
  try {
    const { processCompOffAutoClockOut } = require('./compOffService');
    const compOffSummary = await processCompOffAutoClockOut(now);
    if (compOffSummary && compOffSummary.autoClockedOutCount > 0) {
      summary.autoClockedOutCount += compOffSummary.autoClockedOutCount;
      if (Array.isArray(compOffSummary.results)) {
        summary.results.push(...compOffSummary.results);
      }
    }
  } catch (compOffErr) {
    console.error('[AutoClockOutService] Error running Comp-Off auto clock-out:', compOffErr.message);
  }

  return summary;
};

const initAutoClockOutService = () => {
  console.log('[AutoClockOutService] Initializing scheduled auto clock-out job (every minute: * * * * *)...');

  // Schedule every minute
  cron.schedule('* * * * *', async () => {
    await processAutoClockOut();
  });

  // Run immediate check on server boot
  processAutoClockOut().catch(err => console.error('[AutoClockOutService] Initial check error:', err));
};

module.exports = {
  initAutoClockOutService,
  processAutoClockOut
};
