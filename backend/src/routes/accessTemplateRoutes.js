const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/superAdminMiddleware');
const accessTemplateController = require('../controllers/accessTemplateController');

// All access template endpoints are strictly protected with JWT auth and SUPER_ADMIN guard
router.use(authenticate);
router.use(requireSuperAdmin);

// 1. List available CRM modules registry for building templates
router.get('/modules', accessTemplateController.getAvailableModules);

// 2. List all templates (with optional organizationId, role, status, search filtering & member counts)
router.get('/', accessTemplateController.listTemplates);

// 3. Create a new access template transactionally
router.post('/', accessTemplateController.createTemplate);

// 4. Get a single template by ID (with permissions and member counts)
router.get('/:id', accessTemplateController.getTemplateById);

// 5. Update template details and permissions transactionally
router.put('/:id', accessTemplateController.updateTemplate);

// 6. Duplicate an existing template within the same organization
router.post('/:id/duplicate', accessTemplateController.duplicateTemplate);

// 7. Update template status (ACTIVE / INACTIVE)
router.put('/:id/status', accessTemplateController.updateTemplateStatus);

// 8. Delete a template (guarded: cannot delete if active members are assigned)
router.delete('/:id', accessTemplateController.deleteTemplate);

// 9. List assigned members of a template
router.get('/:id/members', accessTemplateController.getTemplateMembers);

// 10. Register a new user bound to a template
router.post('/:id/register-user', accessTemplateController.registerUserFromTemplate);

module.exports = router;
