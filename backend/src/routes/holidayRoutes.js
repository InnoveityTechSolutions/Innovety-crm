const express = require('express');
const router = express.Router();
const { getHolidays, addHoliday, deleteHoliday } = require('../controllers/holidayController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.get('/', authenticate, requirePermission('payroll_holidays', 'VIEW'), getHolidays);
router.post('/', authenticate, requirePermission('payroll_holidays', 'EDIT'), addHoliday);
router.delete('/:id', authenticate, requirePermission('payroll_holidays', 'EDIT'), deleteHoliday);

module.exports = router;
