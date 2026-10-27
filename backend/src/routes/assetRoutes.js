const express = require('express');
const router = express.Router();
const assetController = require('../controllers/assetController');
const { authenticate, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

const upload = require('../middleware/upload');

router.use(authenticate);

// Dashboard KPI Analytics & ID Preview (requires VIEW)
router.get('/analytics', requireRole(['ADMIN', 'TEAM_LEADER', 'SUPER_ADMIN']), requirePermission('assets', 'VIEW'), assetController.getAssetAnalytics);
router.get('/next-id', requireRole(['ADMIN', 'TEAM_LEADER', 'SUPER_ADMIN']), requirePermission('assets', 'VIEW'), assetController.getNextAssetIdPreview);

// CRUD routes
router.get('/', requirePermission('assets', 'VIEW'), assetController.getAllAssets);
router.get('/:id', requirePermission('assets', 'VIEW'), assetController.getAssetById);

// Admin & Team Leader mutations (requires EDIT on assets)
router.post('/', requireRole(['ADMIN', 'TEAM_LEADER']), requirePermission('assets', 'EDIT'), upload.single('billPhoto'), assetController.createAsset);
router.put('/:id', requireRole(['ADMIN', 'TEAM_LEADER']), requirePermission('assets', 'EDIT'), upload.single('billPhoto'), assetController.updateAsset);
router.post('/:id/bill-photo', requireRole(['ADMIN', 'TEAM_LEADER']), requirePermission('assets', 'EDIT'), upload.single('billPhoto'), assetController.uploadBillPhoto);
router.delete('/:id/bill-photo', requireRole(['ADMIN', 'TEAM_LEADER']), requirePermission('assets', 'EDIT'), assetController.deleteBillPhoto);
router.post('/:id/assign', requireRole(['ADMIN', 'TEAM_LEADER']), requirePermission('assets', 'EDIT'), assetController.assignAsset);
router.post('/:id/return', requireRole(['ADMIN', 'TEAM_LEADER']), requirePermission('assets', 'EDIT'), assetController.returnAsset);
router.delete('/:id', requireRole(['ADMIN', 'TEAM_LEADER']), requirePermission('assets', 'EDIT'), assetController.deleteAsset);

module.exports = router;
