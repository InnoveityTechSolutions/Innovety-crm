const assert = require('assert');
const prisma = require('./backend/src/utils/db');
const jwt = require('./backend/node_modules/jsonwebtoken');
const http = require('http');

const BASE_URL = 'http://localhost:5000';

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

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d, days) {
  const res = new Date(d);
  res.setDate(res.getDate() + days);
  return res;
}

async function runTests() {
  console.log('================================================================');
  console.log('   MINIMUM ADVANCE NOTICE FOR LEAVE TYPES TEST SUITE            ');
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

  // Set up users and tokens using Yeshwanth Y (clean employee without overlapping leaves)
  const superAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', organizationId: { not: null } } });
  let employee = await prisma.user.findUnique({ where: { email: 'yeshwanthy1504@gmail.com' } });
  if (!employee) {
    employee = await prisma.user.findFirst({ where: { role: 'EMPLOYEE', organizationId: admin.organizationId } });
  }

  const superAdminToken = jwt.sign(
    { id: superAdmin.id, email: superAdmin.email, role: superAdmin.role, organizationId: admin.organizationId },
    process.env.JWT_SECRET || 'your-default-jwt-secret',
    { expiresIn: '1h' }
  );

  const employeeToken = jwt.sign(
    { id: employee.id, email: employee.email, role: employee.role, organizationId: employee.organizationId },
    process.env.JWT_SECRET || 'your-default-jwt-secret',
    { expiresIn: '1h' }
  );

  const orgId = employee.organizationId || admin.organizationId;
  const now = new Date();
  const todayStr = formatDate(now);
  const tomorrowStr = formatDate(addDays(now, 1));
  const day2Str = formatDate(addDays(now, 2));
  const day3Str = formatDate(addDays(now, 3));
  const day4Str = formatDate(addDays(now, 4));

  console.log(`Testing with Org: ${orgId} | Employee: ${employee.name} | Today: ${todayStr}\n`);

  let testType0 = null;
  let testType1 = null;
  let testType3 = null;
  const createdLeaveRequestIds = [];

  try {
    // -------------------------------------------------------------
    // Test 5: Invalid, negative, and fractional values are rejected
    // -------------------------------------------------------------
    await test('Validation rejects negative minNoticeDays on create', async () => {
      const res = await apiRequest({
        method: 'POST',
        path: '/api/leave-policy/types',
        headers: { Authorization: `Bearer ${superAdminToken}` },
        body: {
          name: 'Invalid Negative Notice',
          code: 'NEG_TEST',
          minNoticeDays: -1,
          annualDays: 10,
          isPaid: true
        }
      });
      assert.strictEqual(res.status, 400, 'Should return 400 for negative minNoticeDays');
      assert.ok(res.data.message.includes('non-negative whole number'), 'Error message should mention non-negative whole number');
    });

    await test('Validation rejects fractional minNoticeDays on create', async () => {
      const res = await apiRequest({
        method: 'POST',
        path: '/api/leave-policy/types',
        headers: { Authorization: `Bearer ${superAdminToken}` },
        body: {
          name: 'Invalid Fractional Notice',
          code: 'FRAC_TEST',
          minNoticeDays: 2.5,
          annualDays: 10,
          isPaid: true
        }
      });
      assert.strictEqual(res.status, 400, 'Should return 400 for fractional minNoticeDays');
    });

    await test('Validation rejects non-numeric string minNoticeDays on create', async () => {
      const res = await apiRequest({
        method: 'POST',
        path: '/api/leave-policy/types',
        headers: { Authorization: `Bearer ${superAdminToken}` },
        body: {
          name: 'Invalid String Notice',
          code: 'STR_TEST',
          minNoticeDays: 'abc',
          annualDays: 10,
          isPaid: true
        }
      });
      assert.strictEqual(res.status, 400, 'Should return 400 for non-numeric minNoticeDays');
    });

    // Setup Test Leave Types
    // 1) Leave Type with minNoticeDays = 0
    const resType0 = await apiRequest({
      method: 'POST',
      path: '/api/leave-policy/types',
      headers: { Authorization: `Bearer ${superAdminToken}` },
      body: {
        name: 'Notice Zero Test Type',
        code: `NT0_${Date.now()}`.substring(0, 10),
        minNoticeDays: 0,
        annualDays: 15,
        isPaid: true,
        organizationId: orgId
      }
    });
    assert.strictEqual(resType0.status, 201, 'Notice 0 leave type should be created');
    testType0 = resType0.data.leaveType;
    assert.strictEqual(testType0.minNoticeDays, 0, 'minNoticeDays should be 0');

    // Grant balance to employee
    await prisma.userLeaveBalance.upsert({
      where: { userId_leaveTypeId: { userId: employee.id, leaveTypeId: testType0.id } },
      create: { userId: employee.id, leaveTypeId: testType0.id, allocated: 10, available: 10, used: 0, pending: 0 },
      update: { allocated: 10, available: 10, used: 0, pending: 0 }
    });

    // 2) Leave Type with minNoticeDays = 1
    const resType1 = await apiRequest({
      method: 'POST',
      path: '/api/leave-policy/types',
      headers: { Authorization: `Bearer ${superAdminToken}` },
      body: {
        name: 'Notice One Test Type',
        code: `NT1_${Date.now()}`.substring(0, 10),
        minNoticeDays: 1,
        annualDays: 15,
        monthlyCreditDays: 10,
        isPaid: true,
        organizationId: orgId
      }
    });
    assert.strictEqual(resType1.status, 201, 'Notice 1 leave type should be created');
    testType1 = resType1.data.leaveType;
    assert.strictEqual(testType1.minNoticeDays, 1, 'minNoticeDays should be 1');

    await prisma.userLeaveBalance.upsert({
      where: { userId_leaveTypeId: { userId: employee.id, leaveTypeId: testType1.id } },
      create: { userId: employee.id, leaveTypeId: testType1.id, allocated: 10, available: 10, used: 0, pending: 0 },
      update: { allocated: 10, available: 10, used: 0, pending: 0 }
    });

    // 3) Leave Type with minNoticeDays = 3
    const resType3 = await apiRequest({
      method: 'POST',
      path: '/api/leave-policy/types',
      headers: { Authorization: `Bearer ${superAdminToken}` },
      body: {
        name: 'Notice Three Test Type',
        code: `NT3_${Date.now()}`.substring(0, 10),
        minNoticeDays: 3,
        annualDays: 15,
        isPaid: true,
        organizationId: orgId
      }
    });
    assert.strictEqual(resType3.status, 201, 'Notice 3 leave type should be created');
    testType3 = resType3.data.leaveType;
    assert.strictEqual(testType3.minNoticeDays, 3, 'minNoticeDays should be 3');

    await prisma.userLeaveBalance.upsert({
      where: { userId_leaveTypeId: { userId: employee.id, leaveTypeId: testType3.id } },
      create: { userId: employee.id, leaveTypeId: testType3.id, allocated: 10, available: 10, used: 0, pending: 0 },
      update: { allocated: 10, available: 10, used: 0, pending: 0 }
    });

    // -------------------------------------------------------------
    // Test 1: 0 days allows same-day requests
    // -------------------------------------------------------------
    await test('0 days allows same-day leave requests', async () => {
      const res = await apiRequest({
        method: 'POST',
        path: '/api/leaves',
        headers: { Authorization: `Bearer ${employeeToken}` },
        body: {
          leaveType: testType0.code,
          startDate: todayStr,
          endDate: todayStr,
          reason: 'Same day application with 0 notice requirement'
        }
      });
      assert.strictEqual(res.status, 201, `Expected 201 Created but got ${res.status}: ${JSON.stringify(res.data)}`);
      assert.ok(res.data.id || res.data.leave?.id, 'Leave request should be created');
      createdLeaveRequestIds.push(res.data.id || res.data.leave.id);
    });

    // -------------------------------------------------------------
    // Test 2: 1 day rejects same-day requests and permits requests starting tomorrow
    // -------------------------------------------------------------
    await test('1 day rejects same-day requests', async () => {
      const res = await apiRequest({
        method: 'POST',
        path: '/api/leaves',
        headers: { Authorization: `Bearer ${employeeToken}` },
        body: {
          leaveType: testType1.code,
          startDate: todayStr,
          endDate: todayStr,
          reason: 'Attempt same day application for notice 1'
        }
      });
      assert.strictEqual(res.status, 400, 'Expected 400 Bad Request');
      assert.ok(res.data.message.includes('1 day(s) advance notice'), `Error message should mention notice required: ${res.data.message}`);
    });

    await test('1 day permits requests starting tomorrow (spans working day Monday)', async () => {
      const res = await apiRequest({
        method: 'POST',
        path: '/api/leaves',
        headers: { Authorization: `Bearer ${employeeToken}` },
        body: {
          leaveType: testType1.code,
          startDate: tomorrowStr,
          endDate: day3Str,
          reason: 'Application starting tomorrow spanning to Monday with 1 day notice'
        }
      });
      assert.strictEqual(res.status, 201, `Expected 201 Created but got ${res.status}: ${JSON.stringify(res.data)}`);
      assert.ok(res.data.id || res.data.leave?.id, 'Leave request should be created');
      const reqId = res.data.id || res.data.leave.id;
      createdLeaveRequestIds.push(reqId);
      // Delete this so later test cases don't hit date overlap
      await prisma.leaveRequest.delete({ where: { id: reqId } });
    });

    // -------------------------------------------------------------
    // Test 3: 3 days rejects < 3 calendar days notice and permits >= 3
    // -------------------------------------------------------------
    await test('3 days rejects request with 1 day notice (tomorrow)', async () => {
      const res = await apiRequest({
        method: 'POST',
        path: '/api/leaves',
        headers: { Authorization: `Bearer ${employeeToken}` },
        body: {
          leaveType: testType3.code,
          startDate: tomorrowStr,
          endDate: day3Str,
          reason: 'Attempt application starting tomorrow (1 day notice) for notice 3 requirement'
        }
      });
      assert.strictEqual(res.status, 400, 'Expected 400 Bad Request');
      assert.ok(res.data.message.includes('3 day(s) advance notice'), `Error message: ${res.data.message}`);
    });

    await test('3 days rejects request with 2 days notice (Sunday)', async () => {
      const res = await apiRequest({
        method: 'POST',
        path: '/api/leaves',
        headers: { Authorization: `Bearer ${employeeToken}` },
        body: {
          leaveType: testType3.code,
          startDate: day2Str,
          endDate: day3Str,
          reason: 'Attempt application starting Sunday (2 days notice) for notice 3 requirement'
        }
      });
      assert.strictEqual(res.status, 400, 'Expected 400 Bad Request');
      assert.ok(res.data.message.includes('3 day(s) advance notice'), `Error message: ${res.data.message}`);
    });

    await test('3 days permits request meeting requirement (today + 3 days Monday)', async () => {
      const res = await apiRequest({
        method: 'POST',
        path: '/api/leaves',
        headers: { Authorization: `Bearer ${employeeToken}` },
        body: {
          leaveType: testType3.code,
          startDate: day3Str,
          endDate: day3Str,
          reason: 'Application exactly 3 days in advance on Monday'
        }
      });
      assert.strictEqual(res.status, 201, `Expected 201 Created but got ${res.status}: ${JSON.stringify(res.data)}`);
      assert.ok(res.data.id || res.data.leave?.id, 'Leave request should be created');
      const reqId = res.data.id || res.data.leave.id;
      createdLeaveRequestIds.push(reqId);
      // Clean up for next tests
      await prisma.leaveRequest.delete({ where: { id: reqId } });
    });

    // -------------------------------------------------------------
    // Test 4: Multi-day leave requests use the first requested leave date
    // -------------------------------------------------------------
    await test('Multi-day request uses first requested date: rejects if start date is today for 1-day notice', async () => {
      const res = await apiRequest({
        method: 'POST',
        path: '/api/leaves',
        headers: { Authorization: `Bearer ${employeeToken}` },
        body: {
          leaveType: testType1.code,
          startDate: todayStr,
          endDate: day4Str,
          reason: 'Multi-day starting today should fail 1-day notice'
        }
      });
      assert.strictEqual(res.status, 400, 'Should reject multi-day starting today when 1-day notice is required');
      assert.ok(res.data.message.includes('1 day(s) advance notice'), `Message: ${res.data.message}`);
    });

    await test('Multi-day request uses first requested date: permits if start date satisfies notice', async () => {
      const res = await apiRequest({
        method: 'POST',
        path: '/api/leaves',
        headers: { Authorization: `Bearer ${employeeToken}` },
        body: {
          leaveType: testType1.code,
          startDate: tomorrowStr,
          endDate: day4Str,
          reason: 'Multi-day starting tomorrow satisfies 1-day notice'
        }
      });
      assert.strictEqual(res.status, 201, `Expected 201 Created: ${JSON.stringify(res.data)}`);
      assert.ok(res.data.id || res.data.leave?.id);
      const reqId = res.data.id || res.data.leave.id;
      createdLeaveRequestIds.push(reqId);
      await prisma.leaveRequest.delete({ where: { id: reqId } });
    });

    // -------------------------------------------------------------
    // Test 6: Existing leave types without configured value default to 0
    // -------------------------------------------------------------
    await test('Existing leave types without explicit notice default to 0 and allow same-day', async () => {
      const slType = await prisma.leaveType.findFirst({ where: { code: 'SL' } });
      assert.ok(slType, 'SL leave type should exist');
      assert.strictEqual(slType.minNoticeDays, 0, 'SL should default to 0 minNoticeDays');

      const clType = await prisma.leaveType.findFirst({ where: { code: 'CL' } });
      assert.ok(clType, 'CL leave type should exist');
      assert.strictEqual(clType.minNoticeDays, 1, 'CL has user-configured 1 minNoticeDays');

      // Check balances API exposes minNoticeDays
      const balRes = await apiRequest({
        method: 'GET',
        path: '/api/leaves/balances',
        headers: { Authorization: `Bearer ${employeeToken}` }
      });
      assert.strictEqual(balRes.status, 200);
      const exposedSl = balRes.data.leaveTypes?.find(lt => lt.code === 'SL');
      assert.ok(exposedSl, 'SL should be in leave balances');
      assert.strictEqual(exposedSl.minNoticeDays, 0, 'SL minNoticeDays should be exposed as 0');

      const exposedCl = balRes.data.leaveTypes?.find(lt => lt.code === 'CL');
      assert.ok(exposedCl, 'CL should be in leave balances');
      assert.strictEqual(exposedCl.minNoticeDays, 1, 'CL minNoticeDays should be exposed as 1');
    });

    // -------------------------------------------------------------
    // Test 7: Both leave request creation and editing enforce the rule
    // -------------------------------------------------------------
    await test('Editing an existing leave request enforces minimum notice', async () => {
      // Create a valid request for day3Str (Monday) under testType1
      const createRes = await apiRequest({
        method: 'POST',
        path: '/api/leaves',
        headers: { Authorization: `Bearer ${employeeToken}` },
        body: {
          leaveType: testType1.code,
          startDate: day3Str,
          endDate: day3Str,
          reason: 'Valid future request to test edit validation'
        }
      });
      assert.strictEqual(createRes.status, 201);
      const leaveId = createRes.data.id || createRes.data.leave.id;
      createdLeaveRequestIds.push(leaveId);

      // Attempt to edit its start date to today (violating testType1's 1-day notice)
      const editFailRes = await apiRequest({
        method: 'PUT',
        path: `/api/leaves/${leaveId}`,
        headers: { Authorization: `Bearer ${employeeToken}` },
        body: {
          leaveType: testType1.code,
          startDate: todayStr,
          endDate: todayStr,
          reason: 'Updated to today which violates 1-day notice'
        }
      });
      assert.strictEqual(editFailRes.status, 400, 'Editing to earlier date violating notice must be rejected');
      assert.ok(editFailRes.data.message.includes('1 day(s) advance notice'));

      // Attempt to edit to Tuesday (satisfies testType1's 1-day notice)
      const editPassRes = await apiRequest({
        method: 'PUT',
        path: `/api/leaves/${leaveId}`,
        headers: { Authorization: `Bearer ${employeeToken}` },
        body: {
          leaveType: testType1.code,
          startDate: day4Str,
          endDate: day4Str,
          reason: 'Updated to Tuesday which satisfies 1-day notice'
        }
      });
      assert.strictEqual(editPassRes.status, 200, `Expected 200 OK: ${JSON.stringify(editPassRes.data)}`);
      const updatedObj = editPassRes.data.leave || editPassRes.data;
      assert.strictEqual(updatedObj.startDate.split('T')[0], day4Str);
    });

    // -------------------------------------------------------------
    // Test 8: WFH, leave balances, Comp-Off remain unaffected
    // -------------------------------------------------------------
    await test('WFH system leave type remains protected and unaffected', async () => {
      const wfh = await prisma.leaveType.findFirst({ where: { code: 'WFH' } });
      assert.ok(wfh);
      assert.strictEqual(wfh.isSystem, true);
      assert.strictEqual(wfh.minNoticeDays, 0, 'WFH defaults to 0 notice days');
    });

    await test('Leave policy configuration updates minNoticeDays successfully via API', async () => {
      // Super admin updates testType0 to 2 days notice
      const updateRes = await apiRequest({
        method: 'PUT',
        path: `/api/leave-policy/types/${testType0.id}`,
        headers: { Authorization: `Bearer ${superAdminToken}` },
        body: {
          name: testType0.name,
          minNoticeDays: 2
        }
      });
      assert.strictEqual(updateRes.status, 200);
      assert.strictEqual(updateRes.data.leaveType.minNoticeDays, 2);

      // Verify DB persistence
      const dbType = await prisma.leaveType.findUnique({ where: { id: testType0.id } });
      assert.strictEqual(dbType.minNoticeDays, 2);
    });

  } finally {
    // Clean up created test leave requests and test types
    console.log('\nCleaning up test artifacts...');
    if (createdLeaveRequestIds.length > 0) {
      await prisma.leaveRequest.deleteMany({
        where: { id: { in: createdLeaveRequestIds } }
      });
    }

    const testTypeIds = [testType0?.id, testType1?.id, testType3?.id].filter(Boolean);
    if (testTypeIds.length > 0) {
      await prisma.userLeaveBalance.deleteMany({
        where: { leaveTypeId: { in: testTypeIds } }
      });
      await prisma.leaveType.deleteMany({
        where: { id: { in: testTypeIds } }
      });
    }
  }

  console.log('\n================================================================');
  console.log(`TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
