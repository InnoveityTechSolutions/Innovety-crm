const express = require('express');
const router = express.Router();
const {
  getAttendanceLocations,
  getAttendanceLocationById,
  createAttendanceLocation,
  updateAttendanceLocation,
  deleteAttendanceLocation,
  getLocationMembers,
  updateLocationMembers,
  getUserLocations,
  updateUserLocations
} = require('../controllers/attendanceLocationController');
const { authenticate, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.use(authenticate);

// Public within org: all authenticated roles can read locations (for assignment checks / listings)
router.get('/', getAttendanceLocations);
router.get('/user/:userId', getUserLocations);
router.get('/:id', getAttendanceLocationById);
router.get('/:id/members', requireRole(['ADMIN', 'SUPER_ADMIN']), getLocationMembers);

// Admin & Super Admin write actions (requires EDIT on site_settings)
router.post('/', requireRole(['ADMIN', 'SUPER_ADMIN']), requirePermission('site_settings', 'EDIT'), createAttendanceLocation);
router.put('/:id', requireRole(['ADMIN', 'SUPER_ADMIN']), requirePermission('site_settings', 'EDIT'), updateAttendanceLocation);
router.delete('/:id', requireRole(['ADMIN', 'SUPER_ADMIN']), requirePermission('site_settings', 'EDIT'), deleteAttendanceLocation);

// Member assignment routes
router.post('/:id/members', requireRole(['ADMIN', 'SUPER_ADMIN']), requirePermission('site_settings', 'EDIT'), updateLocationMembers);
router.post('/user/:userId', requireRole(['ADMIN', 'SUPER_ADMIN']), requirePermission('site_settings', 'EDIT'), updateUserLocations);

module.exports = router;
