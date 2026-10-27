const express = require('express');
const router = express.Router();
const {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate
} = require('../controllers/salaryTemplateController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.get('/', authenticate, requirePermission('payroll_templates', 'VIEW'), getTemplates);
router.post('/', authenticate, requirePermission('payroll_templates', 'EDIT'), createTemplate);
router.put('/:id', authenticate, requirePermission('payroll_templates', 'EDIT'), updateTemplate);
router.delete('/:id', authenticate, requirePermission('payroll_templates', 'EDIT'), deleteTemplate);

module.exports = router;
