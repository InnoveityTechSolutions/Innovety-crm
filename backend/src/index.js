require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const socketManager = require('./socket');

// Route modules
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const teamRoutes = require('./routes/teamRoutes');
const taskRoutes = require('./routes/taskRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const announcementRoutes = require('./routes/announcementRoutes');
const reportRoutes = require('./routes/reportRoutes');
const logRoutes = require('./routes/logRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const leaveRoutes = require('./routes/leaveRoutes');
const assetRoutes = require('./routes/assetRoutes');
const chatRoutes = require('./routes/chatRoutes');
const projectRoutes = require('./routes/projectRoutes');
const milestoneRoutes = require('./routes/milestoneRoutes');
const taskDependencyRoutes = require('./routes/taskDependencyRoutes');
const workLogRoutes = require('./routes/workLogRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const meetingRoutes = require('./routes/meetingRoutes');


// Payroll Route modules
const salaryTemplateRoutes = require('./routes/salaryTemplateRoutes');
const salaryStructureRoutes = require('./routes/salaryStructureRoutes');
const holidayRoutes = require('./routes/holidayRoutes');
const payrollSettingsRoutes = require('./routes/payrollSettingsRoutes');
const payrollRoutes = require('./routes/payrollRoutes');
const payslipRoutes = require('./routes/payslipRoutes');
const payrollReportRoutes = require('./routes/payrollReportRoutes');

const app = express();
const server = http.createServer(app);

// Phase 10: Security Middleware Suite & Error Tracking
const {
  securityHeaders,
  globalRateLimiter,
  verifyTokenNotRevoked,
  payloadSanitizer
} = require('./middleware/securityMiddleware');
const { trackError } = require('./services/errorTrackingService');
const systemRoutes = require('./routes/systemRoutes');

// Apply Helmet-style security headers
app.use(securityHeaders);

// Process-wide Uncaught Exception & Rejection Handlers
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRITICAL UNHANDLED REJECTION]', reason);
});

// Robust Production & Development CORS Configuration
const { corsOptions } = require('./utils/corsConfig');

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Phase 10: Global Sliding-Window Rate Limiting, Sanitization & Token Revocation
app.use(globalRateLimiter);
app.use(payloadSanitizer);
app.use(verifyTokenNotRevoked);

// Production Diagnostic Request Logging Middleware (Phase 8)
app.use((req, res, next) => {
  console.log(`[HTTP ${req.method}] ${req.originalUrl} | Origin: ${req.headers.origin || 'direct'} | Time: ${new Date().toISOString()}`);
  next();
});

const fs = require('fs');
const { authenticate } = require('./middleware/auth');

// Serve static upload directories with headers (supports both /uploads and /api/uploads for Nginx reverse proxies)
app.use(['/uploads', '/api/uploads'], express.static(path.join(__dirname, '../uploads'), {
  setHeaders: (res, filePath) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
  }
}));

