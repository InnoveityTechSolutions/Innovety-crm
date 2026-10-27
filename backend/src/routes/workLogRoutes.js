const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');
const upload = require('../middleware/upload');
const {
  createWorkLog,
  updateWorkLog,
  deleteWorkLog,
  getWorkLogs,
  getAdminWorkLogs,
  getTodayStatus,
  uploadAttachment
} = require('../controllers/workLogController');

router.use(authenticate);

// Admin review dashboard route
router.get('/admin', requirePermission('worklogs', 'VIEW'), getAdminWorkLogs);

// Today's work log status & auto hours calculation
router.get('/today-status', requirePermission('worklogs', 'VIEW'), getTodayStatus);

// List my work logs with metrics
router.get('/', requirePermission('worklogs', 'VIEW'), getWorkLogs);

// Create work log (requires EDIT on worklogs)
router.post('/', requirePermission('worklogs', 'EDIT'), createWorkLog);

// Upload attachment for work log
router.post('/upload-attachment', requirePermission('worklogs', 'EDIT'), upload.single('file'), uploadAttachment);
router.post('/:workLogId/attachments', requirePermission('worklogs', 'EDIT'), upload.single('file'), uploadAttachment);

// Update work log
router.put('/:id', requirePermission('worklogs', 'EDIT'), updateWorkLog);

// Delete work log
router.delete('/:id', requirePermission('worklogs', 'EDIT'), deleteWorkLog);

module.exports = router;
