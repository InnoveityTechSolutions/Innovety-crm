const http = require('http');
const path = require('path');
const jwt = require('../backend/node_modules/jsonwebtoken');
require('../backend/node_modules/dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const prisma = require('../backend/src/utils/db');
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

async function runPhase3TestSuite() {
  console.log('\n============================================================');
  console.log('   INNOVEITY CRM — PHASE 3 UI & INTEGRATION TEST SUITE     ');
  console.log('============================================================\n');

  try {
    const superAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } });
    const employee = await prisma.user.findFirst({ where: { role: 'EMPLOYEE', status: 'ACTIVE' } });
    const org = await prisma.organization.findFirst({ where: { status: 'ACTIVE' } });

    if (!superAdmin || !org) throw new Error('Missing test seed data (SuperAdmin or Organization).');

    const saToken = createToken(superAdmin);
    const empToken = employee ? createToken(employee) : null;

    console.log(`[Context] Super Admin: ${superAdmin.email} | Target Org: ${org.name} (${org.id})\n`);

    // 1. Route Security & Non-Super Admin Rejection
    console.log('--- 1. ROUTE SECURITY & ROLE GUARDS ---');
    {
      const saAccess = await apiRequest('GET', `/api/super-admin/access-templates?organizationId=${org.id}`, saToken);
      assert(saAccess.status === 200, 'Super Admin granted access to access-templates endpoint (200)');

      if (empToken) {
        const empAccess = await apiRequest('GET', `/api/super-admin/access-templates?organizationId=${org.id}`, empToken);
        assert(empAccess.status === 403, 'Regular employee rejected from super-admin access templates with 403 Forbidden');
      }

      const unauth = await apiRequest('GET', `/api/super-admin/access-templates?organizationId=${org.id}`);
      assert(unauth.status === 401, 'Unauthenticated request rejected with 401 Unauthorized');
    }

    // 2. Module Registry Structure for Template Matrix
    console.log('\n--- 2. MODULE REGISTRY CATEGORIES & EXCLUSIONS ---');
    let modulesList = [];
    {
      const modRes = await apiRequest('GET', '/api/super-admin/access-templates/modules', saToken);
      assert(modRes.status === 200, 'Module registry loaded successfully (200)');
      modulesList = modRes.data?.modules || [];
      assert(modulesList.length === 31, `Exactly 31 operational modules returned (found: ${modulesList.length})`);

      const categories = new Set(modulesList.map(m => m.category));
      assert(categories.has('Overview'), 'Categories include Overview');
      assert(categories.has('Workspaces'), 'Categories include Workspaces');
      assert(categories.has('Communication'), 'Categories include Communication');
      assert(categories.has('Operations'), 'Categories include Operations');
      assert(categories.has('Finance & Payroll'), 'Categories include Finance & Payroll');
      assert(categories.has('System Control'), 'Categories include System Control');

      const profileMod = modulesList.find(m => m.key === 'profile');
      assert(profileMod?.isUniversalSelfService === true, 'My Profile marked as isUniversalSelfService');

      const hasPlatformMod = modulesList.some(m => m.key.startsWith('platform') || m.key.startsWith('super_admin'));
      assert(!hasPlatformMod, 'Platform-control modules excluded from tenant grantable registry');
    }

    // 3. Template Creation via TemplateMatrixModal format
    console.log('\n--- 3. TEMPLATE CREATION & PERMISSION MATRIX SAVING ---');
    let createdTemplateId = null;
    {
      const createPayload = {
        name: `Phase 3 Matrix Template ${Date.now()}`,
        description: 'Template created via Phase 3 modal workflow',
        baseRole: 'EMPLOYEE',
        organizationId: org.id,
        permissions: [
          { moduleKey: 'projects', accessLevel: 'VIEW' },
          { moduleKey: 'tasks', accessLevel: 'EDIT' },
          { moduleKey: 'attendance', accessLevel: 'VIEW' },
          { moduleKey: 'leave_management', accessLevel: 'VIEW' },
          { moduleKey: 'assets', accessLevel: 'EDIT' },
          { moduleKey: 'tickets', accessLevel: 'NONE' }
        ]
      };

      const createRes = await apiRequest('POST', '/api/super-admin/access-templates', saToken, createPayload);
      assert(createRes.status === 201 && createRes.data?.template?.id, 'Template created successfully via API (201)');
      createdTemplateId = createRes.data?.template?.id;

      // Verify single fetch includes accurate 0 member count
      const singleRes = await apiRequest('GET', `/api/super-admin/access-templates/${createdTemplateId}`, saToken);
      assert(singleRes.data?.template?.totalMembers === 0, 'New template initializes with 0 total members');
      assert(singleRes.data?.template?.activeMembers === 0, 'New template initializes with 0 active members');
      assert(singleRes.data?.template?.permissions?.length === 5, '5 valid VIEW/EDIT permissions stored (NONE omitted)');
    }

    // 4. Template List filtering by Organization
    console.log('\n--- 4. TEMPLATE LISTING & ORGANIZATION SCOPE FILTERING ---');
    {
      const listRes = await apiRequest('GET', `/api/super-admin/access-templates?organizationId=${org.id}`, saToken);
      assert(listRes.status === 200, 'Listing templates for target org succeeded (200)');
      const found = listRes.data?.templates?.some(t => t.id === createdTemplateId);
      assert(found, 'Created template present in target organization template list');

      // Test search filter
      const searchRes = await apiRequest('GET', `/api/super-admin/access-templates?organizationId=${org.id}&search=Phase%203`, saToken);
      const searchFound = searchRes.data?.templates?.some(t => t.id === createdTemplateId);
      assert(searchFound, 'Search query correctly locates template');

      // Test role filter
      const roleFilterRes = await apiRequest('GET', `/api/super-admin/access-templates?organizationId=${org.id}&role=EMPLOYEE`, saToken);
      const roleFound = roleFilterRes.data?.templates?.some(t => t.id === createdTemplateId);
      assert(roleFound, 'Role filter correctly includes template with matching baseRole');
    }

    // 5. User Registration via RegisterTemplateUserModal workflow
    console.log('\n--- 5. USER REGISTRATION WORKFLOW & LIVE MEMBER COUNT ---');
    let registeredUserId = null;
    const testEmail = `phase3_user_${Date.now()}@example.com`;
    {
      const regPayload = {
        name: 'Phase 3 UI Tested Member',
        email: testEmail,
        password: 'InitialUserPass@123',
        phone: '9876543210',
        department: 'Engineering',
        designation: 'Associate QA',
        status: 'ACTIVE'
      };

      const regRes = await apiRequest('POST', `/api/super-admin/access-templates/${createdTemplateId}/register-user`, saToken, regPayload);
      assert(regRes.status === 201 && regRes.data?.user?.id, 'User registered successfully from template (201)');
      registeredUserId = regRes.data?.user?.id;
      assert(regRes.data?.user?.employeeId?.startsWith('EM-'), `Employee ID generated with proper prefix: ${regRes.data?.user?.employeeId}`);

      // Verify template counts updated to 1
      const updatedTplRes = await apiRequest('GET', `/api/super-admin/access-templates/${createdTemplateId}`, saToken);
      assert(updatedTplRes.data?.template?.totalMembers === 1, 'totalMembers incremented to 1 after registration');
      assert(updatedTplRes.data?.template?.activeMembers === 1, 'activeMembers incremented to 1 after registration');

      // 6. Template Assigned Members Drawer fetch
      const membersRes = await apiRequest('GET', `/api/super-admin/access-templates/${createdTemplateId}/members`, saToken);
      assert(membersRes.status === 200, 'Assigned members endpoint returns 200');
      const memberEntry = membersRes.data?.members?.find(m => m.id === registeredUserId);
      assert(Boolean(memberEntry), 'Registered user appears in template members list');
      assert(memberEntry?.email === testEmail, 'Member entry email matches registered email');
    }

    // 7. Template Duplication Workflow
    console.log('\n--- 7. TEMPLATE DUPLICATION WORKFLOW ---');
    let clonedTemplateId = null;
    {
      const dupPayload = { name: `Phase 3 Matrix Template (Clone) ${Date.now()}` };
      const dupRes = await apiRequest('POST', `/api/super-admin/access-templates/${createdTemplateId}/duplicate`, saToken, dupPayload);
      assert(dupRes.status === 201 && dupRes.data?.template?.id, 'Template duplicated successfully (201)');
      clonedTemplateId = dupRes.data?.template?.id;

      // Cloned template initializes with 0 members
      const cloneFetch = await apiRequest('GET', `/api/super-admin/access-templates/${clonedTemplateId}`, saToken);
      assert(cloneFetch.data?.template?.totalMembers === 0, 'Cloned template starts with 0 assigned members');
      assert(cloneFetch.data?.template?.permissions?.length === 5, 'Cloned template inherits all 5 permission records');
    }

    // 8. Guarded Deletion Workflow
    console.log('\n--- 8. GUARDED DELETION WORKFLOW ---');
    {
      // Attempt to delete original template (has 1 member)
      const deleteBlocked = await apiRequest('DELETE', `/api/super-admin/access-templates/${createdTemplateId}`, saToken);
      assert(deleteBlocked.status === 400, 'Deletion of template with assigned members blocked with HTTP 400');

      // Delete clone template (has 0 members)
      const deleteAllowed = await apiRequest('DELETE', `/api/super-admin/access-templates/${clonedTemplateId}`, saToken);
      assert(deleteAllowed.status === 200, 'Deletion of template with 0 members succeeds with HTTP 200');
      clonedTemplateId = null; // Cleaned up
    }

    // 9. Status Toggle Workflow
    console.log('\n--- 9. TEMPLATE STATUS TOGGLE WORKFLOW ---');
    {
      const deactRes = await apiRequest('PUT', `/api/super-admin/access-templates/${createdTemplateId}/status`, saToken, { status: 'INACTIVE' });
      assert(deactRes.status === 200 && deactRes.data?.status === 'INACTIVE', 'Status toggle to INACTIVE succeeds');

      // Verify inactive template rejects new registrations
      const blockedReg = await apiRequest('POST', `/api/super-admin/access-templates/${createdTemplateId}/register-user`, saToken, {
        name: 'Blocked User',
        email: `blocked_${Date.now()}@example.com`,
        password: 'Password123!'
      });
      assert(blockedReg.status === 400, 'Registration against INACTIVE template rejected with 400');

      // Reactivate template
      const reactRes = await apiRequest('PUT', `/api/super-admin/access-templates/${createdTemplateId}/status`, saToken, { status: 'ACTIVE' });
      assert(reactRes.status === 200 && reactRes.data?.status === 'ACTIVE', 'Status toggle back to ACTIVE succeeds');
    }

    // Cleanup fixtures
    console.log('\n--- CLEANUP FIXTURES ---');
    {
      if (registeredUserId) {
        await prisma.user.delete({ where: { id: registeredUserId } }).catch(() => {});
        console.log(`  Cleaned up test user: ${registeredUserId}`);
      }
      if (createdTemplateId) {
        await prisma.accessTemplatePermission.deleteMany({ where: { templateId: createdTemplateId } }).catch(() => {});
        await prisma.accessTemplate.delete({ where: { id: createdTemplateId } }).catch(() => {});
        console.log(`  Cleaned up test template: ${createdTemplateId}`);
      }
    }

    console.log('\n============================================================');
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('============================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Phase 3 Test Fatal Error:', err);
    process.exit(1);
  }
}

runPhase3TestSuite();
