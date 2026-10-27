const express = require('express');
const router = express.Router();
const meetingController = require('../controllers/meetingController');
const meetingReportController = require('../controllers/meetingReportController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');
const { ACCESS_LEVELS } = require('../config/crmModules');

// All meeting routes require authentication
router.use(authenticate);

// Core Meeting Routes
router.get('/', requirePermission('meetings', ACCESS_LEVELS.VIEW), meetingController.listMeetings);
router.post('/', requirePermission('meetings', ACCESS_LEVELS.EDIT), meetingController.createMeeting);
router.get('/:id', requirePermission('meetings', ACCESS_LEVELS.VIEW), meetingController.getMeetingById);
router.put('/:id', requirePermission('meetings', ACCESS_LEVELS.EDIT), meetingController.updateMeeting);
router.put('/:id/reschedule', requirePermission('meetings', ACCESS_LEVELS.EDIT), meetingController.rescheduleMeeting);
router.put('/:id/cancel', requirePermission('meetings', ACCESS_LEVELS.EDIT), meetingController.cancelMeeting);
router.put('/:id/complete', requirePermission('meetings', ACCESS_LEVELS.EDIT), meetingController.completeMeeting);

// Meeting Report Routes (Single report per meeting)
router.get('/:id/report', requirePermission('meetings', ACCESS_LEVELS.VIEW), meetingReportController.getReport);
router.post('/:id/report', requirePermission('meetings', ACCESS_LEVELS.EDIT), meetingReportController.saveReport);
router.put('/:id/report', requirePermission('meetings', ACCESS_LEVELS.EDIT), meetingReportController.saveReport);

module.exports = router;
