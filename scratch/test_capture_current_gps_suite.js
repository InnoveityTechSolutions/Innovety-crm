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

async function runGpsCaptureSuite() {
  console.log('====================================================');
  console.log('STARTING GPS CAPTURE & ATTENDANCE LOCATION TEST SUITE');
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

  // 1. Fetch users
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

  let createdLocId = null;

  try {
    // ------------------------------------------------------------------
    // STEP 1-10: Simulate GPS capture -> Save "MCC MRF Innovation Park"
    // ------------------------------------------------------------------
    console.log('TEST 1-11: Capture Current GPS Flow & Save "MCC MRF Innovation Park"');
    
    // Coordinates simulated from browser navigator.geolocation
    const simulatedGps = {
      latitude: 9.925201,
      longitude: 78.119775,
      address: 'MCC MRF Innovation Park, Madurai, Tamil Nadu, 625020',
      name: 'MCC MRF Innovation Park',
      radiusMeters: 100,
      isActive: true
    };

    const resCreate = await clientOrgAAdmin.post('/attendance-locations', {
      name: simulatedGps.name,
      address: simulatedGps.address,
      latitude: simulatedGps.latitude,
      longitude: simulatedGps.longitude,
      radiusMeters: simulatedGps.radiusMeters,
      isActive: simulatedGps.isActive
    });

    assert(resCreate.status === 201 && resCreate.data.success, 'Saved location through Attendance Location API');
    createdLocId = resCreate.data.location.id;
    assert(resCreate.data.location.name === 'MCC MRF Innovation Park', 'Location name is strictly "MCC MRF Innovation Park"');
    assert(resCreate.data.location.radiusMeters === 100, 'Radius set to 100 meters');
    assert(resCreate.data.location.organizationId === orgAId, 'Location correctly belongs to the active organization');

    // ------------------------------------------------------------------
    // STEP 11-13: Location appears in Attendance Locations list and persists
    // ------------------------------------------------------------------
    console.log('\nTEST 12-13: Verification in Attendance Locations List & Persistence');
    const resList = await clientOrgAAdmin.get('/attendance-locations');
    const foundInList = resList.data.locations.find(l => l.id === createdLocId);
    assert(foundInList !== undefined, 'Created location appears in Attendance Locations list');
    assert(foundInList.name === 'MCC MRF Innovation Park', 'Location name verified in list');
    assert(foundInList.address === simulatedGps.address, 'Detected address verified in list');

    // ------------------------------------------------------------------
    // STEP 14: Edit location (Change radius and address)
    // ------------------------------------------------------------------
    console.log('\nTEST 14: Edit Location');
    const resEdit = await clientOrgAAdmin.put(`/attendance-locations/${createdLocId}`, {
      radiusMeters: 150,
      address: 'MCC MRF Innovation Park Campus, Airport Road, Madurai'
    });
    assert(resEdit.status === 200 && resEdit.data.success, 'Edited location successfully');
    assert(resEdit.data.location.radiusMeters === 150, 'Radius updated to 150 meters');
    assert(resEdit.data.location.address === 'MCC MRF Innovation Park Campus, Airport Road, Madurai', 'Address updated');

    // ------------------------------------------------------------------
    // STEP 15: Disable / Enable location
    // ------------------------------------------------------------------
    console.log('\nTEST 15: Disable & Enable Location');
    const resDisable = await clientOrgAAdmin.put(`/attendance-locations/${createdLocId}`, {
      isActive: false
    });
    assert(resDisable.status === 200 && resDisable.data.location.isActive === false, 'Location disabled successfully');

    const resEnable = await clientOrgAAdmin.put(`/attendance-locations/${createdLocId}`, {
      isActive: true
    });
    assert(resEnable.status === 200 && resEnable.data.location.isActive === true, 'Location re-enabled successfully');

    // ------------------------------------------------------------------
    // STEP 18-19: Super Admin Company Switching
    // ------------------------------------------------------------------
    console.log('\nTEST 18-19: Super Admin Company Scope Handling');
    const resSuperOrgA = await clientSuperAdmin.get(`/attendance-locations?organizationId=${orgAId}`);
    const inOrgA = resSuperOrgA.data.locations.some(l => l.id === createdLocId);
    assert(inOrgA, 'Super Admin sees location under Company A (InnovEity Tech)');

    const resSuperOrgB = await clientSuperAdmin.get(`/attendance-locations?organizationId=${orgBId}`);
    const inOrgB = resSuperOrgB.data.locations.some(l => l.id === createdLocId);
    assert(!inOrgB, 'Super Admin switching to Company B does NOT see Company A location');

    // ------------------------------------------------------------------
    // STEP 20: Member Clock-in with Captured Location Compatibility
    // ------------------------------------------------------------------
    console.log('\nTEST 20: Member Clock-In with "MCC MRF Innovation Park" Compatibility');
    // Assign created location to test employee
    await clientOrgAAdmin.post(`/attendance-locations/user/${employee.id}`, {
      attendanceLocationIds: [createdLocId]
    });

    // Clean today attendance for test employee
    const now = new Date();
    const todayDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
    await prisma.attendance.deleteMany({
      where: { userId: employee.id, date: todayDate }
    });

    // Clock in using captured GPS
    const resClockIn = await clientEmployee.post('/attendance/clock-in', {
      latitude: simulatedGps.latitude,
      longitude: simulatedGps.longitude,
      workLocation: 'OFFICE'
    });
    assert(resClockIn.status === 201 && resClockIn.data.success, 'Clock-in allowed using captured location');
    assert(resClockIn.data.attendance.attendanceLocationId === createdLocId, 'attendanceLocationId links to "MCC MRF Innovation Park"');

    // Clock out
    const resClockOut = await clientEmployee.post('/attendance/clock-out', {
      location: 'Leaving MCC MRF Innovation Park'
    });
    assert(resClockOut.status === 200, 'Clock-out succeeds without issues');

  } catch (err) {
    console.error('Test suite error:', err.response?.data || err.message);
    failed++;
  } finally {
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
      if (createdLocId) {
        await prisma.attendanceLocation.delete({ where: { id: createdLocId } }).catch(() => {});
      }
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

runGpsCaptureSuite();
