const http = require('http');
const path = require('path');
const jwt = require('../backend/node_modules/jsonwebtoken');
require('../backend/node_modules/dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const prisma = require('../backend/src/utils/db');
const { CRM_MODULES, ACCESS_LEVELS: BACKEND_ACCESS_LEVELS } = require('../backend/src/config/crmModules');
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

async function runPhase4TestSuite() {
  console.log('\n============================================================');
  console.log('   INNOVEITY CRM — PHASE 4 VERIFICATION TEST SUITE');
  console.log('   Dynamic Navigation & Client-Side Permission Refresh');
  console.log('============================================================\n');

  // Dynamically load frontend module config (ESM)
  const frontendConfig = await import('../frontend/src/config/crmModules.js');
  const { CRM_MODULE_KEYS, ACCESS_LEVELS, ROLE_BASELINES, getRoleBaselinePermission } = frontendConfig;

  // Pure JS simulation of usePermissions getPermission logic
  function evaluatePermission(user, moduleKey) {
    if (!user) return ACCESS_LEVELS.NONE;
    if (user.role === 'SUPER_ADMIN') return ACCESS_LEVELS.EDIT;
    if (moduleKey === CRM_MODULE_KEYS.PROFILE || moduleKey === 'profile') return ACCESS_LEVELS.EDIT;

    if (user.effectivePermissions && typeof user.effectivePermissions === 'object') {
      const level = user.effectivePermissions[moduleKey];
      if (level !== undefined && level !== null) {
        return level;
      }
    }

    if (!user.accessTemplateId && user.role) {
      return getRoleBaselinePermission(user.role, moduleKey);
    }

    return ACCESS_LEVELS.NONE;
  }

  function canView(user, moduleKey) {
    const lvl = evaluatePermission(user, moduleKey);
    return lvl === ACCESS_LEVELS.VIEW || lvl === ACCESS_LEVELS.EDIT;
  }

  function canEdit(user, moduleKey) {
    return evaluatePermission(user, moduleKey) === ACCESS_LEVELS.EDIT;
  }

  let testOrg1 = null;
  let testOrg2 = null;
  let superAdminUser = null;
  let testTemplate = null;
  let testUser = null;
  let socketInstance = null;

  try {
    // -------------------------------------------------------------
    // Setup Test Data
    // -------------------------------------------------------------
    superAdminUser = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN' }
    });
    if (!superAdminUser) {
      throw new Error('No SUPER_ADMIN user found in database.');
    }
    const superAdminToken = createToken(superAdminUser);

    testOrg1 = await prisma.organization.findFirst({
      where: { status: 'ACTIVE' }
    });
    if (!testOrg1) {
      throw new Error('No active organization found.');
    }

    testOrg2 = await prisma.organization.findFirst({
      where: { status: 'ACTIVE', id: { not: testOrg1.id } }
    });

    console.log(`[SETUP] SuperAdmin: ${superAdminUser.email}, Test Org 1: ${testOrg1.name} (${testOrg1.id})`);

    // -------------------------------------------------------------
    // Group 1: Frontend Module Registry Integrity (31 modules)
    // -------------------------------------------------------------
    console.log('\n--- GROUP 1: Client-Side Module Registry Verification ---');
    const frontendKeys = Object.values(CRM_MODULE_KEYS);
    const backendKeys = CRM_MODULES.map(m => m.key);

    assert(frontendKeys.length === 31, 'Frontend registry exposes exactly 31 operational modules', `Count: ${frontendKeys.length}`);
    assert(frontendKeys.length === backendKeys.length, 'Frontend and Backend registries have matching module counts', `Frontend: ${frontendKeys.length}, Backend: ${backendKeys.length}`);

    let allKeysMatch = true;
    for (const key of backendKeys) {
      if (!frontendKeys.includes(key)) {
        allKeysMatch = false;
        console.error(`  Missing module key in frontend: ${key}`);
      }
    }
    assert(allKeysMatch, 'All backend module keys exist in frontend registry');

    // -------------------------------------------------------------
    // Group 2: Role Baseline Fallbacks & Universal Self-Service
    // -------------------------------------------------------------
    console.log('\n--- GROUP 2: Baseline Fallbacks & Universal Self-Service ---');
    assert(ROLE_BASELINES.SUPER_ADMIN[CRM_MODULE_KEYS.PROJECTS] === ACCESS_LEVELS.EDIT, 'SUPER_ADMIN baseline has EDIT on projects');
    assert(ROLE_BASELINES.ADMIN[CRM_MODULE_KEYS.PROJECTS] === ACCESS_LEVELS.EDIT, 'ADMIN baseline has EDIT on projects');
    assert(ROLE_BASELINES.EMPLOYEE[CRM_MODULE_KEYS.PROJECTS] === ACCESS_LEVELS.VIEW, 'EMPLOYEE baseline has VIEW on projects');
    assert(ROLE_BASELINES.EMPLOYEE[CRM_MODULE_KEYS.PAYROLL_PROCESS] === ACCESS_LEVELS.NONE, 'EMPLOYEE baseline has NONE on payroll_process');

    // Universal Profile check
    const mockEmployee = { id: 'emp-1', role: 'EMPLOYEE', accessTemplateId: null, effectivePermissions: {} };
    assert(canView(mockEmployee, CRM_MODULE_KEYS.PROFILE) === true, 'Universal self-service: Employee can view Profile');
    assert(canEdit(mockEmployee, CRM_MODULE_KEYS.PROFILE) === true, 'Universal self-service: Employee can edit Profile');

    const mockRestrictedUser = {
      id: 'emp-2',
      role: 'EMPLOYEE',
      accessTemplateId: 'tpl-1',
      effectivePermissions: {
        [CRM_MODULE_KEYS.PROFILE]: ACCESS_LEVELS.NONE // Even if explicitly passed NONE
      }
    };
    assert(canView(mockRestrictedUser, CRM_MODULE_KEYS.PROFILE) === true, 'Profile remains EDIT even if effectivePermissions has NONE');
    assert(canEdit(mockRestrictedUser, CRM_MODULE_KEYS.PROFILE) === true, 'Profile remains EDIT unconditionally');

    // -------------------------------------------------------------
    // Group 3: Template Creation & User Registration via Template
    // -------------------------------------------------------------
    console.log('\n--- GROUP 3: Access Template Lifecycle & Effective Permissions ---');
    
    // Create an access template with mixed permissions:
    // - projects: EDIT
    // - assets: VIEW
    // - payroll_process: NONE
    // - registry_employees: VIEW
    // - company_documents: NONE
    const createTplRes = await apiRequest('POST', '/api/super-admin/access-templates', superAdminToken, {
      name: `Phase 4 Test Template ${Date.now()}`,
      description: 'Automated Phase 4 test template',
      baseRole: 'EMPLOYEE',
      organizationId: testOrg1.id,
      permissions: [
        { moduleKey: CRM_MODULE_KEYS.PROJECTS, accessLevel: ACCESS_LEVELS.EDIT },
        { moduleKey: CRM_MODULE_KEYS.ASSETS, accessLevel: ACCESS_LEVELS.VIEW },
        { moduleKey: CRM_MODULE_KEYS.PAYROLL_PROCESS, accessLevel: ACCESS_LEVELS.NONE },
        { moduleKey: CRM_MODULE_KEYS.REGISTRY_EMPLOYEES, accessLevel: ACCESS_LEVELS.VIEW },
        { moduleKey: CRM_MODULE_KEYS.COMPANY_DOCUMENTS, accessLevel: ACCESS_LEVELS.NONE }
      ]
    });

    assert(createTplRes.status === 201, 'Super Admin can create access template', `Status: ${createTplRes.status}`);
    testTemplate = createTplRes.data.template;

    // Register test user assigned to this template
    const uniqueEmail = `p4_user_${Date.now()}@innovety.test`;
    const regRes = await apiRequest('POST', `/api/super-admin/access-templates/${testTemplate.id}/register-user`, superAdminToken, {
      name: 'Phase 4 Test User',
      email: uniqueEmail,
      password: 'InitialPassword123!',
      dob: '1995-05-15',
      phone: '9876543210',
      designation: 'QA Tester',
      department: 'Engineering'
    });

    assert(regRes.status === 201, 'Register user through template succeeds', `Status: ${regRes.status}`);
    testUser = regRes.data.user;

    // Verify User in Database has accessTemplateId
    const dbUser = await prisma.user.findUnique({
      where: { id: testUser.id },
      include: { accessTemplate: true }
    });
    assert(dbUser.accessTemplateId === testTemplate.id, 'User record in DB is assigned to accessTemplate');

    // -------------------------------------------------------------
    // Group 4: Profile & Login API Response Structure
    // -------------------------------------------------------------
    console.log('\n--- GROUP 4: Backend Profile & Login effectivePermissions Structure ---');
    const userToken = createToken(dbUser);
    const profileRes = await apiRequest('GET', '/api/auth/profile', userToken);

    assert(profileRes.status === 200, 'GET /api/auth/profile succeeds', `Status: ${profileRes.status}`);
    const userProfile = profileRes.data.user || profileRes.data;
    assert(Boolean(userProfile.effectivePermissions), 'Profile response includes effectivePermissions');
    assert(Boolean(userProfile.accessTemplate), 'Profile response includes accessTemplate metadata');
    assert(userProfile.effectivePermissions[CRM_MODULE_KEYS.PROJECTS] === ACCESS_LEVELS.EDIT, 'Effective permission for projects is EDIT');
    assert(userProfile.effectivePermissions[CRM_MODULE_KEYS.ASSETS] === ACCESS_LEVELS.VIEW, 'Effective permission for assets is VIEW');
    assert(userProfile.effectivePermissions[CRM_MODULE_KEYS.PAYROLL_PROCESS] === ACCESS_LEVELS.NONE, 'Effective permission for payroll_process is NONE');
    assert(userProfile.effectivePermissions[CRM_MODULE_KEYS.PROFILE] === ACCESS_LEVELS.EDIT, 'Effective permission for profile is EDIT');

    // -------------------------------------------------------------
    // Group 5: Dynamic Navigation & Route Guard Logic Evaluation
    // -------------------------------------------------------------
    console.log('\n--- GROUP 5: Dynamic Navigation & Route Guard Logic ---');
    // None -> hidden from sidebar, denied on route
    assert(canView(userProfile, CRM_MODULE_KEYS.PAYROLL_PROCESS) === false, 'Module with NONE is hidden from navigation (canView = false)');
    assert(canEdit(userProfile, CRM_MODULE_KEYS.PAYROLL_PROCESS) === false, 'Module with NONE cannot be edited (canEdit = false)');

    // View -> visible in sidebar, route allowed, mutation buttons hidden
    assert(canView(userProfile, CRM_MODULE_KEYS.ASSETS) === true, 'Module with VIEW is visible in navigation (canView = true)');
    assert(canEdit(userProfile, CRM_MODULE_KEYS.ASSETS) === false, 'Module with VIEW has mutation controls hidden (canEdit = false)');

    // Edit -> visible in sidebar, route allowed, mutation buttons shown
    assert(canView(userProfile, CRM_MODULE_KEYS.PROJECTS) === true, 'Module with EDIT is visible in navigation (canView = true)');
    assert(canEdit(userProfile, CRM_MODULE_KEYS.PROJECTS) === true, 'Module with EDIT has mutation controls visible (canEdit = true)');

    // Unassigned user maintains base role behavior
    const unassignedEmp = { id: 'unassigned-1', role: 'EMPLOYEE', accessTemplateId: null, effectivePermissions: null };
    assert(canView(unassignedEmp, CRM_MODULE_KEYS.PROJECTS) === true, 'Unassigned EMPLOYEE retains baseline VIEW on projects');
    assert(canEdit(unassignedEmp, CRM_MODULE_KEYS.PROJECTS) === false, 'Unassigned EMPLOYEE cannot EDIT projects');
    assert(canView(unassignedEmp, CRM_MODULE_KEYS.PAYROLL_PROCESS) === false, 'Unassigned EMPLOYEE retains baseline NONE on payroll_process');

    const unassignedAdmin = { id: 'unassigned-admin', role: 'ADMIN', accessTemplateId: null, effectivePermissions: null };
    assert(canEdit(unassignedAdmin, CRM_MODULE_KEYS.PROJECTS) === true, 'Unassigned ADMIN retains baseline EDIT on projects');
    assert(canEdit(unassignedAdmin, CRM_MODULE_KEYS.PAYROLL_PROCESS) === true, 'Unassigned ADMIN retains baseline EDIT on payroll_process');

    // -------------------------------------------------------------
    // Group 6: Live Socket.IO Active-Session Permission Refresh
    // -------------------------------------------------------------
    console.log('\n--- GROUP 6: Real-Time Active-Session Permission Refresh via Socket.IO ---');

    // Connect socket client as testUser
    let socketReceivedUpdatedEvent = false;
    let receivedPayload = null;

    await new Promise((resolve) => {
      socketInstance = ioClient(BASE_URL, {
        auth: { token: userToken },
        transports: ['websocket', 'polling']
      });

      socketInstance.on('connect', () => {
        socketInstance.emit('register', {
          userId: testUser.id,
          name: testUser.name,
          role: testUser.role
        });
        resolve();
      });

      socketInstance.on('access_template_updated', (data) => {
        socketReceivedUpdatedEvent = true;
        receivedPayload = data;
      });
    });

    assert(socketInstance.connected === true, 'Socket.IO client connected and registered active session');

    // Super Admin updates testTemplate permissions:
    // Change assets from VIEW -> EDIT
    // Change projects from EDIT -> NONE
    // Change payroll from NONE -> VIEW
    const updateTplRes = await apiRequest('PUT', `/api/super-admin/access-templates/${testTemplate.id}`, superAdminToken, {
      permissions: [
        { moduleKey: CRM_MODULE_KEYS.PROJECTS, accessLevel: ACCESS_LEVELS.NONE },
        { moduleKey: CRM_MODULE_KEYS.ASSETS, accessLevel: ACCESS_LEVELS.EDIT },
        { moduleKey: CRM_MODULE_KEYS.PAYROLL_PROCESS, accessLevel: ACCESS_LEVELS.VIEW }
      ]
    });

    assert(updateTplRes.status === 200, 'Super Admin updates template permissions', `Status: ${updateTplRes.status}`);

    // Wait briefly for socket broadcast
    await new Promise((resolve) => setTimeout(resolve, 800));

    assert(socketReceivedUpdatedEvent === true, 'Active session received access_template_updated socket event without logout');
    assert(receivedPayload && String(receivedPayload.templateId) === String(testTemplate.id), 'Socket event payload matches updated templateId');

    // Active session refreshes profile using GET /api/auth/profile
    const refreshedProfileRes = await apiRequest('GET', '/api/auth/profile', userToken);
    const refreshedProfile = refreshedProfileRes.data.user || refreshedProfileRes.data;

    assert(refreshedProfile.effectivePermissions[CRM_MODULE_KEYS.PROJECTS] === ACCESS_LEVELS.NONE, 'Projects permission immediately revoked to NONE in active session');
    assert(refreshedProfile.effectivePermissions[CRM_MODULE_KEYS.ASSETS] === ACCESS_LEVELS.EDIT, 'Assets permission immediately promoted to EDIT in active session');
    assert(refreshedProfile.effectivePermissions[CRM_MODULE_KEYS.PAYROLL_PROCESS] === ACCESS_LEVELS.VIEW, 'Payroll permission immediately promoted to VIEW in active session');

    // Dynamic Navigation verification after live refresh
    assert(canView(refreshedProfile, CRM_MODULE_KEYS.PROJECTS) === false, 'Projects now hidden from sidebar in active session');
    assert(canEdit(refreshedProfile, CRM_MODULE_KEYS.ASSETS) === true, 'Asset mutation buttons now visible in active session');
    assert(canView(refreshedProfile, CRM_MODULE_KEYS.PAYROLL_PROCESS) === true, 'Payroll link now visible in active session');
    assert(canEdit(refreshedProfile, CRM_MODULE_KEYS.PAYROLL_PROCESS) === false, 'Payroll mutation buttons remain hidden in active session');

    // -------------------------------------------------------------
    // Group 7: Direct Backend API Enforcement Security
    // -------------------------------------------------------------
    console.log('\n--- GROUP 7: Backend Authorization Enforcement Integrity ---');
    // Attempting direct backend mutation on projects (which is now NONE for testUser)
    const directProjectCreate = await apiRequest('POST', '/api/projects', userToken, {
      name: 'Unauthorized Project Attempt',
      description: 'Should be rejected'
    });
    assert(directProjectCreate.status === 403, 'Direct backend API call rejected with 403 Forbidden when module access is revoked', `Status: ${directProjectCreate.status}`);

    // Direct backend access on super admin template endpoint with employee token
    const directSuperAdminCall = await apiRequest('GET', '/api/super-admin/access-templates', userToken);
    assert(directSuperAdminCall.status === 403, 'Normal user token rejected on Super Admin management route', `Status: ${directSuperAdminCall.status}`);

    // -------------------------------------------------------------
    // Group 8: Organization Isolation
    // -------------------------------------------------------------
    console.log('\n--- GROUP 8: Organization Isolation ---');
    if (testOrg2) {
      const org2TplRes = await apiRequest('GET', `/api/super-admin/access-templates?organizationId=${testOrg2.id}`, superAdminToken);
      const org2Templates = org2TplRes.data.templates || [];
      const hasOrg1Tpl = org2Templates.some(t => t.id === testTemplate.id);
      assert(!hasOrg1Tpl, 'Templates from Organization 1 are isolated from Organization 2 query');
    } else {
      console.log('  \x1b[33mSKIP\x1b[0m Secondary organization not present in test database');
    }

  } catch (err) {
    console.error('\n\x1b[31m[ERROR] Exception during test execution:\x1b[0m', err);
    failed++;
  } finally {
    if (socketInstance) {
      socketInstance.disconnect();
    }

    // Clean up created test data
    console.log('\n--- CLEANUP ---');
    if (testUser) {
      try {
        await prisma.user.delete({ where: { id: testUser.id } });
        console.log(`[CLEANUP] Deleted test user: ${testUser.id}`);
      } catch (e) {
        console.warn(`[CLEANUP] Failed to delete test user: ${e.message}`);
      }
    }
    if (testTemplate) {
      try {
        await prisma.accessTemplatePermission.deleteMany({ where: { templateId: testTemplate.id } });
        await prisma.accessTemplate.delete({ where: { id: testTemplate.id } });
        console.log(`[CLEANUP] Deleted test template: ${testTemplate.id}`);
      } catch (e) {
        console.warn(`[CLEANUP] Failed to delete test template: ${e.message}`);
      }
    }

    console.log('\n============================================================');
    console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('============================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  }
}

runPhase4TestSuite();
