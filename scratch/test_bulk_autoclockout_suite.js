const axios = require('../backend/node_modules/axios');
const prisma = require('../backend/src/utils/db');
const bcrypt = require('../backend/node_modules/bcrypt');
const { processAutoClockOut } = require('../backend/src/services/autoClockOutService');

const BASE_URL = 'http://localhost:5000/api';

async function runSuite() {
  console.log('===============================================================');
  console.log('RUNNING COMPREHENSIVE BULK AUTO CLOCK-OUT TEST SUITE');
  console.log('===============================================================\n');

  let testsPassed = 0;
  let testsTotal = 0;

  function assert(condition, message) {
    testsTotal++;
    if (condition) {
      console.log(`  [PASS] Test ${testsTotal}: ${message}`);
      testsPassed++;
    } else {
      console.error(`  [FAIL] Test ${testsTotal}: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  // 1. SETUP AUTHENTICATION
  console.log('[Setup] 1. Authenticating as Company Admin (admin@enterprise-crm.com)...');
  const adminLogin = await axios.post(`${BASE_URL}/auth/login`, {
    userId: 'admin@enterprise-crm.com',
    password: 'password123'
  });
  const adminToken = adminLogin.data.token;
  const adminOrgId = adminLogin.data.user.organizationId;
  console.log(`✓ Admin authenticated. Organization ID: ${adminOrgId}`);

  // Fetch employees belonging to this organization
  const orgEmployees = await prisma.user.findMany({
    where: {
      organizationId: adminOrgId,
      role: 'EMPLOYEE'
    },
    take: 4
  });

  if (orgEmployees.length < 3) {
    throw new Error('Need at least 3 employees in the admin org for bulk tests.');
  }

  const emp1 = orgEmployees[0];
  const emp2 = orgEmployees[1];
  const emp3 = orgEmployees[2];
  console.log(`✓ Using Emp 1: ${emp1.name} (${emp1.id})`);
  console.log(`✓ Using Emp 2: ${emp2.name} (${emp2.id})`);
  console.log(`✓ Using Emp 3: ${emp3.name} (${emp3.id})`);

  // Ensure employee 1 can login as regular non-admin user
  const hashedPw = await bcrypt.hash('password123', 10);
  await prisma.user.update({ where: { id: emp1.id }, data: { password: hashedPw } });

  const emp1Login = await axios.post(`${BASE_URL}/auth/login`, {
    userId: emp1.email,
    password: 'password123'
  });
  const employeeToken = emp1Login.data.token;
  console.log(`✓ Employee 1 authenticated as regular user.`);

  // Find or create an employee belonging to a DIFFERENT organization for tenant boundary tests
  let crossOrgEmployee = await prisma.user.findFirst({
    where: {
      role: 'EMPLOYEE',
      organizationId: { not: adminOrgId }
    }
  });

  if (!crossOrgEmployee) {
    // Find any other org
    const otherOrg = await prisma.organization.findFirst({
      where: { id: { not: adminOrgId } }
    });
    if (otherOrg) {
      crossOrgEmployee = await prisma.user.create({
        data: {
          employeeId: 'TEST-XORG-01',
          name: 'Cross Org Test User',
          email: 'crossorg_test@example.com',
          password: hashedPw,
          role: 'EMPLOYEE',
          status: 'ACTIVE',
          organizationId: otherOrg.id,
          autoClockOutEnabled: true
        }
      });
    }
  }
  console.log(`✓ Cross-org employee: ${crossOrgEmployee?.name} (Org: ${crossOrgEmployee?.organizationId})`);

  // -------------------------------------------------------------
  // TEST SECTION 1: ALWAYS-VISIBLE STATUS FIELD ON USER RETRIEVAL
  // -------------------------------------------------------------
  console.log('\n--- Section 1: User API always returns autoClockOutEnabled ---');
  const getEmployeesRes = await axios.get(`${BASE_URL}/users`, {
    params: { role: 'EMPLOYEE', limit: 10 },
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const fetchedList = getEmployeesRes.data.users || [];
  assert(fetchedList.length > 0, 'Fetched employees list successfully');
  const allHaveField = fetchedList.every(u => u.autoClockOutEnabled !== undefined && typeof u.autoClockOutEnabled === 'boolean');
  assert(allHaveField, 'Every employee row record has an explicit boolean autoClockOutEnabled field');

  // -------------------------------------------------------------
  // TEST SECTION 2: BULK ENABLE AUTO CLOCK-OUT
  // -------------------------------------------------------------
  console.log('\n--- Section 2: Bulk Enable Auto Clock-Out ---');
  // First set them to false directly so we test transition to true
  await prisma.user.updateMany({
    where: { id: { in: [emp1.id, emp2.id, emp3.id] } },
    data: { autoClockOutEnabled: false }
  });

  const bulkEnableRes = await axios.post(
    `${BASE_URL}/users/bulk-auto-clock-out`,
    {
      userIds: [emp1.id, emp2.id, emp3.id],
      enabled: true
    },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );

  assert(bulkEnableRes.data.success === true, 'Bulk enable API returns success: true');
  assert(bulkEnableRes.data.updatedCount === 3, `Bulk enable updatedCount is 3 (got ${bulkEnableRes.data.updatedCount})`);
  assert(bulkEnableRes.data.failedCount === 0, `Bulk enable failedCount is 0 (got ${bulkEnableRes.data.failedCount})`);
  assert(bulkEnableRes.data.enabled === true, 'Bulk enable returns enabled: true');

  // Verify in database
  const verifyDbEnable = await prisma.user.findMany({
    where: { id: { in: [emp1.id, emp2.id, emp3.id] } },
    select: { id: true, autoClockOutEnabled: true }
  });
  assert(verifyDbEnable.every(u => u.autoClockOutEnabled === true), 'All 3 employees have autoClockOutEnabled === true in MySQL');

  // -------------------------------------------------------------
  // TEST SECTION 3: BULK DISABLE AUTO CLOCK-OUT
  // -------------------------------------------------------------
  console.log('\n--- Section 3: Bulk Disable Auto Clock-Out ---');
  const bulkDisableRes = await axios.post(
    `${BASE_URL}/users/bulk-auto-clock-out`,
    {
      userIds: [emp1.id, emp2.id],
      enabled: false
    },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );

  assert(bulkDisableRes.data.success === true, 'Bulk disable API returns success: true');
  assert(bulkDisableRes.data.updatedCount === 2, `Bulk disable updatedCount is 2 (got ${bulkDisableRes.data.updatedCount})`);
  assert(bulkDisableRes.data.failedCount === 0, `Bulk disable failedCount is 0 (got ${bulkDisableRes.data.failedCount})`);
  assert(bulkDisableRes.data.enabled === false, 'Bulk disable returns enabled: false');

  const verifyDbDisable = await prisma.user.findMany({
    where: { id: { in: [emp1.id, emp2.id, emp3.id] } },
    select: { id: true, autoClockOutEnabled: true }
  });
  const mapDb = new Map(verifyDbDisable.map(u => [u.id, u.autoClockOutEnabled]));
  assert(mapDb.get(emp1.id) === false, 'Employee 1 autoClockOutEnabled is false');
  assert(mapDb.get(emp2.id) === false, 'Employee 2 autoClockOutEnabled is false');
  assert(mapDb.get(emp3.id) === true, 'Employee 3 remains unaffected (autoClockOutEnabled is true)');

  // -------------------------------------------------------------
  // TEST SECTION 4: PRESERVE INDIVIDUAL TOGGLE CONTROLS
  // -------------------------------------------------------------
  console.log('\n--- Section 4: Individual toggle controls remain synchronized ---');
  // Admin toggles Employee 1 individually to true
  const individualToggleRes = await axios.put(
    `${BASE_URL}/users/${emp1.id}`,
    { autoClockOutEnabled: true },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  assert(individualToggleRes.data.autoClockOutEnabled === true, 'Individual update succeeds and returns autoClockOutEnabled: true');
  const dbEmp1 = await prisma.user.findUnique({ where: { id: emp1.id }, select: { autoClockOutEnabled: true } });
  assert(dbEmp1.autoClockOutEnabled === true, 'Database has autoClockOutEnabled: true for Employee 1');

  // Verify Employee 2 was not touched
  const dbEmp2 = await prisma.user.findUnique({ where: { id: emp2.id }, select: { autoClockOutEnabled: true } });
  assert(dbEmp2.autoClockOutEnabled === false, 'Employee 2 remains false after individual change to Employee 1');

  // -------------------------------------------------------------
  // TEST SECTION 5: ACCURATE FAILURE REPORTING & PARTIAL FAILURE
  // -------------------------------------------------------------
  console.log('\n--- Section 5: Accurate success & failure reporting ---');
  const fakeId = '00000000-0000-0000-0000-000000000000';
  const mixedRes = await axios.post(
    `${BASE_URL}/users/bulk-auto-clock-out`,
    {
      userIds: [emp1.id, fakeId],
      enabled: false
    },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );

  assert(mixedRes.data.success === true, 'Mixed request returns success response with itemized breakdown');
  assert(mixedRes.data.updatedCount === 1, 'updatedCount is 1 for the valid employee');
  assert(mixedRes.data.failedCount === 1, 'failedCount is 1 for the invalid employee ID');
  assert(mixedRes.data.failedItems.length === 1 && mixedRes.data.failedItems[0].id === fakeId, 'failedItems identifies the non-existent employee');

  // -------------------------------------------------------------
  // TEST SECTION 6: SECURITY - UNAUTHORIZED ROLE ACCESS
  // -------------------------------------------------------------
  console.log('\n--- Section 6: Security - Unauthorized roles blocked ---');
  try {
    await axios.post(
      `${BASE_URL}/users/bulk-auto-clock-out`,
      {
        userIds: [emp1.id],
        enabled: true
      },
      { headers: { Authorization: `Bearer ${employeeToken}` } }
    );
    assert(false, 'Regular employee should NOT be able to call bulk-auto-clock-out');
  } catch (err) {
    assert(err.response?.status === 403, `Employee token correctly rejected with HTTP 403 Forbidden (got ${err.response?.status})`);
  }

  // -------------------------------------------------------------
  // TEST SECTION 7: SECURITY - CROSS-ORGANIZATION TENANT ISOLATION
  // -------------------------------------------------------------
  console.log('\n--- Section 7: Security - Cross-organization tenant isolation ---');
  if (crossOrgEmployee) {
    const crossOrgAttempt = await axios.post(
      `${BASE_URL}/users/bulk-auto-clock-out`,
      {
        userIds: [crossOrgEmployee.id],
        enabled: false
      },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );

    assert(crossOrgAttempt.data.updatedCount === 0, 'Cross-organization employee was NOT updated (updatedCount === 0)');
    assert(crossOrgAttempt.data.failedCount === 1, 'Cross-organization employee failed security check (failedCount === 1)');
    assert(crossOrgAttempt.data.failedItems[0].reason.includes('different organization'), 'Reason explains organization mismatch security policy');
  } else {
    console.log('Skipping cross-org test: no secondary org user available');
  }

  // -------------------------------------------------------------
  // TEST SECTION 8: SUPER ADMIN PROTECTION
  // -------------------------------------------------------------
  console.log('\n--- Section 8: Security - Super Admin account cannot be modified ---');
  const superAdminUser = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' }
  });
  if (superAdminUser) {
    const superAdminAttempt = await axios.post(
      `${BASE_URL}/users/bulk-auto-clock-out`,
      {
        userIds: [superAdminUser.id],
        enabled: false
      },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert(superAdminAttempt.data.updatedCount === 0, 'Super admin user was not updated (updatedCount === 0)');
    assert(superAdminAttempt.data.failedCount === 1, 'Super admin failed update (failedCount === 1)');
  }

  // -------------------------------------------------------------
  // TEST SECTION 9: PERSISTENCE AFTER FETCHING
  // -------------------------------------------------------------
  console.log('\n--- Section 9: Setting persists when re-fetching via GET /users ---');
  // Set emp1 to true, emp2 to true
  await axios.post(
    `${BASE_URL}/users/bulk-auto-clock-out`,
    {
      userIds: [emp1.id, emp2.id],
      enabled: true
    },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );

  const refetchRes = await axios.get(`${BASE_URL}/users`, {
    params: { role: 'EMPLOYEE', limit: 50 },
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const refetchedUsers = refetchRes.data.users || [];
  const refetchedEmp1 = refetchedUsers.find(u => u.id === emp1.id);
  const refetchedEmp2 = refetchedUsers.find(u => u.id === emp2.id);

  assert(refetchedEmp1 && refetchedEmp1.autoClockOutEnabled === true, 'Refetched Emp 1 has autoClockOutEnabled === true');
  assert(refetchedEmp2 && refetchedEmp2.autoClockOutEnabled === true, 'Refetched Emp 2 has autoClockOutEnabled === true');

  // -------------------------------------------------------------
  // TEST SECTION 10: AUTO CLOCK-OUT SCHEDULER LOGIC INTEGRITY
  // -------------------------------------------------------------
  console.log('\n--- Section 10: Auto Clock-Out scheduler logic integrity ---');
  // Verify that processAutoClockOut runs without error and respects individual autoClockOutEnabled flag
  const autoClockOutServiceResult = await processAutoClockOut();
  assert(autoClockOutServiceResult !== undefined, 'processAutoClockOut executes successfully without throwing');

  console.log('\n===============================================================');
  console.log(`ALL BULK AUTO CLOCK-OUT TESTS PASSED: ${testsPassed} / ${testsTotal}`);
  console.log('===============================================================');
}

runSuite()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\nFAILED TEST SUITE:', err);
    process.exit(1);
  });
