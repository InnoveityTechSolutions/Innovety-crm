const express = require('express');
const router = express.Router();
const { getActivityLogs } = require('../controllers/logController');
const { authenticate, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.use(authenticate);

router.get('/', requirePermission('audit_logs', 'VIEW'), getActivityLogs);

module.exports = router;
