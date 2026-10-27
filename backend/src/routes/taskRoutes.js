const express = require('express');
const router = express.Router();
const { createTask, getTasks, getTaskById, updateTaskStatus, submitTask, addComment, updateTask, createSubtask, toggleSubtask, deleteSubtask, deleteTask } = require('../controllers/taskController');
const { submitForReview, approveTask, rejectTask, retryTask, getTaskReviewHistory } = require('../controllers/taskReviewController');
const { authenticate, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');
const upload = require('../middleware/upload');

router.use(authenticate);

// View tasks (requires VIEW on tasks)
router.get('/', requirePermission('tasks', 'VIEW'), getTasks);
router.get('/:id', requirePermission('tasks', 'VIEW'), getTaskById);

// Task creation, full update, and deletion (requires EDIT on tasks)
router.post('/', requireRole(['ADMIN', 'TEAM_LEADER']), requirePermission('tasks', 'EDIT'), upload.array('attachments', 5), createTask);
router.put('/:id', requireRole(['ADMIN', 'TEAM_LEADER']), requirePermission('tasks', 'EDIT'), upload.array('attachments', 5), updateTask);
router.delete('/:id', requireRole(['ADMIN', 'TEAM_LEADER']), requirePermission('tasks', 'EDIT'), deleteTask);

// Assignee task interactions (requires VIEW on tasks)
router.put('/:id/status', requirePermission('tasks', 'VIEW'), updateTaskStatus);
router.post('/:id/submit', requireRole(['INTERN', 'EMPLOYEE']), requirePermission('tasks', 'VIEW'), upload.array('files', 5), submitTask);
router.post('/:id/comment', requirePermission('tasks', 'VIEW'), addComment);

// Task Review Workflow Routes
router.post('/:id/submit-review', requirePermission('tasks', 'VIEW'), submitForReview);
router.post('/:id/approve', requireRole(['ADMIN', 'TEAM_LEADER']), requirePermission('tasks', 'EDIT'), approveTask);
router.post('/:id/reject', requireRole(['ADMIN', 'TEAM_LEADER']), requirePermission('tasks', 'EDIT'), rejectTask);
router.post('/:id/retry', requirePermission('tasks', 'VIEW'), retryTask);
router.get('/:id/review-history', requirePermission('tasks', 'VIEW'), getTaskReviewHistory);

// Subtasks routes
router.post('/:id/subtasks', requirePermission('tasks', 'EDIT'), createSubtask);
router.put('/subtasks/:subtaskId', requirePermission('tasks', 'VIEW'), toggleSubtask);
router.delete('/subtasks/:subtaskId', requirePermission('tasks', 'EDIT'), deleteSubtask);

module.exports = router;
