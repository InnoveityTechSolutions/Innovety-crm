const prisma = require('../utils/db');
const {
  authorizeCreditInTransaction,
  validateWorkEvidence,
  validateClaimWindow,
  validateEligibleDay,
  checkExistingCredit,
  getWorkEvidence,
  processExpiredCompOffCredits,
  getCompOffPolicySettings,
  updateCompOffPolicySettings,
  createCompOffPermissionRequest,
  getCompOffPermissionRequests,
  reviewCompOffPermissionRequest,
  getEligibleFutureDates,
  DEFAULT_CLAIM_WINDOW_DAYS,
  getTodayCompOffStatus,
  startCompOffSession,
  endCompOffSession,
  getCompOffSessions,
  verifyAndApproveCompOffSession,
  rejectCompOffSession,
  calculateExpiryDate
} = require('../services/compOffService');
const { getEffectiveOrgId } = require('../utils/organizationScope');
const { logActivity } = require('../utils/activityLogger');
const { createNotification } = require('../services/notification');

/**
 * 1. Get Eligible Work Evidence & Pre-flight Diagnostics
 * GET /api/comp-off/evidence
 */
const getEligibleWorkEvidence = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const userRole = req.user.role;
    const currentUserId = req.user.id;
    let targetUserId = req.query.userId || currentUserId;

    // Scoping restrictions
    if (userRole === 'EMPLOYEE' || userRole === 'INTERN') {
      targetUserId = currentUserId; // Self-only
    } else if (userRole === 'TEAM_LEADER') {
      if (targetUserId !== currentUserId) {
        // Must lead the employee's team
        const membership = await prisma.teamMember.findFirst({
          where: {
            userId: targetUserId,
            team: { leaderId: currentUserId, organizationId }
          }
        });
        if (!membership) {
          return res.status(403).json({
            message: 'You can only view attendance evidence for members of teams you lead.'
          });
        }
      }
    } else if (userRole === 'ADMIN') {
      if (targetUserId) {
        const emp = await prisma.user.findUnique({
          where: { id: targetUserId },
          select: { organizationId: true }
        });
        if (!emp || emp.organizationId !== organizationId) {
          return res.status(403).json({
            message: 'Target employee does not belong to your organization.'
          });
        }
      }
    }

    const { workDate } = req.query;
    const policy = await getCompOffPolicySettings(organizationId);

    // A. Specific Date Evaluation
    if (workDate) {
      const dateObj = new Date(workDate);
      if (isNaN(dateObj.getTime())) {
        return res.status(400).json({ message: 'Invalid workDate format. Use YYYY-MM-DD.' });
      }

      const dateStr = dateObj.toISOString().split('T')[0];
      const targetDate = new Date(`${dateStr}T00:00:00.000Z`);

      // 1. Claim window check (using configured policy)
      const windowCheck = validateClaimWindow(targetDate, policy.claimWindowDays, new Date(), policy.claimWindowEnabled);

      // 2. Off-day eligibility check
      const dayCheck = await validateEligibleDay({
        userId: targetUserId,
        workDate: targetDate,
        organizationId
      });

      // 3. Attendance evidence check
      const rawEvidence = await getWorkEvidence({ userId: targetUserId, workDate: targetDate });
      const evidenceValidation = validateWorkEvidence(rawEvidence.record);

      // 4. Existing credit check
      const existingCredit = await checkExistingCredit(targetUserId, targetDate);

      return res.json({
        userId: targetUserId,
        workDate: dateStr,
        claimWindow: {
          isValid: windowCheck.isValid,
          elapsedDays: windowCheck.elapsedDays,
          maxClaimWindowDays: policy.claimWindowDays,
          claimWindowEnabled: policy.claimWindowEnabled,
          error: windowCheck.error || null
        },
        workdayEligibility: {
          isEligible: dayCheck.isEligible,
          reason: dayCheck.eligibleReason || null,
          dayName: dayCheck.dayName,
          error: dayCheck.message || null
        },
        attendanceEvidence: {
          hasAttendance: rawEvidence.hasAttendance,
          isSufficient: evidenceValidation.isValid,
          missingReason: evidenceValidation.reason || null,
          details: evidenceValidation.summary || null,
          validationError: evidenceValidation.message || null
        },
        creditStatus: {
          hasExistingCredit: Boolean(existingCredit),
          existingCredit: existingCredit ? {
            id: existingCredit.id,
            creditDays: existingCredit.creditDays,
            availableDays: existingCredit.availableDays,
            status: existingCredit.status,
            earnedAt: existingCredit.earnedAt,
            expiresAt: existingCredit.expiresAt
          } : null
        },
        canAuthorize: windowCheck.isValid && dayCheck.isEligible && evidenceValidation.isValid && !existingCredit
      });
    }

    // B. Scan Retrospective Window for Eligible Off-days with Work Evidence
    const today = new Date();
    const eligibleDates = [];
    const scanLimit = policy.claimWindowEnabled ? policy.claimWindowDays : 90;

    for (let i = 0; i <= scanLimit; i++) {
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().split('T')[0];
      const targetDate = new Date(`${dateStr}T00:00:00.000Z`);

      const dayCheck = await validateEligibleDay({
        userId: targetUserId,
        workDate: targetDate,
        organizationId
      });

      if (dayCheck.isEligible) {
        const rawEvidence = await getWorkEvidence({ userId: targetUserId, workDate: targetDate });
        const evidenceValidation = validateWorkEvidence(rawEvidence.record);
        const existingCredit = await checkExistingCredit(targetUserId, targetDate);

        eligibleDates.push({
          workDate: dateStr,
          dayName: dayCheck.dayName,
          eligibleReason: dayCheck.eligibleReason,
          elapsedDays: i,
          hasAttendance: rawEvidence.hasAttendance,
          isEvidenceSufficient: evidenceValidation.isValid,
          missingEvidenceReason: evidenceValidation.reason || null,
          evidenceSummary: evidenceValidation.summary || null,
          hasExistingCredit: Boolean(existingCredit),
          existingCreditStatus: existingCredit?.status || null,
          canAuthorize: evidenceValidation.isValid && !existingCredit
        });
      }
    }

    return res.json({
      userId: targetUserId,
      claimWindowDays: DEFAULT_CLAIM_WINDOW_DAYS,
      eligibleDatesCount: eligibleDates.length,
      eligibleDates
    });
  } catch (error) {
    console.error('getEligibleWorkEvidence error:', error);
    return res.status(500).json({ message: 'Failed to retrieve eligible work evidence.' });
  }
};

