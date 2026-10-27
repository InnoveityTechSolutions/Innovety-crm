const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');
const {
  getExecutiveKpis,
  getExecutiveTrends,
  getHeatmap,
  getInsights,
  dismissInsight,
  getSelfService,
  getTeamPerformance,
  getDepartmentAnalytics,
  getProductivityMetrics,
  getPredictiveAlerts,
  getReport,
  exportReport
} = require('../controllers/workforceIntelligenceController');

// All intelligence routes require authentication
router.use(authenticate);

// 1. Executive Dashboard KPIs & Trends
router.get('/executive', getExecutiveKpis);
router.get('/trends', getExecutiveTrends);

// 2. Attendance Heatmap
router.get('/heatmap', getHeatmap);

// 3. AI Workforce Insights
router.get('/insights', getInsights);
router.patch('/insights/:id/dismiss', dismissInsight);

// 4. Employee Self-Service
router.get('/self-service', requirePermission('self_service', 'VIEW'), getSelfService);

// 5. Team Leader Performance
router.get('/team-performance', getTeamPerformance);

// 6. Department Performance Analytics
router.get('/departments', getDepartmentAnalytics);

// 7. Productivity Indicators
router.get('/productivity', getProductivityMetrics);

// 8. Predictive Alerts
router.get('/predictive-alerts', getPredictiveAlerts);

// 9. Advanced Report Center & Export
router.get('/reports', getReport);
router.get('/reports/export', exportReport);

module.exports = router;
