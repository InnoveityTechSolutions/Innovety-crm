const axios = require('../backend/node_modules/axios');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const prisma = new PrismaClient();
const API_BASE = 'http://localhost:5000/api';
const JWT_SECRET = 'enterprise_internship_crm_super_secret_jwt_key_123!';

// Helper to generate auth token
function makeToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      organizationId: user.organizationId,
      organizationSlug: user.organization?.slug || 'innoveity'
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function runTests() {
  console.log('====================================================');
  console.log('STARTING MULTIPLE ATTENDANCE LOCATIONS TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  // 1. Fetch test actors
  const superAdmin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' },
    include: { organization: true }
  });
  const orgAAdmin = await prisma.user.findFirst({
    where: { email: 'admin@enterprise-crm.com' },
    include: { organization: true }
  });
  const orgBAdmin = await prisma.user.findFirst({
    where: { email: 'titus@innoveity.com' },
    include: { organization: true }
  });
  const employee = await prisma.user.findFirst({
    where: { email: 'dp0345217@gmail.com' },
    include: { organization: true }
  });

  const orgAId = orgAAdmin.organizationId;
  const orgBId = orgBAdmin.organizationId;

  console.log(`Actors loaded:`);
  console.log(`- Super Admin: ${superAdmin.email}`);
  console.log(`- Org A (${orgAAdmin.organization.name}) Admin: ${orgAAdmin.email}`);
  console.log(`- Org B (${orgBAdmin.organization.name}) Admin: ${orgBAdmin.email}`);
  console.log(`- Test Member: ${employee.email} (${employee.role})\n`);

  const clientSuperAdmin = axios.create({
    baseURL: API_BASE,
    headers: { Authorization: `Bearer ${makeToken(superAdmin)}` }
  });
  const clientOrgAAdmin = axios.create({
    baseURL: API_BASE,
    headers: { Authorization: `Bearer ${makeToken(orgAAdmin)}` }
  });
  const clientOrgBAdmin = axios.create({
    baseURL: API_BASE,
    headers: { Authorization: `Bearer ${makeToken(orgBAdmin)}` }
  });
  const clientEmployee = axios.create({
    baseURL: API_BASE,
    headers: { Authorization: `Bearer ${makeToken(employee)}` }
  });

  let locAId = null;
  let locBId = null;
  let locOrgBId = null;

  try {
    // ----------------------------------------------------
    // TEST A: Create Location
    // ----------------------------------------------------
    console.log('TEST A: Create Location (MRF Innovation Park)');
    const resA = await clientOrgAAdmin.post('/attendance-locations', {
      name: 'MRF Innovation Park',
      address: 'Madurai, Tamil Nadu, India',
      latitude: 9.925201,
      longitude: 78.119775,
      radiusMeters: 100,
      isActive: true
    });
    assert(resA.status === 201 && resA.data.success, 'Created MRF Innovation Park location successfully');
    locAId = resA.data.location.id;
    assert(resA.data.location.organizationId === orgAId, 'Location correctly assigned to Org A');
    assert(resA.data.location.radiusMeters === 100, 'Radius saved as 100 meters');

    // ----------------------------------------------------
    // TEST B: Edit Location
    // ----------------------------------------------------
    console.log('\nTEST B: Edit Location');
    const resEdit = await clientOrgAAdmin.put(`/attendance-locations/${locAId}`, {
      name: 'MRF Innovation Park - Main Campus',
      radiusMeters: 150,
      address: 'MRF Innovation Park, Madurai Airport Road, Tamil Nadu'
    });
    assert(resEdit.status === 200 && resEdit.data.success, 'Updated location successfully');
    assert(resEdit.data.location.radiusMeters === 150, 'Radius updated to 150m');
    assert(resEdit.data.location.name === 'MRF Innovation Park - Main Campus', 'Name updated successfully');

    // ----------------------------------------------------
    // TEST C: Multiple Locations & Member Assignment
    // ----------------------------------------------------
    console.log('\nTEST C: Multiple Locations & Member Assignment');
    const resB = await clientOrgAAdmin.post('/attendance-locations', {
      name: 'Chennai Office',
      address: 'Guindy, Chennai, Tamil Nadu',
      latitude: 13.0067,
      longitude: 80.2026,
      radiusMeters: 200,
      isActive: true
    });
    assert(resB.status === 201, 'Created second location: Chennai Office');
    locBId = resB.data.location.id;

    // Assign both locations to test member
    const resAssign = await clientOrgAAdmin.post(`/attendance-locations/user/${employee.id}`, {
      attendanceLocationIds: [locAId, locBId]
    });
    assert(resAssign.status === 200 && resAssign.data.success, 'Assigned both locations to member');
    assert(resAssign.data.assignedLocations.length === 2, 'Member has 2 assigned locations');

    // Verify clock-in status API returns both assigned locations
    const resStatus = await clientEmployee.get('/attendance/status');
    assert(resStatus.data.assignedLocations && resStatus.data.assignedLocations.length === 2, 'Clock-in status returns member assigned locations');
    assert(resStatus.data.hasOrganizationLocations === true, 'hasOrganizationLocations flag is true');

    // ----------------------------------------------------
    // TEST D: Geofence Validation
    // ----------------------------------------------------
    console.log('\nTEST D: Geofence Validation (Inside A -> ALLOW, Inside B -> ALLOW, Outside both -> DENY)');
    
    // Clean up any attendance for today for test employee so we can test clock-in
    const now = new Date();
    const todayDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
    await prisma.attendance.deleteMany({
      where: { userId: employee.id, date: todayDate }
    });

    // Subtest D1: GPS Inside Location A (lat: 9.925201, lon: 78.119775)
    const resClockInA = await clientEmployee.post('/attendance/clock-in', {
      latitude: 9.925201,
      longitude: 78.119775,
      workLocation: 'OFFICE'
    });
    assert(resClockInA.status === 201 && resClockInA.data.success, 'Clock-in ALLOWED when GPS inside Location A');
    assert(resClockInA.data.attendance.attendanceLocationId === locAId, 'attendanceLocationId properly recorded for Location A');

    // Remove today record to test Location B
    await prisma.attendance.deleteMany({
      where: { userId: employee.id, date: todayDate }
    });

    // Subtest D2: GPS Inside Location B (lat: 13.0067, lon: 80.2026)
    const resClockInB = await clientEmployee.post('/attendance/clock-in', {
      latitude: 13.0067,
      longitude: 80.2026,
      workLocation: 'OFFICE'
    });
    assert(resClockInB.status === 201 && resClockInB.data.success, 'Clock-in ALLOWED when GPS inside Location B');
    assert(resClockInB.data.attendance.attendanceLocationId === locBId, 'attendanceLocationId properly recorded for Location B');

    // Remove today record to test Outside
    await prisma.attendance.deleteMany({
      where: { userId: employee.id, date: todayDate }
    });

    // Subtest D3: GPS Outside both locations (e.g. Mumbai lat: 19.0760, lon: 72.8777)
    let outsideRejected = false;
    let outsideMsg = '';
    try {
      await clientEmployee.post('/attendance/clock-in', {
        latitude: 19.0760,
        longitude: 72.8777,
        workLocation: 'OFFICE'
      });
    } catch (err) {
      outsideRejected = err.response?.status === 400;
      outsideMsg = err.response?.data?.message;
    }
    assert(outsideRejected, 'Clock-in DENIED (400) when GPS is outside both locations');
    assert(outsideMsg === 'You are outside your allowed attendance locations.', `Correct friendly error message received: "${outsideMsg}"`);

    // ----------------------------------------------------
    // TEST E: No Assignment Error
    // ----------------------------------------------------
    console.log('\nTEST E: No Location Assignment');
    // Remove all location assignments for the member
    await clientOrgAAdmin.post(`/attendance-locations/user/${employee.id}`, {
      attendanceLocationIds: []
    });

    let noAssignRejected = false;
    let noAssignMsg = '';
    try {
      await clientEmployee.post('/attendance/clock-in', {
        latitude: 9.925201,
        longitude: 78.119775,
        workLocation: 'OFFICE'
      });
    } catch (err) {
      noAssignRejected = err.response?.status === 400;
      noAssignMsg = err.response?.data?.message;
    }
    assert(noAssignRejected, 'Clock-in DENIED (400) when member has no assigned location');
    assert(noAssignMsg === 'No attendance location has been assigned to your account. Please contact your administrator.', `Correct assignment error message received: "${noAssignMsg}"`);

    // Reassign Location A
    await clientOrgAAdmin.post(`/attendance-locations/user/${employee.id}`, {
      attendanceLocationIds: [locAId]
    });

    // ----------------------------------------------------
    // TEST F: Inactive Location
    // ----------------------------------------------------
    console.log('\nTEST F: Inactive Location Check');
    // Set Location A to inactive
    await clientOrgAAdmin.put(`/attendance-locations/${locAId}`, {
      isActive: false
    });

    let inactiveRejected = false;
    let inactiveMsg = '';
    try {
      await clientEmployee.post('/attendance/clock-in', {
        latitude: 9.925201,
        longitude: 78.119775,
        workLocation: 'OFFICE'
      });
    } catch (err) {
      inactiveRejected = err.response?.status === 400;
      inactiveMsg = err.response?.data?.message;
    }
    assert(inactiveRejected, 'Clock-in DENIED (400) when assigned location is inactive');

    // Reactivate Location A
    await clientOrgAAdmin.put(`/attendance-locations/${locAId}`, {
      isActive: true
    });

    // ----------------------------------------------------
    // TEST G: Organization / Multi-tenant Isolation
    // ----------------------------------------------------
    console.log('\nTEST G: Organization / Multi-Tenant Isolation');
    // Create Location for Org B
    const resOrgB = await clientOrgBAdmin.post('/attendance-locations', {
      name: 'Innoveity Globs HQ',
      address: 'Coimbatore, Tamil Nadu',
      latitude: 11.0168,
      longitude: 76.9558,
      radiusMeters: 100,
      isActive: true
    });
    locOrgBId = resOrgB.data.location.id;
    assert(resOrgB.status === 201, 'Created Location for Company B');

    // 1. Org A Admin lists locations -> must NOT see Org B location
    const resListA = await clientOrgAAdmin.get('/attendance-locations');
    const idsInA = resListA.data.locations.map(l => l.id);
    assert(!idsInA.includes(locOrgBId), 'Company A admin cannot see Company B location');
    assert(idsInA.includes(locAId), 'Company A admin sees Company A location');

    // 2. Org B Admin lists locations -> must NOT see Org A locations
    const resListB = await clientOrgBAdmin.get('/attendance-locations');
    const idsInB = resListB.data.locations.map(l => l.id);
    assert(!idsInB.includes(locAId), 'Company B admin cannot see Company A location');
    assert(idsInB.includes(locOrgBId), 'Company B admin sees Company B location');

    // 3. Org B Admin tries to modify Org A location -> 404/403 forbidden
    let crossOrgDenied = false;
    try {
      await clientOrgBAdmin.put(`/attendance-locations/${locAId}`, { name: 'Hacked Location' });
    } catch (err) {
      crossOrgDenied = (err.response?.status === 404 || err.response?.status === 403);
    }
    assert(crossOrgDenied, 'Cross-tenant edit strictly blocked (404/403)');

    // 4. Super Admin Company Switcher:
    // With organizationId=OrgA
    const resSuperA = await clientSuperAdmin.get(`/attendance-locations?organizationId=${orgAId}`);
    const superIdsA = resSuperA.data.locations.map(l => l.id);
    assert(superIdsA.includes(locAId) && !superIdsA.includes(locOrgBId), 'Super Admin filtering by Company A sees only Company A locations');

    // With organizationId=OrgB
    const resSuperB = await clientSuperAdmin.get(`/attendance-locations?organizationId=${orgBId}`);
    const superIdsB = resSuperB.data.locations.map(l => l.id);
    assert(superIdsB.includes(locOrgBId) && !superIdsB.includes(locAId), 'Super Admin filtering by Company B sees only Company B locations');

    // ----------------------------------------------------
    // TEST H: Existing Attendance & Reports
    // ----------------------------------------------------
    console.log('\nTEST H: Historical Attendance Records & Reports Non-Regression');
    // Clock in member at Location A for real record test
    await clientEmployee.post('/attendance/clock-in', {
      latitude: 9.925201,
      longitude: 78.119775,
      workLocation: 'OFFICE'
    });

    // Test Clock-Out continues to work normally
    const resClockOut = await clientEmployee.post('/attendance/clock-out', {
      location: 'Leaving office'
    });
    assert(resClockOut.status === 200 && resClockOut.data.success, 'Clock-out preserved and operates normally');

    // Test Attendance Logs API returns location name
    const resLogs = await clientOrgAAdmin.get(`/attendance/logs?userId=${employee.id}`);
    const todayLog = resLogs.data.find(l => l.userId === employee.id && l.clockIn);
    assert(todayLog && todayLog.attendanceLocation?.name === 'MRF Innovation Park - Main Campus', 'Attendance log includes enriched attendanceLocation name');

    // Test Attendance History API
    const resHist = await clientEmployee.get('/attendance/history');
    assert(resHist.status === 200 && resHist.data.success, 'Attendance history API works smoothly');
    const histRecord = resHist.data.records.find(r => r.userId === employee.id && r.attendanceLocation);
    assert(histRecord && histRecord.attendanceLocation.name === 'MRF Innovation Park - Main Campus', 'Attendance history record includes attendanceLocation');

  } catch (error) {
    console.error('Unexpected test suite error:', error.response?.data || error.message);
    failed++;
  } finally {
    // ----------------------------------------------------
    // CLEANUP
    // ----------------------------------------------------
    console.log('\nCleaning up test data...');
    try {
      const now = new Date();
      const todayDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
      await prisma.attendance.deleteMany({
        where: { userId: employee.id, date: todayDate }
      });
      await prisma.userAttendanceLocation.deleteMany({
        where: { userId: employee.id }
      });
      if (locAId) await prisma.attendanceLocation.delete({ where: { id: locAId } }).catch(() => {});
      if (locBId) await prisma.attendanceLocation.delete({ where: { id: locBId } }).catch(() => {});
      if (locOrgBId) await prisma.attendanceLocation.delete({ where: { id: locOrgBId } }).catch(() => {});
      console.log('Cleanup completed safely.');
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr.message);
    }

    console.log('\n====================================================');
    console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
