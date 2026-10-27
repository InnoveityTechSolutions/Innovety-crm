const path = require('path');
const fs = require('fs');
const prisma = require('../utils/db');
const { getEffectiveOrgId, getOrganizationWhere } = require('../utils/organizationScope');
const { logActivity } = require('../utils/activityLogger');
const { uploadDir } = require('../middleware/documentUpload');

const VALID_CATEGORIES = [
  'Company Documents',
  'Legal Documents',
  'Licenses & Certificates',
  'Agreements',
  'Policies',
  'HR Documents',
  'Financial Documents',
  'Other'
];

const MIME_MAP = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

// GET /api/company-documents
const getDocuments = async (req, res) => {
  try {
    const { search, category } = req.query;

    const baseWhere = getOrganizationWhere(req);
    const where = { ...baseWhere };

    if (category && category.trim() && category !== 'All Categories') {
      where.category = category.trim();
    }

    if (search && search.trim()) {
      const term = search.trim();
      where.OR = [
        { documentName: { contains: term } },
        { description: { contains: term } }
      ];
    }

    const documents = await prisma.companyDocument.findMany({
      where,
      include: {
        uploadedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.status(200).json({
      success: true,
      count: documents.length,
      documents
    });
  } catch (error) {
    console.error('Error fetching company documents:', error);
    return res.status(500).json({ message: 'Failed to retrieve company documents.' });
  }
};

// GET /api/company-documents/:id
const getDocumentById = async (req, res) => {
  try {
    const { id } = req.params;

    const document = await prisma.companyDocument.findUnique({
      where: { id },
      include: {
        uploadedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        },
        organization: {
          select: {
            id: true,
            name: true,
            companyCode: true
          }
        }
      }
    });

    if (!document) {
      return res.status(404).json({ message: 'Company document not found.' });
    }

    // Organization Isolation Check
    if (req.user.role !== 'SUPER_ADMIN' && document.organizationId !== req.user.organizationId) {
      return res.status(403).json({ message: 'Access denied: Document belongs to another organization.' });
    }

    return res.status(200).json({ success: true, document });
  } catch (error) {
    console.error('Error fetching document details:', error);
    return res.status(500).json({ message: 'Failed to retrieve document details.' });
  }
};

// POST /api/company-documents
const uploadDocument = async (req, res) => {
  const file = req.file;

  try {
    if (!file) {
      return res.status(400).json({ message: 'Document file is required.' });
    }

    const { documentName, category, description, expiryDate } = req.body;

    // Validate required fields
    if (!documentName || !documentName.trim()) {
      if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ message: 'Document Name is required.' });
    }

    if (!category || !category.trim()) {
      if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ message: 'Category is required.' });
    }

    if (!VALID_CATEGORIES.includes(category.trim())) {
      if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ message: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` });
    }

    const targetOrgId = getEffectiveOrgId(req);
    if (!targetOrgId) {
      if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ message: 'Valid organization context is required to upload documents.' });
    }

    let parsedExpiry = null;
    if (expiryDate && expiryDate.trim()) {
      const d = new Date(expiryDate);
      if (isNaN(d.getTime())) {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(400).json({ message: 'Invalid expiry date format.' });
      }
      parsedExpiry = d;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const fileType = ext ? ext.replace('.', '').toUpperCase() : 'UNKNOWN';

    const newDocument = await prisma.companyDocument.create({
      data: {
        organizationId: targetOrgId,
        documentName: documentName.trim(),
        category: category.trim(),
        description: description?.trim() || null,
        filePath: file.filename,
        originalFileName: file.originalname,
        fileType,
        fileSize: file.size,
        uploadedById: req.user.id,
        expiryDate: parsedExpiry
      },
      include: {
        uploadedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      }
    });

    await logActivity({
      userId: req.user.id,
      organizationId: targetOrgId,
      action: 'UPLOAD_COMPANY_DOCUMENT',
      details: `Uploaded company document "${newDocument.documentName}" (${newDocument.category})`,
      req
    });

    return res.status(201).json({
      success: true,
      message: 'Document uploaded successfully.',
      document: newDocument
    });
  } catch (error) {
    console.error('Error uploading company document:', error);
    if (file?.path && fs.existsSync(file.path)) {
      try { fs.unlinkSync(file.path); } catch (e) {}
    }
    return res.status(500).json({ message: 'Failed to upload document.' });
  }
};

// GET /api/company-documents/:id/view (Inline preview)
const streamDocumentPreview = async (req, res) => {
  try {
    const { id } = req.params;

    const document = await prisma.companyDocument.findUnique({
      where: { id }
    });

    if (!document) {
      return res.status(404).json({ message: 'Company document not found.' });
    }

    // Organization Isolation Check
    if (req.user.role !== 'SUPER_ADMIN' && document.organizationId !== req.user.organizationId) {
      return res.status(403).json({ message: 'Access denied: Document belongs to another organization.' });
    }

    const filename = path.basename(document.filePath);
    const resolvedPath = path.resolve(uploadDir, filename);

    // Path traversal check
    if (!resolvedPath.startsWith(uploadDir)) {
      console.warn(`[SECURITY] Path traversal attempted: ${document.filePath}`);
      return res.status(403).json({ message: 'Access denied.' });
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ message: 'Physical document file not found on server.' });
    }

    const ext = path.extname(document.originalFileName).toLowerCase();
    const contentType = MIME_MAP[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(document.originalFileName)}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    return res.sendFile(resolvedPath);
  } catch (error) {
    console.error('Error previewing company document:', error);
    return res.status(500).json({ message: 'Failed to preview document.' });
  }
};

// GET /api/company-documents/:id/download
const downloadDocument = async (req, res) => {
  try {
    const { id } = req.params;

    const document = await prisma.companyDocument.findUnique({
      where: { id }
    });

    if (!document) {
      return res.status(404).json({ message: 'Company document not found.' });
    }

    // Organization Isolation Check
    if (req.user.role !== 'SUPER_ADMIN' && document.organizationId !== req.user.organizationId) {
      return res.status(403).json({ message: 'Access denied: Document belongs to another organization.' });
    }

    const filename = path.basename(document.filePath);
    const resolvedPath = path.resolve(uploadDir, filename);

    // Path traversal check
    if (!resolvedPath.startsWith(uploadDir)) {
      console.warn(`[SECURITY] Path traversal attempted: ${document.filePath}`);
      return res.status(403).json({ message: 'Access denied.' });
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ message: 'Physical document file not found on server.' });
    }

    return res.download(resolvedPath, document.originalFileName);
  } catch (error) {
    console.error('Error downloading company document:', error);
    return res.status(500).json({ message: 'Failed to download document.' });
  }
};

// DELETE /api/company-documents/:id
const deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;

    const document = await prisma.companyDocument.findUnique({
      where: { id }
    });

    if (!document) {
      return res.status(404).json({ message: 'Company document not found.' });
    }

    // Organization Isolation Check
    if (req.user.role !== 'SUPER_ADMIN' && document.organizationId !== req.user.organizationId) {
      return res.status(403).json({ message: 'Access denied: Document belongs to another organization.' });
    }

    // Delete physical file
    const filename = path.basename(document.filePath);
    const resolvedPath = path.resolve(uploadDir, filename);

    if (resolvedPath.startsWith(uploadDir) && fs.existsSync(resolvedPath)) {
      try {
        fs.unlinkSync(resolvedPath);
      } catch (fileErr) {
        console.warn('Could not unlink physical file:', fileErr.message);
      }
    }

    // Delete database record
    await prisma.companyDocument.delete({
      where: { id }
    });

    await logActivity({
      userId: req.user.id,
      organizationId: document.organizationId,
      action: 'DELETE_COMPANY_DOCUMENT',
      details: `Deleted company document "${document.documentName}" (${document.originalFileName})`,
      req
    });

    return res.status(200).json({
      success: true,
      message: 'Document deleted successfully.'
    });
  } catch (error) {
    console.error('Error deleting company document:', error);
    return res.status(500).json({ message: 'Failed to delete document.' });
  }
};

module.exports = {
  getDocuments,
  getDocumentById,
  uploadDocument,
  streamDocumentPreview,
  downloadDocument,
  deleteDocument,
  VALID_CATEGORIES
};
