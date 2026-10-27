const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');
const {
  getCalendar,
  createOverride,
  updateOverride,
  deleteOverride
} = require('../controllers/workCalendarController');

// All authenticated roles can view the calendar (requires VIEW on work_calendar)
router.get('/', authenticate, requirePermission('work_calendar', 'VIEW'), getCalendar);

// ADMIN and SUPER_ADMIN can create, update, or delete calendar overrides (requires EDIT on work_calendar)
router.post('/', authenticate, requireRole(['ADMIN', 'SUPER_ADMIN']), requirePermission('work_calendar', 'EDIT'), createOverride);
router.put('/:id', authenticate, requireRole(['ADMIN', 'SUPER_ADMIN']), requirePermission('work_calendar', 'EDIT'), updateOverride);
router.delete('/:id', authenticate, requireRole(['ADMIN', 'SUPER_ADMIN']), requirePermission('work_calendar', 'EDIT'), deleteOverride);

module.exports = router;
