const express = require('express');
const router = express.Router();
const { getPayrollSettings, updatePayrollSettings } = require('../controllers/payrollSettingsController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.get('/', authenticate, requirePermission('payroll_settings', 'VIEW'), getPayrollSettings);
router.put('/', authenticate, requirePermission('payroll_settings', 'EDIT'), updatePayrollSettings);

module.exports = router;
