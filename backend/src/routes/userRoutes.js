const express = require('express');
const router = express.Router();
const {
  createUser,
  getAllUsers,
  getUserById,
  editUser,
  deleteUser,
  toggleUserStatus,
  resetUserPassword,
  bulkImport,
  bulkDelete,
  bulkUpdateAutoClockOut,
  promoteUser,
  getUserPromotionHistory,
  removeProfilePicture,
  completeWelcomePopup,
  resetWelcomePopup
} = require('../controllers/userController');
const { authenticate, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');

const userUpload = upload.fields([
  { name: 'profilePic', maxCount: 1 },
  { name: 'resume', maxCount: 1 }
]);

// Self / Authenticated User Routes (Welcome complete)
router.post('/me/welcome-complete', authenticate, completeWelcomePopup);
router.post('/welcome-complete', authenticate, completeWelcomePopup);

// Dedicated authenticated user profile endpoints (strictly placed BEFORE /:id to prevent route shadowing)
router.get('/profile', authenticate, (req, res) => {
  req.params.id = req.user.id;
  return getUserById(req, res);
});
router.put('/profile', authenticate, userUpload, (req, res) => {
  req.params.id = req.user.id;
  return editUser(req, res);
});

// GET /api/users and GET /api/users/:id allowed for authenticated users
router.get('/', authenticate, requireRole(['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER', 'INTERN', 'EMPLOYEE']), getAllUsers);
router.get('/:id/promotion-history', authenticate, getUserPromotionHistory);
router.get('/:id', authenticate, requireRole(['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER', 'INTERN', 'EMPLOYEE']), getUserById);
router.delete('/profile-photo', authenticate, removeProfilePicture);
router.delete('/profile/picture', authenticate, removeProfilePicture);

const { requirePermission } = require('../middleware/permissionMiddleware');

// All user creation, modification, promotion, and deletion routes strictly require ADMIN or SUPER_ADMIN privilege AND user_management EDIT permission
router.use(authenticate, requireRole(['ADMIN', 'SUPER_ADMIN']), requirePermission('user_management', 'EDIT'));

router.post('/me/welcome-complete', completeWelcomePopup);
router.post('/:id/reset-welcome', resetWelcomePopup);
router.post('/', userUpload, createUser);
router.post('/:id/promote', promoteUser);
router.put('/:id', userUpload, editUser);
router.delete('/:id', deleteUser);
router.delete('/:id/profile-picture', removeProfilePicture);
router.delete('/:id/profile-photo', removeProfilePicture);
router.put('/:id/status', toggleUserStatus);
router.put('/:id/reset-password', resetUserPassword);
router.post('/bulk-import', bulkImport);
router.post('/bulk-delete', bulkDelete);
router.post('/bulk-auto-clock-out', bulkUpdateAutoClockOut);

module.exports = router;
