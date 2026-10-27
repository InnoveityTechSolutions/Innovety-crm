const prisma = require('../utils/db');
const { getEffectiveOrgId } = require('../utils/organizationScope');

// 1. Financial Summary & Department Analytics
const getPayrollReportsSummary = async (req, res) => {
  try {
    const userRole = req.user.role;
    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
      return res.status(403).json({ message: 'Access denied to financial reports.' });
    }

    const { month, year } = req.query;
    const targetOrgId = getEffectiveOrgId(req);

    const whereClause = { status: 'PUBLISHED' };
    if (month) whereClause.month = Number(month);
    if (year) whereClause.year = Number(year);

    if (targetOrgId) {
      whereClause.OR = [
        { organizationId: targetOrgId },
        { batch: { organizationId: targetOrgId } }
      ];
    }

    const publishedPayslips = await prisma.payslip.findMany({
      where: whereClause,
      include: {
        user: { select: { id: true, name: true, role: true, department: true, employeeId: true, organizationId: true } },
        batch: true
      }
    });

    let totalGrossExpense = 0;
    let totalNetExpense = 0;
    let totalPF = 0;
    let totalESI = 0;
    let totalTax = 0;
    let totalOvertimePay = 0;
    let totalHolidayPay = 0;

    const departmentMap = {};

    publishedPayslips.forEach(ps => {
      totalGrossExpense += ps.grossSalary;
      totalNetExpense += ps.netSalary;

      const deductions = ps.deductionsJson || {};
      totalPF += (deductions.pfDeduction || 0);
      totalESI += (deductions.esiDeduction || 0);
      totalTax += (deductions.incomeTax || 0);
      totalOvertimePay += (ps.overtimePay || 0);
      totalHolidayPay += (ps.holidayPay || 0);

      const dept = ps.user?.department || 'General';
      if (!departmentMap[dept]) {
        departmentMap[dept] = { department: dept, totalEmployees: 0, totalGross: 0, totalNet: 0 };
      }
      departmentMap[dept].totalEmployees += 1;
      departmentMap[dept].totalGross += ps.grossSalary;
      departmentMap[dept].totalNet += ps.netSalary;
    });

    const departmentBreakdown = Object.values(departmentMap);

    // Monthly Trend (Last 6 Batches for selected company)
    const batchWhere = targetOrgId ? { organizationId: targetOrgId } : {};

    const recentBatches = await prisma.payrollBatch.findMany({
      where: batchWhere,
      take: 6,
      orderBy: [{ year: 'desc' }, { month: 'desc' }]
    });

    res.json({
      totalGrossExpense,
      totalNetExpense,
      totalPF,
      totalESI,
      totalTax,
      totalOvertimePay,
      totalHolidayPay,
      totalPublishedPayslips: publishedPayslips.length,
      departmentBreakdown,
      monthlyTrends: recentBatches.map(b => ({
        label: `${b.month}/${b.year}`,
        gross: b.totalGross,
        net: b.totalNet,
        status: b.status
      }))
    });
  } catch (error) {
    console.error('Get payroll reports error:', error);
    res.status(500).json({ message: 'Failed to retrieve payroll reports.' });
  }
};

module.exports = {
  getPayrollReportsSummary
};
