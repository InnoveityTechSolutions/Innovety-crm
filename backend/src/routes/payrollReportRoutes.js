const express = require('express');
const router = express.Router();
const { getPayrollReportsSummary } = require('../controllers/payrollReportController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.get('/summary', authenticate, requirePermission('payroll_reports', 'VIEW'), getPayrollReportsSummary);

module.exports = router;
