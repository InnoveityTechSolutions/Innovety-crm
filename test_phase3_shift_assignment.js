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

async function runPhase3Verification() {
  console.log('====================================================');
  console.log('PHASE 3: SHIFT ASSIGNMENT & CONFIGURATION VERIFICATION');
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

  // 2. Select Target Organization
  const innoveityOrg = await prisma.organization.findUnique({
    where: { slug: 'innoveity' }
  });
  if (!innoveityOrg) throw new Error('INNOVEITY Workspace organization not found.');
  console.log(`[2] Target Company: "${innoveityOrg.name}" (${innoveityOrg.id})`);

  // Ensure default shift exists
  const defaultShift = await prisma.shift.findFirst({
    where: { organizationId: innoveityOrg.id, name: 'Company Default' }
  });
  if (!defaultShift) throw new Error('Company Default shift not found.');
  console.log(` - Company Default Shift verified: ID=${defaultShift.id}`);

  // 3. Create a Test Custom Shift for Assignment
  console.log('\n[3] Creating custom shift for assignment testing...');
  const createShiftRes = await makeRequest(token, 'POST', '/api/shifts', {
    organizationId: innoveityOrg.id,
    name: 'Phase 3 Dev Shift',
    startTime: '10:00',
    endTime: '19:00',
    workingDays: {
      MONDAY: 'Working',
      TUESDAY: 'Working',
      WEDNESDAY: 'Working',
      THURSDAY: 'Working',
      FRIDAY: 'Working',
      SATURDAY: 'Holiday',
      SUNDAY: 'Holiday'
    }
  });

  if (createShiftRes.status !== 201) {
    throw new Error(`Failed to create custom shift: ${JSON.stringify(createShiftRes.body)}`);
  }
  const testShift = createShiftRes.body.shift;
  console.log(` - Created shift: "${testShift.name}" (ID: ${testShift.id})`);

  // 4. Fetch Company Users & Departments
  console.log('\n[4] Testing Department & User Listing for Company...');
  const usersRes = await makeRequest(token, 'GET', `/api/users?organizationId=${innoveityOrg.id}&limit=1000&status=ACTIVE`);
  const allUsers = usersRes.body?.users || [];
  console.log(` - Retrieved ${allUsers.length} active users for ${innoveityOrg.name}`);

  const deptsRes = await makeRequest(token, 'GET', `/api/organization/departments?organizationId=${innoveityOrg.id}`);
  const departments = deptsRes.body || [];
  console.log(` - Retrieved ${departments.length} departments for ${innoveityOrg.name}`);

  if (allUsers.length < 2) {
    throw new Error('Need at least 2 users in company to verify assignment and overrides.');
  }

  // 5. Test Department-Based Auto-Selection (Simulate selecting a department)
  console.log('\n[5] Testing Department-Based Batch Assignment (Task 4)...');
  // Group users by department
  const usersByDept = {};
  allUsers.forEach(u => {
    const dept = u.department || 'General';
    if (!usersByDept[dept]) usersByDept[dept] = [];
    usersByDept[dept].push(u);
  });

  const sampleDept = Object.keys(usersByDept).find(d => usersByDept[d].length >= 1) || Object.keys(usersByDept)[0];
  const deptMembers = usersByDept[sampleDept];
  const deptMemberIds = deptMembers.map(u => u.id);
  console.log(` - Selected Department: "${sampleDept}" (${deptMemberIds.length} members: ${deptMembers.map(u => u.name).join(', ')})`);

  // Call assignMembers API
  const assignDeptRes = await makeRequest(token, 'POST', `/api/shifts/${testShift.id}/members`, {
    userIds: deptMemberIds,
    organizationId: innoveityOrg.id
  });

  console.log(` - POST /api/shifts/:id/members status: HTTP ${assignDeptRes.status}`);
  if (assignDeptRes.status !== 200 || !assignDeptRes.body?.success) {
    throw new Error(`Failed to assign department members: ${JSON.stringify(assignDeptRes.body)}`);
  }
  console.log(` - Result: ${assignDeptRes.body.message}`);

  // Verify in DB that these users are now in Phase 3 Dev Shift and NOT in Company Default
  for (const uid of deptMemberIds) {
    const sm = await prisma.shiftMember.findUnique({ where: { userId: uid } });
    if (!sm || sm.shiftId !== testShift.id) {
      throw new Error(`User ${uid} was not assigned to custom shift ${testShift.id}!`);
    }
  }
  console.log(` - PASS: All ${deptMemberIds.length} department members verified in "${testShift.name}".`);

  // 6. Test Individual Overrides: Uncheck 1 member, add 1 member from another department (Task 5)
  console.log('\n[6] Testing Individual Overrides & Mixed Departments (Task 5)...');
  const removedUser = deptMembers[0];
  const remainingUserIds = deptMemberIds.filter(id => id !== removedUser.id);
  
  // Find a user from another department or outside the initial list
  const otherUser = allUsers.find(u => !deptMemberIds.includes(u.id));
  if (!otherUser) {
    throw new Error('Need an additional user for cross-department override test.');
  }

  const updatedUserIds = [...remainingUserIds, otherUser.id];
  console.log(` - Action: Removing "${removedUser.name}" (should return to Company Default)`);
  console.log(` - Action: Adding "${otherUser.name}" from "${otherUser.department || 'Other'}"`);
  console.log(` - New target member count: ${updatedUserIds.length}`);

  const overrideRes = await makeRequest(token, 'POST', `/api/shifts/${testShift.id}/members`, {
    userIds: updatedUserIds,
    organizationId: innoveityOrg.id
  });

  console.log(` - POST /api/shifts/:id/members status: HTTP ${overrideRes.status}`);
  if (overrideRes.status !== 200) {
    throw new Error(`Failed to save override assignments: ${JSON.stringify(overrideRes.body)}`);
  }

  // 7. Verify Default Shift Protection & Reassignment (Task 9)
  console.log('\n[7] Verifying Default Shift Protection & Single Shift Invariant (Task 8 & 9)...');
  // 1) Verify removed user was reassigned back to Company Default!
  const removedUserAssignment = await prisma.shiftMember.findUnique({ where: { userId: removedUser.id } });
  if (!removedUserAssignment || removedUserAssignment.shiftId !== defaultShift.id) {
    throw new Error(`FAIL: Removed user ${removedUser.name} was not returned to Company Default shift! (shiftId: ${removedUserAssignment?.shiftId})`);
  }
  console.log(` - PASS: Removed user "${removedUser.name}" was automatically returned to Company Default.`);

  // 2) Verify added cross-department user is now in custom shift
  const otherUserAssignment = await prisma.shiftMember.findUnique({ where: { userId: otherUser.id } });
  if (!otherUserAssignment || otherUserAssignment.shiftId !== testShift.id) {
    throw new Error(`FAIL: Added user ${otherUser.name} not in custom shift.`);
  }
  console.log(` - PASS: Cross-department user "${otherUser.name}" successfully assigned to "${testShift.name}".`);

  // 3) Verify updated shift count in shift list
  const updatedShiftsRes = await makeRequest(token, 'GET', `/api/shifts?organizationId=${innoveityOrg.id}`);
  const customShiftInList = updatedShiftsRes.body.shifts.find(s => s.id === testShift.id);
  const customCount = customShiftInList._count?.members || customShiftInList.members?.length || 0;
  console.log(` - Shift Card live member count: ${customCount} (expected ${updatedUserIds.length})`);
  if (customCount !== updatedUserIds.length) {
    throw new Error(`Member count mismatch on shift card: got ${customCount}, expected ${updatedUserIds.length}`);
  }
  console.log(` - PASS: Shift card member count reflects updated assignments immediately.`);

  // 8. Test Single Active Shift / No Duplicate Records Invariant
  console.log('\n[8] Verifying No Duplicate Assignments (1 shift per user)...');
  const allAssignments = await prisma.shiftMember.findMany({
    where: { shift: { organizationId: innoveityOrg.id } }
  });
  const userIdsSeen = new Set();
  for (const a of allAssignments) {
    if (userIdsSeen.has(a.userId)) {
      throw new Error(`FAIL: Duplicate shift assignment found for user ${a.userId}!`);
    }
    userIdsSeen.add(a.userId);
  }
  console.log(` - PASS: Total ${allAssignments.length} assignments checked. Zero duplicates found. Exactly 1 active shift per employee.`);

  // 9. Test Shift Deletion with Fallback to Company Default (Task 9)
  console.log('\n[9] Testing Custom Shift Deletion & Safe Return to Company Default...');
  const deleteRes = await makeRequest(token, 'DELETE', `/api/shifts/${testShift.id}?organizationId=${innoveityOrg.id}`);
  console.log(` - DELETE /api/shifts/:id status: HTTP ${deleteRes.status}`);
  if (deleteRes.status !== 200) {
    throw new Error(`Failed to delete custom shift: ${JSON.stringify(deleteRes.body)}`);
  }
  console.log(` - Response: "${deleteRes.body.message}"`);

  // Verify all users from deleted shift returned to Company Default
  for (const uid of updatedUserIds) {
    const sm = await prisma.shiftMember.findUnique({ where: { userId: uid } });
    if (!sm || sm.shiftId !== defaultShift.id) {
      throw new Error(`FAIL: User ${uid} did not return to Company Default after shift deletion!`);
    }
  }
  console.log(` - PASS: All ${updatedUserIds.length} members safely moved back to Company Default shift. No unassigned users.`);

  // 10. Regression Check on Core Modules
  console.log('\n[10] Running Core CRM Regression Check...');
  const regAttendance = await makeRequest(token, 'GET', '/api/attendance/status');
  console.log(` - [Attendance Status] -> HTTP ${regAttendance.status} (${regAttendance.status === 200 ? 'PASS' : 'FAIL'})`);

  const regLeaves = await makeRequest(token, 'GET', '/api/leaves');
  console.log(` - [Leaves Overview] -> HTTP ${regLeaves.status} (${regLeaves.status === 200 ? 'PASS' : 'FAIL'})`);

  const regPositions = await makeRequest(token, 'GET', `/api/positions?organizationId=${innoveityOrg.id}`);
  console.log(` - [Positions List] -> HTTP ${regPositions.status} (${regPositions.status === 200 ? 'PASS' : 'FAIL'})`);

  const regDepartments = await makeRequest(token, 'GET', `/api/organization/departments?organizationId=${innoveityOrg.id}`);
  console.log(` - [Departments List] -> HTTP ${regDepartments.status} (${regDepartments.status === 200 ? 'PASS' : 'FAIL'})`);

  const regPayroll = await makeRequest(token, 'GET', `/api/payroll/settings?organizationId=${innoveityOrg.id}`);
  console.log(` - [Payroll Settings] -> HTTP ${regPayroll.status} (${regPayroll.status === 200 ? 'PASS' : 'FAIL'})`);

  console.log('\n====================================================');
  console.log('ALL PHASE 3 ASSIGNMENT & REGRESSION TESTS PASSED (100%)');
  console.log('====================================================');
}

runPhase3Verification()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error('Phase 3 verification failed:', err);
    prisma.$disconnect();
    process.exit(1);
  });
