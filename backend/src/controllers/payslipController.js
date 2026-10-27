const prisma = require('../utils/db');
const { logActivity } = require('../utils/activityLogger');
const { createNotification } = require('../services/notification');
const { getEffectiveOrgId, assertOrganizationAccess } = require('../utils/organizationScope');

// 1. Get Payslips (Role & Organization Scoped)
const getPayslips = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;

    const { month, year, status } = req.query;
    const targetOrgId = getEffectiveOrgId(req);

    let payslips = [];

    if (['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
      const whereClause = {
        NOT: {
          AND: [
            { basicSalary: 0 },
            { grossSalary: 0 },
            { netSalary: 0 }
          ]
        }
      };
      if (month) whereClause.month = Number(month);
      if (year) whereClause.year = Number(year);
      if (status) whereClause.status = status;

      if (targetOrgId) {
        whereClause.OR = [
          { organizationId: targetOrgId },
          { batch: { organizationId: targetOrgId } }
        ];
      }

      payslips = await prisma.payslip.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              employeeId: true,
              role: true,
              department: true,
              profilePic: true,
              organizationId: true,
              shiftAssignment: { include: { shift: true } }
            }
          },
          batch: true
        },
        orderBy: [{ year: 'desc' }, { month: 'desc' }]
      });
    } else {
      // Employees/Interns/TLs view published or own payslips
      const empWhere = {
        userId,
        status: status || 'PUBLISHED'
      };
      if (month) empWhere.month = Number(month);
      if (year) empWhere.year = Number(year);

      payslips = await prisma.payslip.findMany({
        where: empWhere,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              employeeId: true,
              role: true,
              department: true,
              profilePic: true,
              organizationId: true,
              shiftAssignment: { include: { shift: true } }
            }
          },
          batch: true
        },
        orderBy: [{ year: 'desc' }, { month: 'desc' }]
      });
    }

    res.json(payslips);
  } catch (error) {
    console.error('Get payslips error:', error);
    res.status(500).json({ message: 'Failed to retrieve payslips.' });
  }
};

// 2. Get Detailed Single Payslip by ID (for View / Print / PDF / QR Verification)
const getPayslipById = async (req, res) => {
  try {
    const { id } = req.params;
    const userRole = req.user.role;
    const userId = req.user.id;

    const targetOrgId = getEffectiveOrgId(req);

    const payslip = await prisma.payslip.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true, name: true, email: true, phone: true, employeeId: true,
            role: true, department: true, designation: true, profilePic: true,
            joiningDate: true, companyName: true, organizationId: true,
            shiftAssignment: { include: { shift: true } }
          }
        },
        batch: true
      }
    });

    if (!payslip) {
      return res.status(404).json({ message: 'Payslip not found.' });
    }

    // Role-based access control
    if (['INTERN', 'EMPLOYEE'].includes(userRole) && payslip.userId !== userId) {
      return res.status(403).json({ message: 'You can only view your own payslips.' });
    }

    if (['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
      assertOrganizationAccess(payslip, req);
    }

    const psOrgId = payslip.organizationId || payslip.user?.organizationId || payslip.batch?.organizationId || targetOrgId;
    const settings = (psOrgId ? await prisma.payrollSettings.findFirst({ where: { organizationId: psOrgId } }) : null) || {};

    await logActivity({
      userId: req.user.id,
      organizationId: psOrgId,
      action: 'PAYSLIP_VIEW',
      details: `Viewed payslip for ${payslip.user.name} (${payslip.month}/${payslip.year})`
    });

    res.json({
      payslip,
      settings
    });
  } catch (error) {
    if (error.statusCode === 403) return res.status(403).json({ message: error.message });
    console.error('Get payslip details error:', error);
    res.status(500).json({ message: 'Failed to retrieve payslip details.' });
  }
};

// 3. Email Payslip to Employee (Admin / Super Admin Only)
const emailPayslip = async (req, res) => {
  try {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only Administrators can send payslip emails.' });
    }

    const { id } = req.params;
    const payslip = await prisma.payslip.findUnique({
      where: { id },
      include: { user: true }
    });

    if (!payslip) {
      return res.status(404).json({ message: 'Payslip not found.' });
    }

    assertOrganizationAccess(payslip, req);

    await createNotification({
      userId: payslip.userId,
      title: 'Payslip Emailed',
      message: `Your itemized payslip for ${payslip.month}/${payslip.year} has been sent to your email (${payslip.user.email}).`,
      type: 'PAYSLIP_EMAILED'
    });

    await logActivity({
      userId: req.user.id,
      organizationId: payslip.organizationId || payslip.user?.organizationId,
      action: 'PAYSLIP_EMAIL_SEND',
      details: `Sent payslip email to ${payslip.user.name} (${payslip.user.email})`
    });

    res.json({ message: `Payslip notification sent to ${payslip.user.email}.` });
  } catch (error) {
    if (error.statusCode === 403) return res.status(403).json({ message: error.message });
    console.error('Email payslip error:', error);
    res.status(500).json({ message: 'Failed to send payslip email.' });
  }
};

module.exports = {
  getPayslips,
  getPayslipById,
  emailPayslip
};
