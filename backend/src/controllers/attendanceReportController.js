const { getEffectiveOrgId } = require('../utils/organizationScope');
const {
  getDailyAttendanceData,
  getWeeklyAttendanceData,
  getMonthlyAttendanceData,
  generateExcelReport
} = require('../services/attendanceReportService');

const getDailyAttendanceReport = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const { date, teamId, role, employeeName, status } = req.query;

    const data = await getDailyAttendanceData({
      organizationId,
      date,
      teamId,
      role,
      employeeName,
      status
    });

    return res.json({
      success: true,
      ...data
    });
  } catch (error) {
    console.error('Get daily attendance report error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch daily attendance report.'
    });
  }
};

const getWeeklyAttendanceReport = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const { week, year, date, teamId, role, employeeName, status, userIds } = req.query;

    const data = await getWeeklyAttendanceData({
      organizationId,
      week,
      year,
      date,
      teamId,
      role,
      employeeName,
      status,
      userIds
    });

    return res.json({
      success: true,
      ...data
    });
  } catch (error) {
    console.error('Get weekly attendance report error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch weekly attendance report.'
    });
  }
};

const getMonthlyAttendanceReport = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const { month, year, teamId, role, employeeName, status, userIds } = req.query;

    const data = await getMonthlyAttendanceData({
      organizationId,
      month,
      year,
      teamId,
      role,
      employeeName,
      status,
      userIds
    });

    return res.json({
      success: true,
      ...data
    });
  } catch (error) {
    console.error('Get monthly attendance report error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch monthly attendance report.'
    });
  }
};

const exportAttendanceReport = async (req, res) => {
  try {
    const organizationId = getEffectiveOrgId(req);
    const { type = 'daily' } = req.query;

    const validTypes = ['daily', 'weekly', 'monthly'];
    const normalizedType = String(type).toLowerCase();
    if (!validTypes.includes(normalizedType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid report type. Supported types: daily, weekly, monthly'
      });
    }

    const { workbook, filename } = await generateExcelReport({
      type: normalizedType,
      organizationId,
      params: req.query
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export attendance report error:', error);
    const isUserError = error.message && error.message.includes('Please select');
    return res.status(isUserError ? 400 : 500).json({
      success: false,
      message: error.message || 'Failed to export attendance report to Excel.'
    });
  }
};

module.exports = {
  getDailyAttendanceReport,
  getWeeklyAttendanceReport,
  getMonthlyAttendanceReport,
  exportAttendanceReport
};
