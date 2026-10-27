const express = require('express');
const router = express.Router();
const { createTeam, getAllTeams, getTeamDetails, editTeam, deleteTeam, assignMembers } = require('../controllers/teamController');
const { authenticate, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.use(authenticate);

// View-only endpoints accessible by any authenticated user (requires VIEW on teams_hub)
router.get('/', requirePermission('teams_hub', 'VIEW'), getAllTeams);
router.get('/:id', requirePermission('teams_hub', 'VIEW'), getTeamDetails);

// Modifying endpoints restricted to Admin role (requires EDIT on teams_hub)
router.post('/', requireRole(['ADMIN']), requirePermission('teams_hub', 'EDIT'), createTeam);
router.put('/:id', requireRole(['ADMIN']), requirePermission('teams_hub', 'EDIT'), editTeam);
router.delete('/:id', requireRole(['ADMIN']), requirePermission('teams_hub', 'EDIT'), deleteTeam);
router.put('/:id/members', requireRole(['ADMIN']), requirePermission('teams_hub', 'EDIT'), assignMembers);

module.exports = router;
