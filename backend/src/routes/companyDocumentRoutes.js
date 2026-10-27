const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissionMiddleware');
const { documentUpload } = require('../middleware/documentUpload');
const {
  getDocuments,
  getDocumentById,
  uploadDocument,
  streamDocumentPreview,
  downloadDocument,
  deleteDocument
} = require('../controllers/companyDocumentController');

// Multer error handling wrapper
const handleUpload = (req, res, next) => {
  documentUpload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'File size exceeds the 15MB limit.' });
      }
      return res.status(400).json({ message: err.message || 'File upload failed.' });
    }
    next();
  });
};

// GET /api/company-documents (SUPER_ADMIN, ADMIN, TEAM_LEADER)
router.get('/', authenticate, requireRole(['ADMIN', 'TEAM_LEADER']), requirePermission('company_documents', 'VIEW'), getDocuments);

// POST /api/company-documents (SUPER_ADMIN, ADMIN only)
router.post('/', authenticate, requireRole(['ADMIN']), requirePermission('company_documents', 'EDIT'), handleUpload, uploadDocument);

// GET /api/company-documents/:id (SUPER_ADMIN, ADMIN, TEAM_LEADER)
router.get('/:id', authenticate, requireRole(['ADMIN', 'TEAM_LEADER']), requirePermission('company_documents', 'VIEW'), getDocumentById);

// GET /api/company-documents/:id/view (SUPER_ADMIN, ADMIN, TEAM_LEADER - inline preview)
router.get('/:id/view', authenticate, requireRole(['ADMIN', 'TEAM_LEADER']), requirePermission('company_documents', 'VIEW'), streamDocumentPreview);

// GET /api/company-documents/:id/download (SUPER_ADMIN, ADMIN, TEAM_LEADER - file download)
router.get('/:id/download', authenticate, requireRole(['ADMIN', 'TEAM_LEADER']), requirePermission('company_documents', 'VIEW'), downloadDocument);

// DELETE /api/company-documents/:id (SUPER_ADMIN, ADMIN only)
router.delete('/:id', authenticate, requireRole(['ADMIN']), requirePermission('company_documents', 'EDIT'), deleteDocument);

module.exports = router;
