const express = require('express');
const router = express.Router();
const { getPayslips, getPayslipById, emailPayslip } = require('../controllers/payslipController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.get('/', authenticate, requirePermission(['payroll_payslips', 'my_payroll'], 'VIEW'), getPayslips);
router.get('/:id', authenticate, requirePermission(['payroll_payslips', 'my_payroll'], 'VIEW'), getPayslipById);
router.post('/:id/email', authenticate, requirePermission('payroll_payslips', 'EDIT'), emailPayslip);

module.exports = router;
