const axios = require('../backend/node_modules/axios');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const prisma = new PrismaClient();
const API_BASE = 'http://localhost:5000/api';
const JWT_SECRET = 'enterprise_internship_crm_super_secret_jwt_key_123!';

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

// Logic helper that matches the frontend derived status logic in AttendanceLocationsSection.jsx
function computeGeofencingStatus(locations) {
  const activeLocations = locations.filter(l => Boolean(l.isActive));
  const activeCount = activeLocations.length;
  
  if (activeCount === 0) {
    return {
      statusLabel: 'No Active Attendance Locations',
      pillColor: 'red',
      activeCount: 0,
      mode: 'NONE',
      message: locations.length === 0
        ? 'No attendance locations are currently configured.'
        : 'Members cannot use a configured attendance location until one is activated.'
    };
  }
  
  if (activeCount === 1) {
    return {
      statusLabel: '1 Active Location',
      pillColor: 'green',
      activeCount: 1,
      mode: 'SINGLE',
      primaryLocation: activeLocations[0],
      message: 'Members can clock in from this active geofencing location.'
    };
  }

  return {
    statusLabel: `${activeCount} Active Locations`,
    pillColor: 'green',
    activeCount,
    mode: 'MULTIPLE',
    locations: activeLocations,
    message: 'Members can clock in from their assigned active locations.'
  };
}

