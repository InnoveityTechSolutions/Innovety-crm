const express = require('express');
const router = express.Router();
const { getClockInStatus, clockIn, clockOut, getAttendanceLogs, updateAttendance, getAttendanceAnalytics, getAttendanceHistory, getCompanyLeaveReport, verifyLocation, getAttendanceById } = require('../controllers/attendanceController');
const { authenticate, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.use(authenticate);

// Personal Attendance self-service (requires at least VIEW on attendance)
router.get('/status', requireRole(['INTERN', 'TEAM_LEADER', 'EMPLOYEE', 'ADMIN']), requirePermission('attendance', 'VIEW'), getClockInStatus);
router.get('/today-status', requireRole(['INTERN', 'TEAM_LEADER', 'EMPLOYEE', 'ADMIN']), requirePermission('attendance', 'VIEW'), getClockInStatus);
router.post('/verify-location', requireRole(['INTERN', 'TEAM_LEADER', 'EMPLOYEE', 'ADMIN']), requirePermission('attendance', 'VIEW'), verifyLocation);
router.post('/clock-in', requireRole(['INTERN', 'TEAM_LEADER', 'EMPLOYEE']), requirePermission('attendance', 'VIEW'), clockIn);
router.post('/clock-out', requireRole(['INTERN', 'TEAM_LEADER', 'EMPLOYEE']), requirePermission('attendance', 'VIEW'), clockOut);
router.get('/logs', requirePermission('attendance', 'VIEW'), getAttendanceLogs);
router.get('/history', requirePermission('attendance', 'VIEW'), getAttendanceHistory);
router.get('/analytics', requirePermission('attendance', 'VIEW'), getAttendanceAnalytics);
router.get('/:id', requirePermission('attendance', 'VIEW'), getAttendanceById);

// Managerial Attendance Audits & Overrides (requires attendance_audit permission)
router.get('/leave-report', requireRole(['ADMIN', 'SUPER_ADMIN']), requirePermission('attendance_audit', 'VIEW'), getCompanyLeaveReport);
router.put('/:id', requireRole(['ADMIN', 'SUPER_ADMIN']), requirePermission('attendance_audit', 'EDIT'), updateAttendance);

module.exports = router;
