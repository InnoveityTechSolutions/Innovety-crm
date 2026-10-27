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

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId
    },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: '1d' }
  );
}

async function run() {
  console.log('===============================================================');
  console.log(' InnovEity CRM — Phase 4 Frontend Integration & Regression Suite');
  console.log('===============================================================');

  // Find existing organization
  let org = await prisma.organization.findFirst();
  if (!org) {
    throw new Error('No organization found in database.');
  }

  // Find or create users
  let admin = await prisma.user.findFirst({
    where: { email: 'phase4_admin@enterprise-crm.com' }
  });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        email: 'phase4_admin@enterprise-crm.com',
        name: 'Phase 4 Admin',
        password: 'hashedpassword',
        role: 'ADMIN',
        organizationId: org.id,
        employeeId: 'AD-4001',
        status: 'ACTIVE'
      }
    });
  }

  let tl = await prisma.user.findFirst({
    where: { email: 'phase4_tl@enterprise-crm.com' }
  });
  if (!tl) {
    tl = await prisma.user.create({
      data: {
        email: 'phase4_tl@enterprise-crm.com',
        name: 'Phase 4 Team Leader',
        password: 'hashedpassword',
        role: 'TEAM_LEADER',
        organizationId: org.id,
        employeeId: 'TL-4001',
        status: 'ACTIVE'
      }
    });
  }

  let emp = await prisma.user.findFirst({
    where: { email: 'phase4_emp@enterprise-crm.com' }
  });
  if (!emp) {
    emp = await prisma.user.create({
      data: {
        email: 'phase4_emp@enterprise-crm.com',
        name: 'Phase 4 Employee',
        password: 'hashedpassword',
        role: 'EMPLOYEE',
        organizationId: org.id,
        employeeId: 'EM-4001',
        status: 'ACTIVE'
      }
    });
  }

  let superAdmin = await prisma.user.findFirst({
    where: { email: 'phase4_superadmin@enterprise-crm.com' }
  });
  if (!superAdmin) {
    superAdmin = await prisma.user.create({
      data: {
        email: 'phase4_superadmin@enterprise-crm.com',
        name: 'Phase 4 Super Admin',
        password: 'hashedpassword',
        role: 'SUPER_ADMIN',
        organizationId: null,
        employeeId: 'SA-4001',
        status: 'ACTIVE'
      }
    });
  }

  // Find or create team
  let team = await prisma.team.findFirst({
    where: { organizationId: org.id, leaderId: tl.id }
  });
  if (!team) {
    team = await prisma.team.create({
      data: {
        name: 'Phase 4 Dev Team',
        organizationId: org.id,
        leaderId: tl.id,
        members: {
          create: [{ userId: emp.id }]
        }
      }
    });
  } else {
    const isMember = await prisma.teamMember.findFirst({
      where: { teamId: team.id, userId: emp.id }
    });
    if (!isMember) {
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: emp.id }
      });
    }
  }

  const adminToken = generateToken(admin);
  const tlToken = generateToken(tl);
  const empToken = generateToken(emp);
  const saToken = generateToken(superAdmin);

  // Clean existing test comp-off and leave data for emp
  await prisma.compOffConsumption.deleteMany({
    where: { credit: { userId: emp.id } }
  });
  await prisma.compOffCredit.deleteMany({
    where: { userId: emp.id }
  });
  await prisma.leaveRequest.deleteMany({
    where: { userId: emp.id }
  });

  console.log('\n--- Test Group 1: Employee Portal Leave Balance & Dynamic Types ---');
  {
    const res = await request({
      method: 'GET',
      path: '/api/leaves/balances',
      headers: { Authorization: `Bearer ${empToken}` }
    });

    assert(res.status === 200, 'GET /api/leaves/balances returns 200 for Employee');
    assert(Array.isArray(res.data.leaveTypes), 'leaveTypes array is returned');
    const compOff = res.data.leaveTypes.find((lt) => lt.code === 'COMP_OFF');
    assert(Boolean(compOff), 'COMP_OFF is dynamically included in leaveTypes');
    assert(compOff.available === 0, 'Initial available Comp-Off balance is 0');
    assert(compOff.pending === 0, 'Initial pending Comp-Off balance is 0');
    assert(compOff.used === 0, 'Initial used Comp-Off balance is 0');
  }

  console.log('\n--- Test Group 2: Evidence Diagnostics & 30-Day Claim Window ---');
  const validSunday = new Date();
  // Find a sunday within the past 14 days
  validSunday.setDate(validSunday.getDate() - ((validSunday.getDay() + 7) % 7 || 7));
  const workDateStr = validSunday.toISOString().split('T')[0];

  // Create attendance record on that Sunday with 8.5 hours
  const clockInTime = new Date(`${workDateStr}T09:00:00.000Z`);
  const clockOutTime = new Date(`${workDateStr}T17:30:00.000Z`);
  await prisma.attendance.deleteMany({
    where: { userId: emp.id, date: new Date(workDateStr) }
  });
  await prisma.attendance.create({
    data: {
      userId: emp.id,
      date: new Date(workDateStr),
      clockIn: clockInTime,
      clockOut: clockOutTime,
      workingHours: 8.5,
      status: 'PRESENT'
    }
  });

  {
    // Check evidence as TL
    const res = await request({
      method: 'GET',
      path: `/api/comp-off/evidence?userId=${emp.id}&workDate=${workDateStr}`,
      headers: { Authorization: `Bearer ${tlToken}` }
    });

    assert(res.status === 200, 'TL can inspect attendance evidence for team member');
    assert(res.data.canAuthorize === true, 'Evidence indicates canAuthorize = true');
    assert(res.data.workdayEligibility?.isEligible === true, 'Evidence shows eligible = true on weekly off');
    assert(res.data.workdayEligibility?.reason === 'SUNDAY_WEEKLY_OFF', 'Day type is identified as SUNDAY_WEEKLY_OFF');
    assert(res.data.attendanceEvidence?.details?.workingHours === 8.5, 'Attendance hours match (8.5 hrs)');
  }

  {
    // Test date outside 30-day claim window
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 35);
    const oldDateStr = oldDate.toISOString().split('T')[0];

    const res = await request({
      method: 'GET',
      path: `/api/comp-off/evidence?userId=${emp.id}&workDate=${oldDateStr}`,
      headers: { Authorization: `Bearer ${tlToken}` }
    });

    assert(res.status === 200, 'Evidence check returns 200 with ineligibility reason');
    assert(res.data.canAuthorize === false, 'Date older than 30 days cannot be authorized');
    assert(res.data.claimWindow?.isValid === false, 'claimWindow.isValid is false');
    assert(res.data.claimWindow?.error?.includes('30 calendar days'), 'Reason explicitly communicates 30-day claim window');
  }

  console.log('\n--- Test Group 3: Team Leader Verification -> Admin Queue ---');
  let creditId;
  {
    const res = await request({
      method: 'POST',
      path: '/api/comp-off/authorize',
      headers: { Authorization: `Bearer ${tlToken}` },
      body: {
        userId: emp.id,
        workDate: workDateStr,
        creditDays: 1.0,
        reason: 'WEEKLY_OFF',
        remarks: 'Verified deployment on Sunday'
      }
    });

    const credit = res.data.credit || res.data;
    assert(res.status === 201, 'TL authorization creates credit with HTTP 201');
    assert(credit.status === 'PENDING_ADMIN_APPROVAL', 'TL credit is set to PENDING_ADMIN_APPROVAL');
    assert(credit.creditDays === 1.0, 'Credit days set to 1.0');
    creditId = credit.id;
  }

  {
    // Employee balance should still be 0 because it is awaiting Admin approval
    const res = await request({
      method: 'GET',
      path: '/api/leaves/balances',
      headers: { Authorization: `Bearer ${empToken}` }
    });
    const compOff = res.data.leaveTypes.find((lt) => lt.code === 'COMP_OFF');
    assert(compOff.available === 0, 'Comp-off available remains 0 while in pending review');
  }

  console.log('\n--- Test Group 4: Admin Approval Queue & Ledger ---');
  {
    // Admin checks pending queue
    const res = await request({
      method: 'GET',
      path: '/api/comp-off/credits?status=PENDING_ADMIN_APPROVAL',
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert(res.status === 200, 'Admin can fetch PENDING_ADMIN_APPROVAL queue');
    const item = res.data.credits.find((c) => c.id === creditId);
    assert(Boolean(item), 'Pending claim is present in Admin approval queue');
    assert(item.tlApprover.name === 'Phase 4 Team Leader', 'TL approver is populated');
  }

  {
    // Admin approves the credit
    const res = await request({
      method: 'PUT',
      path: `/api/comp-off/credits/${creditId}/admin-approve`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { remarks: 'Admin verified and sanctioned' }
    });

    const updated = res.data.credit || res.data;
    assert(res.status === 200, 'Admin approval succeeds with HTTP 200');
    assert(updated.status === 'APPROVED', 'Credit status is updated to APPROVED');
    assert(updated.remainingDays === 1.0, 'Remaining days equals 1.0');
  }

  {
    // Employee now sees 1.0 available Comp-Off days!
    const res = await request({
      method: 'GET',
      path: '/api/leaves/balances',
      headers: { Authorization: `Bearer ${empToken}` }
    });
    const compOff = res.data.leaveTypes.find((lt) => lt.code === 'COMP_OFF');
    assert(compOff.available === 1.0, 'Employee available Comp-Off balance is now 1.0 day');
  }

  console.log('\n--- Test Group 5: Employee Leave Application & Reservation ---');
  let leaveId;
  {
    // Employee applies for 0.5 day Comp-Off leave
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    const leaveDateStr = tomorrow.toISOString().split('T')[0];

    const res = await request({
      method: 'POST',
      path: '/api/leaves',
      headers: { Authorization: `Bearer ${empToken}` },
      body: {
        leaveType: 'COMP_OFF',
        startDate: leaveDateStr,
        endDate: leaveDateStr,
        isHalfDay: true,
        reason: 'Utilizing half-day compensatory off for appointment'
      }
    });

    const leave = res.data.leave || res.data;
    assert(res.status === 201, 'Employee successfully submits COMP_OFF leave application');
    assert(leave.status === 'PENDING_TL_APPROVAL' || leave.status === 'PENDING_ADMIN_APPROVAL' || leave.status === 'PENDING', 'Leave request is pending approval');
    leaveId = leave.id;
  }

  {
    // Check balance reservation: available = 0.5, pending = 0.5
    const res = await request({
      method: 'GET',
      path: '/api/leaves/balances',
      headers: { Authorization: `Bearer ${empToken}` }
    });
    const compOff = res.data.leaveTypes.find((lt) => lt.code === 'COMP_OFF');
    assert(compOff.pending === 0.5, '0.5 day is reserved in pending balance');
    assert(compOff.available === 0.5, 'Remaining available balance is 0.5 day (1.0 - 0.5 reserved)');
  }

  console.log('\n--- Test Group 6: FIFO Consumption Estimate Preview ---');
  {
    const res = await request({
      method: 'GET',
      path: `/api/comp-off/estimate-consumption?leaveRequestId=${leaveId}`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert(res.status === 200, 'GET /api/comp-off/estimate-consumption returns 200');
    assert(res.data.canCover === true, 'FIFO estimate shows canCover = true');
    assert(res.data.requiredDays === 0.5, 'Required days is 0.5');
    assert(res.data.totalAvailable === 1.0, 'Total available in ledger is 1.0');
    assert(Array.isArray(res.data.breakdown), 'Breakdown list is returned');
    assert(res.data.breakdown[0].deducting === 0.5, 'Breakdown details 0.5 day deduction');
    assert(res.data.breakdown[0].remainingAfter === 0.5, 'Remaining after estimate is 0.5');
  }

  console.log('\n--- Test Group 7: Two-Stage Approval & Final Ledger Deduction ---');
  {
    // Step 1: Team Leader recommends approval
    const resTL = await request({
      method: 'PUT',
      path: `/api/leaves/${leaveId}/tl-approve`,
      headers: { Authorization: `Bearer ${tlToken}` },
      body: { remarks: 'Recommended by TL' }
    });
    assert(resTL.status === 200, 'TL approves leave request (Step 1)');
    const leaveTL = resTL.data.leave || resTL.data;
    assert(leaveTL.status === 'PENDING_ADMIN_APPROVAL', 'Leave request moves to PENDING_ADMIN_APPROVAL');

    // Step 2: Admin final sanction
    const res = await request({
      method: 'PUT',
      path: `/api/leaves/${leaveId}/admin-approve`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { remarks: 'Sanctioned by Admin' }
    });

    const leaveApproved = res.data.leave || res.data;
    assert(res.status === 200, 'Admin approves leave request (Step 2)');
    assert(leaveApproved.status === 'APPROVED', 'Leave request status is APPROVED');
  }

  {
    // Ledger check: remainingDays should now be 0.5
    const res = await request({
      method: 'GET',
      path: `/api/comp-off/credits/${creditId}`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    const creditAfter = res.data.credit || res.data;
    assert(res.status === 200, 'Admin can fetch credit by ID');
    assert(creditAfter.remainingDays === 0.5, 'Credit remainingDays deducted to 0.5');
    assert(Array.isArray(creditAfter.consumptions), 'Consumptions array populated in credit');
    assert(creditAfter.consumptions.length === 1, '1 consumption entry recorded');
    assert((creditAfter.consumptions[0].consumedDays ?? creditAfter.consumptions[0].daysDeducted) === 0.5, '0.5 days deducted in consumption entry');
  }

  console.log('\n--- Test Group 8: Leave Cancellation & Restoration Audit ---');
  {
    // Employee cancels the approved leave
    const res = await request({
      method: 'PUT',
      path: `/api/leaves/${leaveId}/cancel`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    const cancelled = res.data.leave || res.data;
    assert(res.status === 200, 'Approved leave cancelled with HTTP 200');
    assert(cancelled.status === 'CANCELLED', 'Leave request status is CANCELLED');
  }

  {
    // Verify credit is restored to 1.0
    const res = await request({
      method: 'GET',
      path: `/api/comp-off/credits/${creditId}`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    const restoredCredit = res.data.credit || res.data;
    assert(restoredCredit.remainingDays === 1.0, 'Credit remainingDays restored to 1.0 upon cancellation');
  }

  console.log('\n--- Test Group 9: Super Admin Read-Only Security Enforcement ---');
  {
    // Super Admin should be able to audit and view credits
    const res = await request({
      method: 'GET',
      path: '/api/comp-off/credits',
      headers: { Authorization: `Bearer ${saToken}` }
    });
    assert(res.status === 200, 'Super Admin can view comp-off credits ledger (audit view)');
  }

  {
    // Super Admin cannot create/authorize credits (restricted to ADMIN and TEAM_LEADER)
    const res = await request({
      method: 'POST',
      path: '/api/comp-off/authorize',
      headers: { Authorization: `Bearer ${saToken}` },
      body: {
        userId: emp.id,
        workDate: workDateStr,
        creditDays: 1.0,
        remarks: 'Super Admin test'
      }
    });
    assert(res.status === 403, 'Super Admin authorization attempt rejected with HTTP 403');
  }

  console.log('\n===============================================================');
  console.log(` RESULTS: ${passed}/${total} assertions passed (${Math.round((passed / total) * 100)}%)`);
  console.log('===============================================================');
}

run()
  .then(() => {
    console.log('\n✓ Phase 4 Integration & Regression Test Suite completed successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n✗ Test Suite failed:', err);
    process.exit(1);
  });