/**
 * 2. Authorize Comp-Off Credit
 * POST /api/comp-off/authorize
 */
const authorizeCompOffCredit = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const { userId, workDate, creditDays, remarks } = req.body;

    if (!userId || !workDate || creditDays === undefined) {
      return res.status(400).json({
        message: 'Missing required parameters: userId, workDate, and creditDays (0.5 or 1.0) are mandatory.'
      });
    }

    // Execute Transaction
    const result = await prisma.$transaction(async (tx) => {
      const resData = await authorizeCreditInTransaction({
        verifierUser: req.user,
        targetUserId: userId,
        workDate,
        creditDays,
        remarks,
        organizationId,
        txClient: tx
      });

      if (resData && resData.allowed === false) {
        const err = new Error(resData.error || 'Authorization failed.');
        err.statusCode = resData.statusCode || 400;
        err.missingEvidence = resData.missingEvidence || null;
        err.existingCredit = resData.existingCredit || null;
        throw err;
      }

      return resData;
    });

    const { credit, eligibility } = result;

    // Dual Audit Trail & Logging
    await logActivity({
      userId: req.user.id,
      organizationId,
      action: req.user.role === 'ADMIN' ? 'COMPOFF_CREDIT_AUTHORIZE' : 'COMPOFF_CREDIT_VERIFY',
      details: `${req.user.role} ${req.user.name} ${req.user.role === 'ADMIN' ? 'authorized' : 'verified'} ${credit.creditDays} day(s) Comp-Off for ${eligibility.targetUser.name} on ${workDate}. Remarks: "${remarks || 'None'}"`,
      req
    });

    // Notifications
    const dateStr = typeof workDate === 'string' ? workDate.split('T')[0] : workDate.toISOString().split('T')[0];
    if (req.user.role === 'ADMIN') {
      await createNotification({
        userId,
        title: 'Comp-Off Credit Authorized',
        message: `Admin granted you ${credit.creditDays} day(s) Compensatory Leave for working on ${dateStr}.`,
        type: 'COMPOFF_CREDIT_AUTHORIZED'
      });
    } else if (req.user.role === 'TEAM_LEADER') {
      await createNotification({
        userId,
        title: 'Comp-Off Credit Verified by Team Leader',
        message: `Team Leader verified your work on ${dateStr} for ${credit.creditDays} day(s) Comp-Off. Awaiting final Admin sanction.`,
        type: 'COMPOFF_CREDIT_VERIFIED'
      });

      // Notify Admins
      const admins = await prisma.user.findMany({
        where: { role: 'ADMIN', organizationId }
      });
      for (const admin of admins) {
        await createNotification({
          userId: admin.id,
          title: 'Comp-Off Credit Awaiting Admin Sanction',
          message: `Comp-Off credit for ${eligibility.targetUser.name} (${credit.creditDays} day(s) on ${dateStr}) verified by TL and awaits sanction.`,
          type: 'COMPOFF_CREDIT_FORWARDED_ADMIN'
        });
      }
    }

    return res.status(201).json(credit);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        missingEvidence: error.missingEvidence || null,
        existingCredit: error.existingCredit || null
      });
    }
    console.error('authorizeCompOffCredit error:', error);
    return res.status(500).json({ message: 'Failed to authorize Comp-Off credit.' });
  }
};

