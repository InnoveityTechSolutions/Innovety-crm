const http = require('http');
const path = require('path');
module.paths.push(path.resolve(__dirname, '..', 'backend', 'node_modules'));
const jwt = require('jsonwebtoken');
const prisma = require('../backend/src/utils/db');

let total = 0;
let passed = 0;

function assert(condition, msg) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${msg}`);
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function request({ method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const dataString = body ? JSON.stringify(body) : '';
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    if (dataString) {
      reqHeaders['Content-Length'] = Buffer.byteLength(dataString);
    }

    const req = http.request(
      {
        hostname: 'localhost',
        port: 5000,
        path,
        method,
        headers: reqHeaders
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => (responseBody += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(responseBody);
          } catch {
            parsed = responseBody;
          }
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        });
      }
    );

    req.on('error', reject);
    if (dataString) req.write(dataString);
    req.end();
  });
}

function makeToken(user) {
  const secret = process.env.JWT_SECRET || 'your_jwt_secret_key_change_in_production';
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId
    },
    secret,
    { expiresIn: '1h' }
  );
}

async function runLiveApiSuite() {
  console.log('================================================================');
  console.log('  InnovEity CRM — Comp-Off Live HTTP API Test Suite');
  console.log('================================================================\n');

  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', organizationId: 'cmu43zvwm0000exne7d53m25e' }
  });
  const superAdmin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' }
  });
  const employee = await prisma.user.findFirst({
    where: { role: 'EMPLOYEE', organizationId: 'cmu43zvwm0000exne7d53m25e' }
  });

  const adminToken = makeToken(admin);
  const superAdminToken = makeToken(superAdmin);
  const employeeToken = makeToken(employee);

  // Sunday date
  const sunday = new Date();
  while (sunday.getUTCDay() !== 0) {
    sunday.setDate(sunday.getDate() - 1);
  }
  const sundayDateStr = sunday.toISOString().split('T')[0];
  const sundayDate = new Date(`${sundayDateStr}T00:00:00.000Z`);

  // Ensure attendance evidence exists
  await prisma.attendance.deleteMany({
    where: { userId: employee.id, date: sundayDate }
  });
  await prisma.compOffCredit.deleteMany({
    where: { userId: employee.id, workDate: sundayDate }
  });

  const att = await prisma.attendance.create({
    data: {
      userId: employee.id,
      date: sundayDate,
      clockIn: new Date(`${sundayDateStr}T09:00:00.000Z`),
      clockOut: new Date(`${sundayDateStr}T18:00:00.000Z`),
      workingHours: 9.0,
      status: 'PRESENT',
      workLocation: 'OFFICE'
    }
  });

  let createdCreditId = null;

  try {
    console.log('--- Test 1: GET /api/comp-off/evidence ---');
    {
      const res = await request({
        method: 'GET',
        path: `/api/comp-off/evidence?userId=${employee.id}&workDate=${sundayDateStr}`,
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert(res.status === 200, 'GET /api/comp-off/evidence returns 200 OK');
      assert(res.data.workdayEligibility.isEligible === true, 'Evidence identifies Sunday as eligible workday');
      assert(res.data.attendanceEvidence.isSufficient === true, 'Evidence identifies valid attendance');
      assert(res.data.canAuthorize === true, 'Diagnostic flags canAuthorize = true');
    }

    console.log('\n--- Test 2: POST /api/comp-off/authorize Security Safeguards ---');
    {
      // 1. Super Admin rejected
      const saRes = await request({
        method: 'POST',
        path: '/api/comp-off/authorize',
        headers: { Authorization: `Bearer ${superAdminToken}` },
        body: { userId: employee.id, workDate: sundayDateStr, creditDays: 1.0 }
      });
      assert(saRes.status === 403, 'Super Admin authorization attempt returns 403 Forbidden');
      assert(saRes.data.message.includes('read-only'), 'Message indicates Super Admin read-only');

      // 2. Invalid credit amount rejected
      const badAmountRes = await request({
        method: 'POST',
        path: '/api/comp-off/authorize',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { userId: employee.id, workDate: sundayDateStr, creditDays: 0.75 }
      });
      assert(badAmountRes.status === 400, 'Invalid credit amount 0.75 returns 400 Bad Request');

      // 3. Future date rejected
      const futureDateStr = new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0];
      const futureRes = await request({
        method: 'POST',
        path: '/api/comp-off/authorize',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { userId: employee.id, workDate: futureDateStr, creditDays: 1.0 }
      });
      assert(futureRes.status === 400, 'Future work date returns 400 Bad Request');
    }

    console.log('\n--- Test 3: POST /api/comp-off/authorize Valid Authorization ---');
    {
      const authRes = await request({
        method: 'POST',
        path: '/api/comp-off/authorize',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          userId: employee.id,
          workDate: sundayDateStr,
          creditDays: 1.0,
          remarks: 'Live HTTP API test authorization'
        }
      });
      assert(authRes.status === 201, 'Valid Admin authorization returns 201 Created');
      assert(authRes.data.status === 'APPROVED', 'Status is APPROVED');
      assert(authRes.data.availableDays === 1.0, 'availableDays is 1.0');
      createdCreditId = authRes.data.id;
    }

    console.log('\n--- Test 4: Duplicate Submission Blocked via API ---');
    {
      const dupRes = await request({
        method: 'POST',
        path: '/api/comp-off/authorize',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          userId: employee.id,
          workDate: sundayDateStr,
          creditDays: 1.0,
          remarks: 'Duplicate attempt'
        }
      });
      assert(dupRes.status === 409, 'Duplicate authorization returns 409 Conflict');
    }

    console.log('\n--- Test 5: GET /api/comp-off/credits ---');
    {
      const listRes = await request({
        method: 'GET',
        path: `/api/comp-off/credits?userId=${employee.id}`,
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      console.log('listRes status:', listRes.status, 'data:', listRes.data);
      assert(listRes.status === 200, 'GET /api/comp-off/credits returns 200 OK');
      assert(Array.isArray(listRes.data.credits), 'Returns credits array');
      assert(listRes.data.credits.some(c => c.id === createdCreditId), 'List contains created credit');
    }

    console.log('\n--- Test 6: GET /api/comp-off/credits/:id ---');
    {
      const getRes = await request({
        method: 'GET',
        path: `/api/comp-off/credits/${createdCreditId}`,
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert(getRes.status === 200, 'GET /api/comp-off/credits/:id returns 200 OK');
      assert(getRes.data.id === createdCreditId, 'Returns requested credit');
      assert(getRes.data.attendance !== null, 'Includes linked attendance evidence');
      assert(getRes.data.adminApprover !== null, 'Includes adminApprover audit details');
    }

    console.log('\n--- Test 7: GET /api/leaves/balances reflects updated Comp-Off credit ---');
    {
      const balRes = await request({
        method: 'GET',
        path: `/api/leaves/balances?userId=${employee.id}`,
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert(balRes.status === 200, 'GET /api/leaves/balances returns 200 OK');
      assert(balRes.data.compOffRemaining >= 1.0, `Live balance reflects compOffRemaining: ${balRes.data.compOffRemaining}`);
    }

  } finally {
    // Cleanup
    if (createdCreditId) {
      await prisma.compOffCredit.deleteMany({ where: { id: createdCreditId } });
    }
    await prisma.attendance.deleteMany({ where: { id: att.id } });
    console.log('\n  Live API test fixtures cleaned up.');
    await prisma.$disconnect();
  }

  console.log('\n================================================================');
  console.log(`  LIVE API TESTS PASSED! (${passed} / ${total} assertions passed)`);
  console.log('================================================================');
}

runLiveApiSuite().catch(err => {
  console.error('Live API Test Suite Failed:', err);
  process.exit(1);
});