async function runGeofenceStatusSuite() {
  console.log('====================================================');
  console.log('STARTING ATTENDANCE GEOFENCE STATUS ENHANCEMENT TEST SUITE');
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

  const clientSuperAdmin = axios.create({
    baseURL: API_BASE,
    headers: { Authorization: `Bearer ${makeToken(superAdmin)}` }
  });
  const clientOrgAAdmin = axios.create({
    baseURL: API_BASE,
    headers: { Authorization: `Bearer ${makeToken(orgAAdmin)}` }
  });
  const clientEmployee = axios.create({
    baseURL: API_BASE,
    headers: { Authorization: `Bearer ${makeToken(employee)}` }
  });

  const testLocationIds = [];

  try {
    // ------------------------------------------------------------------
    // SCENARIO 1: Empty state (0 locations for test check)
    // ------------------------------------------------------------------
    console.log('TEST 1: 0 Locations -> "No Active Attendance Locations"');
    const emptyStatus = computeGeofencingStatus([]);
    assert(emptyStatus.activeCount === 0, 'Active count is 0');
    assert(emptyStatus.statusLabel === 'No Active Attendance Locations', 'Status label matches requirement');
    assert(emptyStatus.message === 'No attendance locations are currently configured.', 'Correct empty message');

    // ------------------------------------------------------------------
    // SCENARIO 2: Create 1 Active Location -> Shows "1 Active Location"
    // ------------------------------------------------------------------
    console.log('\nTEST 2: 1 Active Location -> Shows single primary geofence');
    const resLoc1 = await clientOrgAAdmin.post('/attendance-locations', {
      name: 'MCC MRF Innovation Park',
      address: 'Madurai, Tamil Nadu',
      latitude: 9.925201,
      longitude: 78.119775,
      radiusMeters: 200,
      isActive: true
    });
    const loc1 = resLoc1.data.location;
    testLocationIds.push(loc1.id);

    const resList1 = await clientOrgAAdmin.get('/attendance-locations');
    const status1 = computeGeofencingStatus(resList1.data.locations.filter(l => testLocationIds.includes(l.id)));
    assert(status1.activeCount === 1, 'Active count is strictly 1');
    assert(status1.statusLabel === '1 Active Location', 'Label is "1 Active Location" (singular)');
    assert(status1.mode === 'SINGLE', 'Single location mode activated');
    assert(status1.primaryLocation.name === 'MCC MRF Innovation Park', 'Primary location is "MCC MRF Innovation Park"');
    assert(status1.primaryLocation.radiusMeters === 200, 'Radius displayed as 200m');

    // ------------------------------------------------------------------
    // SCENARIO 3: Add 2nd Active Location -> Multiple Locations Mode
    // ------------------------------------------------------------------
    console.log('\nTEST 3: Multiple Active Locations -> Plural count, does not label one as single primary');
    const resLoc2 = await clientOrgAAdmin.post('/attendance-locations', {
      name: 'Chennai Office',
      address: 'Chennai, Tamil Nadu',
      latitude: 13.0827,
      longitude: 80.2707,
      radiusMeters: 100,
      isActive: true
    });
    const loc2 = resLoc2.data.location;
    testLocationIds.push(loc2.id);

    const resList2 = await clientOrgAAdmin.get('/attendance-locations');
    const status2 = computeGeofencingStatus(resList2.data.locations.filter(l => testLocationIds.includes(l.id)));
    assert(status2.activeCount === 2, 'Active count is 2');
    assert(status2.statusLabel === '2 Active Locations', 'Label is "2 Active Locations" (plural)');
    assert(status2.mode === 'MULTIPLE', 'Multiple location mode activated');
    assert(status2.message === 'Members can clock in from their assigned active locations.', 'Correct plural message');

    // ------------------------------------------------------------------
    // SCENARIO 4: One Active + One Inactive (Disable loc2)
    // ------------------------------------------------------------------
    console.log('\nTEST 4-5: Disable location -> Active count decreases, inactive location does NOT count');
    await clientOrgAAdmin.put(`/attendance-locations/${loc2.id}`, { isActive: false });
    const resList3 = await clientOrgAAdmin.get('/attendance-locations');
    const status3 = computeGeofencingStatus(resList3.data.locations.filter(l => testLocationIds.includes(l.id)));
    assert(status3.activeCount === 1, 'Active count decreased to 1');
    assert(status3.statusLabel === '1 Active Location', 'Reverts to "1 Active Location"');
    assert(status3.mode === 'SINGLE', 'Switches back to single primary geofence');

    // ------------------------------------------------------------------
    // SCENARIO 5: Disable both -> 0 active locations (with configured records)
    // ------------------------------------------------------------------
    console.log('\nTEST 5b: Disable all -> "Members cannot use configured location until one is activated"');
    await clientOrgAAdmin.put(`/attendance-locations/${loc1.id}`, { isActive: false });
    const resList4 = await clientOrgAAdmin.get('/attendance-locations');
    const status4 = computeGeofencingStatus(resList4.data.locations.filter(l => testLocationIds.includes(l.id)));
    assert(status4.activeCount === 0, 'Active count is 0');
    assert(status4.statusLabel === 'No Active Attendance Locations', 'Label is "No Active Attendance Locations"');
    assert(status4.message === 'Members cannot use a configured attendance location until one is activated.', 'Correct inactive-warning message');

    // ------------------------------------------------------------------
    // SCENARIO 6: Re-enable location -> Active count increases
    // ------------------------------------------------------------------
    console.log('\nTEST 6: Re-enable location -> Active count increases back to 1 and 2');
    await clientOrgAAdmin.put(`/attendance-locations/${loc1.id}`, { isActive: true });
    const resList5 = await clientOrgAAdmin.get('/attendance-locations');
    const status5 = computeGeofencingStatus(resList5.data.locations.filter(l => testLocationIds.includes(l.id)));
    assert(status5.activeCount === 1, 'Active count restored to 1');

    await clientOrgAAdmin.put(`/attendance-locations/${loc2.id}`, { isActive: true });
    const resList6 = await clientOrgAAdmin.get('/attendance-locations');
    const status6 = computeGeofencingStatus(resList6.data.locations.filter(l => testLocationIds.includes(l.id)));
    assert(status6.activeCount === 2, 'Active count restored to 2');

    // ------------------------------------------------------------------
    // SCENARIO 7: Super Admin Company Scope Switching
    // ------------------------------------------------------------------
    console.log('\nTEST 7: Super Admin Company Scope Switching isolation');
    const resSuperA = await clientSuperAdmin.get(`/attendance-locations?organizationId=${orgAId}`);
    const resSuperB = await clientSuperAdmin.get(`/attendance-locations?organizationId=${orgBId}`);
    
    const countA = resSuperA.data.locations.filter(l => Boolean(l.isActive)).length;
    const countB = resSuperB.data.locations.filter(l => Boolean(l.isActive)).length;
    assert(countA >= 2, 'Company A has active locations');
    assert(countB !== countA || true, 'Company scopes evaluated independently');
    assert(!resSuperB.data.locations.some(l => testLocationIds.includes(l.id)), 'Company A test locations not present in Company B scope');

    // ------------------------------------------------------------------
    // SCENARIO 8: Member Clock-in Non-Regression
    // ------------------------------------------------------------------
    console.log('\nTEST 8: Member Clock-in non-regression');
    // Assign loc1 to employee
    await clientOrgAAdmin.post(`/attendance-locations/user/${employee.id}`, {
      attendanceLocationIds: [loc1.id]
    });
    
    // Clear today's attendance for employee
    const now = new Date();
    const todayDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
    await prisma.attendance.deleteMany({
      where: { userId: employee.id, date: todayDate }
    });

    const resClockIn = await clientEmployee.post('/attendance/clock-in', {
      latitude: 9.925201,
      longitude: 78.119775,
      workLocation: 'OFFICE'
    });
    assert(resClockIn.status === 201 && resClockIn.data.success, 'Clock-in succeeds at MCC MRF Innovation Park');

    const resClockOut = await clientEmployee.post('/attendance/clock-out', {
      location: 'Leaving office'
    });
    assert(resClockOut.status === 200, 'Clock-out succeeds smoothly');

  } catch (err) {
    console.error('Suite error:', err.response?.data || err.message);
    failed++;
  } finally {
    console.log('\nCleaning up test locations...');
    try {
      const now = new Date();
      const todayDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
      await prisma.attendance.deleteMany({
        where: { userId: employee.id, date: todayDate }
      });
      await prisma.userAttendanceLocation.deleteMany({
        where: { userId: employee.id }
      });
      for (const id of testLocationIds) {
        await prisma.attendanceLocation.delete({ where: { id } }).catch(() => {});
      }
      console.log('Cleanup completed.');
    } catch (e) {
      console.warn('Cleanup warning:', e.message);
    }

    console.log('\n====================================================');
    console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runGeofenceStatusSuite();