/**
 * 3. Admin Final Approval of TL-Verified Claim
 * PUT /api/comp-off/credits/:id/admin-approve
 */
const adminApproveCompOffCredit = async (req, res) => {
  try {
    const { id } = req.params;
    const { remarks } = req.body;
    const organizationId = getEffectiveOrgId(req);
    const userRole = req.user.role;
    const userId = req.user.id;

    if (userRole === 'SUPER_ADMIN') {
      return res.status(403).json({
        message: 'Super Admin is strictly read-only and cannot approve Comp-Off credits.'
      });
    }

    if (userRole !== 'ADMIN') {
      return res.status(403).json({
        message: 'Only Administrators can perform final Comp-Off credit sanction.'
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const credit = await tx.compOffCredit.findUnique({
        where: { id },
        include: { user: true }
      });

      if (!credit) {
        const err = new Error('Comp-Off credit not found.');
        err.statusCode = 404;
        throw err;
      }

      if (credit.organizationId !== organizationId) {
        const err = new Error('Unauthorized organization scope.');
        err.statusCode = 403;
        throw err;
      }

      if (credit.status !== 'PENDING_ADMIN_APPROVAL') {
        const err = new Error(`Credit is not pending final Admin approval (current status: ${credit.status}).`);
        err.statusCode = 400;
        throw err;
      }

      // Expiry period starts from the credit approval/grant date, not the work date
      const grantDate = new Date();
      const policy = await getCompOffPolicySettings(organizationId);
      const expiresAt = calculateExpiryDate(grantDate, policy.validityDays);

      return await tx.compOffCredit.update({
        where: { id },
        data: {
          status: 'APPROVED',
          availableDays: credit.creditDays,
          adminApprovedById: userId,
          adminApprovedAt: grantDate,
          adminRemarks: remarks || 'Sanctioned by Admin',
          expiresAt
        },
        include: {
          user: { select: { id: true, name: true, employeeId: true, email: true } },
          attendance: { select: { id: true, date: true, clockIn: true, clockOut: true, workingHours: true } }
        }
      });
    });

    // Dual Audit Log
    await logActivity({
      userId,
      organizationId,
      action: 'COMPOFF_ADMIN_APPROVE',
      details: `Admin sanctioned ${updated.creditDays} day(s) Comp-Off for ${updated.user.name}. Remarks: "${remarks || 'Sanctioned'}"`,
      req
    });

    // Notify Employee
    await createNotification({
      userId: updated.userId,
      title: 'Comp-Off Credit Sanctioned by Admin',
      message: `Your ${updated.creditDays} day(s) Comp-Off credit has been sanctioned by Admin and is now available in your balance.`,
      type: 'COMPOFF_CREDIT_SANCTIONED'
    });

    return res.json({
      ...updated,
      remainingDays: updated.availableDays
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('adminApproveCompOffCredit error:', error);
    return res.status(500).json({ message: 'Failed to approve Comp-Off credit.' });
  }
};

/**
 * 4. Reject Comp-Off Credit Claim
 * PUT /api/comp-off/credits/:id/reject
 */
const rejectCompOffCredit = async (req, res) => {
  try {
    const { id } = req.params;
    const { remarks } = req.body;
    const organizationId = getEffectiveOrgId(req);
    const userRole = req.user.role;
    const userId = req.user.id;

    if (userRole === 'SUPER_ADMIN') {
      return res.status(403).json({
        message: 'Super Admin is strictly read-only and cannot reject Comp-Off credits.'
      });
    }

    if (userRole !== 'ADMIN' && userRole !== 'TEAM_LEADER') {
      return res.status(403).json({
        message: 'Only Administrators or Team Leaders can reject Comp-Off credit requests.'
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const credit = await tx.compOffCredit.findUnique({
        where: { id },
        include: { user: true }
      });

      if (!credit) {
        const err = new Error('Comp-Off credit not found.');
        err.statusCode = 404;
        throw err;
      }

      if (credit.organizationId !== organizationId) {
        const err = new Error('Unauthorized organization scope.');
        err.statusCode = 403;
        throw err;
      }

      if (credit.status !== 'PENDING_ADMIN_APPROVAL') {
        const err = new Error(`Only pending credits can be rejected (current status: ${credit.status}).`);
        err.statusCode = 400;
        throw err;
      }

      if (userRole === 'TEAM_LEADER') {
        // Team Leader cannot reject own credit or peer TL credit
        if (credit.userId === userId) {
          const err = new Error('Team Leaders cannot reject their own Comp-Off request.');
          err.statusCode = 403;
          throw err;
        }
        const membership = await tx.teamMember.findFirst({
          where: {
            userId: credit.userId,
            team: { leaderId: userId, organizationId }
          }
        });
        if (!membership) {
          const err = new Error('You can only reject Comp-Off requests for members of teams you lead.');
          err.statusCode = 403;
          throw err;
        }
      }

      return await tx.compOffCredit.update({
        where: { id },
        data: {
          status: 'REJECTED',
          availableDays: 0.0,
          adminApprovedById: userRole === 'ADMIN' ? userId : credit.adminApprovedById,
          adminApprovedAt: userRole === 'ADMIN' ? new Date() : credit.adminApprovedAt,
          adminRemarks: userRole === 'ADMIN' ? (remarks || 'Rejected by Admin') : credit.adminRemarks,
          tlRemarks: userRole === 'TEAM_LEADER' ? (remarks || 'Rejected by Team Leader') : credit.tlRemarks
        },
        include: {
          user: { select: { id: true, name: true, employeeId: true } }
        }
      });
    });

    // Dual Audit Log
    await logActivity({
      userId,
      organizationId,
      action: 'COMPOFF_CREDIT_REJECT',
      details: `${userRole} rejected Comp-Off credit for ${updated.user.name}. Remarks: "${remarks || 'None'}"`,
      req
    });

    // Notify Employee
    await createNotification({
      userId: updated.userId,
      title: 'Comp-Off Credit Request Rejected',
      message: `Your Comp-Off credit request was rejected. Remarks: "${remarks || 'None'}"`,
      type: 'COMPOFF_CREDIT_REJECTED'
    });

    return res.json(updated);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('rejectCompOffCredit error:', error);
    return res.status(500).json({ message: 'Failed to reject Comp-Off credit.' });
  }
};

/**
 * 5. List Comp-Off Credits
 * GET /api/comp-off/credits
 */
const getCompOffCredits = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const userRole = req.user.role;
    const currentUserId = req.user.id;

    const where = {};
    if (organizationId) {
      where.organizationId = organizationId;
    }

    // Role-based visibility scoping
    if (userRole === 'EMPLOYEE' || userRole === 'INTERN') {
      where.userId = currentUserId; // Strict tenant & self isolation
    } else if (userRole === 'TEAM_LEADER') {
      if (req.query.userId) {
        if (req.query.userId !== currentUserId) {
          const membership = await prisma.teamMember.findFirst({
            where: {
              userId: req.query.userId,
              team: { leaderId: currentUserId, organizationId }
            }
          });
          if (!membership) {
            return res.status(403).json({
              message: 'You can only view Comp-Off credits for members of teams you lead.'
            });
          }
        }
        where.userId = req.query.userId;
      } else {
        // Find all team members led by this Team Leader + self
        const teamMembers = await prisma.teamMember.findMany({
          where: {
            team: { leaderId: currentUserId, organizationId }
          },
          select: { userId: true }
        });
        const allowedIds = [currentUserId, ...teamMembers.map(m => m.userId)];
        where.userId = { in: allowedIds };
      }
    } else if (userRole === 'ADMIN' || userRole === 'SUPER_ADMIN') {
      if (req.query.userId) {
        where.userId = req.query.userId;
      }
    }

    // Status filter
    if (req.query.status) {
      where.status = req.query.status.toUpperCase();
    }

    // Date range filter
    if (req.query.startDate || req.query.endDate) {
      where.workDate = {};
      if (req.query.startDate) {
        where.workDate.gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        where.workDate.lte = new Date(req.query.endDate);
      }
    }

    // Lazy Expiry Transition: Transition eligible expired records before listing
    await processExpiredCompOffCredits({ organizationId });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [total, credits] = await Promise.all([
      prisma.compOffCredit.count({ where }),
      prisma.compOffCredit.findMany({
        where,
        skip,
        take: limit,
        orderBy: { workDate: 'desc' },
        include: {
          user: { select: { id: true, name: true, employeeId: true, role: true, profilePic: true } },
          attendance: { select: { id: true, date: true, clockIn: true, clockOut: true, workingHours: true, status: true } },
          consumptions: {
            include: {
              leaveRequest: {
                select: { id: true, startDate: true, endDate: true, status: true, totalDays: true, reason: true }
              }
            }
          }
        }
      })
    ]);

    // Batch fetch unique approver user details
    const approverIds = new Set();
    credits.forEach((c) => {
      if (c.tlApprovedById) approverIds.add(c.tlApprovedById);
      if (c.adminApprovedById) approverIds.add(c.adminApprovedById);
    });

    const approversMap = {};
    if (approverIds.size > 0) {
      const approvers = await prisma.user.findMany({
        where: { id: { in: Array.from(approverIds) } },
        select: { id: true, name: true, role: true }
      });
      approvers.forEach((a) => {
        approversMap[a.id] = a;
      });
    }

    const populatedCredits = credits.map((c) => ({
      ...c,
      remainingDays: c.availableDays !== undefined ? c.availableDays : c.remainingDays,
      tlApprover: c.tlApprovedById ? approversMap[c.tlApprovedById] || null : null,
      adminApprover: c.adminApprovedById ? approversMap[c.adminApprovedById] || null : null
    }));

    return res.json({
      credits: populatedCredits,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('getCompOffCredits error:', error);
    return res.status(500).json({ message: 'Failed to retrieve Comp-Off credits.' });
  }
};

/**
 * 6. Get Single Comp-Off Credit Details & Audit History
 * GET /api/comp-off/credits/:id
 */
const getCompOffCreditById = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = getEffectiveOrgId(req);
    const userRole = req.user.role;
    const currentUserId = req.user.id;

    const credit = await prisma.compOffCredit.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, employeeId: true, role: true, email: true, department: true } },
        attendance: {
          include: {
            attendanceLocation: { select: { id: true, name: true, address: true } }
          }
        },
        organization: { select: { id: true, name: true } },
        consumptions: {
          include: {
            leaveRequest: {
              select: { id: true, startDate: true, endDate: true, status: true, totalDays: true, reason: true }
            }
          }
        }
      }
    });

    if (!credit) {
      return res.status(404).json({ message: 'Comp-Off credit not found.' });
    }

    // Tenant Check
    if (organizationId && credit.organizationId !== organizationId) {
      return res.status(403).json({ message: 'Unauthorized organization scope.' });
    }

    // Role Visibility Scope
    if (userRole === 'EMPLOYEE' || userRole === 'INTERN') {
      if (credit.userId !== currentUserId) {
        return res.status(403).json({ message: 'You can only view your own Comp-Off credits.' });
      }
    } else if (userRole === 'TEAM_LEADER') {
      if (credit.userId !== currentUserId) {
        const membership = await prisma.teamMember.findFirst({
          where: {
            userId: credit.userId,
            team: { leaderId: currentUserId, organizationId }
          }
        });
        if (!membership) {
          return res.status(403).json({
            message: 'You can only view Comp-Off credits for members of teams you lead.'
          });
        }
      }
    }

    // Fetch Approvers info if present
    let tlApprover = null;
    let adminApprover = null;

    if (credit.tlApprovedById) {
      tlApprover = await prisma.user.findUnique({
        where: { id: credit.tlApprovedById },
        select: { id: true, name: true, role: true }
      });
    }

    if (credit.adminApprovedById) {
      adminApprover = await prisma.user.findUnique({
        where: { id: credit.adminApprovedById },
        select: { id: true, name: true, role: true }
      });
    }

    const isExpired = new Date() > new Date(credit.expiresAt);

    return res.json({
      ...credit,
      remainingDays: credit.availableDays !== undefined ? credit.availableDays : credit.remainingDays,
      isExpired,
      tlApprover,
      adminApprover
    });
  } catch (error) {
    console.error('getCompOffCreditById error:', error);
    return res.status(500).json({ message: 'Failed to retrieve Comp-Off credit details.' });
  }
};

