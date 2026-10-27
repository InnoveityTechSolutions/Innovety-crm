const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads/company-documents directory exists
const uploadDir = path.join(__dirname, '../../uploads/company-documents');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Supported file extensions and MIME types
const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const timestamp = Date.now();
    const randomHex = Math.round(Math.random() * 1e9).toString(16);
    // Safe generated filename
    cb(null, `doc_${timestamp}_${randomHex}${ext}`);
  }
});

const documentUpload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      const err = new Error('Invalid file type. Supported formats: PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG.');
      err.code = 'INVALID_FILE_TYPE';
      return cb(err, false);
    }
    cb(null, true);
  }
});

module.exports = {
  documentUpload,
  uploadDir,
  ALLOWED_EXTENSIONS
};
