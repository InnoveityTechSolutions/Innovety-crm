const assert = require('assert');
const prisma = require('./backend/src/utils/db');
const jwt = require('./backend/node_modules/jsonwebtoken');
const http = require('http');
const { getTestConfig } = require('./backend/src/utils/testConfigHelper');

const testConfig = getTestConfig({ isDestructive: true });
const BASE_URL = testConfig.serverUrl;

function apiRequest({ method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('   PART 1: WFH PERMANENT SYSTEM LEAVE TYPE VERIFICATION TESTS    ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err.message}`);
      failed++;
    }
  }

  // 1. Get test users and tokens
  const superAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', organizationId: { not: null } } });
  const employee = await prisma.user.findFirst({ where: { role: 'EMPLOYEE', organizationId: admin.organizationId } });

  const superAdminToken = jwt.sign(
    { id: superAdmin.id, email: superAdmin.email, role: superAdmin.role, organizationId: admin.organizationId },
    process.env.JWT_SECRET || 'your-default-jwt-secret',
    { expiresIn: '1h' }
  );

  const adminToken = jwt.sign(
    { id: admin.id, email: admin.email, role: admin.role, organizationId: admin.organizationId },
    process.env.JWT_SECRET || 'your-default-jwt-secret',
    { expiresIn: '1h' }
  );

  const employeeToken = jwt.sign(
    { id: employee.id, email: employee.email, role: employee.role, organizationId: employee.organizationId },
    process.env.JWT_SECRET || 'your-default-jwt-secret',
    { expiresIn: '1h' }
  );

  const orgId = admin.organizationId;
  console.log(`Testing with Admin: ${admin.name} | Org: ${orgId} | Employee: ${employee.name}\n`);

  // =====================================================================
  // Test 1: WFH exists as a system leave type and is protected
  // =====================================================================
  await test('WFH exists in database with isSystem: true and code: "WFH"', async () => {
    const wfh = await prisma.leaveType.findFirst({
      where: { code: 'WFH' }
    });
    assert.ok(wfh, 'WFH leave type must exist in DB');
    assert.strictEqual(wfh.code, 'WFH', 'Code must be WFH');
    assert.strictEqual(wfh.isSystem, true, 'isSystem must be true');
    assert.strictEqual(wfh.isActive, true, 'isActive must be true by default');
  });

  // =====================================================================
  // Test 2: Core leave types (CL, SL, COMP_OFF, WFH) remain unaffected
  // =====================================================================
  await test('Existing CL, SL, COMP_OFF, and WFH are all system leave types', async () => {
    const systemTypes = await prisma.leaveType.findMany({
      where: { code: { in: ['CL', 'SL', 'COMP_OFF', 'WFH'] } }
    });
    const codes = systemTypes.map(t => t.code);
    assert.ok(codes.includes('CL'), 'CL must exist and be system type');
    assert.ok(codes.includes('SL'), 'SL must exist and be system type');
    assert.ok(codes.includes('COMP_OFF'), 'COMP_OFF must exist and be system type');
    assert.ok(codes.includes('WFH'), 'WFH must exist and be system type');
    for (const t of systemTypes) {
      assert.strictEqual(t.isSystem, true, `${t.code} must have isSystem: true`);
    }
  });

  // =====================================================================
  // Test 3: WFH cannot be deleted through API (direct DELETE request)
  // =====================================================================
  await test('WFH cannot be deleted via DELETE /api/leave-policy/types/:id (returns 400)', async () => {
    const wfh = await prisma.leaveType.findFirst({ where: { code: 'WFH' } });
    assert.ok(wfh, 'WFH record must exist');

    const res = await apiRequest({
      method: 'DELETE',
      path: `/api/leave-policy/types/${wfh.id}`,
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });

    assert.strictEqual(res.status, 400, 'Attempting to delete WFH must return HTTP 400');
    assert.ok(
      res.data?.message && res.data.message.includes('Work From Home (WFH) is a built-in system leave type and cannot be deleted'),
      `Error message must clearly state WFH is built-in and cannot be deleted. Got: ${res.data?.message}`
    );

    // Verify it was NOT deleted from DB
    const wfhStillInDb = await prisma.leaveType.findFirst({ where: { code: 'WFH' } });
    assert.ok(wfhStillInDb, 'WFH must still exist in DB after attempted deletion');
    assert.strictEqual(wfhStillInDb.id, wfh.id, 'WFH record must remain unchanged');
  });

  // =====================================================================
  // Test 4: Custom leave type with code WFH cannot be created
  // =====================================================================
  await test('Cannot create custom leave type with code WFH or name Work From Home', async () => {
    const res = await apiRequest({
      method: 'POST',
      path: '/api/leave-policy/types',
      headers: { Authorization: `Bearer ${superAdminToken}` },
      body: {
        name: 'Work From Home Duplicate',
        code: 'WFH',
        annualDays: 10
      }
    });

    assert.strictEqual(res.status, 400, 'Creating custom WFH must return HTTP 400');
    assert.ok(
      res.data?.message && res.data.message.includes('built-in system leave type'),
      `Message must state WFH is built-in. Got: ${res.data?.message}`
    );
  });

  // =====================================================================
  // Test 5: Disable WFH via Toggle and verify new applications are blocked
  // =====================================================================
  await test('Toggling WFH to Disabled blocks new WFH leave applications', async () => {
    const wfh = await prisma.leaveType.findFirst({ where: { code: 'WFH' } });

    // Step 5a: Disable WFH
    const toggleRes1 = await apiRequest({
      method: 'PUT',
      path: `/api/leave-policy/types/${wfh.id}/status`,
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    assert.strictEqual(toggleRes1.status, 200, 'Toggling status should succeed');
    assert.strictEqual(toggleRes1.data?.leaveType?.isActive, false, 'WFH should now be inactive');

    // Step 5b: Employee tries to apply for WFH
    const applyRes = await apiRequest({
      method: 'POST',
      path: '/api/leaves',
      headers: { Authorization: `Bearer ${employeeToken}` },
      body: {
        leaveType: 'WFH',
        startDate: '2026-11-10',
        endDate: '2026-11-10',
        reason: 'Testing disabled WFH policy'
      }
    });

    assert.strictEqual(applyRes.status, 400, 'Applying for disabled WFH must return HTTP 400');
    assert.ok(
      applyRes.data?.message && applyRes.data.message.includes('Work From Home (WFH) is not an active leave policy'),
      `Should reject disabled WFH application. Got: ${applyRes.data?.message}`
    );
  });

  // =====================================================================
  // Test 6: Re-enable WFH and verify applications are restored
  // =====================================================================
  await test('Re-enabling WFH allows employees to apply for WFH again', async () => {
    const wfh = await prisma.leaveType.findFirst({ where: { code: 'WFH' } });

    // Step 6a: Re-enable WFH
    const toggleRes2 = await apiRequest({
      method: 'PUT',
      path: `/api/leave-policy/types/${wfh.id}/status`,
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    assert.strictEqual(toggleRes2.status, 200, 'Toggling status should succeed');
    assert.strictEqual(toggleRes2.data?.leaveType?.isActive, true, 'WFH should now be active again');

    // Step 6b: Check that WFH is returned in employee leave balances
    const balRes = await apiRequest({
      method: 'GET',
      path: '/api/leaves/balances',
      headers: { Authorization: `Bearer ${employeeToken}` }
    });
    assert.strictEqual(balRes.status, 200, 'Getting balances should succeed');
    const availableTypes = balRes.data?.leaveTypes || [];
    const hasWfh = availableTypes.some(t => t.code === 'WFH');
    assert.ok(hasWfh, 'WFH must now appear in available leave types list');
  });

  // =====================================================================
  // Test 7: Historical records preserved (Attendance and Leaves)
  // =====================================================================
  await test('Historical WFH attendance records remain completely intact and uncorrupted', async () => {
    const antoWfhCount = await prisma.attendance.count({
      where: {
        status: 'WORK_FROM_HOME',
        workLocation: 'HOME'
      }
    });
    assert.ok(antoWfhCount >= 3, `Historical WFH records must be preserved. Found ${antoWfhCount}`);
  });

  // =====================================================================
  // Test 8: Tenant isolation - WFH is available across all organizations
  // =====================================================================
  await test('Tenant isolation - WFH is available in leave-policy for all organizations', async () => {
    const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
    for (const o of orgs) {
      const res = await apiRequest({
        method: 'GET',
        path: `/api/leave-policy?organizationId=${o.id}`,
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.status, 200, `Getting policy for ${o.name} must return 200`);
      const types = res.data?.leaveTypes || [];
      const hasWfh = types.some(t => t.code === 'WFH');
      assert.ok(hasWfh, `Organization ${o.name} (${o.id}) must have WFH in its leave policy`);
    }
  });

  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests()
  .catch((err) => {
    console.error('Test error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
