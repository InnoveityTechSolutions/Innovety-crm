const express = require('express');
const router = express.Router();
const {
  getGlobalLeavePolicy,
  updateGlobalLeavePolicy,
  createLeaveType,
  updateLeaveType,
  toggleLeaveTypeStatus,
  deleteLeaveType,
  getUserLeaveBalances,
  adjustUserLeaveBalance,
  executeAnnualReset
} = require('../controllers/leavePolicyController');
const { authenticate, requireRole } = require('../middleware/auth');

// User Leave Balance query (Accessible to authenticated users)
router.get('/balances/:userId?', authenticate, getUserLeaveBalances);

router.get('/', authenticate, requireRole(['ADMIN', 'SUPER_ADMIN']), getGlobalLeavePolicy);
router.put('/', authenticate, requireRole(['ADMIN', 'SUPER_ADMIN']), updateGlobalLeavePolicy);

// Super Admin ONLY Policy Type Management & System Reset Routes
router.use(authenticate, requireRole(['SUPER_ADMIN']));
router.post('/types', createLeaveType);
router.put('/types/:id', updateLeaveType);
router.put('/types/:id/status', toggleLeaveTypeStatus);
router.delete('/types/:id', deleteLeaveType);
router.delete('/:id', deleteLeaveType);
router.post('/adjust-balance', adjustUserLeaveBalance);
router.post('/annual-reset', executeAnnualReset);

module.exports = router;
