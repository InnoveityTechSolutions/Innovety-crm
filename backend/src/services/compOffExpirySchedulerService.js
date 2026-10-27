const cron = require('node-cron');
const prisma = require('../utils/db');
const { createNotification } = require('./notification');
const { processExpiredCompOffCredits } = require('./compOffService');

/**
 * InnovEity CRM — Comp-Off Expiry Scheduler & Reminder Service
 *
 * Rules:
 * 1. Dispatches expiry warnings to employees at two key milestones:
 *    - 14 days before expiry (threshold = 14)
 *    - 3 days before expiry (threshold = 3)
 * 2. Only evaluates active, unexpired, unexhausted credits:
 *    - status === 'APPROVED'
 *    - availableDays > 0
 *    - expiresAt > now
 * 3. Persistent deduplication:
 *    - Embeds a deterministic reference tag `[Ref:${credit.id}-T${threshold}]` in the notification message.
 *    - Checks if a notification with that tag was already dispatched.
 *    - If already sent, skips cleanly, ensuring multiple runs/retries never send duplicates.
 * 4. Message length constraint:
 *    - Notification.message is varchar(191) in MySQL. Messages are strictly capped at ~120 characters.
 * 5. Runs daily maintenance at 01:00 AM server time (configurable via cron).
 */

const REMINDER_THRESHOLDS = [14, 3]; // Days before expiry

/**
 * Evaluates active Comp-Off credits and dispatches 14-day and 3-day expiry warnings.
 *
 * @param {Object} options
 * @param {Date} [options.referenceDate=new Date()] - Reference date for simulation/testing
 * @param {string|null} [options.organizationId=null] - Optional organization filter
 * @param {Object} [options.txClient=prisma] - Prisma client or transaction instance
 * @returns {Promise<{ processedCount: number, remindersSent: number, skippedDuplicates: number, results: Array }>}
 */
const sendCompOffExpiryReminders = async ({
  referenceDate = new Date(),
  organizationId = null,
  txClient = prisma
} = {}) => {
  const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);

  const summary = {
    processedCount: 0,
    remindersSent: 0,
    skippedDuplicates: 0,
    results: []
  };

  try {
    const where = {
      status: 'APPROVED',
      availableDays: { gt: 0 },
      expiresAt: { gt: now }
    };

    if (organizationId) {
      where.organizationId = organizationId;
    }

    const activeCredits = await txClient.compOffCredit.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            organizationId: true,
            notificationPreferences: true
          }
        }
      },
      orderBy: { expiresAt: 'asc' }
    });

    summary.processedCount = activeCredits.length;

    for (const credit of activeCredits) {
      const expiryDate = new Date(credit.expiresAt);
      const diffMs = expiryDate.getTime() - now.getTime();
      const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      // Determine applicable threshold
      let applicableThreshold = null;
      if (daysRemaining <= 3 && daysRemaining >= 0) {
        applicableThreshold = 3;
      } else if (daysRemaining <= 14 && daysRemaining > 3) {
        applicableThreshold = 14;
      }

      if (!applicableThreshold) {
        // Not in reminder window (> 14 days)
        continue;
      }

      const dedupTag = `[Ref:${credit.id}-T${applicableThreshold}]`;

      // Check persistent deduplication in notification table
      const existingNotification = await txClient.notification.findFirst({
        where: {
          userId: credit.userId,
          type: 'COMPOFF_EXPIRY_WARNING',
          message: { contains: dedupTag }
        }
      });

      if (existingNotification) {
        summary.skippedDuplicates++;
        summary.results.push({
          creditId: credit.id,
          userId: credit.userId,
          threshold: applicableThreshold,
          status: 'SKIPPED_DUPLICATE',
          daysRemaining
        });
        continue;
      }

      const workDateStr = new Date(credit.workDate).toISOString().split('T')[0];
      const expiryDateStr = expiryDate.toISOString().split('T')[0];
      const daysText = credit.availableDays === 1 ? '1 day' : `${credit.availableDays} days`;

      const title = 'Comp-Off Credit Expiring Soon';
      // Compact message safely under MySQL varchar(191) limit (~115 chars)
      const message = `Your ${daysText} Comp-Off earned on ${workDateStr} expires on ${expiryDateStr} (${daysRemaining}d left). ${dedupTag}`;

      const notification = await createNotification({
        userId: credit.userId,
        title,
        message,
        type: 'COMPOFF_EXPIRY_WARNING'
      });

      summary.remindersSent++;
      summary.results.push({
        creditId: credit.id,
        userId: credit.userId,
        threshold: applicableThreshold,
        status: 'SENT',
        notificationId: notification?.id || null,
        daysRemaining
      });
    }
  } catch (error) {
    console.error('[CompOffScheduler] Error sending expiry reminders:', error);
    throw error;
  }

  return summary;
};

/**
 * Runs combined Comp-Off daily maintenance:
 * 1. Transitions expired credits to EXPIRED status with availableDays = 0.
 * 2. Dispatches 14-day and 3-day expiry warning reminders.
 *
 * @param {Object} options
 * @param {Date} [options.referenceDate=new Date()]
 * @param {string|null} [options.organizationId=null]
 * @returns {Promise<{ expiryResults: Object, reminderResults: Object }>}
 */
const processCompOffDailyMaintenance = async ({
  referenceDate = new Date(),
  organizationId = null
} = {}) => {
  const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);

  // 1. Process expired credits
  const expiryResults = await processExpiredCompOffCredits({
    referenceDate: now,
    organizationId
  });

  // 2. Send expiry warning reminders
  const reminderResults = await sendCompOffExpiryReminders({
    referenceDate: now,
    organizationId
  });

  return {
    referenceDate: now.toISOString(),
    expiryResults,
    reminderResults
  };
};

/**
 * Initializes the node-cron scheduler for Comp-Off daily maintenance.
 * Default schedule: '0 1 * * *' (Every day at 01:00 AM server time).
 */
let scheduledTask = null;

const initCompOffScheduler = (cronExpression = '0 1 * * *') => {
  if (scheduledTask) {
    console.log('[CompOffScheduler] Scheduler is already initialized.');
    return scheduledTask;
  }

  console.log(`[CompOffScheduler] Initializing daily maintenance job (${cronExpression})...`);

  scheduledTask = cron.schedule(cronExpression, async () => {
    try {
      console.log('[CompOffScheduler] Executing scheduled Comp-Off daily maintenance...');
      const summary = await processCompOffDailyMaintenance();
      console.log(
        `[CompOffScheduler] Maintenance complete. Expired credits: ${summary.expiryResults.expiredCount}, Reminders sent: ${summary.reminderResults.remindersSent}, Duplicates skipped: ${summary.reminderResults.skippedDuplicates}`
      );
    } catch (err) {
      console.error('[CompOffScheduler] Scheduled maintenance error:', err.message);
    }
  });

  return scheduledTask;
};

module.exports = {
  REMINDER_THRESHOLDS,
  sendCompOffExpiryReminders,
  processCompOffDailyMaintenance,
  initCompOffScheduler
};
