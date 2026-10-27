const express = require('express');
const router = express.Router();
const {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  updateProjectWorkflowStages,
  deleteProject,
  uploadDocument,
  deleteDocument
} = require('../controllers/projectController');
const { authenticate, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');
const upload = require('../middleware/upload');

router.use(authenticate);

router.get('/', requirePermission('projects', 'VIEW'), getProjects);
router.post('/', requireRole(['ADMIN', 'SUPER_ADMIN']), requirePermission('projects', 'EDIT'), createProject);
router.get('/:id', requirePermission('projects', 'VIEW'), getProjectById);
router.put('/:id', requireRole(['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER']), requirePermission('projects', 'EDIT'), updateProject);
router.put('/:id/workflow-stages', requireRole(['ADMIN', 'SUPER_ADMIN']), requirePermission('projects', 'EDIT'), updateProjectWorkflowStages);
router.delete('/:id', requireRole(['ADMIN', 'SUPER_ADMIN']), requirePermission('projects', 'EDIT'), deleteProject);

// Project Documents
router.post('/:id/documents', requirePermission('projects', 'EDIT'), upload.single('file'), uploadDocument);
router.delete('/:id/documents/:docId', requirePermission('projects', 'EDIT'), deleteDocument);

module.exports = router;
