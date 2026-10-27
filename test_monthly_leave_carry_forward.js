const prisma = require('./backend/src/utils/db');
const jwt = require('./backend/node_modules/jsonwebtoken');
const { getCompanyLeavePolicy } = require('./backend/src/utils/companyLeavePolicyStore');

const BASE_URL = 'http://localhost:5000/api';
const JWT_SECRET = process.env.JWT_SECRET || 'enterprise_internship_crm_super_secret_jwt_key_123!';

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      organizationId: user.organizationId,
      organizationSlug: 'innoveity'
    },
    JWT_SECRET,
    { expiresIn: '1d' }
  );
}

async function apiRequest(method, url, data = null, headers = {}) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };
  if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    options.body = JSON.stringify(data);
  }
  const res = await fetch(url, options);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, data: json };
}

async function runTests() {
  console.log('================================================================');
  console.log('   MONTHLY LEAVE CARRY FORWARD & ANNUAL RESET VERIFICATION TESTS ');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`  [FAIL] ${message}`);
    }
  }

  const cleanupIds = {
    users: [],
    orgs: [],
    leaves: [],
    balances: []
  };

  try {
    const adminUser = await prisma.user.findFirst({
      where: { organizationId: 'cmu43zvwm0000exne7d53m25e', role: 'ADMIN' }
    });
    const adminToken = generateToken(adminUser);
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };

    const superAdminUser = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN' }
    });
    const superAdminToken = generateToken(superAdminUser);
    const superAdminHeaders = { Authorization: `Bearer ${superAdminToken}` };

    // ====================================================================
    // TEST PART 1: Isolated Employee with Jan 1 joining date
    // ====================================================================
    console.log('\n--- PART 1: Employee with Jan 1 Joining Date (Full Year Accrual) ---');

    const janEmployee = await prisma.user.create({
      data: {
        id: 'test_cf_jan_emp_' + Date.now(),
        employeeId: 'EMP_TEST_' + Date.now().toString().slice(-6),
        name: 'Carry Forward Jan Employee',
        email: `cf_jan_emp_${Date.now()}@test.com`,
        password: '$2b$10$oorJgLdYa3IQVTn2fdW/bOnVmIbOV3bedL.NhN2IjgrY.Y/L6Q7kW',
        role: 'EMPLOYEE',
        organizationId: 'cmu43zvwm0000exne7d53m25e',
        status: 'ACTIVE',
        joiningDate: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z')
      }
    });
    cleanupIds.users.push(janEmployee.id);

    const janToken = generateToken(janEmployee);
    const janHeaders = { Authorization: `Bearer ${janToken}` };

    // Fetch balances for Jan Employee in October (current month is October: 9 prior months Jan-Sep)
    const balancesRes = await apiRequest('GET', `${BASE_URL}/leaves/balances`, null, janHeaders);
    assert(balancesRes.status === 200, 'Employee balances endpoint returned 200 OK');

    const clType = balancesRes.data.leaveTypes.find(lt => lt.code === 'CL');
    const slType = balancesRes.data.leaveTypes.find(lt => lt.code === 'SL');

    // 1. Monthly Carry Forward enabled (CL) accumulates month to month
    assert(clType !== undefined, 'Casual Leave (CL) exists in balances');
    assert(clType.allowCarryForward === true, 'CL has allowCarryForward = true');
    assert(clType.allocated === 1, `CL current month allocation is 1 (got: ${clType.allocated})`);
    assert(clType.carryForward === 9, `CL unused monthly credits accumulated into carryForward = 9 (got: ${clType.carryForward})`);
    assert(clType.available === 10, `CL total available = 10 (1 allocated + 9 carryForward) (got: ${clType.available})`);

    // 2. Monthly Carry Forward disabled (SL) expires at month-end
    assert(slType !== undefined, 'Sick Leave (SL) exists in balances');
    assert(slType.allowCarryForward === false, 'SL has allowCarryForward = false');
    assert(slType.allocated === 1, `SL current month allocation is 1 (got: ${slType.allocated})`);
    assert(slType.carryForward === 0, `SL carryForward is 0 because credits expire at month-end (got: ${slType.carryForward})`);
    assert(slType.available === 1, `SL available is strictly current month credit = 1 (got: ${slType.available})`);

    // 3. Repeated balance queries do NOT duplicate credits (Idempotency)
    const repeatBalancesRes = await apiRequest('GET', `${BASE_URL}/leaves/balances`, null, janHeaders);
    const clRepeat = repeatBalancesRes.data.leaveTypes.find(lt => lt.code === 'CL');
    const slRepeat = repeatBalancesRes.data.leaveTypes.find(lt => lt.code === 'SL');
    assert(clRepeat.available === 10, `Repeat call: CL available remains exactly 10 (got: ${clRepeat.available})`);
    assert(clRepeat.carryForward === 9, `Repeat call: CL carryForward remains exactly 9 (got: ${clRepeat.carryForward})`);
    assert(slRepeat.available === 1, `Repeat call: SL available remains exactly 1 (got: ${slRepeat.available})`);

    // ====================================================================
    // TEST PART 2: Leave Application, Approval, and Cancellation with Carry-Forward
    // ====================================================================
    console.log('\n--- PART 2: Application, Approval, and Cancellation ---');

    // Employee applies for 3 days of Casual Leave (using carried-forward balance)
    const testStartDate = '2026-10-27';
    const testEndDate = '2026-10-29'; // 3 days

    const applyRes = await apiRequest('POST', `${BASE_URL}/leaves`, {
      leaveType: 'CL',
      startDate: testStartDate,
      endDate: testEndDate,
      reason: '3-day leave utilizing accumulated carry-forward balance'
    }, janHeaders);

    assert(applyRes.status === 201, `Leave application for 3 days succeeded (status: ${applyRes.status})`);
    const createdLeaveId = applyRes.data.id;
    cleanupIds.leaves.push(createdLeaveId);

    // Verify pending balance before approval
    const pendingBalancesRes = await apiRequest('GET', `${BASE_URL}/leaves/balances`, null, janHeaders);
    const clPending = pendingBalancesRes.data.leaveTypes.find(lt => lt.code === 'CL');
    assert(clPending.pending === 3, `Pending leave tracks 3 days (got: ${clPending.pending})`);
    assert(clPending.available === 7, `Available balance accounts for pending leave (got: ${clPending.available}, expected: 7)`);

    // Admin approves the 3-day leave request
    const approveRes = await apiRequest('PUT', `${BASE_URL}/leaves/${createdLeaveId}/status`, {
      status: 'APPROVED',
      action: 'APPROVE',
      comment: 'Approved 3 days'
    }, adminHeaders);
    assert(approveRes.status === 200, `Admin approved leave request (status: ${approveRes.status})`);

    // Verify balances after approval: available must decrease by exactly 3, used must be 3, no double counting
    const afterApproveBalances = await apiRequest('GET', `${BASE_URL}/leaves/balances`, null, janHeaders);
    const clApproved = afterApproveBalances.data.leaveTypes.find(lt => lt.code === 'CL');
    assert(clApproved.available === 7, `Available balance after approval is 7 (got: ${clApproved.available})`);
    assert(clApproved.used === 3, `Used days after approval is 3 (got: ${clApproved.used})`);
    assert(clApproved.pending === 0, `Pending days reset to 0 after approval (got: ${clApproved.pending})`);

    // Admin cancels the approved leave
    const cancelRes = await apiRequest('PUT', `${BASE_URL}/leaves/${createdLeaveId}/cancel`, {}, adminHeaders);
    assert(cancelRes.status === 200, `Admin cancelled approved leave (status: ${cancelRes.status})`);

    // Verify balances after cancellation: available restored to 10, used back to 0, no double counting
    const afterCancelBalances = await apiRequest('GET', `${BASE_URL}/leaves/balances`, null, janHeaders);
    const clCancelled = afterCancelBalances.data.leaveTypes.find(lt => lt.code === 'CL');
    assert(clCancelled.available === 10, `Available balance restored exactly to 10 (got: ${clCancelled.available})`);
    assert(clCancelled.used === 0, `Used days restored back to 0 (got: ${clCancelled.used})`);

    // ====================================================================
    // TEST PART 3: Real Employee Balance Verification (Usage & Joining Date Awareness)
    // ====================================================================
    console.log('\n--- PART 3: Real Employee Balance & Carry Forward Visibility ---');

    // Test Yeshwanth (joined Sept 2026, 0 leaves taken -> carry forward = 1, available = 2)
    const yeshwanth = await prisma.user.findFirst({
      where: { email: 'yeshwanthy1504@gmail.com' }
    });
    assert(yeshwanth !== null, 'Found existing employee Yeshwanth Y (0 leaves used)');
    const yeshwanthToken = generateToken(yeshwanth);
    const yeshwanthHeaders = { Authorization: `Bearer ${yeshwanthToken}` };

    const yBalancesRes = await apiRequest('GET', `${BASE_URL}/leaves/balances`, null, yeshwanthHeaders);
    assert(yBalancesRes.status === 200, 'Yeshwanth balances retrieved successfully');
    const yCl = yBalancesRes.data.leaveTypes.find(lt => lt.code === 'CL');
    const ySl = yBalancesRes.data.leaveTypes.find(lt => lt.code === 'SL');

    assert(yCl.allocated === 1, `Yeshwanth CL current month allocation = 1 (got: ${yCl.allocated})`);
    assert(yCl.carryForward === 1, `Yeshwanth CL carried forward 1 month from September = 1 (got: ${yCl.carryForward})`);
    assert(yCl.available === 2, `Yeshwanth CL available = 2 (got: ${yCl.available})`);
    assert(yCl.allowCarryForward === true, 'Yeshwanth CL allows carry forward');

    assert(ySl.allocated === 1, `Yeshwanth SL allocated = 1 (got: ${ySl.allocated})`);
    assert(ySl.carryForward === 0, `Yeshwanth SL carryForward = 0 (got: ${ySl.carryForward})`);
    assert(ySl.available === 1, `Yeshwanth SL available = 1 (got: ${ySl.available})`);

    // Test Zubairya (joined Sept 2026, used 1 day in Sept -> carry forward = 0, available = 1)
    const zubairya = await prisma.user.findFirst({
      where: { email: 'zubairyasalamkhan213@gmail.com' }
    });
    assert(zubairya !== null, 'Found existing employee Zubairya Salam Khan (1 leave used in Sept)');
    const zubairyaToken = generateToken(zubairya);
    const zubairyaHeaders = { Authorization: `Bearer ${zubairyaToken}` };

    const zBalancesRes = await apiRequest('GET', `${BASE_URL}/leaves/balances`, null, zubairyaHeaders);
    assert(zBalancesRes.status === 200, 'Zubairya balances retrieved successfully');
    const zCl = zBalancesRes.data.leaveTypes.find(lt => lt.code === 'CL');
    assert(zCl.allocated === 1, `Zubairya CL allocated = 1 (got: ${zCl.allocated})`);
    assert(zCl.carryForward === 0, `Zubairya CL carryForward = 0 (Sept credit used in Sept) (got: ${zCl.carryForward})`);
    assert(zCl.available === 1, `Zubairya CL available = 1 (got: ${zCl.available})`);

    // ====================================================================
    // TEST PART 4: Annual Reset Isolated Test (Annual allocation NEVER carries forward)
    // ====================================================================
    console.log('\n--- PART 4: Annual Allocation Reset (Strict 0 Carry Forward) ---');

    const testOrgId = 'test_ann_org_' + Date.now();
    const testOrg = await prisma.organization.create({
      data: {
        id: testOrgId,
        slug: 'slug-' + testOrgId,
        companyCode: 'COMP_' + Date.now().toString().slice(-6),
        name: 'Isolated Annual Reset Org',
        status: 'ACTIVE'
      }
    });
    cleanupIds.orgs.push(testOrg.id);

    const annualUser = await prisma.user.create({
      data: {
        id: 'test_ann_u_' + Date.now(),
        employeeId: 'EMP_ANN_' + Date.now().toString().slice(-6),
        name: 'Annual User',
        email: `ann_u_${Date.now()}@test.com`,
        password: '$2b$10$oorJgLdYa3IQVTn2fdW/bOnVmIbOV3bedL.NhN2IjgrY.Y/L6Q7kW',
        role: 'EMPLOYEE',
        organizationId: testOrg.id,
        status: 'ACTIVE',
        joiningDate: new Date('2025-06-01T00:00:00.000Z')
      }
    });
    cleanupIds.users.push(annualUser.id);

    // Create an annual balance record with unused days and prior carry forward
    const initialAnnualBal = await prisma.userLeaveBalance.create({
      data: {
        userId: annualUser.id,
        leaveTypeId: clType.id,
        allocated: 12.0,
        used: 4.0,
        pending: 1.0,
        available: 7.0,
        carryForward: 5.0, // Existing carry forward from earlier
        expired: 0.0
      }
    });
    cleanupIds.balances.push(initialAnnualBal.id);

    // Call annual reset API for the isolated test organization
    const resetRes = await apiRequest('POST', `${BASE_URL}/leave-policy/annual-reset`, {
      organizationId: testOrg.id
    }, superAdminHeaders);

    assert(resetRes.status === 200, `Annual reset executed successfully for test organization (status: ${resetRes.status})`);

    const resetBal = await prisma.userLeaveBalance.findUnique({
      where: { id: initialAnnualBal.id }
    });

    assert(resetBal.carryForward === 0, `Annual reset strictly set carryForward = 0 (got: ${resetBal.carryForward})`);
    assert(resetBal.expired === 7.0, `Annual reset expired the 7.0 remaining unused available days (got: ${resetBal.expired})`);
    assert(resetBal.used === 0, `Annual reset reset used to 0 (got: ${resetBal.used})`);
    assert(resetBal.pending === 0, `Annual reset reset pending to 0 (got: ${resetBal.pending})`);
    assert(resetBal.allocated === 12.0, `Annual reset assigned fresh annual allowance (got: ${resetBal.allocated})`);
    assert(resetBal.available === 12.0, `Annual reset set available to fresh annual allowance (got: ${resetBal.available})`);

    // ====================================================================
    // TEST PART 5: Role-Specific Allowances Respected
    // ====================================================================
    console.log('\n--- PART 5: Company & Role-Specific Allowances ---');

    const empPolicy = getCompanyLeavePolicy('cmu43zvwm0000exne7d53m25e', 'EMPLOYEE');
    const tlPolicy = getCompanyLeavePolicy('cmu43zvwm0000exne7d53m25e', 'TEAM_LEADER');

    assert(empPolicy !== null, 'EMPLOYEE policy exists in company store');
    assert(tlPolicy !== null, 'TEAM_LEADER policy exists in company store');
    assert(empPolicy.allowances?.CL !== undefined, 'EMPLOYEE policy defines CL allowance');
    assert(tlPolicy.allowances?.CL !== undefined, 'TEAM_LEADER policy defines CL allowance');

    console.log('\n================================================================');
    console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
    console.log('================================================================\n');

    process.exit(totalTests === passedTests ? 0 : 1);
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  } finally {
    // Clean up test records
    for (const lid of cleanupIds.leaves) {
      await prisma.leaveRequest.deleteMany({ where: { id: lid } }).catch(() => {});
    }
    for (const bid of cleanupIds.balances) {
      await prisma.userLeaveBalance.deleteMany({ where: { id: bid } }).catch(() => {});
    }
    for (const uid of cleanupIds.users) {
      await prisma.userLeaveBalance.deleteMany({ where: { userId: uid } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: uid } }).catch(() => {});
    }
    for (const oid of cleanupIds.orgs) {
      await prisma.organization.deleteMany({ where: { id: oid } }).catch(() => {});
    }
  }
}

runTests();
