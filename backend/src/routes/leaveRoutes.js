const express = require('express');
const router = express.Router();
const {
  getLeaves,
  getLeaveBalances,
  applyLeave,
  updateLeave,
  approveLeaveTL,
  approveLeaveAdmin,
  rejectLeave,
  cancelLeave
} = require('../controllers/leaveController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

// View leaves and balances (requires VIEW)
router.get('/', authenticate, requirePermission('leave_management', 'VIEW'), getLeaves);
router.get('/balances', authenticate, requirePermission('leave_management', 'VIEW'), getLeaveBalances);

// Apply own leave (requires VIEW or EDIT on leave_management)
router.post('/', authenticate, requirePermission('leave_management', 'VIEW'), applyLeave);

// Edit pending leave (requires VIEW - applicants can update their own pending requests)
router.put('/:id', authenticate, requirePermission('leave_management', 'VIEW'), updateLeave);
router.put('/:id/tl-approve', authenticate, requirePermission('leave_management', 'EDIT'), approveLeaveTL);
router.put('/:id/admin-approve', authenticate, requirePermission('leave_management', 'EDIT'), approveLeaveAdmin);
router.put('/:id/reject', authenticate, requirePermission('leave_management', 'EDIT'), rejectLeave);

// User Self-Service Cancellation of pending request (requires VIEW)
router.put('/:id/cancel', authenticate, requirePermission('leave_management', 'VIEW'), cancelLeave);

// Legacy fallback router (requires EDIT)
router.put('/:id/status', authenticate, requirePermission('leave_management', 'EDIT'), (req, res, next) => {
  if (req.body.status === 'APPROVED') return approveLeaveAdmin(req, res, next);
  if (req.body.status === 'REJECTED') return rejectLeave(req, res, next);
  res.status(400).json({ message: 'Invalid status parameter.' });
});

module.exports = router;
