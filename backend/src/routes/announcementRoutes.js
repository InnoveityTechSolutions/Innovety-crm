const express = require('express');
const router = express.Router();
const { createAnnouncement, getAnnouncements } = require('../controllers/announcementController');
const { authenticate, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.use(authenticate);

router.get('/', requirePermission('announcements', 'VIEW'), getAnnouncements);
router.post('/', requireRole(['ADMIN', 'TEAM_LEADER']), requirePermission('announcements', 'EDIT'), createAnnouncement);

module.exports = router;