/**
 * 7. Estimate Comp-Off Consumption Breakdown (FIFO Preview)
 * GET /api/comp-off/estimate-consumption
 */
const estimateCompOffConsumption = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const { userId: queryUserId, leaveRequestId, days } = req.query;
    let targetUserId = queryUserId || req.user.id;
    let requiredDays = parseFloat(days) || 0;

    if (leaveRequestId) {
      const lr = await prisma.leaveRequest.findUnique({
        where: { id: leaveRequestId },
        include: { user: true }
      });
      if (!lr) return res.status(404).json({ message: 'Leave request not found.' });
      if (organizationId && lr.user?.organizationId !== organizationId) {
        return res.status(403).json({ message: 'Unauthorized organization scope.' });
      }
      targetUserId = lr.userId;
      requiredDays = parseFloat(lr.totalDays) || 1.0;
    }

    // Role checks
    if (['EMPLOYEE', 'INTERN'].includes(req.user.role) && targetUserId !== req.user.id) {
      targetUserId = req.user.id;
    }

    const now = new Date();
    const activeCredits = await prisma.compOffCredit.findMany({
      where: {
        userId: targetUserId,
        status: 'APPROVED',
        availableDays: { gt: 0 },
        expiresAt: { gte: now }
      },
      orderBy: [
        { expiresAt: 'asc' },
        { earnedAt: 'asc' },
        { id: 'asc' }
      ]
    });

    let remaining = requiredDays;
    const breakdown = [];
    let totalAvailable = 0;

    for (const c of activeCredits) {
      totalAvailable += c.availableDays;
      if (remaining > 0) {
        const toDeduct = Math.min(c.availableDays, remaining);
        remaining = Math.round((remaining - toDeduct) * 100) / 100;
        breakdown.push({
          creditId: c.id,
          workDate: c.workDate,
          expiresAt: c.expiresAt,
          creditDays: c.creditDays,
          currentAvailable: c.availableDays,
          estimatedDeduction: toDeduct,
          estimatedRemaining: Math.round((c.availableDays - toDeduct) * 100) / 100,
          deducting: toDeduct,
          remainingAfter: Math.round((c.availableDays - toDeduct) * 100) / 100
        });
      }
    }

    return res.json({
      userId: targetUserId,
      requiredDays,
      totalAvailable: Math.round(totalAvailable * 100) / 100,
      canCover: totalAvailable >= requiredDays,
      breakdown,
      isEstimate: true
    });
  } catch (err) {
    console.error('estimateCompOffConsumption error:', err);
    return res.status(500).json({ message: 'Failed to estimate Comp-Off consumption.' });
  }
};