// Dedicated file download endpoint with proper MIME headers & Content-Disposition
app.get('/api/download-file', authenticate, (req, res) => {
  try {
    const rawFile = req.query.file || req.query.filename;
    if (!rawFile) {
      return res.status(400).json({ message: 'File parameter is required.' });
    }

    // Decode URL parameter
    let fileRelPath = decodeURIComponent(rawFile).trim();

    if (fileRelPath.startsWith('http://') || fileRelPath.startsWith('https://')) {
      try {
        fileRelPath = new URL(fileRelPath).pathname;
      } catch (e) { }
    }

    // Normalization & leading slash cleanup
    if (fileRelPath.startsWith('/') || fileRelPath.startsWith('\\')) {
      fileRelPath = fileRelPath.substring(1);
    }

    // Strip optional leading 'api/uploads/' or 'uploads/' prefix
    let targetRelPath = fileRelPath;
    if (/^(api[/\\])?uploads[/\\]/i.test(targetRelPath)) {
      targetRelPath = targetRelPath.replace(/^(api[/\\])?uploads[/\\]/i, '');
    }

    const uploadsDir = path.resolve(__dirname, '../uploads');
    const resolvedPath = path.resolve(uploadsDir, targetRelPath);

    // SECURITY CHECK: Path Traversal Prevention
    if (!resolvedPath.startsWith(uploadsDir)) {
      console.warn(`[SECURITY] Path traversal blocked for: ${rawFile}`);
      return res.status(403).json({ message: 'Access denied.' });
    }

    if (!fs.existsSync(resolvedPath)) {
      console.warn(`File download failed - physical file not found at: ${resolvedPath}`);
      return res.status(404).json({ message: 'File not found on server.' });
    }

    // Use custom download name from query if provided, otherwise fallback to physical basename
    const customName = req.query.name || req.query.originalFileName || path.basename(resolvedPath);

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(customName)}"; filename*=UTF-8''${encodeURIComponent(customName)}`);

    res.download(resolvedPath, customName, (err) => {
      if (err && !res.headersSent) {
        console.error('File download stream error:', err);
        res.status(500).json({ message: 'Error downloading file.' });
      }
    });
  } catch (error) {
    console.error('Download route exception:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

const superAdminRoutes = require('./routes/superAdminRoutes');
const platformBuilderRoutes = require('./routes/platformBuilderRoutes');
const accessTemplateRoutes = require('./routes/accessTemplateRoutes');

app.use('/api/super-admin/access-templates', accessTemplateRoutes);
app.use('/api/super-admin/platform-builder', platformBuilderRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.get('/api/platform/settings', async (req, res) => {
  try {
    const prisma = require('./utils/db');
    const { organizationId } = req.query;

    let platform = await prisma.platformSettings.findUnique({ where: { id: 'PLATFORM' } }).catch(() => null);
    if (!platform) {
      platform = await prisma.platformSettings.create({
        data: { id: 'PLATFORM', companyName: 'Innoviety Enterprise', selectedTheme: 'emerald', themeMode: 'light', chatEnabledForAdmins: true, chatEnabledForUsers: true }
      }).catch(() => null);
    }

    const platformObj = {
      chatEnabledForAdmins: platform?.chatEnabledForAdmins ?? true,
      chatEnabledForUsers: platform?.chatEnabledForUsers ?? true,
      adminChatEnabled: platform?.chatEnabledForAdmins ?? true,
      userChatEnabled: platform?.chatEnabledForUsers ?? true
    };

    if (organizationId) {
      const orgSettings = await prisma.organizationSettings.findUnique({
        where: { organizationId }
      }).catch(() => null);

      let fileBranding = {};
      try {
        const fs = require('fs');
        const path = require('path');
        const brandingPath = path.join(__dirname, 'data/company_branding.json');
        if (fs.existsSync(brandingPath)) {
          const allBranding = JSON.parse(fs.readFileSync(brandingPath, 'utf8') || '{}');
          fileBranding = allBranding[organizationId] || {};
        }
      } catch (e) {
        // ignore
      }

      const themeObj = orgSettings?.theme || orgSettings?.branding || {};
      const orgObj = {
        organizationId,
        chatEnabledForAdmins: fileBranding.chatEnabledForAdmins ?? (orgSettings?.chatEnabledForAdmins ?? true),
        chatEnabledForUsers: fileBranding.chatEnabledForUsers ?? (orgSettings?.chatEnabledForUsers ?? true),
        adminChatEnabled: fileBranding.chatEnabledForAdmins ?? (orgSettings?.chatEnabledForAdmins ?? true),
        userChatEnabled: fileBranding.chatEnabledForUsers ?? (orgSettings?.chatEnabledForUsers ?? true)
      };

      return res.json({
        organizationId,
        companyName: fileBranding.companyName || orgSettings?.branding?.companyName || platform?.companyName || 'Innoviety Enterprise',
        selectedTheme: fileBranding.selectedTheme || themeObj.selectedTheme || platform?.selectedTheme || 'emerald',
        themeMode: fileBranding.themeMode || themeObj.themeMode || platform?.themeMode || 'light',
        companyLogo: fileBranding.companyLogo !== undefined ? fileBranding.companyLogo : (orgSettings?.branding?.companyLogo || platform?.companyLogo || null),
        chatEnabledForAdmins: orgObj.chatEnabledForAdmins,
        chatEnabledForUsers: orgObj.chatEnabledForUsers,
        adminChatEnabled: orgObj.adminChatEnabled,
        userChatEnabled: orgObj.userChatEnabled,
        platform: platformObj,
        organization: orgObj
      });
    }

    res.json({
      ...platform,
      chatEnabledForAdmins: platformObj.chatEnabledForAdmins,
      chatEnabledForUsers: platformObj.chatEnabledForUsers,
      adminChatEnabled: platformObj.adminChatEnabled,
      userChatEnabled: platformObj.userChatEnabled,
      platform: platformObj,
      organization: null
    });
  } catch (err) {
    res.json({
      companyName: 'Innoviety Enterprise',
      selectedTheme: 'emerald',
      themeMode: 'light',
      companyLogo: null,
      chatEnabledForAdmins: true,
      chatEnabledForUsers: true,
      adminChatEnabled: true,
      userChatEnabled: true,
      platform: { chatEnabledForAdmins: true, chatEnabledForUsers: true },
      organization: null
    });
  }
});
const organizationRoutes = require('./routes/organizationRoutes');
const companyRoutes = require('./routes/companyRoutes');
const organizationSettingsRoutes = require('./routes/organizationSettingsRoutes');
const publicCompanyRoutes = require('./routes/publicCompanyRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const platformRoutes = require('./routes/platformRoutes');
const backupRoutes = require('./routes/backupRoutes');
const maintenanceRoutes = require('./routes/maintenanceRoutes');
const positionRoutes = require('./routes/positionRoutes');

app.use('/api/public/company', publicCompanyRoutes);
app.use('/api/organization', organizationRoutes);
app.use('/api/organizations', companyRoutes);
app.use('/api/organizations', organizationSettingsRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/platform', platformRoutes);
app.use('/api/backups', backupRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/positions', positionRoutes);

const { completeWelcomePopup, resetWelcomePopup } = require('./controllers/userController');
const { requireRole } = require('./middleware/auth');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.post('/api/admin/users/:id/reset-welcome', authenticate, requireRole(['ADMIN', 'SUPER_ADMIN']), resetWelcomePopup);
app.use('/api/teams', teamRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/attendance', attendanceRoutes);
const attendanceLocationRoutes = require('./routes/attendanceLocationRoutes');
app.use('/api/attendance-locations', attendanceLocationRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/settings', settingsRoutes);
const leavePolicyRoutes = require('./routes/leavePolicyRoutes');
const latePolicyRoutes = require('./routes/latePolicyRoutes');

app.use('/api/leave-policy', leavePolicyRoutes);
app.use('/api/late-policy', latePolicyRoutes);
app.use('/api/leaves', leaveRoutes);
const compOffRoutes = require('./routes/compOffRoutes');
app.use('/api/comp-off', compOffRoutes);
const estimateRoutes = require('./routes/estimateRoutes');
app.use('/api/assets/estimates', estimateRoutes);
app.use('/api/assets', assetRoutes);
const companyDocumentRoutes = require('./routes/companyDocumentRoutes');
app.use('/api/company-documents', companyDocumentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/milestones', milestoneRoutes);
app.use('/api/task-dependencies', taskDependencyRoutes);
app.use('/api/worklogs', workLogRoutes);
app.use('/api/daily-work-log', workLogRoutes);
app.use('/api/dashboard', dashboardRoutes);
const workCalendarRoutes = require('./routes/workCalendarRoutes');
app.use('/api/work-calendar', workCalendarRoutes);
const shiftRoutes = require('./routes/shiftRoutes');
app.use('/api/shifts', shiftRoutes);
const scheduleRoutes = require('./routes/scheduleRoutes');
app.use('/api/schedules', scheduleRoutes);
const workforceAutomationRoutes = require('./routes/workforceAutomationRoutes');
app.use('/api/workforce', workforceAutomationRoutes);
const workforceIntelligenceRoutes = require('./routes/workforceIntelligenceRoutes');
app.use('/api/intelligence', workforceIntelligenceRoutes);
const enterpriseRoutes = require('./routes/enterpriseRoutes');
app.use('/api/enterprise', enterpriseRoutes);



// Finance & Payroll API Endpoints
app.use('/api/payroll/templates', salaryTemplateRoutes);
app.use('/api/payroll/salary-structures', salaryStructureRoutes);
app.use('/api/payroll/holidays', holidayRoutes);
app.use('/api/payroll/settings', payrollSettingsRoutes);
app.use('/api/payroll/payslips', payslipRoutes);
app.use('/api/payroll/reports', payrollReportRoutes);
app.use('/api/payroll', payrollRoutes);

// Health check / Diagnostic Endpoints (both /health and /api/health)
app.get(['/health', '/api/health'], (req, res) => {
  res.json({ status: 'healthy' });
});

// Phase 10: Production System, Security, Monitoring & Certification Routes
app.use('/api/system', systemRoutes);

// Central Error Handler with Phase 10 Error Tracking
app.use((err, req, res, next) => {
  console.error('Express global error handler caught:', err);
  const status = err.statusCode || 500;
  trackError({
    message: err.message,
    stack: err.stack,
    statusCode: status,
    path: req.originalUrl,
    method: req.method,
    userId: req.user?.id,
    organizationId: req.user?.organizationId,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  res.status(status).json({
    message: err.message || 'An unexpected error occurred on the server.',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Initialize Socket.io
socketManager.init(server);

const { ensureCompanyChatRoom } = require('./services/companyChatService');
const { initAutoClockOutService } = require('./services/autoClockOutService');
const { initCompOffScheduler } = require('./services/compOffExpirySchedulerService');

const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  console.log(`[STARTUP] Enterprise CRM backend server is running on port ${PORT}`);
  console.log(`[STARTUP] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[STARTUP] Frontend URL: ${process.env.FRONTEND_URL || 'Not configured'}`);

  // Database Connection Verification
  try {
    const prisma = require('./utils/db');
    await prisma.$queryRaw`SELECT 1`;
    console.log('[STARTUP] Database connection verified successfully.');
  } catch (dbErr) {
    console.error('[STARTUP ERROR] Database connection failed:', dbErr.message);
  }

  try {
    await ensureCompanyChatRoom();
    initAutoClockOutService();
    initCompOffScheduler();
    console.log('[STARTUP] Background services initialized.');
  } catch (err) {
    console.warn('[STARTUP WARNING] Background service init warning:', err.message);
  }
});
