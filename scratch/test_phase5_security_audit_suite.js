const http = require('http');
const path = require('path');
const jwt = require('../backend/node_modules/jsonwebtoken');
require('../backend/node_modules/dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const prisma = require('../backend/src/utils/db');
const { CRM_MODULES, ACCESS_LEVELS } = require('../backend/src/config/crmModules');
const ioClient = require('../frontend/node_modules/socket.io-client');

const PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'enterprise_internship_crm_super_secret_jwt_key_123!';

function apiRequest(method, endpoint, token = null, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method.toUpperCase(),
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, data: parsed });
      });
    });
    req.on('error', (err) => reject(err));
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function createToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, organizationId: user.organizationId },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

let passed = 0;
let failed = 0;

function assert(cond, name, detail = '') {
  if (cond) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`);
  } else {
    failed++;
    console.error(`  \x1b[31mFAIL\x1b[0m ${name} ${detail ? ' - ' + detail : ''}`);
  }
}

async function runPhase5SecurityAuditSuite() {
  console.log('\n============================================================');
  console.log('   INNOVEITY CRM — PHASE 5 FINAL SECURITY AUDIT SUITE');
  console.log('   Exhaustive Multi-Tenant & Endpoint Authorization Audit');
  console.log('============================================================\n');

  let superAdminUser = null;
  let testOrg1 = null;
  let testOrg2 = null;
  let viewOnlyUser = null;
  let editUser = null;
  let noAccessUser = null;
  let viewTemplate = null;
  let editTemplate = null;
  let noAccessTemplate = null;

  try {
    // -------------------------------------------------------------
    // SETUP
    // -------------------------------------------------------------
    superAdminUser = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
    if (!superAdminUser) throw new Error('No SUPER_ADMIN user found.');
    const superAdminToken = createToken(superAdminUser);

    testOrg1 = await prisma.organization.findFirst({ where: { status: 'ACTIVE' } });
    if (!testOrg1) throw new Error('No active organization found.');

    testOrg2 = await prisma.organization.findFirst({
      where: { status: 'ACTIVE', id: { not: testOrg1.id } }
    });

    console.log(`[SETUP] Super Admin: ${superAdminUser.email}`);
    console.log(`[SETUP] Org 1: ${testOrg1.name} (${testOrg1.id})`);
    if (testOrg2) {
      console.log(`[SETUP] Org 2: ${testOrg2.name} (${testOrg2.id})`);
    }

    // -------------------------------------------------------------
    // AUDIT 1: ALL BASE ROLES TEMPLATE CREATION & LIFECYCLE
    // -------------------------------------------------------------
    console.log('\n--- AUDIT 1: Base Roles Template Lifecycle ---');
    const baseRoles = ['INTERN', 'EMPLOYEE', 'TEAM_LEADER', 'ADMIN'];
    for (const role of baseRoles) {
      const res = await apiRequest('POST', '/api/super-admin/access-templates', superAdminToken, {
        name: `Audit Template ${role} ${Date.now()}`,
        description: `Lifecycle test for role ${role}`,
        baseRole: role,
        organizationId: testOrg1.id,
        permissions: [
          { moduleKey: 'projects', accessLevel: 'VIEW' },
          { moduleKey: 'tasks', accessLevel: 'EDIT' }
        ]
      });
      assert(res.status === 201, `Create template for base role ${role} succeeds`);
      if (res.data?.template?.id) {
        // Clean up
        await prisma.accessTemplatePermission.deleteMany({ where: { templateId: res.data.template.id } });
        await prisma.accessTemplate.delete({ where: { id: res.data.template.id } });
      }
    }

    // Attempt SUPER_ADMIN base role template creation (MUST FAIL)
    const saTplRes = await apiRequest('POST', '/api/super-admin/access-templates', superAdminToken, {
      name: 'Illegal SA Template',
      baseRole: 'SUPER_ADMIN',
      organizationId: testOrg1.id
    });
    assert(saTplRes.status === 400 || saTplRes.status === 403, 'Creation of template with baseRole SUPER_ADMIN rejected');

    // -------------------------------------------------------------
    // AUDIT 2: TENANT ISOLATION & CROSS-ORGANIZATION BOUNDARY
    // -------------------------------------------------------------
    console.log('\n--- AUDIT 2: Multi-Tenant Data & Action Isolation ---');
    if (testOrg2) {
      // Create template in Org 1
      const org1TplRes = await apiRequest('POST', '/api/super-admin/access-templates', superAdminToken, {
        name: `Org 1 Template ${Date.now()}`,
        baseRole: 'EMPLOYEE',
        organizationId: testOrg1.id,
        permissions: [{ moduleKey: 'projects', accessLevel: 'VIEW' }]
      });
      const org1Tpl = org1TplRes.data.template;

      // Find an admin in Org 2
      const org2Admin = await prisma.user.findFirst({
        where: { organizationId: testOrg2.id, role: 'ADMIN' }
      });

      if (org2Admin) {
        const org2AdminToken = createToken(org2Admin);

        // Org 2 Admin attempts to list Org 1 templates via Super Admin route
        const crossListRes = await apiRequest('GET', `/api/super-admin/access-templates?organizationId=${testOrg1.id}`, org2AdminToken);
        assert(crossListRes.status === 403, 'Tenant Admin cannot call super-admin template endpoints');

        // Org 2 Admin attempts to fetch Org 1 data
        const crossOrgSettingsRes = await apiRequest('GET', `/api/organizations/${testOrg1.id}/settings`, org2AdminToken);
        assert(crossOrgSettingsRes.status === 403 || crossOrgSettingsRes.status === 400, 'Tenant Admin cannot access settings of another organization');
      }

      // Cleanup
      await prisma.accessTemplatePermission.deleteMany({ where: { templateId: org1Tpl.id } });
      await prisma.accessTemplate.delete({ where: { id: org1Tpl.id } });
    } else {
      console.log('  [SKIP] Multi-tenant boundary check skipped (single organization in DB)');
    }

    // -------------------------------------------------------------
    // AUDIT 3: ENDPOINT-BY-ENDPOINT AUTHORIZATION (VIEW vs EDIT vs NONE)
    // -------------------------------------------------------------
    console.log('\n--- AUDIT 3: Granular Endpoint Access Matrix Audit ---');

    // Setup 3 templates:
    // View-Only Template: projects: VIEW, assets: VIEW, worklogs: VIEW, site_settings: VIEW, payroll_templates: VIEW
    const createViewTpl = await apiRequest('POST', '/api/super-admin/access-templates', superAdminToken, {
      name: `ViewOnly Template ${Date.now()}`,
      baseRole: 'ADMIN',
      organizationId: testOrg1.id,
      permissions: [
        { moduleKey: 'projects', accessLevel: 'VIEW' },
        { moduleKey: 'assets', accessLevel: 'VIEW' },
        { moduleKey: 'worklogs', accessLevel: 'VIEW' },
        { moduleKey: 'site_settings', accessLevel: 'VIEW' },
        { moduleKey: 'payroll_templates', accessLevel: 'VIEW' },
        { moduleKey: 'company_documents', accessLevel: 'VIEW' },
        { moduleKey: 'teams_hub', accessLevel: 'VIEW' },
        { moduleKey: 'tickets', accessLevel: 'VIEW' }
      ]
    });
    viewTemplate = createViewTpl.data.template;

    // Register User with View Template
    const regViewUser = await apiRequest('POST', `/api/super-admin/access-templates/${viewTemplate.id}/register-user`, superAdminToken, {
      name: 'Auditor View User',
      email: `view_auditor_${Date.now()}@innovety.test`,
      password: 'AuditPassword123!',
      dob: '1992-04-10',
      phone: '9876543211',
      designation: 'Auditor',
      department: 'Finance'
    });
    viewOnlyUser = regViewUser.data.user;
    const viewUserToken = createToken(viewOnlyUser);

    // Setup No-Access Template: all above modules are NONE
    const createNoAccessTpl = await apiRequest('POST', '/api/super-admin/access-templates', superAdminToken, {
      name: `NoAccess Template ${Date.now()}`,
      baseRole: 'EMPLOYEE',
      organizationId: testOrg1.id,
      permissions: [
        { moduleKey: 'projects', accessLevel: 'NONE' },
        { moduleKey: 'assets', accessLevel: 'NONE' },
        { moduleKey: 'worklogs', accessLevel: 'NONE' },
        { moduleKey: 'site_settings', accessLevel: 'NONE' },
        { moduleKey: 'payroll_templates', accessLevel: 'NONE' },
        { moduleKey: 'company_documents', accessLevel: 'NONE' },
        { moduleKey: 'teams_hub', accessLevel: 'NONE' },
        { moduleKey: 'tickets', accessLevel: 'NONE' },
        { moduleKey: 'dashboard', accessLevel: 'NONE' },
        { moduleKey: 'chat', accessLevel: 'NONE' },
        { moduleKey: 'work_calendar', accessLevel: 'NONE' }
      ]
    });
    noAccessTemplate = createNoAccessTpl.data.template;

    const regNoAccessUser = await apiRequest('POST', `/api/super-admin/access-templates/${noAccessTemplate.id}/register-user`, superAdminToken, {
      name: 'Auditor NoAccess User',
      email: `noaccess_auditor_${Date.now()}@innovety.test`,
      password: 'AuditPassword123!',
      dob: '1993-06-12',
      phone: '9876543212',
      designation: 'Restricted User',
      department: 'Operations'
    });
    noAccessUser = regNoAccessUser.data.user;
    const noAccessUserToken = createToken(noAccessUser);

    // 3.1 PROJECTS MODULE AUDIT
    console.log('  [Testing Projects Module]');
    const viewProjectsRes = await apiRequest('GET', '/api/projects', viewUserToken);
    assert(viewProjectsRes.status === 200, 'User with projects: VIEW can list projects');
    const mutateProjectsRes = await apiRequest('POST', '/api/projects', viewUserToken, { name: 'Unauthorized Create' });
    assert(mutateProjectsRes.status === 403, 'User with projects: VIEW cannot create projects (403)');
    const noAccessProjectsRes = await apiRequest('GET', '/api/projects', noAccessUserToken);
    assert(noAccessProjectsRes.status === 403, 'User with projects: NONE cannot list projects (403)');

    // 3.2 ASSETS & ESTIMATES MODULE AUDIT
    console.log('  [Testing Assets & Estimates Module]');
    const viewAssetsRes = await apiRequest('GET', '/api/assets', viewUserToken);
    assert(viewAssetsRes.status === 200, 'User with assets: VIEW can list assets');
    const mutateAssetsRes = await apiRequest('POST', '/api/assets', viewUserToken, { name: 'Illegal Asset' });
    assert(mutateAssetsRes.status === 403, 'User with assets: VIEW cannot create assets (403)');
    const viewEstimatesRes = await apiRequest('GET', '/api/assets/estimates', viewUserToken);
    assert(viewEstimatesRes.status === 200, 'User with assets: VIEW can list estimates');
    const mutateEstimatesRes = await apiRequest('POST', '/api/assets/estimates', viewUserToken, { title: 'Illegal Estimate' });
    assert(mutateEstimatesRes.status === 403, 'User with assets: VIEW cannot create estimate (403)');
    const noAccessAssetsRes = await apiRequest('GET', '/api/assets', noAccessUserToken);
    assert(noAccessAssetsRes.status === 403, 'User with assets: NONE cannot list assets (403)');
    const noAccessEstimatesRes = await apiRequest('GET', '/api/assets/estimates', noAccessUserToken);
    assert(noAccessEstimatesRes.status === 403, 'User with assets: NONE cannot list estimates (403)');

    // 3.3 WORK LOGS MODULE AUDIT
    console.log('  [Testing Work Logs Module]');
    const viewWorklogsRes = await apiRequest('GET', '/api/worklogs', viewUserToken);
    assert(viewWorklogsRes.status === 200, 'User with worklogs: VIEW can view worklogs');
    const mutateWorklogsRes = await apiRequest('POST', '/api/worklogs', viewUserToken, { hours: 5 });
    assert(mutateWorklogsRes.status === 403, 'User with worklogs: VIEW cannot create worklog (403)');
    const noAccessWorklogsRes = await apiRequest('GET', '/api/worklogs', noAccessUserToken);
    assert(noAccessWorklogsRes.status === 403, 'User with worklogs: NONE cannot view worklogs (403)');

    // 3.4 SITE SETTINGS & GEOFENCING AUDIT
    console.log('  [Testing Site Settings & Geofencing Module]');
    const viewSettingsRes = await apiRequest('GET', '/api/settings', viewUserToken);
    assert(viewSettingsRes.status === 200, 'User with site_settings: VIEW can view site settings');
    const mutateSettingsRes = await apiRequest('PUT', '/api/settings', viewUserToken, { officeLatitude: 12.5 });
    assert(mutateSettingsRes.status === 403, 'User with site_settings: VIEW cannot update site settings (403)');
    const mutateLocRes = await apiRequest('POST', '/api/attendance-locations', viewUserToken, { name: 'Illegal Location' });
    assert(mutateLocRes.status === 403, 'User with site_settings: VIEW cannot create attendance locations (403)');
    const noAccessSettingsRes = await apiRequest('GET', '/api/settings', noAccessUserToken);
    assert(noAccessSettingsRes.status === 403, 'User with site_settings: NONE cannot view site settings (403)');

    // 3.5 SALARY TEMPLATES AUDIT
    console.log('  [Testing Salary Templates Module]');
    const viewSalaryTplRes = await apiRequest('GET', '/api/payroll/templates', viewUserToken);
    assert(viewSalaryTplRes.status === 200, 'User with payroll_templates: VIEW can list salary templates');
    const mutateSalaryTplRes = await apiRequest('POST', '/api/payroll/templates', viewUserToken, { name: 'Illegal Tpl' });
    assert(mutateSalaryTplRes.status === 403, 'User with payroll_templates: VIEW cannot create salary template (403)');
    const noAccessSalaryTplRes = await apiRequest('GET', '/api/payroll/templates', noAccessUserToken);
    assert(noAccessSalaryTplRes.status === 403, 'User with payroll_templates: NONE cannot list salary templates (403)');

    // 3.6 TEAMS HUB AUDIT
    console.log('  [Testing Teams Hub Module]');
    const viewTeamsRes = await apiRequest('GET', '/api/teams', viewUserToken);
    assert(viewTeamsRes.status === 200, 'User with teams_hub: VIEW can list teams');
    const mutateTeamsRes = await apiRequest('POST', '/api/teams', viewUserToken, { name: 'Illegal Team' });
    assert(mutateTeamsRes.status === 403, 'User with teams_hub: VIEW cannot create teams (403)');
    const noAccessTeamsRes = await apiRequest('GET', '/api/teams', noAccessUserToken);
    assert(noAccessTeamsRes.status === 403, 'User with teams_hub: NONE cannot list teams (403)');

    // 3.7 DASHBOARD & CHAT & WORK CALENDAR NO-ACCESS AUDIT
    console.log('  [Testing Dashboard, Chat & Calendar No-Access]');
    const noAccessDashRes = await apiRequest('GET', '/api/dashboard/overview', noAccessUserToken);
    assert(noAccessDashRes.status === 403, 'User with dashboard: NONE cannot access dashboard overview (403)');
    const noAccessChatRes = await apiRequest('GET', '/api/chat/rooms', noAccessUserToken);
    assert(noAccessChatRes.status === 403, 'User with chat: NONE cannot access chat rooms (403)');
    const noAccessCalendarRes = await apiRequest('GET', '/api/work-calendar', noAccessUserToken);
    assert(noAccessCalendarRes.status === 403, 'User with work_calendar: NONE cannot access work calendar (403)');

    // -------------------------------------------------------------
    // AUDIT 4: UNIVERSAL SELF-SERVICE FOR ALL USERS
    // -------------------------------------------------------------
    console.log('\n--- AUDIT 4: Universal Self-Service Guarantee ---');
    // My Profile is guaranteed EDIT for EVERY user even if template sets profile: NONE
    const profileResNoAccess = await apiRequest('GET', '/api/auth/profile', noAccessUserToken);
    assert(profileResNoAccess.status === 200, 'Universal self-service: GET /api/auth/profile allowed for restricted user');
    const profileUpdateRes = await apiRequest('PUT', '/api/auth/profile', noAccessUserToken, { phone: '9999999999' });
    assert(profileUpdateRes.status === 200, 'Universal self-service: PUT /api/auth/profile allowed for restricted user');

    // -------------------------------------------------------------
    // AUDIT 5: SUPER ADMIN RESTRICTION ENFORCEMENT
    // -------------------------------------------------------------
    console.log('\n--- AUDIT 5: Super Admin Platform Routes Defense ---');
    const saStatsRes = await apiRequest('GET', '/api/super-admin/stats', viewUserToken);
    assert(saStatsRes.status === 403, 'Normal user blocked from /api/super-admin/stats (403)');
    const saBrandingRes = await apiRequest('GET', '/api/super-admin/branding', viewUserToken);
    assert(saBrandingRes.status === 403, 'Normal user blocked from /api/super-admin/branding (403)');
    const saUsersRes = await apiRequest('GET', '/api/super-admin/users', viewUserToken);
    assert(saUsersRes.status === 403, 'Normal user blocked from /api/super-admin/users (403)');

    // -------------------------------------------------------------
    // AUDIT 6: UNASSIGNED USERS REGRESSION (BACKWARD COMPATIBILITY)
    // -------------------------------------------------------------
    console.log('\n--- AUDIT 6: Unassigned Users Backward Compatibility ---');
    const existingEmployee = await prisma.user.findFirst({
      where: { role: 'EMPLOYEE', accessTemplateId: null }
    });
    if (existingEmployee) {
      const empToken = createToken(existingEmployee);
      const empProfile = await apiRequest('GET', '/api/auth/profile', empToken);
      assert(empProfile.status === 200, 'Existing unassigned employee profile retrieves cleanly');
      assert(empProfile.data.accessTemplate === null, 'Unassigned employee accessTemplate is null');
      assert(empProfile.data.effectivePermissions.projects === 'VIEW', 'Unassigned employee receives baseline projects: VIEW');

      const empProjects = await apiRequest('GET', '/api/projects', empToken);
      assert(empProjects.status === 200, 'Unassigned employee can view projects endpoint');
    } else {
      console.log('  [SKIP] No existing unassigned employee found in database');
    }

  } catch (err) {
    console.error('\n\x1b[31m[ERROR] Exception during Phase 5 audit:\x1b[0m', err);
    failed++;
  } finally {
    console.log('\n--- CLEANUP ---');
    if (viewOnlyUser) {
      try {
        await prisma.user.delete({ where: { id: viewOnlyUser.id } });
        console.log(`[CLEANUP] Deleted viewOnlyUser: ${viewOnlyUser.id}`);
      } catch (e) {}
    }
    if (noAccessUser) {
      try {
        await prisma.user.delete({ where: { id: noAccessUser.id } });
        console.log(`[CLEANUP] Deleted noAccessUser: ${noAccessUser.id}`);
      } catch (e) {}
    }
    if (viewTemplate) {
      try {
        await prisma.accessTemplatePermission.deleteMany({ where: { templateId: viewTemplate.id } });
        await prisma.accessTemplate.delete({ where: { id: viewTemplate.id } });
        console.log(`[CLEANUP] Deleted viewTemplate: ${viewTemplate.id}`);
      } catch (e) {}
    }
    if (noAccessTemplate) {
      try {
        await prisma.accessTemplatePermission.deleteMany({ where: { templateId: noAccessTemplate.id } });
        await prisma.accessTemplate.delete({ where: { id: noAccessTemplate.id } });
        console.log(`[CLEANUP] Deleted noAccessTemplate: ${noAccessTemplate.id}`);
      } catch (e) {}
    }

    console.log('\n============================================================');
    console.log(`PHASE 5 AUDIT RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('============================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  }
}

runPhase5SecurityAuditSuite();
