const express = require('express');
const router = express.Router();
const { getTeamPerformance, getDashboardOverview } = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.use(authenticate);

// GET /api/dashboard/overview
router.get('/overview', requirePermission('dashboard', 'VIEW'), getDashboardOverview);

// GET /api/dashboard/team-performance
router.get('/team-performance', requirePermission('dashboard', 'VIEW'), getTeamPerformance);

module.exports = router;