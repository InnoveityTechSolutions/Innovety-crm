const express = require('express');
const router = express.Router();
const estimateController = require('../controllers/estimateController');
const { authenticate, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.use(authenticate);

// Settings
router.get('/settings', requireRole(['ADMIN', 'TEAM_LEADER', 'SUPER_ADMIN']), requirePermission('assets', 'VIEW'), estimateController.getBillingSettings);
router.put('/settings', requireRole(['ADMIN', 'SUPER_ADMIN']), requirePermission('assets', 'EDIT'), estimateController.updateBillingSettings);

// History Listing
router.get('/', requireRole(['ADMIN', 'TEAM_LEADER', 'SUPER_ADMIN']), requirePermission('assets', 'VIEW'), estimateController.getEstimates);

// Preview (Does not save, does not consume sequence)
router.post('/preview', requireRole(['ADMIN', 'TEAM_LEADER', 'SUPER_ADMIN']), requirePermission('assets', 'VIEW'), estimateController.previewEstimate);

// Create (Persists snapshot and consumes atomic sequence)
router.post('/', requireRole(['ADMIN', 'TEAM_LEADER', 'SUPER_ADMIN']), requirePermission('assets', 'EDIT'), estimateController.createEstimate);

// Retrieve single estimate
router.get('/:id', requireRole(['ADMIN', 'TEAM_LEADER', 'SUPER_ADMIN']), requirePermission('assets', 'VIEW'), estimateController.getEstimateById);

// Cancel estimate (ADMIN, SUPER_ADMIN only)
router.patch('/:id/cancel', requireRole(['ADMIN', 'SUPER_ADMIN']), requirePermission('assets', 'EDIT'), estimateController.cancelEstimate);

module.exports = router;
