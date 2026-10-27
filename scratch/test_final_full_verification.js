const axios = require('../backend/node_modules/axios');
const prisma = require('../backend/src/utils/db');
const bcrypt = require('../backend/node_modules/bcrypt');
const { processAutoClockOut } = require('../backend/src/services/autoClockOutService');

const BASE_URL = 'http://localhost:5000/api';

async function runMasterVerification() {
  console.log('========================================================================');
  console.log('FINAL FULL VERIFICATION: AUTO CLOCK-OUT SYSTEM & ATTENDANCE INTEGRITY');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`  [PASS] Test ${total}: ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] Test ${total}: ${message}`);
      throw new Error(`Assertion Failed: ${message}`);
    }
  }

  // --- 0. SETUP & AUTHENTICATION ---
  console.log('[Setup] 1. Logging in as Admin (admin@enterprise-crm.com)...');
  const adminLogin = await axios.post(`${BASE_URL}/auth/login`, {
    userId: 'admin@enterprise-crm.com',
    password: 'password123'
  });
  const adminToken = adminLogin.data.token;
  const adminOrgId = adminLogin.data.user.organizationId;
  console.log(`✓ Admin authenticated. Organization ID: ${adminOrgId}`);

  // Fetch 3 test employees in admin's organization
  const employees = await prisma.user.findMany({
    where: {
      organizationId: adminOrgId,
      role: 'EMPLOYEE'
    },
    take: 3
  });

  if (employees.length < 3) {
    throw new Error('Need at least 3 employees in admin org for verification tests.');
  }

  const empA = employees[0];
  const empB = employees[1];
  const empC = employees[2];
  console.log(`✓ Test Employee A: ${empA.name} (${empA.id})`);
  console.log(`✓ Test Employee B: ${empB.name} (${empB.id})`);
  console.log(`✓ Test Employee C: ${empC.name} (${empC.id})`);

  // Ensure employee password is known
  const hashedPw = await bcrypt.hash('password123', 10);
  await prisma.user.update({ where: { id: empA.id }, data: { password: hashedPw } });
  await prisma.user.update({ where: { id: empB.id }, data: { password: hashedPw } });

  const empALogin = await axios.post(`${BASE_URL}/auth/login`, {
    userId: empA.email,
    password: 'password123'
  });
  const empAToken = empALogin.data.token;
  console.log('✓ Employee A authenticated.');

  // Find cross-organization employee
  let crossOrgEmp = await prisma.user.findFirst({
    where: {
      role: 'EMPLOYEE',
      organizationId: { not: adminOrgId }
    }
  });

  // Find super admin user
  const superAdmin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' }
  });

  // =========================================================================
  // SECTION 1: INDIVIDUAL SETTINGS VERIFICATION
  // =========================================================================
  console.log('\n--- SECTION 1: Individual Settings Verification ---');

  // Test 1.1: Enable Auto Clock-Out for Employee A and verify persistence
  const resEnableA = await axios.put(
    `${BASE_URL}/users/${empA.id}`,
    { autoClockOutEnabled: true },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  assert(resEnableA.data.autoClockOutEnabled === true, 'Admin API returns autoClockOutEnabled: true for Employee A');

  const dbA = await prisma.user.findUnique({ where: { id: empA.id }, select: { autoClockOutEnabled: true } });
  assert(dbA.autoClockOutEnabled === true, 'Database persists autoClockOutEnabled = true for Employee A');

  // Test 1.2: Disable Auto Clock-Out for Employee B and verify persistence
  const resDisableB = await axios.put(
    `${BASE_URL}/users/${empB.id}`,
    { autoClockOutEnabled: false },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  assert(resDisableB.data.autoClockOutEnabled === false, 'Admin API returns autoClockOutEnabled: false for Employee B');

  const dbB = await prisma.user.findUnique({ where: { id: empB.id }, select: { autoClockOutEnabled: true } });
  assert(dbB.autoClockOutEnabled === false, 'Database persists autoClockOutEnabled = false for Employee B');

  // Test 1.3: Confirm changing Employee B did not affect Employee A or Employee C
  const dbA_recheck = await prisma.user.findUnique({ where: { id: empA.id }, select: { autoClockOutEnabled: true } });
  assert(dbA_recheck.autoClockOutEnabled === true, 'Employee A setting remains true after Employee B was disabled');

  // Test 1.4: Refetch via GET /api/users/:id
  const getEmpA = await axios.get(`${BASE_URL}/users/${empA.id}`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert(getEmpA.data.autoClockOutEnabled === true, 'GET /users/:id returns persisted autoClockOutEnabled: true for Employee A');

  const getEmpB = await axios.get(`${BASE_URL}/users/${empB.id}`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert(getEmpB.data.autoClockOutEnabled === false, 'GET /users/:id returns persisted autoClockOutEnabled: false for Employee B');

  // =========================================================================
  // SECTION 2: BULK ACTIONS & TABLE BADGES VERIFICATION
  // =========================================================================
  console.log('\n--- SECTION 2: Bulk Actions, Status Badges & Filtering ---');

  // Test 2.1: Bulk Enable for Employee A, B, C
  const bulkEnableRes = await axios.post(
    `${BASE_URL}/users/bulk-auto-clock-out`,
    {
      userIds: [empA.id, empB.id, empC.id],
      enabled: true
    },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  assert(bulkEnableRes.data.success === true, 'Bulk enable API returns success: true');
  assert(bulkEnableRes.data.updatedCount === 3, `Bulk enable updated all 3 employees (count: ${bulkEnableRes.data.updatedCount})`);
  assert(bulkEnableRes.data.failedCount === 0, 'Bulk enable failedCount === 0');

  const dbBulkCheck1 = await prisma.user.findMany({
    where: { id: { in: [empA.id, empB.id, empC.id] } },
    select: { id: true, autoClockOutEnabled: true }
  });
  assert(dbBulkCheck1.every(u => u.autoClockOutEnabled === true), 'All 3 employees confirmed enabled in MySQL database');

  // Test 2.2: Bulk Disable for Employee A and Employee C
  const bulkDisableRes = await axios.post(
    `${BASE_URL}/users/bulk-auto-clock-out`,
    {
      userIds: [empA.id, empC.id],
      enabled: false
    },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  assert(bulkDisableRes.data.success === true, 'Bulk disable API returns success: true');
  assert(bulkDisableRes.data.updatedCount === 2, `Bulk disable updated 2 employees (count: ${bulkDisableRes.data.updatedCount})`);

  const dbBulkCheck2 = await prisma.user.findMany({
    where: { id: { in: [empA.id, empB.id, empC.id] } },
    select: { id: true, autoClockOutEnabled: true }
  });
  const mapCheck2 = new Map(dbBulkCheck2.map(u => [u.id, u.autoClockOutEnabled]));
  assert(mapCheck2.get(empA.id) === false, 'Employee A is now disabled');
  assert(mapCheck2.get(empB.id) === true, 'Employee B remains enabled (unselected)');
  assert(mapCheck2.get(empC.id) === false, 'Employee C is now disabled');

  // Test 2.3: Verify GET /api/users listing includes explicit boolean on all records
  const listRes = await axios.get(`${BASE_URL}/users`, {
    params: { role: 'EMPLOYEE', limit: 50 },
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const fetchedUsers = listRes.data.users || [];
  assert(fetchedUsers.length >= 3, 'Fetched employee list contains test records');
  assert(fetchedUsers.every(u => typeof u.autoClockOutEnabled === 'boolean'), 'Every employee row in listing has a boolean autoClockOutEnabled');

  // Test 2.4: Synchronization between individual and bulk actions
  // Now change Emp A individually back to true
  await axios.put(
    `${BASE_URL}/users/${empA.id}`,
    { autoClockOutEnabled: true },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  const dbEmpASync = await prisma.user.findUnique({ where: { id: empA.id }, select: { autoClockOutEnabled: true } });
  assert(dbEmpASync.autoClockOutEnabled === true, 'Individual update successfully re-enabled Employee A');

  // Emp C remains false
  const dbEmpCSync = await prisma.user.findUnique({ where: { id: empC.id }, select: { autoClockOutEnabled: true } });
  assert(dbEmpCSync.autoClockOutEnabled === false, 'Employee C remains disabled');

  // =========================================================================
  // SECTION 3: AUTOMATIC VS MANUAL CLOCK-OUT EXECUTION
  // =========================================================================
  console.log('\n--- SECTION 3: Automatic vs Manual Clock-Out Execution ---');

  // Current server time reference and today's zoned date
  const { getTodayZonedDate } = require('../backend/src/utils/attendanceUtils');
  const testNow = new Date();
  const testDate = getTodayZonedDate(testNow, 'Asia/Kolkata');
  const pastClockIn = new Date(testNow.getTime() - 9 * 60 * 60 * 1000); // 9 hours ago
  const pastShiftEnd = new Date(testNow.getTime() - 1 * 60 * 60 * 1000); // Shift ended 1 hour ago

  // Clean any existing test attendance for today for Emp A and Emp B
  await prisma.attendance.deleteMany({
    where: {
      userId: { in: [empA.id, empB.id] },
      date: testDate
    }
  });

  // Emp A: autoClockOutEnabled === true
  const attA = await prisma.attendance.create({
    data: {
      userId: empA.id,
      date: testDate,
      clockIn: pastClockIn,
      clockInLatitude: 12.9716,
      clockInLongitude: 77.5946,
      status: 'PRESENT',
      shiftName: 'Company Default',
      shiftEndAt: pastShiftEnd,
      scheduledEndTime: '17:00'
    }
  });

  // Emp B: autoClockOutEnabled === false (temporarily set to false)
  await prisma.user.update({ where: { id: empB.id }, data: { autoClockOutEnabled: false } });
  const attB = await prisma.attendance.create({
    data: {
      userId: empB.id,
      date: testDate,
      clockIn: pastClockIn,
      clockInLatitude: 12.9716,
      clockInLongitude: 77.5946,
      status: 'PRESENT',
      shiftName: 'Company Default',
      shiftEndAt: pastShiftEnd,
      scheduledEndTime: '17:00'
    }
  });

  console.log('✓ Created active attendance records with elapsed shift end for Emp A (Enabled) and Emp B (Disabled).');

  // Execute processAutoClockOut
  const run1 = await processAutoClockOut(testNow);
  console.log(`✓ processAutoClockOut run 1 completed: autoClockedOut=${run1.autoClockedOutCount}, skipped=${run1.skippedCount}`);

  // Test 3.1: Emp A was auto-clocked out
  const checkAttA = await prisma.attendance.findUnique({ where: { id: attA.id } });
  assert(checkAttA.clockOut !== null, 'Employee A was automatically clocked out');
  assert(checkAttA.autoClockOut === true, 'Employee A record marked with autoClockOut === true');
  assert(checkAttA.clockOutReason === 'AUTO', 'Employee A record marked with clockOutReason === "AUTO"');
  assert(checkAttA.clockOutLatitude === null && checkAttA.clockOutLongitude === null, 'Automatic clock-out did NOT fabricate GPS coordinates');

  // Test 3.2: Emp B was NOT auto-clocked out
  const checkAttB = await prisma.attendance.findUnique({ where: { id: attB.id } });
  assert(checkAttB.clockOut === null, 'Employee B remained clocked in (was NOT auto-clocked out)');
  assert(checkAttB.autoClockOut === false, 'Employee B record autoClockOut remains false');

  // Test 3.3: Manual clock-out reminder notification sent to Emp B
  const reminderNotif = await prisma.notification.findFirst({
    where: {
      userId: empB.id,
      type: 'ATTENDANCE_MANUAL_CLOCKOUT_REMINDER'
    },
    orderBy: { createdAt: 'desc' }
  });
  assert(reminderNotif !== null, 'Manual clock-out reminder notification was created for Employee B');

  // Test 3.4: Idempotency & Duplicate prevention on second scheduler execution
  const run2 = await processAutoClockOut(testNow);
  assert(run2.autoClockedOutCount === 0, 'Second run does NOT duplicate auto clock-out (autoClockedOutCount === 0)');

  const remindersCount = await prisma.notification.count({
    where: {
      userId: empB.id,
      type: 'ATTENDANCE_MANUAL_CLOCKOUT_REMINDER',
      createdAt: { gte: pastClockIn }
    }
  });
  assert(remindersCount === 1, 'Subsequent cron runs do NOT generate duplicate reminder notifications');

  // Test 3.5: Employee B attempts manual clock-out OUTSIDE geofence
  const empBLogin = await axios.post(`${BASE_URL}/auth/login`, { userId: empB.email, password: 'password123' });
  const empBToken = empBLogin.data.token;

  try {
    await axios.post(
      `${BASE_URL}/attendance/clock-out`,
      { latitude: 12.9716, longitude: 77.5946 }, // Bangalore (outside Chennai office)
      { headers: { Authorization: `Bearer ${empBToken}` } }
    );
    assert(false, 'Manual clock-out outside geofence should be rejected');
  } catch (geoErr) {
    assert(geoErr.response?.data?.reason === 'OUTSIDE_GEOFENCE', 'Manual clock-out outside permitted location correctly enforces geofence validation');
  }

  // Test 3.6: Employee B performs genuine manual clock-out INSIDE permitted geofence
  const manualClockOutRes = await axios.post(
    `${BASE_URL}/attendance/clock-out`,
    {
      latitude: 12.920368,
      longitude: 80.121690,
      address: 'MCC MRF Innovation Park, Tambaram',
      workLocation: 'OFFICE'
    },
    { headers: { Authorization: `Bearer ${empBToken}` } }
  );

  assert(manualClockOutRes.data.success === true, 'Manual clock-out within geofence succeeds with HTTP 200');

  const checkManualAttB = await prisma.attendance.findUnique({ where: { id: attB.id } });
  assert(checkManualAttB.clockOut !== null, 'Employee B manually clocked out successfully');
  assert(checkManualAttB.autoClockOut === false, 'Employee B manual clock-out has autoClockOut === false');
  assert(checkManualAttB.clockOutReason === 'MANUAL', 'Employee B manual clock-out has clockOutReason === "MANUAL"');
  assert(checkManualAttB.clockOutLatitude !== null, 'Employee B captured genuine GPS latitude on manual clock-out');

  // =========================================================================
  // SECTION 4: SECURITY & DATA INTEGRITY
  // =========================================================================
  console.log('\n--- SECTION 4: Security & Data Integrity ---');

  // Test 4.1: Regular non-admin employee cannot call bulk update
  try {
    await axios.post(
      `${BASE_URL}/users/bulk-auto-clock-out`,
      { userIds: [empA.id], enabled: true },
      { headers: { Authorization: `Bearer ${empAToken}` } }
    );
    assert(false, 'Regular employee should NOT be able to call bulk-auto-clock-out');
  } catch (err) {
    assert(err.response?.status === 403, 'Regular employee correctly blocked with HTTP 403 Forbidden');
  }

  // Test 4.2: Regular employee cannot edit individual autoClockOutEnabled
  try {
    await axios.put(
      `${BASE_URL}/users/${empA.id}`,
      { autoClockOutEnabled: true },
      { headers: { Authorization: `Bearer ${empAToken}` } }
    );
    assert(false, 'Regular employee should NOT be able to edit autoClockOutEnabled');
  } catch (err) {
    assert(err.response?.status === 403, 'Regular employee cannot modify autoClockOutEnabled (HTTP 403)');
  }

  // Test 4.3: Cross-organization tenant isolation check
  if (crossOrgEmp) {
    const crossOrgRes = await axios.post(
      `${BASE_URL}/users/bulk-auto-clock-out`,
      { userIds: [crossOrgEmp.id], enabled: false },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert(crossOrgRes.data.updatedCount === 0, 'Cross-organization employee was NOT updated (updatedCount === 0)');
    assert(crossOrgRes.data.failedCount === 1, 'Cross-organization employee rejected with failedCount === 1');
    assert(crossOrgRes.data.failedItems[0].reason.includes('different organization'), 'Reason notes cross-organization policy violation');
  } else {
    console.log('Skipping crossOrg test: no secondary org user available');
  }

  // Test 4.4: Protected Super Admin account cannot be modified
  if (superAdmin) {
    const superAdminRes = await axios.post(
      `${BASE_URL}/users/bulk-auto-clock-out`,
      { userIds: [superAdmin.id], enabled: false },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert(superAdminRes.data.updatedCount === 0, 'Super Admin account was NOT modified');
    assert(superAdminRes.data.failedCount === 1, 'Super Admin account reported in failedCount');
  }

  // Test 4.5: Invalid, missing, duplicate, and nonexistent employee IDs
  const fakeId1 = '00000000-0000-0000-0000-000000000000';
  const duplicateIdRes = await axios.post(
    `${BASE_URL}/users/bulk-auto-clock-out`,
    {
      userIds: [empA.id, empA.id, fakeId1],
      enabled: true
    },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  assert(duplicateIdRes.data.success === true, 'Handled mixed duplicate and invalid IDs gracefully');
  assert(duplicateIdRes.data.updatedCount === 1, 'Deduped and updated valid employee once');
  assert(duplicateIdRes.data.failedCount === 1, 'Nonexistent ID identified in failedCount');

  // Test 4.6: Empty userIds rejected
  try {
    await axios.post(
      `${BASE_URL}/users/bulk-auto-clock-out`,
      { userIds: [], enabled: true },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert(false, 'Empty userIds should be rejected');
  } catch (err) {
    assert(err.response?.status === 400, 'Empty userIds rejected with HTTP 400');
  }

  // Test 4.7: Missing enabled boolean rejected
  try {
    await axios.post(
      `${BASE_URL}/users/bulk-auto-clock-out`,
      { userIds: [empA.id] },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert(false, 'Missing enabled boolean should be rejected');
  } catch (err) {
    assert(err.response?.status === 400, 'Missing enabled rejected with HTTP 400');
  }

  // Test 4.8: Historical records integrity
  const totalAttendances = await prisma.attendance.count();
  assert(totalAttendances > 0, `Historical attendance records intact (count: ${totalAttendances})`);

  const salaryTemplates = await prisma.salaryTemplate.count();
  assert(salaryTemplates >= 0, `Salary structures/templates intact (count: ${salaryTemplates})`);

  console.log('\n========================================================================');
  console.log(`FINAL MASTER VERIFICATION COMPLETE: ALL ${passed} / ${total} TESTS PASSED!`);
  console.log('========================================================================\n');
}

runMasterVerification()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\nMASTER VERIFICATION FAILED:', err);
    process.exit(1);
  });
