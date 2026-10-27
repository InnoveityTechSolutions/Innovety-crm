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

async function run() {
  console.log('================================================================');
  console.log('  TESTING LEAVE ALIAS & MINIMUM NOTICE VALIDATION               ');
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

  // Use clean employee Yeshwanth Y
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', organizationId: { not: null } } });
  let employee = await prisma.user.findUnique({ where: { email: 'yeshwanthy1504@gmail.com' } });
  if (!employee) {
    employee = await prisma.user.findFirst({ where: { role: 'EMPLOYEE', organizationId: admin.organizationId } });
  }

  const employeeToken = jwt.sign(
    { id: employee.id, email: employee.email, role: employee.role, organizationId: employee.organizationId },
    process.env.JWT_SECRET || 'your-default-jwt-secret',
    { expiresIn: '1h' }
  );

  const now = new Date();
  const todayStr = formatDate(now);
  const tomorrowStr = formatDate(addDays(now, 1));
  const day3Str = formatDate(addDays(now, 3)); // Monday
  const day4Str = formatDate(addDays(now, 4)); // Tuesday

  const createdLeaveIds = [];

  try {
    // Check CL minNoticeDays in DB
    const clType = await prisma.leaveType.findFirst({ where: { code: 'CL' } });
    console.log(`Casual Leave (CL) minNoticeDays in DB: ${clType.minNoticeDays}`);
    assert.strictEqual(clType.minNoticeDays, 1, 'Casual Leave must have minNoticeDays = 1');

    // 1. Same-day request with legacy alias "CASUAL" must be REJECTED
    await test('Same-day request with legacy alias "CASUAL" is rejected (notice = 1)', async () => {
      const res = await apiRequest({
        method: 'POST',
        path: '/api/leaves',
        headers: { Authorization: `Bearer ${employeeToken}` },
        body: {
          leaveType: 'CASUAL',
          startDate: todayStr,
          endDate: todayStr,
          reason: 'Attempt same-day with CASUAL alias'
        }
      });
      assert.strictEqual(res.status, 400, `Expected 400 Bad Request but got ${res.status}: ${JSON.stringify(res.data)}`);
      assert.ok(res.data.message.includes('1 day(s) advance notice'), `Error message must mention notice required: ${res.data.message}`);
    });

    // 2. Same-day request with canonical code "CL" must be REJECTED
    await test('Same-day request with canonical code "CL" is rejected (notice = 1)', async () => {
      const res = await apiRequest({
        method: 'POST',
        path: '/api/leaves',
        headers: { Authorization: `Bearer ${employeeToken}` },
        body: {
          leaveType: 'CL',
          startDate: todayStr,
          endDate: todayStr,
          reason: 'Attempt same-day with CL code'
        }
      });
      assert.strictEqual(res.status, 400, `Expected 400 Bad Request but got ${res.status}: ${JSON.stringify(res.data)}`);
      assert.ok(res.data.message.includes('1 day(s) advance notice'), `Error message: ${res.data.message}`);
    });

    // 3. Same-day request with name "Casual Leave" must be REJECTED
    await test('Same-day request with full name "Casual Leave" is rejected (notice = 1)', async () => {
      const res = await apiRequest({
        method: 'POST',
        path: '/api/leaves',
        headers: { Authorization: `Bearer ${employeeToken}` },
        body: {
          leaveType: 'Casual Leave',
          startDate: todayStr,
          endDate: todayStr,
          reason: 'Attempt same-day with full name Casual Leave'
        }
      });
      assert.strictEqual(res.status, 400, `Expected 400 Bad Request but got ${res.status}: ${JSON.stringify(res.data)}`);
      assert.ok(res.data.message.includes('1 day(s) advance notice'), `Error message: ${res.data.message}`);
    });

    // 4. Invalid/unknown leave type must be REJECTED with clear error
    await test('Invalid or unknown leave type is rejected with 400', async () => {
      const res = await apiRequest({
        method: 'POST',
        path: '/api/leaves',
        headers: { Authorization: `Bearer ${employeeToken}` },
        body: {
          leaveType: 'NON_EXISTENT_TYPE',
          startDate: tomorrowStr,
          endDate: tomorrowStr,
          reason: 'Attempt application with fake leave type'
        }
      });
      assert.strictEqual(res.status, 400, 'Expected 400 Bad Request');
      assert.ok(res.data.message.includes('invalid or not available'), `Error message: ${res.data.message}`);
    });

    // 5. Valid request starting Monday (1 working day) with legacy alias "CASUAL" is PERMITTED and saved as "CL"
    await test('Request with alias "CASUAL" is accepted and saved as "CL"', async () => {
      const res = await apiRequest({
        method: 'POST',
        path: '/api/leaves',
        headers: { Authorization: `Bearer ${employeeToken}` },
        body: {
          leaveType: 'CASUAL',
          startDate: day3Str,
          endDate: day3Str,
          reason: 'Valid future request with CASUAL alias'
        }
      });
      assert.strictEqual(res.status, 201, `Expected 201 Created: ${JSON.stringify(res.data)}`);
      const leave = res.data;
      assert.strictEqual(leave.leaveType, 'CL', 'Saved leaveType must be normalized canonical code CL');
      createdLeaveIds.push(leave.id);

      // 6. Test editing this pending request: editing to today with alias "CASUAL" must be REJECTED
      const editFailRes = await apiRequest({
        method: 'PUT',
        path: `/api/leaves/${leave.id}`,
        headers: { Authorization: `Bearer ${employeeToken}` },
        body: {
          leaveType: 'CASUAL',
          startDate: todayStr,
          endDate: todayStr,
          reason: 'Attempt to edit to today violating 1-day notice'
        }
      });
      assert.strictEqual(editFailRes.status, 400, 'Editing to today must be rejected');
      assert.ok(editFailRes.data.message.includes('1 day(s) advance notice'));

      // 7. Test editing this pending request: editing to Tuesday (satisfies notice) is ACCEPTED
      const editPassRes = await apiRequest({
        method: 'PUT',
        path: `/api/leaves/${leave.id}`,
        headers: { Authorization: `Bearer ${employeeToken}` },
        body: {
          leaveType: 'CASUAL',
          startDate: day4Str,
          endDate: day4Str,
          reason: 'Edit to Tuesday satisfying notice'
        }
      });
      assert.strictEqual(editPassRes.status, 200, `Expected 200 OK: ${JSON.stringify(editPassRes.data)}`);
      assert.strictEqual(editPassRes.data.leaveType, 'CL');
    });

  } finally {
    console.log('\nCleaning up created test leaves...');
    if (createdLeaveIds.length > 0) {
      await prisma.leaveRequest.deleteMany({
        where: { id: { in: createdLeaveIds } }
      });
    }
  }

  console.log('\n================================================================');
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
