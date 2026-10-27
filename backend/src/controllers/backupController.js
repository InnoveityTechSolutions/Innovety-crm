const {
  takeLiveBackup,
  getBackupHistory,
  getBackupFilePath,
  deleteBackup,
  listAllBackups,
  createFullBackup,
  verifyBackupIntegrity
} = require('../services/backupService');
const { dryRunRestore, executeConfirmedRestore } = require('../services/restoreService');
const { enqueueJob } = require('../services/jobQueueService');

/**
 * GET /api/backups
 * Returns list of latest 20 production backups
 */
const getBackupsList = async (req, res, next) => {
  try {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Unauthorized. Super Admin access required.' });
    }
    const backups = getBackupHistory();
    res.json({
      success: true,
      count: backups.length,
      data: backups
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/backups/live
 * Takes a full live MySQL production backup
 */
const takeLiveBackupAction = async (req, res, next) => {
  try {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Unauthorized. Only Super Admin can create production backups.' });
    }
    const result = await takeLiveBackup({ user: req.user });
    res.json({
      success: true,
      message: 'Live Backup Created Successfully',
      backup: result.backup,
      validation: result.validation
    });
  } catch (error) {
    console.error('[BackupController] Live backup failed:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to create live backup.',
      validation: error.validation || null,
      errors: error.validation?.errors || [error.message]
    });
  }
};

/**
 * GET /api/backups/download/:filename
 * Securely stream and download a backup ZIP
 */
const downloadBackupAction = async (req, res, next) => {
  try {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Unauthorized. Super Admin access required.' });
    }
    const { filename } = req.params;
    const filePath = getBackupFilePath(filename);
    res.download(filePath, filename, (err) => {
      if (err && !res.headersSent) {
        console.error('[BackupController] Error downloading backup:', err);
        res.status(500).json({ success: false, message: 'Failed to download backup file.' });
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/backups/:filename
 * Remove a historical backup
 */
const deleteBackupAction = async (req, res, next) => {
  try {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Unauthorized. Super Admin access required.' });
    }
    const { filename } = req.params;
    deleteBackup(filename);
    res.json({
      success: true,
      message: `Backup ${filename} deleted successfully.`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/backups/trigger (Legacy job-queue trigger)
 */
const triggerBackup = async (req, res, next) => {
  try {
    const job = enqueueJob('BACKUP', { type: 'MANUAL' }, async (payload, updateProgress) => {
      updateProgress(30);
      const manifest = await takeLiveBackup({ user: req.user });
      updateProgress(100);
      return manifest;
    });

    res.json({
      success: true,
      message: 'Backup creation job enqueued successfully.',
      jobId: job.id
    });
  } catch (error) {
    next(error);
  }
};

const {
  validateUploadedBackup,
  executeLiveRestore,
  validateUploadedSql,
  executeSqlImport
} = require('../services/restoreService');

/**
 * POST /api/backups/restore/validate
 * Validates uploaded backup ZIP and returns preview information
 */
const validateUploadedBackupAction = async (req, res, next) => {
  try {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Unauthorized. Super Admin access required.' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Invalid Backup File: No ZIP file was uploaded.' });
    }

    const validation = await validateUploadedBackup(req.file.path, req.file.originalname);
    if (!validation.valid) {
      // Clean up uploaded file if invalid
      const fs = require('fs');
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(422).json({
        success: false,
        message: 'Invalid Backup File',
        errors: validation.errors,
        warnings: validation.warnings
      });
    }

    res.json({
      success: true,
      message: 'Backup Validated Successfully',
      backupInfo: validation.backupInfo,
      tempFileName: req.file.filename,
      originalFileName: req.file.originalname
    });
  } catch (error) {
    const fs = require('fs');
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    console.error('[BackupController] Restore validation failed:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to validate uploaded backup.'
    });
  }
};

/**
 * POST /api/backups/restore/execute
 * Executes full disaster recovery restoration
 */
const executeRestoreAction = async (req, res, next) => {
  try {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Unauthorized. Super Admin access required.' });
    }

    const { tempFileName, originalFileName, targetDatabase, promoteToActive } = req.body;
    if (!tempFileName) {
      return res.status(400).json({ success: false, message: 'tempFileName is required to execute restore.' });
    }

    const result = await executeLiveRestore({
      tempFileName,
      originalFileName,
      user: req.user,
      targetDatabase,
      promoteToActive
    });

    res.json(result);
  } catch (error) {
    console.error('[BackupController] Restore execution failed:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to restore backup.',
      verification: error.verification || null,
      safetyBackup: error.safetyBackup || null
    });
  }
};

/**
 * POST /api/backups/import-sql/validate
 * Validates uploaded .sql file and returns preview information
 */
const validateUploadedSqlAction = async (req, res, next) => {
  try {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Unauthorized. Super Admin access required.' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Invalid SQL File: No file was uploaded.' });
    }

    const validation = await validateUploadedSql(req.file.path, req.file.originalname);
    if (!validation.valid) {
      const fs = require('fs');
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(422).json({
        success: false,
        message: 'Invalid SQL File',
        errors: validation.errors
      });
    }

    res.json({
      success: true,
      message: 'SQL File Validated Successfully',
      sqlInfo: validation.sqlInfo,
      tempFileName: req.file.filename,
      originalFileName: req.file.originalname
    });
  } catch (error) {
    const fs = require('fs');
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    console.error('[BackupController] SQL validation failed:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to validate SQL file.'
    });
  }
};

/**
 * POST /api/backups/import-sql/execute
 * Executes full confirmed SQL import with pre-import safety backup
 */
const executeSqlImportAction = async (req, res, next) => {
  try {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Unauthorized. Super Admin access required.' });
    }

    const { tempFileName, originalFileName } = req.body;
    if (!tempFileName) {
      return res.status(400).json({ success: false, message: 'tempFileName is required to execute SQL import.' });
    }

    const result = await executeSqlImport({
      tempFileName,
      originalFileName,
      user: req.user
    });

    res.json(result);
  } catch (error) {
    console.error('[BackupController] SQL import failed:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to import SQL backup.',
      verification: error.verification || null,
      safetyBackup: error.safetyBackup || null
    });
  }
};

/**
 * POST /api/backups/restore/dry-run (Legacy)
 */
const dryRunRestoreAction = async (req, res, next) => {
  try {
    const { backupId } = req.body;
    if (!backupId) {
      return res.status(400).json({ success: false, message: 'backupId is required.' });
    }
    res.json({ success: true, message: 'Dry run deprecated, use /restore/validate' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/backups/restore/confirm (Legacy)
 */
const confirmRestoreAction = async (req, res, next) => {
  try {
    const { backupId } = req.body;
    if (!backupId) {
      return res.status(400).json({ success: false, message: 'backupId is required.' });
    }
    res.json({ success: true, message: 'Confirm restore deprecated, use /restore/execute' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getBackupsList,
  takeLiveBackupAction,
  downloadBackupAction,
  deleteBackupAction,
  triggerBackup,
  dryRunRestoreAction,
  confirmRestoreAction,
  validateUploadedBackupAction,
  executeRestoreAction,
  validateUploadedSqlAction,
  executeSqlImportAction
};