/**
 * 6. Get Comp-Off Policy Settings
 * GET /api/comp-off/policy
 */
const getCompOffPolicy = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const policy = await getCompOffPolicySettings(organizationId);
    res.json({ policy });
  } catch (error) {
    console.error('getCompOffPolicy error:', error);
    res.status(500).json({ message: 'Failed to retrieve Comp-Off policy settings.' });
  }
};

/**
 * 7. Update Comp-Off Policy Settings
 * PUT /api/comp-off/policy
 */
const updateCompOffPolicy = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const userRole = req.user.role;
    if (userRole === 'SUPER_ADMIN') {
      // Super admin can specify target org or update global
    } else if (userRole !== 'ADMIN') {
      return res.status(403).json({ message: 'Only administrators can update Comp-Off policy settings.' });
    }

    const { claimWindowEnabled, claimWindowDays, validityDays } = req.body;
    const updated = await updateCompOffPolicySettings({
      organizationId,
      claimWindowEnabled,
      claimWindowDays,
      validityDays
    });

    await logActivity({
      userId: req.user.id,
      organizationId,
      action: 'UPDATE_COMPOFF_POLICY',
      details: `Updated Comp-Off policy: claimWindowEnabled=${updated.claimWindowEnabled}, claimWindowDays=${updated.claimWindowDays}`
    });

    res.json({
      message: 'Comp-Off policy updated successfully.',
      policy: updated
    });
  } catch (error) {
    console.error('updateCompOffPolicy error:', error);
    res.status(500).json({ message: 'Failed to update Comp-Off policy.' });
  }
};

