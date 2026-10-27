const express = require('express');
const router = express.Router();
const {
  getAttendanceReport,
  getTaskReport,
  getTeamReport,
  getTicketReport,
  getLeaveReport,
  getPayrollReport,
  getAssetReport,
  getWorkLogReport,
  getProjectReport
} = require('../controllers/reportController');
const {
  getDailyAttendanceReport,
  getWeeklyAttendanceReport,
  getMonthlyAttendanceReport,
  exportAttendanceReport
} = require('../controllers/attendanceReportController');
const { authenticate, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

// Reports base authentication & module permission
router.use(authenticate, requireRole(['ADMIN', 'TEAM_LEADER', 'SUPER_ADMIN']), requirePermission('reports', 'VIEW'));

// Attendance Reports (Phase 4 & Phase 7: Strictly Admin & Super Admin ONLY)
router.get('/attendance/daily', requireRole(['SUPER_ADMIN', 'ADMIN']), getDailyAttendanceReport);
router.get('/attendance/weekly', requireRole(['SUPER_ADMIN', 'ADMIN']), getWeeklyAttendanceReport);
router.get('/attendance/monthly', requireRole(['SUPER_ADMIN', 'ADMIN']), getMonthlyAttendanceReport);
router.get('/attendance/export', requireRole(['SUPER_ADMIN', 'ADMIN']), exportAttendanceReport);

// General Legacy Reports
router.get('/attendance', getAttendanceReport);
router.get('/tasks', getTaskReport);
router.get('/projects', getProjectReport);
router.get('/teams', getTeamReport);
router.get('/tickets', getTicketReport);
router.get('/leaves', getLeaveReport);
router.get('/payroll', getPayrollReport);
router.get('/assets', getAssetReport);
router.get('/worklogs', getWorkLogReport);

module.exports = router;
