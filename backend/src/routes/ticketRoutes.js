const express = require('express');
const router = express.Router();
const { createTicket, getTickets, updateTicketStatus, deleteTicket } = require('../controllers/ticketController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.use(authenticate);

// View tickets and raise new ticket (requires VIEW on tickets)
router.get('/', requirePermission('tickets', 'VIEW'), getTickets);
router.post('/', requirePermission('tickets', 'VIEW'), createTicket);

// Manage ticket status and deletion (requires EDIT on tickets)
router.put('/:id', requirePermission('tickets', 'EDIT'), updateTicketStatus);
router.delete('/:id', requirePermission('tickets', 'EDIT'), deleteTicket);

module.exports = router;
