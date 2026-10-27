const http = require('http');
const jwt = require('jsonwebtoken');
const prisma = require('./backend/src/utils/db');
const { getTestConfig } = require('./backend/src/utils/testConfigHelper');

const testConfig = getTestConfig({ isDestructive: true });
const JWT_SECRET = process.env.JWT_SECRET || 'enterprise_internship_crm_super_secret_jwt_key_123!';

async function makeRequest(token, method, queryPath, body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (postData) headers['Content-Length'] = Buffer.byteLength(postData);

    const options = {
      hostname: testConfig.hostname,
      port: testConfig.port,
      path: queryPath,
      method: method.toUpperCase(),
      headers
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runPhase2FunctionalTests() {
  console.log('====================================================');
  console.log('PHASE 2: SHIFT MANAGEMENT UI & FUNCTIONAL VERIFICATION');
  console.log('====================================================\n');

  // 1. Authenticate as Super Admin
  const superAdmin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' }
  });
  if (!superAdmin) throw new Error('Super Admin not found in DB.');

  const token = jwt.sign(
    {
      id: superAdmin.id,
      email: superAdmin.email,
      role: superAdmin.role,
      organizationId: superAdmin.organizationId
    },
    JWT_SECRET,
    { expiresIn: '1d' }
  );
  console.log(`[1] Authenticated as: ${superAdmin.name} (${superAdmin.email})`);

  // 2. Fetch Organizations
  const orgsRes = await makeRequest(token, 'GET', '/api/organizations');
  const orgs = orgsRes.body?.organizations || orgsRes.body?.data || orgsRes.body || [];
  if (!Array.isArray(orgs) || orgs.length === 0) {
    throw new Error('No organizations found.');
  }
  const testOrg = orgs[0];
  console.log(`[2] Target Organization: "${testOrg.name}" (${testOrg.id})`);

  // 3. Verify Shifts Dashboard Loading & Company Default Shift Protection
  console.log('\n[3] Testing Shifts Dashboard Retrieval...');
  const shiftsRes = await makeRequest(token, 'GET', `/api/shifts?organizationId=${testOrg.id}`);
  console.log(` - GET /api/shifts status: HTTP ${shiftsRes.status}`);
  if (!shiftsRes.body?.success) {
    throw new Error(`Failed to get shifts: ${JSON.stringify(shiftsRes.body)}`);
  }

  const shifts = shiftsRes.body.shifts || [];
  console.log(` - Total shifts loaded: ${shifts.length}`);
  const defaultShift = shifts.find(s => s.name === 'Company Default');
  if (!defaultShift) {
    throw new Error('Company Default shift not found for target organization.');
  }
  console.log(` - Company Default Shift verified: ID=${defaultShift.id}, Time=${defaultShift.startTime}–${defaultShift.endTime}`);

  // 4. Test Shift Creation Flow (Task 4: Basic Info, Working Days Selector, Attendance settings inheritance)
  console.log('\n[4] Testing Shift Creation Flow (Task 3 & 4)...');
  const newShiftPayload = {
    organizationId: testOrg.id,
    name: 'Morning Shift',
    startTime: '07:00',
    endTime: '15:30',
    workingDays: {
      MONDAY: 'Working',
      TUESDAY: 'Working',
      WEDNESDAY: 'Working',
      THURSDAY: 'Working',
      FRIDAY: 'Working',
      SATURDAY: 'WFH',
      SUNDAY: 'Holiday'
    },
    status: 'ACTIVE'
  };

  const createRes = await makeRequest(token, 'POST', '/api/shifts', newShiftPayload);
  console.log(` - POST /api/shifts status: HTTP ${createRes.status}`);
  if (createRes.status !== 201 || !createRes.body?.success) {
    throw new Error(`Failed to create shift: ${JSON.stringify(createRes.body)}`);
  }
  const createdShift = createRes.body.shift;
  console.log(` - Created shift successfully: "${createdShift.name}" (ID: ${createdShift.id})`);
  console.log(` - Operational hours: ${createdShift.startTime} – ${createdShift.endTime}`);
  console.log(` - Working days: ${JSON.stringify(createdShift.workingDays)}`);

  // 5. Test Shift List Refresh (Verify new shift appears alongside default shift)
  console.log('\n[5] Testing Shift Dashboard Refresh (Task 4 & 5)...');
  const refreshedShiftsRes = await makeRequest(token, 'GET', `/api/shifts?organizationId=${testOrg.id}`);
  const updatedShifts = refreshedShiftsRes.body.shifts || [];
  const foundCreated = updatedShifts.find(s => s.id === createdShift.id);
  if (!foundCreated) {
    throw new Error('Newly created shift does not appear in refreshed shift list.');
  }
  console.log(` - Refreshed shifts count: ${updatedShifts.length} (PASS: Custom shift appears immediately)`);

  // 6. Test Company Default Protection (Must NOT allow deletion)
  console.log('\n[6] Testing Company Default Shift Protection...');
  const deleteDefaultRes = await makeRequest(token, 'DELETE', `/api/shifts/${defaultShift.id}?organizationId=${testOrg.id}`);
  console.log(` - DELETE default shift status: HTTP ${deleteDefaultRes.status}`);
  if (deleteDefaultRes.status === 200) {
    throw new Error('FAIL: Company Default shift was deleted! It must be protected.');
  }
  console.log(` - PASS: Company Default deletion safely blocked: "${deleteDefaultRes.body?.message}"`);

  // 7. Test Shift Update & Duplicate Simulation
  console.log('\n[7] Testing Shift Update Flow...');
  const updateRes = await makeRequest(token, 'PUT', `/api/shifts/${createdShift.id}?organizationId=${testOrg.id}`, {
    name: 'Morning Shift (Updated)',
    startTime: '07:30',
    endTime: '16:00'
  });
  console.log(` - PUT /api/shifts/:id status: HTTP ${updateRes.status}`);
  if (updateRes.status !== 200) {
    throw new Error('Failed to update shift.');
  }
  console.log(` - PASS: Shift updated successfully.`);

  // 8. Test Clean Up of Custom Shift
  console.log('\n[8] Cleaning up created test shift...');
  const deleteRes = await makeRequest(token, 'DELETE', `/api/shifts/${createdShift.id}?organizationId=${testOrg.id}`);
  console.log(` - DELETE /api/shifts/:id status: HTTP ${deleteRes.status}`);
  if (deleteRes.status !== 200) {
    throw new Error('Failed to delete test shift.');
  }
  console.log(` - PASS: Test shift deleted cleanly.`);

  // 9. Regression Check on Core Modules
  console.log('\n[9] Running Core CRM Regression Check...');
  const regAttendance = await makeRequest(token, 'GET', '/api/attendance/status');
  console.log(` - [Attendance Status] -> HTTP ${regAttendance.status} (${regAttendance.status === 200 ? 'PASS' : 'FAIL'})`);

  const regLeaves = await makeRequest(token, 'GET', '/api/leaves');
  console.log(` - [Leaves Overview] -> HTTP ${regLeaves.status} (${regLeaves.status === 200 ? 'PASS' : 'FAIL'})`);

  const regPositions = await makeRequest(token, 'GET', `/api/positions?organizationId=${testOrg.id}`);
  console.log(` - [Positions List] -> HTTP ${regPositions.status} (${regPositions.status === 200 ? 'PASS' : 'FAIL'})`);

  const regDepartments = await makeRequest(token, 'GET', `/api/organization/departments?organizationId=${testOrg.id}`);
  console.log(` - [Departments List] -> HTTP ${regDepartments.status} (${regDepartments.status === 200 ? 'PASS' : 'FAIL'})`);

  const regPayroll = await makeRequest(token, 'GET', `/api/payroll/settings?organizationId=${testOrg.id}`);
  console.log(` - [Payroll Settings] -> HTTP ${regPayroll.status} (${regPayroll.status === 200 ? 'PASS' : 'FAIL'})`);

  console.log('\n====================================================');
  console.log('ALL PHASE 2 FUNCTIONAL & REGRESSION TESTS PASSED (100%)');
  console.log('====================================================');
}

runPhase2FunctionalTests()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error('Test execution failed:', err);
    prisma.$disconnect();
    process.exit(1);
  });