/**
 * 8. Get Upcoming Eligible Future Off-days for Advance Permission Requests
 * GET /api/comp-off/eligible-future-dates
 */
const getEligibleFutureDatesEndpoint = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const currentUserId = req.user.id;
    const targetUserId = req.query.userId || currentUserId;
    const daysAhead = req.query.days ? parseInt(req.query.days, 10) : 60;

    const dates = await getEligibleFutureDates({
      userId: targetUserId,
      organizationId,
      daysAhead
    });

    res.json({ dates });
  } catch (error) {
    console.error('getEligibleFutureDates error:', error);
    res.status(500).json({ message: 'Failed to fetch eligible future dates.' });
  }
};

/**
 * 9. Submit Advance Permission Request
 * POST /api/comp-off/permission-requests
 */
const createCompOffPermissionRequestEndpoint = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const currentUserId = req.user.id;
    const { workDate, reason } = req.body;

    if (!workDate) {
      return res.status(400).json({ message: 'workDate is required.' });
    }

    const request = await createCompOffPermissionRequest({
      organizationId,
      userId: currentUserId,
      workDate,
      reason
    });

    await logActivity({
      userId: currentUserId,
      organizationId,
      action: 'REQUEST_COMPOFF_ADVANCE_PERMISSION',
      details: `Requested advance permission to work on ${workDate}`
    });

    res.status(201).json({
      message: 'Advance permission request submitted successfully.',
      request
    });
  } catch (error) {
    console.error('createCompOffPermissionRequest error:', error);
    res.status(error.statusCode || 500).json({ message: error.message || 'Failed to submit advance permission request.' });
  }
};

/**
 * 10. List Advance Permission Requests
 * GET /api/comp-off/permission-requests
 */
const getCompOffPermissionRequestsEndpoint = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const userRole = req.user.role;
    const currentUserId = req.user.id;
    const { userId: targetUserId, status, limit, offset } = req.query;

    const result = await getCompOffPermissionRequests({
      organizationId,
      userRole,
      currentUserId,
      targetUserId,
      status,
      limit,
      offset
    });

    res.json(result);
  } catch (error) {
    console.error('getCompOffPermissionRequests error:', error);
    res.status(error.statusCode || 500).json({ message: error.message || 'Failed to fetch advance permission requests.' });
  }
};

