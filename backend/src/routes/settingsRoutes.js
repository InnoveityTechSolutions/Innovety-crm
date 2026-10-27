const express = require('express');
const router = express.Router();
const { getSettings, updateSettings } = require('../controllers/settingsController');
const { authenticate, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.use(authenticate);

router.get('/', requirePermission('site_settings', 'VIEW'), getSettings);
router.put('/', requireRole(['ADMIN', 'SUPER_ADMIN']), requirePermission('site_settings', 'EDIT'), updateSettings);

module.exports = router;
