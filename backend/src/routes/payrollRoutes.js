const express = require('express');
const router = express.Router();
const {
  processPayrollBatch,
  getPayrollBatches,
  getPayrollBatchById,
  lockPayrollBatch,
  reviewPayrollBatch,
  publishPayrollBatch,
  rollbackPayrollBatch,
  resetPayrollData
} = require('../controllers/payrollController');
const { authenticate, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

// Status dispatcher middleware helper
const updateBatchStatusHandler = async (req, res, next) => {
  const { status } = req.body || {};
  if (status === 'LOCKED') return lockPayrollBatch(req, res, next);
  if (status === 'REVIEW') return reviewPayrollBatch(req, res, next);
  if (status === 'PUBLISHED') return publishPayrollBatch(req, res, next);
  if (status === 'ROLLED_BACK') return rollbackPayrollBatch(req, res, next);
  return lockPayrollBatch(req, res, next);
};

// 0. Reset Payroll Module Data
router.post('/reset', authenticate, requireRole(['ADMIN', 'SUPER_ADMIN']), requirePermission('payroll_process', 'EDIT'), resetPayrollData);

// 1. Process Batch Endpoints
router.post('/process', authenticate, requirePermission('payroll_process', 'EDIT'), processPayrollBatch);
router.post('/batches/process', authenticate, requirePermission('payroll_process', 'EDIT'), processPayrollBatch);
router.post('/batch/process', authenticate, requirePermission('payroll_process', 'EDIT'), processPayrollBatch);

// 2. Fetch Batches & Batch Details
router.get('/batches', authenticate, requirePermission('payroll_process', 'VIEW'), getPayrollBatches);
router.get('/batch', authenticate, requirePermission('payroll_process', 'VIEW'), getPayrollBatches);
router.get('/batches/:id', authenticate, requirePermission('payroll_process', 'VIEW'), getPayrollBatchById);
router.get('/batch/:id', authenticate, requirePermission('payroll_process', 'VIEW'), getPayrollBatchById);

// 3. Generic Status Update
router.put('/batches/:id/status', authenticate, requirePermission('payroll_process', 'EDIT'), updateBatchStatusHandler);
router.put('/batch/:id/status', authenticate, requirePermission('payroll_process', 'EDIT'), updateBatchStatusHandler);

// 4. Specific Action Routes (support both PUT and POST, singular and plural)
router.put('/batch/:id/lock', authenticate, requirePermission('payroll_process', 'EDIT'), lockPayrollBatch);
router.post('/batch/:id/lock', authenticate, requirePermission('payroll_process', 'EDIT'), lockPayrollBatch);
router.put('/batches/:id/lock', authenticate, requirePermission('payroll_process', 'EDIT'), lockPayrollBatch);
router.post('/batches/:id/lock', authenticate, requirePermission('payroll_process', 'EDIT'), lockPayrollBatch);

router.put('/batch/:id/review', authenticate, requirePermission('payroll_process', 'EDIT'), reviewPayrollBatch);
router.post('/batch/:id/review', authenticate, requirePermission('payroll_process', 'EDIT'), reviewPayrollBatch);
router.put('/batches/:id/review', authenticate, requirePermission('payroll_process', 'EDIT'), reviewPayrollBatch);
router.post('/batches/:id/review', authenticate, requirePermission('payroll_process', 'EDIT'), reviewPayrollBatch);

router.put('/batch/:id/publish', authenticate, requirePermission('payroll_process', 'EDIT'), publishPayrollBatch);
router.post('/batch/:id/publish', authenticate, requirePermission('payroll_process', 'EDIT'), publishPayrollBatch);
router.put('/batches/:id/publish', authenticate, requirePermission('payroll_process', 'EDIT'), publishPayrollBatch);
router.post('/batches/:id/publish', authenticate, requirePermission('payroll_process', 'EDIT'), publishPayrollBatch);

router.put('/batch/:id/rollback', authenticate, requirePermission('payroll_process', 'EDIT'), rollbackPayrollBatch);
router.post('/batch/:id/rollback', authenticate, requirePermission('payroll_process', 'EDIT'), rollbackPayrollBatch);
router.put('/batches/:id/rollback', authenticate, requirePermission('payroll_process', 'EDIT'), rollbackPayrollBatch);
router.post('/batches/:id/rollback', authenticate, requirePermission('payroll_process', 'EDIT'), rollbackPayrollBatch);

module.exports = router;
