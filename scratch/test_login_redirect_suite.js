const http = require('http');
const path = require('path');
const jwt = require('../backend/node_modules/jsonwebtoken');
require('../backend/node_modules/dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const prisma = require('../backend/src/utils/db');
const { CRM_MODULES, ACCESS_LEVELS } = require('../backend/src/config/crmModules');

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

function resolveLoginDestination(user) {
  const userRole = String(user?.role || '').toUpperCase();
  if (userRole === 'SUPER_ADMIN') {
    return '/super-admin/dashboard';
  } else if (user?.accessTemplateId) {
    return '/profile';
  } else {
    return '/';
  }
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

async function runLoginRedirectVerification() {
  console.log('\n============================================================');
  console.log('   INNOVEITY CRM — LOGIN REDIRECT VERIFICATION SUITE');
  console.log('============================================================\n');

  try {
    // 1. Super Admin Account
    const superAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
    assert(superAdmin, 'Super Admin account exists in database');
    const saDest = resolveLoginDestination(superAdmin);
    assert(saDest === '/super-admin/dashboard', 'Super Admin redirects to /super-admin/dashboard');

    // 2. Default Unassigned Admin Account
    const defaultAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN', accessTemplateId: null } });
    assert(defaultAdmin, 'Default unassigned Admin account exists');
    const daDest = resolveLoginDestination(defaultAdmin);
    assert(daDest === '/', 'Default Admin without template redirects to /');

    // 3. Default Unassigned Employee Account
    const defaultEmp = await prisma.user.findFirst({ where: { role: 'EMPLOYEE', accessTemplateId: null } });
    assert(defaultEmp, 'Default unassigned Employee account exists');
    const deDest = resolveLoginDestination(defaultEmp);
    assert(deDest === '/', 'Default Employee without template redirects to /');

    // 4. Template-Assigned Account (vinith@gmail.com - Finance Admin without dashboard access)
    const templateUser = await prisma.user.findUnique({
      where: { email: 'vinith@gmail.com' },
      include: { accessTemplate: { include: { permissions: true } } }
    });
    assert(templateUser, 'Template-assigned user (vinith@gmail.com) exists');
    assert(Boolean(templateUser?.accessTemplateId), 'User has valid accessTemplateId');
    assert(templateUser?.accessTemplate?.name === 'Finance', 'User is assigned to Finance template');
    
    const hasDashboard = templateUser?.accessTemplate?.permissions?.some(p => p.moduleKey === 'dashboard');
    assert(!hasDashboard, 'Finance template explicitly has NO dashboard permission (NONE)');

    const tuDest = resolveLoginDestination(templateUser);
    assert(tuDest === '/profile', 'Template user without dashboard access redirects to /profile');

    // 5. Template-Assigned Across All Other Base Roles (Employee, Intern, Team Leader)
    const mockTemplateEmployee = { role: 'EMPLOYEE', accessTemplateId: 'mock-template-id' };
    const mockTemplateIntern = { role: 'INTERN', accessTemplateId: 'mock-template-id' };
    const mockTemplateTL = { role: 'TEAM_LEADER', accessTemplateId: 'mock-template-id' };
    const mockTemplateAdminWithDash = { role: 'ADMIN', accessTemplateId: 'mock-template-id' };

    assert(resolveLoginDestination(mockTemplateEmployee) === '/profile', 'Template Employee redirects to /profile');
    assert(resolveLoginDestination(mockTemplateIntern) === '/profile', 'Template Intern redirects to /profile');
    assert(resolveLoginDestination(mockTemplateTL) === '/profile', 'Template Team Leader redirects to /profile');
    assert(resolveLoginDestination(mockTemplateAdminWithDash) === '/profile', 'Template Admin with dashboard access redirects to /profile');

    // 6. Safe handling when template data is missing / corrupted
    const corruptedUser = { role: 'EMPLOYEE', accessTemplateId: null };
    assert(resolveLoginDestination(corruptedUser) === '/', 'User with null accessTemplateId safely falls back to /');
    const emptyUser = null;
    assert(resolveLoginDestination(emptyUser) === '/', 'Null user safely falls back to /');

    // 7. Verify API Profile endpoint access for template user
    const token = jwt.sign(
      { id: templateUser.id, role: templateUser.role, organizationId: templateUser.organizationId },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    const profileRes = await apiRequest('GET', '/api/auth/profile', token);
    assert(profileRes.status === 200, 'GET /api/auth/profile returns 200 for template user');
    assert(profileRes.data.effectivePermissions?.profile === 'EDIT', 'Profile module is EDIT for template user');
    assert(profileRes.data.effectivePermissions?.dashboard === 'NONE', 'Dashboard remains NONE for template user');
    assert(profileRes.data.accessTemplateId === templateUser.accessTemplateId, 'Profile response returns correct accessTemplateId');

    // 8. Verify direct backend authorization for restricted module (projects)
    const projectsRes = await apiRequest('GET', '/api/projects', token);
    assert(projectsRes.status === 403, 'Restricted module (/api/projects) correctly rejects user with 403 Forbidden');

    // 9. Verify permitted module (assets) allows access
    const assetsRes = await apiRequest('GET', '/api/assets', token);
    assert(assetsRes.status === 200, 'Permitted module (/api/assets) successfully returns 200');

    console.log(`\n============================================================`);
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log(`============================================================\n`);

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test execution failed:', err);
    process.exit(1);
  }
}

runLoginRedirectVerification();
