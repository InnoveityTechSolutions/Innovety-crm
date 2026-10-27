const express = require('express');
const router = express.Router();
const {
  getEligibleWorkEvidence,
  authorizeCompOffCredit,
  adminApproveCompOffCredit,
  rejectCompOffCredit,
  getCompOffCredits,
  getCompOffCreditById,
  estimateCompOffConsumption,
  getCompOffPolicy,
  updateCompOffPolicy,
  getEligibleFutureDatesEndpoint,
  createCompOffPermissionRequestEndpoint,
  getCompOffPermissionRequestsEndpoint,
  approveCompOffPermissionRequestEndpoint,
  rejectCompOffPermissionRequestEndpoint,
  getTodayCompOffStatusEndpoint,
  startCompOffSessionEndpoint,
  endCompOffSessionEndpoint,
  getCompOffSessionsEndpoint,
  approveCompOffSessionEndpoint,
  rejectCompOffSessionEndpoint
} = require('../controllers/compOffController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

// 1. Evidence and diagnostics (VIEW permission on leave_management)
router.get('/evidence', authenticate, requirePermission('leave_management', 'VIEW'), getEligibleWorkEvidence);

// 2. Verification and authorization submission (EDIT permission on leave_management)
router.post('/authorize', authenticate, requirePermission('leave_management', 'EDIT'), authorizeCompOffCredit);

// 3. Managerial approval and rejection actions (EDIT permission on leave_management)
router.put('/credits/:id/admin-approve', authenticate, requirePermission('leave_management', 'EDIT'), adminApproveCompOffCredit);
router.put('/credits/:id/reject', authenticate, requirePermission('leave_management', 'EDIT'), rejectCompOffCredit);

// 4. Listing and viewing credit details (VIEW permission on leave_management)
router.get('/credits', authenticate, requirePermission('leave_management', 'VIEW'), getCompOffCredits);
router.get('/credits/:id', authenticate, requirePermission('leave_management', 'VIEW'), getCompOffCreditById);

// 5. Estimated FIFO credit consumption preview (VIEW permission on leave_management)
router.get('/estimate-consumption', authenticate, requirePermission('leave_management', 'VIEW'), estimateCompOffConsumption);

// 6. Configurable Comp-Off Policy Settings (Retrospective claim window & validity)
router.get('/policy', authenticate, requirePermission('leave_management', 'VIEW'), getCompOffPolicy);
router.put('/policy', authenticate, requirePermission('leave_management', 'EDIT'), updateCompOffPolicy);

// 7. Advance Permission Requests Workflow
router.get('/eligible-future-dates', authenticate, requirePermission('leave_management', 'VIEW'), getEligibleFutureDatesEndpoint);
router.get('/permission-requests', authenticate, requirePermission('leave_management', 'VIEW'), getCompOffPermissionRequestsEndpoint);
router.post('/permission-requests', authenticate, requirePermission('leave_management', 'VIEW'), createCompOffPermissionRequestEndpoint);
router.put('/permission-requests/:id/approve', authenticate, requirePermission('leave_management', 'EDIT'), approveCompOffPermissionRequestEndpoint);
router.put('/permission-requests/:id/reject', authenticate, requirePermission('leave_management', 'EDIT'), rejectCompOffPermissionRequestEndpoint);

// 8. Comp-Off Dedicated Working Session Workflow (Phase 2 & 3)
router.get('/sessions/today-status', authenticate, getTodayCompOffStatusEndpoint);
router.post('/sessions/login', authenticate, startCompOffSessionEndpoint);
router.post('/sessions/clock-out', authenticate, endCompOffSessionEndpoint);
router.get('/sessions', authenticate, requirePermission('leave_management', 'VIEW'), getCompOffSessionsEndpoint);
router.post('/sessions/:id/approve', authenticate, requirePermission('leave_management', 'EDIT'), approveCompOffSessionEndpoint);
router.post('/sessions/:id/reject', authenticate, requirePermission('leave_management', 'EDIT'), rejectCompOffSessionEndpoint);

module.exports = router;