/**
 * 11. Approve Advance Permission Request (Admin only, zero credit created)
 * PUT /api/comp-off/permission-requests/:id/approve
 */
const approveCompOffPermissionRequestEndpoint = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const { id } = req.params;
    const { remarks } = req.body;

    const updated = await reviewCompOffPermissionRequest({
      requestId: id,
      reviewerUser: req.user,
      action: 'APPROVE',
      remarks,
      organizationId
    });

    await logActivity({
      userId: req.user.id,
      organizationId,
      action: 'APPROVE_COMPOFF_ADVANCE_PERMISSION',
      details: `Approved advance Comp-Off permission request ${id}`
    });

    res.json({
      message: 'Advance permission request approved successfully.',
      request: updated
    });
  } catch (error) {
    console.error('approveCompOffPermissionRequest error:', error);
    res.status(error.statusCode || 500).json({ message: error.message || 'Failed to approve advance permission request.' });
  }
};

/**
 * 12. Reject Advance Permission Request (Admin only)
 * PUT /api/comp-off/permission-requests/:id/reject
 */
const rejectCompOffPermissionRequestEndpoint = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const { id } = req.params;
    const { remarks, rejectionReason } = req.body;

    const reasonToUse = rejectionReason || remarks;
    if (!reasonToUse || String(reasonToUse).trim().length < 4) {
      return res.status(400).json({ message: 'A clear rejection reason (at least 4 characters) is required.' });
    }

    const updated = await reviewCompOffPermissionRequest({
      requestId: id,
      reviewerUser: req.user,
      action: 'REJECT',
      remarks,
      rejectionReason: reasonToUse,
      organizationId
    });

    await logActivity({
      userId: req.user.id,
      organizationId,
      action: 'REJECT_COMPOFF_ADVANCE_PERMISSION',
      details: `Rejected advance Comp-Off permission request ${id}. Reason: ${reasonToUse}`
    });

    res.json({
      message: 'Advance permission request rejected.',
      request: updated
    });
  } catch (error) {
    console.error('rejectCompOffPermissionRequest error:', error);
    res.status(error.statusCode || 500).json({ message: error.message || 'Failed to reject advance permission request.' });
  }
};

/**
 * 13. Get Today's Comp-Off Session Status (for Employee)
 * GET /api/comp-off/sessions/today-status
 */
const getTodayCompOffStatusEndpoint = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const userId = req.user.id;

    const result = await getTodayCompOffStatus({
      userId,
      organizationId
    });

    res.json(result);
  } catch (error) {
    console.error('getTodayCompOffStatus error:', error);
    res.status(error.statusCode || 500).json({ message: error.message || 'Failed to get today comp-off status.' });
  }
};

/**
 * 14. Comp-Off Login (Start dedicated off-day session)
 * POST /api/comp-off/sessions/login
 */
const startCompOffSessionEndpoint = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const userId = req.user.id;
    const { latitude, longitude, locationReason } = req.body;

    const ipAddress = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || '';

    const session = await startCompOffSession({
      userId,
      organizationId,
      latitude,
      longitude,
      locationReason,
      ipAddress,
      userAgent
    });

    await logActivity({
      userId,
      organizationId,
      action: 'COMPOFF_LOGIN',
      details: `Started Comp-Off session for ${session.workDate.toISOString().split('T')[0]}. Geofence: ${session.locationStatus}`
    });

    res.status(201).json({
      message: 'Comp-Off login recorded successfully.',
      session
    });
  } catch (error) {
    console.error('startCompOffSession error:', error);
    res.status(error.statusCode || 500).json({
      message: error.message || 'Failed to start Comp-Off session.',
      isOutsideGeofence: error.isOutsideGeofence || false,
      geofence: error.geofence || null
    });
  }
};

/**
 * 15. Comp-Off Clock-Out (End dedicated off-day session)
 * POST /api/comp-off/sessions/clock-out
 */
const endCompOffSessionEndpoint = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const userId = req.user.id;
    const { sessionId } = req.body;

    const session = await endCompOffSession({
      userId,
      organizationId,
      sessionId
    });

    await logActivity({
      userId,
      organizationId,
      action: 'COMPOFF_CLOCK_OUT',
      details: `Ended Comp-Off session. Worked duration: ${session.durationHours} hours.`
    });

    res.json({
      message: 'Comp-Off clock-out completed successfully.',
      session
    });
  } catch (error) {
    console.error('endCompOffSession error:', error);
    res.status(error.statusCode || 500).json({ message: error.message || 'Failed to complete Comp-Off clock-out.' });
  }
};

