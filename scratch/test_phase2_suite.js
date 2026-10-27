const http = require('http');
const path = require('path');
const jwt = require('../backend/node_modules/jsonwebtoken');
const bcrypt = require('../backend/node_modules/bcrypt');
require('../backend/node_modules/dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const prisma = require('../backend/src/utils/db');
const { CRM_MODULES, ACCESS_LEVELS } = require('../backend/src/config/crmModules');

const PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'enterprise_internship_crm_super_secret_jwt_key_123!';

// Simple HTTP request helper
function apiRequest(method, endpoint, token = null, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed
        });
      });
    });

    req.on('error', (err) => reject(err));

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      organizationId: user.organizationId,
      organizationSlug: 'innoveity'
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    passedTests++;
    console.log(`  \x1b[32mPASS\x1b[0m ${testName}`);
  } else {
    failedTests++;
    console.error(`  \x1b[31mFAIL\x1b[0m ${testName} ${details ? '- ' + details : ''}`);
  }
}

async function runPhase2TestSuite() {
  console.log('\n============================================================');
  console.log('   INNOVEITY CRM — PHASE 2 BACKEND PERMISSIONS TEST SUITE   ');
  console.log('============================================================\n');

  try {
    // 0. Setup: Find or verify Super Admin, Organization, and sample users
    const superAdmin = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN', status: 'ACTIVE' }
    });
    if (!superAdmin) {
      throw new Error('No active SUPER_ADMIN user found in database for testing.');
    }

    const org = await prisma.organization.findFirst({
      where: { status: 'ACTIVE' }
    });
    if (!org) {
      throw new Error('No active Organization found in database for testing.');
    }

    const regularEmployee = await prisma.user.findFirst({
      where: { role: 'EMPLOYEE', status: 'ACTIVE' }
    });

    const superAdminToken = createToken(superAdmin);
    const employeeToken = regularEmployee ? createToken(regularEmployee) : null;

    console.log(`[Context] Super Admin: ${superAdmin.email} | Org: ${org.name} (${org.id})`);

    // TEST SUITE 1: Super Admin-only endpoint protection
    console.log('\n--- 1. SUPER ADMIN-ONLY ROUTE PROTECTION ---');
    {
      const unauthRes = await apiRequest('GET', '/api/super-admin/access-templates');
      assert(unauthRes.status === 401, 'Unauthenticated request to access templates is rejected (401)');

      if (employeeToken) {
        const forbiddenRes = await apiRequest('GET', '/api/super-admin/access-templates', employeeToken);
        assert(forbiddenRes.status === 403, 'Non-Super Admin user is rejected from access templates (403)');
      }

      const superRes = await apiRequest('GET', `/api/super-admin/access-templates?organizationId=${org.id}`, superAdminToken);
      assert(superRes.status === 200 && Array.isArray(superRes.data.templates), 'Super Admin is authorized to list access templates (200)');
    }

    // TEST SUITE 2: Module Registry Endpoint
    console.log('\n--- 2. CRM MODULE REGISTRY FETCH ---');
    {
      const modulesRes = await apiRequest('GET', '/api/super-admin/access-templates/modules', superAdminToken);
      assert(modulesRes.status === 200, 'Super Admin can fetch available CRM modules registry (200)');
      assert(modulesRes.data.modules?.length === 31, `All 31 operational modules returned (found: ${modulesRes.data.modules?.length})`);
      assert(
        !modulesRes.data.modules?.some(m => m.key.startsWith('platform') || m.key === 'super_admin'),
        'Platform infrastructure routes are excluded from tenant templates'
      );
    }

    // TEST SUITE 3: Template Creation & Transactional Integrity
    console.log('\n--- 3. TEMPLATE CREATION & VALIDATION ---');
    let createdTemplateId = null;
    {
      // Missing organizationId
      const missingOrgRes = await apiRequest('POST', '/api/super-admin/access-templates', superAdminToken, {
        name: 'Invalid Template',
        baseRole: 'EMPLOYEE'
      });
      assert(missingOrgRes.status === 400, 'Creation without organizationId is rejected (400)');

      // Attempt to create SUPER_ADMIN template (privilege escalation prevention)
      const superAdminRoleRes = await apiRequest('POST', '/api/super-admin/access-templates', superAdminToken, {
        name: 'Super Admin Template Attempt',
        baseRole: 'SUPER_ADMIN',
        organizationId: org.id
      });
      assert(superAdminRoleRes.status === 400, 'Creation with baseRole SUPER_ADMIN is rejected (400)');

      // Valid Creation with transaction
      const templatePayload = {
        name: `Test Engineering Template ${Date.now()}`,
        description: 'Template for Phase 2 permission verification',
        baseRole: 'EMPLOYEE',
        organizationId: org.id,
        permissions: [
          { moduleKey: 'projects', accessLevel: 'VIEW' },
          { moduleKey: 'assets', accessLevel: 'EDIT' },
          { moduleKey: 'tickets', accessLevel: 'NONE' },
          { moduleKey: 'attendance', accessLevel: 'VIEW' },
          { moduleKey: 'leave_management', accessLevel: 'VIEW' }
        ]
      };

      const createRes = await apiRequest('POST', '/api/super-admin/access-templates', superAdminToken, templatePayload);
      assert(createRes.status === 201 && createRes.data.template?.id, 'Template created successfully with transaction (201)');
      createdTemplateId = createRes.data.template?.id;

      // Verify permissions saved in DB (VIEW/EDIT are stored, NONE is omitted)
      const dbPerms = await prisma.accessTemplatePermission.findMany({
        where: { templateId: createdTemplateId }
      });
      assert(dbPerms.length === 4, `Permissions saved transactionally in database (count: ${dbPerms.length}, NONE is omitted)`);
    }

    // TEST SUITE 4: Template Details & Permissions Update
    console.log('\n--- 4. TEMPLATE UPDATE (TRANSACTIONAL PERMISSION REPLACEMENT) ---');
    {
      const updatePayload = {
        name: `Updated Test Template ${Date.now()}`,
        description: 'Updated description',
        permissions: [
          { moduleKey: 'projects', accessLevel: 'VIEW' },
          { moduleKey: 'assets', accessLevel: 'EDIT' },
          { moduleKey: 'tickets', accessLevel: 'NONE' },
          { moduleKey: 'attendance', accessLevel: 'VIEW' },
          { moduleKey: 'leave_management', accessLevel: 'VIEW' },
          { moduleKey: 'announcements', accessLevel: 'VIEW' }
        ]
      };

      const updateRes = await apiRequest('PUT', `/api/super-admin/access-templates/${createdTemplateId}`, superAdminToken, updatePayload);
      assert(updateRes.status === 200, 'Template updated successfully (200)');
      assert(updateRes.data.template?.permissions?.length === 5, 'Template permissions transactionally updated to 5 stored records');
    }

    // TEST SUITE 5: Template Duplication
    console.log('\n--- 5. TEMPLATE DUPLICATION (INTRA-ORGANIZATION) ---');
    let duplicatedTemplateId = null;
    {
      const dupRes = await apiRequest('POST', `/api/super-admin/access-templates/${createdTemplateId}/duplicate`, superAdminToken, {
        name: `Duplicated Copy ${Date.now()}`
      });
      assert(dupRes.status === 201 && dupRes.data.template?.id, 'Template duplicated successfully (201)');
      duplicatedTemplateId = dupRes.data.template?.id;

      const dupPerms = await prisma.accessTemplatePermission.findMany({
        where: { templateId: duplicatedTemplateId }
      });
      assert(dupPerms.length === 5, `Duplicated template inherits all 5 stored permission records`);
    }

    // TEST SUITE 6: Template Status Toggle
    console.log('\n--- 6. TEMPLATE STATUS TOGGLE ---');
    {
      const deactivateRes = await apiRequest('PUT', `/api/super-admin/access-templates/${duplicatedTemplateId}/status`, superAdminToken, {
        status: 'INACTIVE'
      });
      assert(deactivateRes.status === 200 && deactivateRes.data.status === 'INACTIVE', 'Template status set to INACTIVE (200)');

      const activateRes = await apiRequest('PUT', `/api/super-admin/access-templates/${duplicatedTemplateId}/status`, superAdminToken, {
        status: 'ACTIVE'
      });
      assert(activateRes.status === 200 && activateRes.data.status === 'ACTIVE', 'Template status set back to ACTIVE (200)');
    }

    // TEST SUITE 7: Organization Isolation
    console.log('\n--- 7. STRICT ORGANIZATION ISOLATION ---');
    {
      // Attempt to access template with mismatched organization or spoofed query
      const fakeOrgId = 'fake_org_non_existent_123';
      const crossOrgRes = await apiRequest('GET', `/api/super-admin/access-templates?organizationId=${fakeOrgId}`, superAdminToken);
      assert(crossOrgRes.data.templates?.length === 0, 'No templates leaked for foreign or non-existent organization');

      // Attempt to duplicate into a foreign organization
      const foreignOrg = await prisma.organization.findFirst({
        where: { id: { not: org.id } }
      });
      if (foreignOrg) {
        console.log(`[Multi-tenant Check] Testing against secondary org: ${foreignOrg.name}`);
        // Attempt to access org's template by another org scope
        const foreignTemplates = await apiRequest('GET', `/api/super-admin/access-templates?organizationId=${foreignOrg.id}`, superAdminToken);
        const leaked = foreignTemplates.data.templates?.some(t => t.id === createdTemplateId);
        assert(!leaked, 'Organization A templates do not appear under Organization B filter');
      } else {
        console.log('  (Single organization present in test database, validated org-scope binding)');
      }
    }

    // TEST SUITE 8: User Registration from Template
    console.log('\n--- 8. USER REGISTRATION FROM TEMPLATE & QUOTA ENFORCEMENT ---');
    let templateUser = null;
    let templateUserToken = null;
    const testEmail = `template_test_user_${Date.now()}@example.com`;
    const initialPlainPassword = 'TempPassword123!';
    {
      // 1. Attempt registration from an inactive template
      await prisma.accessTemplate.update({
        where: { id: duplicatedTemplateId },
        data: { status: 'INACTIVE' }
      });
      const inactiveRegRes = await apiRequest('POST', `/api/super-admin/access-templates/${duplicatedTemplateId}/register-user`, superAdminToken, {
        name: 'Inactive Test User',
        email: `inactive_${Date.now()}@test.com`,
        password: 'Password123!'
      });
      assert(inactiveRegRes.status === 400, 'Registration from INACTIVE template is rejected (400)');

      // 2. Successful registration from active template
      const regRes = await apiRequest('POST', `/api/super-admin/access-templates/${createdTemplateId}/register-user`, superAdminToken, {
        name: 'Template Verified Employee',
        email: testEmail,
        password: initialPlainPassword,
        phone: '9876543210'
      });
      assert(regRes.status === 201 && regRes.data.user?.id, 'User registered successfully from template (201)');
      templateUser = regRes.data.user;

      // 3. Verify server-derived values (not client-trusting)
      assert(templateUser.organizationId === org.id, 'User organization strictly derived from template organization');
      assert(templateUser.role === 'EMPLOYEE', 'User role strictly derived from template baseRole');
      assert(templateUser.accessTemplateId === createdTemplateId, 'User correctly bound to template ID');
      assert(templateUser.employeeId?.startsWith('EM-'), `Employee ID auto-generated with proper prefix (${templateUser.employeeId})`);

      // 4. Verify password hashing (never plaintext)
      const dbUser = await prisma.user.findUnique({ where: { id: templateUser.id } });
      const passMatches = await bcrypt.compare(initialPlainPassword, dbUser.password);
      assert(passMatches === true, 'Initial password properly hashed with bcrypt and verifiable');
      assert(dbUser.password !== initialPlainPassword, 'Plaintext password is never stored in database');

      // 5. Duplicate email rejection
      const dupEmailRes = await apiRequest('POST', `/api/super-admin/access-templates/${createdTemplateId}/register-user`, superAdminToken, {
        name: 'Duplicate Test',
        email: testEmail,
        password: 'Password123!'
      });
      assert(dupEmailRes.status === 400, 'Registration with duplicate email is rejected (400)');

      // 6. Member Count Accuracy
      const singleTemplateRes = await apiRequest('GET', `/api/super-admin/access-templates/${createdTemplateId}`, superAdminToken);
      assert(singleTemplateRes.data.template?.totalMembers >= 1, `Total member count accurately reflects registered user (${singleTemplateRes.data.template?.totalMembers})`);
      assert(singleTemplateRes.data.template?.activeMembers >= 1, `Active member count accurately reflects registered user (${singleTemplateRes.data.template?.activeMembers})`);

      // 7. Guarded deletion: cannot delete template with assigned members
      const deleteBlockedRes = await apiRequest('DELETE', `/api/super-admin/access-templates/${createdTemplateId}`, superAdminToken);
      assert(deleteBlockedRes.status === 400, 'Deletion of template with assigned members is blocked (400)');

      // Create JWT for the new template user
      templateUserToken = createToken(dbUser);
    }

    // TEST SUITE 9: Actual Endpoint Permission Enforcement (NONE, VIEW, EDIT)
    console.log('\n--- 9. ACTUAL ENDPOINT PERMISSION ENFORCEMENT ---');
    {
      // The template has:
      // projects: VIEW
      // assets: EDIT
      // tickets: NONE
      // attendance: VIEW
      // leave_management: VIEW

      // 9a: projects has VIEW permission
      const projectsGetRes = await apiRequest('GET', '/api/projects', templateUserToken);
      assert(projectsGetRes.status === 200, 'Template user with projects: VIEW can list projects (200)');

      // 9b: direct API mutation on projects (requires EDIT -> must return 403 READ_ONLY_ACCESS)
      const projectMutationRes = await apiRequest('POST', '/api/projects', templateUserToken, {
        name: 'Unauthorized Project Attempt',
        description: 'Should fail'
      });
      assert(
        projectMutationRes.status === 403,
        `Direct API mutation blocked for VIEW-only user on projects (${projectMutationRes.status})`,
        projectMutationRes.data?.code || projectMutationRes.data?.message
      );

      // 9c: tickets has NONE permission (missing / revoked -> must return 403 PERMISSION_DENIED)
      const ticketsGetRes = await apiRequest('GET', '/api/tickets', templateUserToken);
      assert(
        ticketsGetRes.status === 403 && ticketsGetRes.data?.code === 'PERMISSION_DENIED',
        'User with tickets: NONE is denied read access with PERMISSION_DENIED (403)'
      );

      const ticketPostRes = await apiRequest('POST', '/api/tickets', templateUserToken, {
        subject: 'Denied Ticket',
        description: 'Should fail'
      });
      assert(
        ticketPostRes.status === 403 && ticketPostRes.data?.code === 'PERMISSION_DENIED',
        'User with tickets: NONE is denied create mutation with PERMISSION_DENIED (403)'
      );

      // 9d: assets has EDIT permission
      const assetsGetRes = await apiRequest('GET', '/api/assets', templateUserToken);
      assert(assetsGetRes.status === 200, 'Template user with assets: EDIT can list assets (200)');
    }

    // TEST SUITE 10: Dynamic Permission Inheritance & Revocation
    console.log('\n--- 10. DYNAMIC PERMISSION INHERITANCE (LIVE UPDATE) ---');
    {
      // Change template permissions: revoke projects access (set to NONE)
      await apiRequest('PUT', `/api/super-admin/access-templates/${createdTemplateId}`, superAdminToken, {
        name: 'Template - Projects Revoked',
        permissions: [
          { moduleKey: 'projects', accessLevel: 'NONE' },
          { moduleKey: 'assets', accessLevel: 'EDIT' },
          { moduleKey: 'tickets', accessLevel: 'NONE' },
          { moduleKey: 'attendance', accessLevel: 'VIEW' },
          { moduleKey: 'leave_management', accessLevel: 'VIEW' }
        ]
      });

      // User makes immediate next request with their EXISTING token
      const revokedProjectsRes = await apiRequest('GET', '/api/projects', templateUserToken);
      assert(
        revokedProjectsRes.status === 403 && revokedProjectsRes.data?.code === 'PERMISSION_DENIED',
        'Dynamically revoked permissions immediately enforced by backend on next request (403)'
      );

      // Re-grant projects to VIEW
      await apiRequest('PUT', `/api/super-admin/access-templates/${createdTemplateId}`, superAdminToken, {
        name: 'Template - Projects Restored',
        permissions: [
          { moduleKey: 'projects', accessLevel: 'VIEW' },
          { moduleKey: 'assets', accessLevel: 'EDIT' },
          { moduleKey: 'tickets', accessLevel: 'NONE' },
          { moduleKey: 'attendance', accessLevel: 'VIEW' },
          { moduleKey: 'leave_management', accessLevel: 'VIEW' }
        ]
      });

      const restoredProjectsRes = await apiRequest('GET', '/api/projects', templateUserToken);
      assert(restoredProjectsRes.status === 200, 'Restored permissions immediately available without re-login (200)');
    }

    // TEST SUITE 11: My Profile Access & Self-Elevation Prevention
    console.log('\n--- 11. MY PROFILE SELF-SERVICE & PRIVILEGE PRESERVATION ---');
    {
      // 11a: My Profile is accessible
      const profileRes = await apiRequest('GET', '/api/auth/profile', templateUserToken);
      assert(profileRes.status === 200, 'My Profile is accessible for template-assigned user (200)');
      assert(profileRes.data.effectivePermissions !== undefined, 'Profile response includes live effectivePermissions map');
      assert(profileRes.data.accessTemplate?.id === createdTemplateId, 'Profile response includes assigned accessTemplate details');

      // 11b: Attempt self-elevation via PUT /api/auth/profile
      const elevationRes = await apiRequest('PUT', '/api/auth/profile', templateUserToken, {
        role: 'SUPER_ADMIN',
        organizationId: 'malicious_org',
        accessTemplateId: 'spoofed_template'
      });
      assert(elevationRes.status === 200, 'Profile update request processed (200)');

      // Verify DB record remained untouched for sensitive authorization fields
      const refreshedUser = await prisma.user.findUnique({ where: { id: templateUser.id } });
      assert(refreshedUser.role === 'EMPLOYEE', 'User role NOT modified by self-profile update (still EMPLOYEE)');
      assert(refreshedUser.organizationId === org.id, 'Organization NOT modified by self-profile update');
      assert(refreshedUser.accessTemplateId === createdTemplateId, 'Template assignment NOT modified by self-profile update');
    }

    // TEST SUITE 12: Backward Compatibility for Existing Users (accessTemplateId == null)
    console.log('\n--- 12. UNASSIGNED USERS BACKWARD COMPATIBILITY ---');
    {
      if (regularEmployee && regularEmployee.accessTemplateId === null) {
        const unassignedToken = createToken(regularEmployee);
        const profileRes = await apiRequest('GET', '/api/auth/profile', unassignedToken);
        assert(profileRes.status === 200, 'Existing user without template retrieves profile (200)');
        assert(profileRes.data.accessTemplate === null, 'accessTemplate is null for unassigned user');
        assert(
          profileRes.data.effectivePermissions?.projects === 'VIEW',
          'Unassigned EMPLOYEE receives verified crmModules role baseline (projects: VIEW)'
        );

        const projectListRes = await apiRequest('GET', '/api/projects', unassignedToken);
        assert(projectListRes.status === 200, 'Unassigned user can access existing permitted module (projects) (200)');
      } else {
        console.log('  (All test users currently assigned or no null user found; verifying via permissionService)');
        const { getUserEffectivePermissions } = require('../backend/src/services/permissionService');
        const fallback = await getUserEffectivePermissions({ id: 'dummy', role: 'EMPLOYEE', accessTemplateId: null });
        assert(fallback.projects === 'VIEW', 'Role baseline fallback correctly resolved by permissionService');
        assert(fallback.profile === 'EDIT', 'Profile universal self-service guaranteed');
      }
    }

    // TEST SUITE 13: Attendance, Leave, and Payroll Regressions
    console.log('\n--- 13. DOMAIN-SPECIFIC SENSITIVE FLOW REGRESSIONS ---');
    {
      // 13a: Attendance punch status (self-service) works for template user with attendance: VIEW
      const attStatusRes = await apiRequest('GET', '/api/attendance/status', templateUserToken);
      assert(attStatusRes.status === 200, 'Attendance self-service status endpoint accessible (200)');

      // 13b: Attendance managerial override PUT /:id requires attendance_audit: EDIT & ADMIN role
      const attOverrideRes = await apiRequest('PUT', '/api/attendance/dummy-record-id', templateUserToken, {
        status: 'PRESENT'
      });
      assert(attOverrideRes.status === 403, 'Managerial attendance override denied for standard template user (403)');

      // 13c: Leave filing (self-service) requires leave_management: VIEW
      const leavesRes = await apiRequest('GET', '/api/leaves', templateUserToken);
      assert(leavesRes.status === 200, 'Leave viewing accessible for template user with leave_management: VIEW (200)');

      // 13d: Payroll process requires payroll_process: EDIT
      const payrollRes = await apiRequest('POST', '/api/payroll/process', templateUserToken, {
        month: 10,
        year: 2026
      });
      assert(
        payrollRes.status === 403,
        `Payroll process mutation blocked for template user without payroll_process permission (${payrollRes.status})`
      );
    }

    // Cleanup test user and test templates
    console.log('\n--- CLEANUP OF TEST FIXTURES ---');
    {
      if (templateUser) {
        await prisma.user.delete({ where: { id: templateUser.id } }).catch(() => {});
        console.log(`  Cleaned up test user: ${templateUser.id}`);
      }
      if (createdTemplateId) {
        await prisma.accessTemplatePermission.deleteMany({ where: { templateId: createdTemplateId } }).catch(() => {});
        await prisma.accessTemplate.delete({ where: { id: createdTemplateId } }).catch(() => {});
        console.log(`  Cleaned up test template: ${createdTemplateId}`);
      }
      if (duplicatedTemplateId) {
        await prisma.accessTemplatePermission.deleteMany({ where: { templateId: duplicatedTemplateId } }).catch(() => {});
        await prisma.accessTemplate.delete({ where: { id: duplicatedTemplateId } }).catch(() => {});
        console.log(`  Cleaned up duplicated template: ${duplicatedTemplateId}`);
      }
    }

    console.log('\n============================================================');
    console.log(`TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('============================================================\n');

    process.exit(failedTests > 0 ? 1 : 0);
  } catch (error) {
    console.error('\nTest Suite Fatal Error:', error);
    process.exit(1);
  }
}

runPhase2TestSuite();
