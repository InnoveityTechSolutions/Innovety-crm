const express = require('express');
const router = express.Router();
const {
  getSalaryStructure,
  getAllSalaryStructures,
  saveSalaryStructure,
  getSalaryRevisions,
  bulkAssignSalaryStructures
} = require('../controllers/salaryStructureController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.get('/all', authenticate, requirePermission('payroll_structures', 'VIEW'), getAllSalaryStructures);
router.get('/user/:userId', authenticate, requirePermission('payroll_structures', 'VIEW'), getSalaryStructure);
router.get('/my', authenticate, requirePermission(['my_payroll', 'payroll_structures'], 'VIEW'), (req, res, next) => {
  req.params.userId = req.user.id;
  return getSalaryStructure(req, res, next);
});
router.get('/revisions/:userId', authenticate, requirePermission('payroll_structures', 'VIEW'), getSalaryRevisions);
router.post('/save', authenticate, requirePermission('payroll_structures', 'EDIT'), saveSalaryStructure);
router.post('/bulk-save', authenticate, requirePermission('payroll_structures', 'EDIT'), bulkAssignSalaryStructures);

module.exports = router;