/**
 * 16. Get Comp-Off Sessions (Admin & Employee listing)
 * GET /api/comp-off/sessions
 */
const getCompOffSessionsEndpoint = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const { status, userId, dateFrom, dateTo, limit, page } = req.query;

    const result = await getCompOffSessions({
      organizationId,
      requestingUser: req.user,
      status,
      userId,
      dateFrom,
      dateTo,
      limit,
      page
    });

    res.json(result);
  } catch (error) {
    console.error('getCompOffSessions error:', error);
    res.status(error.statusCode || 500).json({ message: error.message || 'Failed to fetch Comp-Off sessions.' });
  }
};

/**
 * 17. Verify and Approve Comp-Off Session (Admin only)
 * POST /api/comp-off/sessions/:id/approve
 */
const approveCompOffSessionEndpoint = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const { id } = req.params;
    const { remarks } = req.body;

    const result = await verifyAndApproveCompOffSession({
      sessionId: id,
      verifierUser: req.user,
      organizationId,
      remarks
    });

    const workDateStr = result.session.workDate ? result.session.workDate.toISOString().split('T')[0] : 'work date';

    await logActivity({
      userId: req.user.id,
      organizationId,
      action: 'COMPOFF_SESSION_APPROVED',
      details: `Admin ${req.user.name} approved Comp-Off session for ${result.session.user?.name || 'employee'} on ${workDateStr}. Granted: ${result.credit.creditDays} day(s) credit.`
    });

    await createNotification({
      userId: result.session.userId,
      title: 'Comp-Off Session Approved',
      message: `Admin approved your off-day session for ${workDateStr} and granted you ${result.credit.creditDays} day(s) Compensatory Off.`,
      type: 'COMPOFF_CREDIT_AUTHORIZED'
    });

    res.json({
      message: 'Comp-Off session approved and credit granted successfully.',
      session: result.session,
      credit: result.credit,
      calculation: result.calculation
    });
  } catch (error) {
    console.error('approveCompOffSession error:', error);
    res.status(error.statusCode || 500).json({
      message: error.message || 'Failed to approve Comp-Off session.',
      calculation: error.calculation || null,
      existingCredit: error.existingCredit || null
    });
  }
};

/**
 * 18. Reject Comp-Off Session (Admin only)
 * POST /api/comp-off/sessions/:id/reject
 */
const rejectCompOffSessionEndpoint = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const { id } = req.params;
    const { rejectionReason, adminRemarks } = req.body;

    if (!rejectionReason || !rejectionReason.trim()) {
      return res.status(400).json({ message: 'A rejection reason is mandatory when rejecting a Comp-Off session.' });
    }

    const result = await rejectCompOffSession({
      sessionId: id,
      verifierUser: req.user,
      organizationId,
      rejectionReason,
      adminRemarks
    });

    const workDateStr = result.session.workDate ? result.session.workDate.toISOString().split('T')[0] : 'work date';

    await logActivity({
      userId: req.user.id,
      organizationId,
      action: 'COMPOFF_SESSION_REJECTED',
      details: `Admin ${req.user.name} rejected Comp-Off session for ${result.session.user?.name || 'employee'} on ${workDateStr}. Reason: "${rejectionReason.trim()}"`
    });

    await createNotification({
      userId: result.session.userId,
      title: 'Comp-Off Session Rejected',
      message: `Your off-day session for ${workDateStr} was rejected. Reason: ${rejectionReason.trim()}`,
      type: 'COMPOFF_SESSION_REJECTED'
    });

    res.json({
      message: 'Comp-Off session rejected.',
      session: result.session
    });
  } catch (error) {
    console.error('rejectCompOffSession error:', error);
    res.status(error.statusCode || 500).json({ message: error.message || 'Failed to reject Comp-Off session.' });
  }
};

module.exports = {
  getEligibleWorkEvidence,
  authorizeCompOffCredit,
  adminApproveCompOffCredit,
  rejectCompOffCredit,
  getCompOffCredits,
  getCompOffCreditById,
  estimateCompOffConsumption,
  getCompOffPolicy,
  updateCompOffPolicy,
  getEligibleFutureDatesEndpoint,
  createCompOffPermissionRequestEndpoint,
  getCompOffPermissionRequestsEndpoint,
  approveCompOffPermissionRequestEndpoint,
  rejectCompOffPermissionRequestEndpoint,
  getTodayCompOffStatusEndpoint,
  startCompOffSessionEndpoint,
  endCompOffSessionEndpoint,
  getCompOffSessionsEndpoint,
  approveCompOffSessionEndpoint,
  rejectCompOffSessionEndpoint,
  // Convenience aliases
  authorizeCredit: authorizeCompOffCredit,
  adminApproveCredit: adminApproveCompOffCredit,
  rejectCredit: rejectCompOffCredit
};

