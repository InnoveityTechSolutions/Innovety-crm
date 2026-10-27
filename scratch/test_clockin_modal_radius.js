const path = require('path');
const backendDir = path.resolve(__dirname, '../backend');
const prisma = require(path.join(backendDir, 'src/utils/db'));
const { calculateHaversineDistance, formatDistance, evaluateAttendanceGeofence } = require(path.join(backendDir, 'src/utils/attendanceUtils'));
const axios = require(path.join(backendDir, 'node_modules/axios'));
const jwt = require(path.join(backendDir, 'node_modules/jsonwebtoken'));

const BASE_URL = 'http://localhost:5000/api';
const JWT_SECRET = process.env.JWT_SECRET || 'enterprise_internship_crm_super_secret_jwt_key_123!';

async function runTests() {
  console.log('===============================================================');
  console.log('   VERIFYING CLOCK-IN MODAL ALLOWED RADIUS & GEOFENCE LOGIC    ');
  console.log('===============================================================\n');

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

  // --- UNIT TEST SUITE: evaluateAttendanceGeofence ---
  console.log('SECTION 1: Unit testing evaluateAttendanceGeofence resolution logic...');

  const loc50m = {
    id: 'loc-50m',
    name: 'Small Branch 50m',
    latitude: 12.970000,
    longitude: 77.590000,
    radiusMeters: 50.0,
    isActive: true
  };

  const loc100m = {
    id: 'loc-100m',
    name: 'Standard Office 100m',
    latitude: 12.980000,
    longitude: 77.600000,
    radiusMeters: 100.0,
    isActive: true
  };

  const loc200m = {
    id: 'loc-200m',
    name: 'Campus 200m',
    latitude: 12.990000,
    longitude: 77.610000,
    radiusMeters: 200.0,
    isActive: true
  };

  // 1. Single 50m location - Inside (20m away)
  const dist20mLat = loc50m.latitude + 0.00015; // ~16.7m away
  const eval50Inside = evaluateAttendanceGeofence({
    userLat: dist20mLat,
    userLon: loc50m.longitude,
    assignedLocations: [loc50m],
    hasOrgLocations: true
  });
  assert(eval50Inside.isInside === true, '50m location: Member 17m away is INSIDE.');
  assert(eval50Inside.allowedRadiusMeters === 50, `50m location: Evaluated allowed radius is 50m (got: ${eval50Inside.allowedRadiusMeters}m).`);
  assert(eval50Inside.locationName === 'Small Branch 50m', '50m location: Evaluated location name is correct.');

  // 2. Single 50m location - Outside (150m away)
  const dist150mLat = loc50m.latitude + 0.00135; // ~150m away
  const eval50Outside = evaluateAttendanceGeofence({
    userLat: dist150mLat,
    userLon: loc50m.longitude,
    assignedLocations: [loc50m],
    hasOrgLocations: true
  });
  assert(eval50Outside.isInside === false, '50m location: Member 150m away is OUTSIDE.');
  assert(eval50Outside.allowedRadiusMeters === 50, `50m location: Outside member sees 50m allowed radius (NOT 200m! Got: ${eval50Outside.allowedRadiusMeters}m).`);
  assert(eval50Outside.locationName === 'Small Branch 50m', '50m location: Outside member sees the nearest location name.');
  assert(eval50Outside.nearestLocation.radiusMeters === 50, '50m location: Nearest location object has radius 50m.');

  // 3. Single 100m location - Inside (70m away)
  const dist70mLat = loc100m.latitude + 0.00063; // ~70m away
  const eval100Inside = evaluateAttendanceGeofence({
    userLat: dist70mLat,
    userLon: loc100m.longitude,
    assignedLocations: [loc100m],
    hasOrgLocations: true
  });
  assert(eval100Inside.isInside === true, '100m location: Member 70m away is INSIDE.');
  assert(eval100Inside.allowedRadiusMeters === 100, `100m location: Member sees 100m allowed radius (got: ${eval100Inside.allowedRadiusMeters}m).`);

  // 4. Single 100m location - Outside (250m away)
  const dist250mLat = loc100m.latitude + 0.00225; // ~250m away
  const eval100Outside = evaluateAttendanceGeofence({
    userLat: dist250mLat,
    userLon: loc100m.longitude,
    assignedLocations: [loc100m],
    hasOrgLocations: true
  });
  assert(eval100Outside.isInside === false, '100m location: Member 250m away is OUTSIDE.');
  assert(eval100Outside.allowedRadiusMeters === 100, `100m location: Outside member sees 100m allowed radius (NOT 200m! Got: ${eval100Outside.allowedRadiusMeters}m).`);
  assert(eval100Outside.locationName === 'Standard Office 100m', '100m location: Outside member sees nearest location name.');

  // 5. Single 200m location - Inside (180m away)
  const dist180mLat = loc200m.latitude + 0.00162; // ~180m away
  const eval200Inside = evaluateAttendanceGeofence({
    userLat: dist180mLat,
    userLon: loc200m.longitude,
    assignedLocations: [loc200m],
    hasOrgLocations: true
  });
  assert(eval200Inside.isInside === true, '200m location: Member 180m away is INSIDE.');
  assert(eval200Inside.allowedRadiusMeters === 200, `200m location: Member sees 200m allowed radius.`);

  // 6. Single 200m location - Outside (400m away)
  const dist400mLat = loc200m.latitude + 0.00360; // ~400m away
  const eval200Outside = evaluateAttendanceGeofence({
    userLat: dist400mLat,
    userLon: loc200m.longitude,
    assignedLocations: [loc200m],
    hasOrgLocations: true
  });
  assert(eval200Outside.isInside === false, '200m location: Member 400m away is OUTSIDE.');
  assert(eval200Outside.allowedRadiusMeters === 200, `200m location: Member sees 200m allowed radius.`);

  // 7. Multiple assigned locations (50m and 100m)
  // Position member closer to loc100m (e.g. 150m from loc100m, but 1.5km from loc50m)
  const evalMulti100 = evaluateAttendanceGeofence({
    userLat: dist150mLat + (loc100m.latitude - loc50m.latitude),
    userLon: loc100m.longitude,
    assignedLocations: [loc50m, loc100m],
    hasOrgLocations: true
  });
  assert(evalMulti100.nearestLocation.name === 'Standard Office 100m', 'Multiple locations: Nearest location identified as Standard Office 100m.');
  assert(evalMulti100.allowedRadiusMeters === 100, `Multiple locations: Displayed radius matches nearest location (100m).`);

  // Position member closer to loc50m (e.g. 80m from loc50m, but 1.5km from loc100m)
  const evalMulti50 = evaluateAttendanceGeofence({
    userLat: loc50m.latitude + 0.00072, // ~80m
    userLon: loc50m.longitude,
    assignedLocations: [loc50m, loc100m],
    hasOrgLocations: true
  });
  assert(evalMulti50.nearestLocation.name === 'Small Branch 50m', 'Multiple locations: Nearest location identified as Small Branch 50m.');
  assert(evalMulti50.allowedRadiusMeters === 50, `Multiple locations: Displayed radius matches nearest location (50m, NOT 100m or 200m).`);


  // --- SECTION 2: END-TO-END API TESTS VIA HTTP ---
  console.log('\nSECTION 2: Integration testing /api/attendance/verify-location, /status, and /clock-in...');

  const employee = await prisma.user.findFirst({
    where: { role: { in: ['INTERN', 'EMPLOYEE', 'TEAM_LEADER'] } },
    include: { organization: true }
  });

  if (!employee) {
    console.error('Cannot find employee in database.');
    process.exit(1);
  }

  const token = jwt.sign(
    { id: employee.id, role: employee.role, email: employee.email, organizationId: employee.organizationId },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  const authHeader = { headers: { Authorization: `Bearer ${token}` } };

  // Create temporary test locations in DB
  const testLoc50 = await prisma.attendanceLocation.create({
    data: {
      name: 'E2E Test Hub 50m',
      address: 'Test 50m St',
      latitude: 13.040000,
      longitude: 80.250000,
      radiusMeters: 50.0,
      isActive: true,
      organizationId: employee.organizationId
    }
  });

  const testLoc100 = await prisma.attendanceLocation.create({
    data: {
      name: 'E2E Test Hub 100m',
      address: 'Test 100m St',
      latitude: 13.060000,
      longitude: 80.260000,
      radiusMeters: 100.0,
      isActive: true,
      organizationId: employee.organizationId
    }
  });

  try {
    // Clean up any existing assignments for this test user
    await prisma.userAttendanceLocation.deleteMany({ where: { userId: employee.id } });

    // Test A: Assign user to 50m location only
    await prisma.userAttendanceLocation.create({
      data: { userId: employee.id, attendanceLocationId: testLoc50.id }
    });

    // Verify /api/attendance/status returns allowedRadiusMeters = 50
    const status50Res = await axios.get(`${BASE_URL}/attendance/status`, authHeader);
    assert(status50Res.data.geofence.allowedRadiusMeters === 50, `GET /attendance/status returns allowedRadiusMeters = 50 for 50m location (got: ${status50Res.data.geofence.allowedRadiusMeters}).`);
    assert(status50Res.data.geofence.officeLocationName === 'E2E Test Hub 50m', 'GET /attendance/status returns officeLocationName = E2E Test Hub 50m.');

    // Verify /api/attendance/verify-location when INSIDE 50m
    const verify50Inside = await axios.post(`${BASE_URL}/attendance/verify-location`, {
      latitude: testLoc50.latitude,
      longitude: testLoc50.longitude
    }, authHeader);
    assert(verify50Inside.data.status === 'INSIDE', 'POST /attendance/verify-location: 0m away is INSIDE.');
    assert(verify50Inside.data.allowedRadiusMeters === 50, 'POST /attendance/verify-location: allowedRadiusMeters is 50m.');
    assert(verify50Inside.data.locationName === 'E2E Test Hub 50m', 'POST /attendance/verify-location: locationName is E2E Test Hub 50m.');

    // Verify /api/attendance/verify-location when OUTSIDE 50m (e.g. 150m away)
    const verify50Outside = await axios.post(`${BASE_URL}/attendance/verify-location`, {
      latitude: testLoc50.latitude + 0.00135,
      longitude: testLoc50.longitude
    }, authHeader);
    assert(verify50Outside.data.status === 'OUTSIDE', 'POST /attendance/verify-location: 150m away is OUTSIDE.');
    assert(verify50Outside.data.allowedRadiusMeters === 50, `POST /attendance/verify-location: Outside member sees 50m (NOT 200m! Got: ${verify50Outside.data.allowedRadiusMeters}).`);
    assert(verify50Outside.data.nearestLocation.name === 'E2E Test Hub 50m', 'POST /attendance/verify-location: nearestLocation name is E2E Test Hub 50m.');
    assert(verify50Outside.data.nearestLocation.radiusMeters === 50, 'POST /attendance/verify-location: nearestLocation.radiusMeters is 50.');

    // Test B: Switch assignment to 100m location only
    await prisma.userAttendanceLocation.deleteMany({ where: { userId: employee.id } });
    await prisma.userAttendanceLocation.create({
      data: { userId: employee.id, attendanceLocationId: testLoc100.id }
    });

    const status100Res = await axios.get(`${BASE_URL}/attendance/status`, authHeader);
    assert(status100Res.data.geofence.allowedRadiusMeters === 100, `GET /attendance/status returns allowedRadiusMeters = 100 for 100m location.`);

    const verify100Outside = await axios.post(`${BASE_URL}/attendance/verify-location`, {
      latitude: testLoc100.latitude + 0.0020,
      longitude: testLoc100.longitude
    }, authHeader);
    assert(verify100Outside.data.status === 'OUTSIDE', 'POST /attendance/verify-location: 220m away from 100m location is OUTSIDE.');
    assert(verify100Outside.data.allowedRadiusMeters === 100, `POST /attendance/verify-location: Outside member sees 100m (NOT 200m! Got: ${verify100Outside.data.allowedRadiusMeters}).`);
    assert(verify100Outside.data.nearestLocation.name === 'E2E Test Hub 100m', 'POST /attendance/verify-location: nearestLocation name is E2E Test Hub 100m.');

    // Test C: Assign BOTH 50m and 100m locations
    await prisma.userAttendanceLocation.create({
      data: { userId: employee.id, attendanceLocationId: testLoc50.id }
    });

    // Test position nearest to 50m location (e.g. 70m from 50m location)
    const verifyMultiNear50 = await axios.post(`${BASE_URL}/attendance/verify-location`, {
      latitude: testLoc50.latitude + 0.00063,
      longitude: testLoc50.longitude
    }, authHeader);
    assert(verifyMultiNear50.data.nearestLocation.name === 'E2E Test Hub 50m', 'Multiple locations: Nearest location identified as E2E Test Hub 50m.');
    assert(verifyMultiNear50.data.allowedRadiusMeters === 50, 'Multiple locations: Displayed radius matches 50m nearest location.');

    // Test position nearest to 100m location (e.g. 150m from 100m location)
    const verifyMultiNear100 = await axios.post(`${BASE_URL}/attendance/verify-location`, {
      latitude: testLoc100.latitude + 0.00135,
      longitude: testLoc100.longitude
    }, authHeader);
    assert(verifyMultiNear100.data.nearestLocation.name === 'E2E Test Hub 100m', 'Multiple locations: Nearest location identified as E2E Test Hub 100m.');
    assert(verifyMultiNear100.data.allowedRadiusMeters === 100, 'Multiple locations: Displayed radius matches 100m nearest location.');

    // Test D: POST /api/attendance/clock-in outside geofence returns nearestLocation details
    try {
      await axios.post(`${BASE_URL}/attendance/clock-in`, {
        latitude: testLoc50.latitude + 0.00135,
        longitude: testLoc50.longitude,
        workLocation: 'OFFICE'
      }, authHeader);
      assert(false, 'Clock in should be rejected when outside geofence.');
    } catch (clockInErr) {
      assert(clockInErr.response?.status === 400, 'Clock in rejected with HTTP 400 when outside geofence.');
      assert(clockInErr.response?.data?.reason === 'OUTSIDE_GEOFENCE', 'Rejection reason is OUTSIDE_GEOFENCE.');
      assert(clockInErr.response?.data?.allowedRadiusMeters === 50, `Clock in response returns allowedRadiusMeters = 50 (got: ${clockInErr.response?.data?.allowedRadiusMeters}).`);
      assert(clockInErr.response?.data?.nearestLocation?.name === 'E2E Test Hub 50m', 'Clock in response returns nearestLocation.name.');
      assert(clockInErr.response?.data?.distanceMeters > 0, `Clock in response returns distanceMeters (${clockInErr.response?.data?.distanceMeters}m).`);
    }

  } finally {
    // Cleanup temporary records
    console.log('\nCleaning up temporary test database records...');
    await prisma.userAttendanceLocation.deleteMany({
      where: { attendanceLocationId: { in: [testLoc50.id, testLoc100.id] } }
    });
    await prisma.attendanceLocation.deleteMany({
      where: { id: { in: [testLoc50.id, testLoc100.id] } }
    });
    console.log('Cleanup complete.');
  }

  console.log('\n===============================================================');
  console.log(`   TEST RESULTS: ${passed} PASSED, ${failed} FAILED               `);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
