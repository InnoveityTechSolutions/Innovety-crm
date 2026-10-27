const prisma = require('./src/utils/db');
const { calculateHaversineDistance, formatDistance } = require('./src/utils/attendanceUtils');
const axios = require('axios');
const { getTestConfig } = require('./src/utils/testConfigHelper');

const testConfig = getTestConfig({ isDestructive: true });
const BASE_URL = testConfig.apiUrl;

async function runGeofenceE2ETests() {
  console.log('====================================================');
  console.log('   RUNNING GEO-FENCED ATTENDANCE E2E VERIFICATION   ');
  console.log('====================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passedCount++;
    } else {
      console.error(`❌ [FAIL] ${message}`);
      failedCount++;
    }
  }

  try {
    // 1. Authenticate or fetch Admin and Test Employee tokens
    console.log('1. Setting up test users and JWT authentication tokens...');
    const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    const testEmployee = await prisma.user.findFirst({ where: { role: { in: ['INTERN', 'EMPLOYEE', 'TEAM_LEADER'] } } });

    if (!adminUser || !testEmployee) {
      console.error('Failed to locate test Admin or Employee accounts in DB.');
      process.exit(1);
    }

    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'enterprise_internship_crm_super_secret_jwt_key_123!';

    const adminToken = jwt.sign({ id: adminUser.id, role: adminUser.role, email: adminUser.email }, JWT_SECRET, { expiresIn: '1h' });
    const employeeToken = jwt.sign({ id: testEmployee.id, role: testEmployee.role, email: testEmployee.email }, JWT_SECRET, { expiresIn: '1h' });

    const adminAuthHeader = { headers: { Authorization: `Bearer ${adminToken}` } };
    const employeeAuthHeader = { headers: { Authorization: `Bearer ${employeeToken}` } };

    // 2. Test Admin Site Settings Configuration
    console.log('\n2. Testing Admin Office Location Settings & Validation...');
    const officeLat = 12.971598;
    const officeLon = 77.594562;
    const initialRadius = 200.0;

    const settingsRes = await axios.put(`${BASE_URL}/settings`, {
      companyName: 'Innoveity',
      senderEmail: 'test@innoveity.com',
      officeLatitude: officeLat,
      officeLongitude: officeLon,
      allowedRadiusMeters: initialRadius,
      officeLocationName: 'Innoveity HQ Geofence Test'
    }, adminAuthHeader);

    assert(settingsRes.status === 200, 'Admin can successfully update office latitude, longitude, and radius.');
    assert(settingsRes.data.officeLatitude === officeLat, 'Office Latitude matches configured value.');
    assert(settingsRes.data.officeLongitude === officeLon, 'Office Longitude matches configured value.');
    assert(settingsRes.data.allowedRadiusMeters === initialRadius, 'Allowed radius matches configured 200m.');

    // Test Invalid Settings Rejection
    try {
      await axios.put(`${BASE_URL}/settings`, { officeLatitude: 150 }, adminAuthHeader);
      assert(false, 'Should reject invalid latitude > 90');
    } catch (err) {
      assert(err.response?.status === 400, 'Admin settings correctly rejects invalid latitude > 90 with HTTP 400.');
    }

    try {
      await axios.put(`${BASE_URL}/settings`, { allowedRadiusMeters: -50 }, adminAuthHeader);
      assert(false, 'Should reject negative radius');
    } catch (err) {
      assert(err.response?.status === 400, 'Admin settings correctly rejects negative radius with HTTP 400.');
    }

    // Clean up any existing attendance for test employee today so clock-in tests work cleanly
    const todayStr = new Date().toISOString().split('T')[0];
    const todayDate = new Date(`${todayStr}T00:00:00.000Z`);
    await prisma.attendance.deleteMany({
      where: { userId: testEmployee.id, date: todayDate }
    });

    // 3. Test Haversine Distance Helper Unit Tests
    console.log('\n3. Testing Haversine Distance Formula Accuracy...');
    const distZero = calculateHaversineDistance(officeLat, officeLon, officeLat, officeLon);
    assert(Math.round(distZero) === 0, 'Distance to exact same coordinates is 0 meters.');

    // Coordinate approx 100 meters away (0.0009 deg lat difference)
    const dist100m = calculateHaversineDistance(officeLat, officeLon, officeLat + 0.0009, officeLon);
    assert(dist100m > 90 && dist100m < 110, `Calculated distance (~100m) is ${Math.round(dist100m)}m.`);

    // 4. Test Missing Coordinates Clock-In Rejection
    console.log('\n4. Test: Missing GPS Coordinates Rejection...');
    try {
      await axios.post(`${BASE_URL}/attendance/clock-in`, { workLocation: 'OFFICE' }, employeeAuthHeader);
      assert(false, 'Should reject clock in missing coordinates');
    } catch (err) {
      assert(err.response?.status === 400, 'Clock-In rejects missing GPS coordinates with HTTP 400.');
      assert(err.response?.data?.reason === 'LOCATION_REQUIRED', 'Error code is LOCATION_REQUIRED.');
    }

    // 5. Test Security: Outside Geofence + OFFICE Location Rejection
    console.log('\n5. Test Security: User Outside Geofence attempting OFFICE clock-in...');
    const farLat = 13.050000;
    const farLon = 77.650000; // ~10.5 km away
    try {
      await axios.post(`${BASE_URL}/attendance/clock-in`, {
        latitude: farLat,
        longitude: farLon,
        workLocation: 'OFFICE'
      }, employeeAuthHeader);
      assert(false, 'Should reject outside OFFICE clock-in');
    } catch (err) {
      assert(err.response?.status === 400, 'Backend rejects outside OFFICE clock-in with HTTP 400.');
      assert(err.response?.data?.reason === 'OUTSIDE_GEOFENCE', 'Error code is OUTSIDE_GEOFENCE.');
      assert(err.response?.data?.isOutside === true, 'Response specifies isOutside = true.');
      assert(err.response?.data?.distanceMeters > 5000, `Returned exact distance (${err.response?.data?.distanceMeters}m).`);
    }

    // 6. Test Outside Geofence + HOME Clock-In
    console.log('\n6. Test: Outside Geofence + HOME Clock-In...');
    const clockInHomeRes = await axios.post(`${BASE_URL}/attendance/clock-in`, {
      latitude: farLat,
      longitude: farLon,
      workLocation: 'HOME'
    }, employeeAuthHeader);

    assert(clockInHomeRes.status === 201, 'Clock-In succeeds for HOME location outside geofence.');
    assert(clockInHomeRes.data.attendance.workLocation === 'HOME', 'Attendance record workLocation stored as HOME.');

    // Clean up for next test
    await prisma.attendance.deleteMany({ where: { userId: testEmployee.id, date: todayDate } });

    // 7. Test Outside Geofence + OTHER Clock-In
    console.log('\n7. Test: Outside Geofence + OTHER Clock-In with Reason...');
    const clockInOtherRes = await axios.post(`${BASE_URL}/attendance/clock-in`, {
      latitude: farLat,
      longitude: farLon,
      workLocation: 'OTHER',
      workLocationOther: 'Client Site Meeting - Chennai Branch'
    }, employeeAuthHeader);

    assert(clockInOtherRes.status === 201, 'Clock-In succeeds for OTHER location outside geofence.');
    assert(clockInOtherRes.data.attendance.workLocation === 'OTHER', 'Attendance record workLocation stored as OTHER.');
    assert(clockInOtherRes.data.attendance.workLocationOther === 'Client Site Meeting - Chennai Branch', 'Attendance record stores reason string.');

    // Clean up for next test
    await prisma.attendance.deleteMany({ where: { userId: testEmployee.id, date: todayDate } });

    // 8. Test Inside Geofence + OFFICE Clock-In
    console.log('\n8. Test: Inside Geofence + OFFICE Clock-In...');
    const nearLat = 12.971600;
    const nearLon = 77.594560; // ~5 meters away <= 200m
    const clockInOfficeRes = await axios.post(`${BASE_URL}/attendance/clock-in`, {
      latitude: nearLat,
      longitude: nearLon,
      workLocation: 'OFFICE'
    }, employeeAuthHeader);

    assert(clockInOfficeRes.status === 201, 'Clock-In succeeds for inside geofence OFFICE location.');
    assert(clockInOfficeRes.data.attendance.workLocation === 'OFFICE', 'Attendance record workLocation stored as OFFICE.');

    // 9. Test Geofence Dynamic Radius Change
    console.log('\n9. Test: Dynamic Admin Radius Change (200m -> 500m)...');
    await axios.put(`${BASE_URL}/settings`, { allowedRadiusMeters: 500.0 }, adminAuthHeader);
    const updatedStatusRes = await axios.get(`${BASE_URL}/attendance/status`, employeeAuthHeader);
    assert(updatedStatusRes.data.geofence.allowedRadiusMeters === 500.0, 'Backend status endpoint immediately reflects new 500m allowed radius.');

    // Restore initial 200m radius
    await axios.put(`${BASE_URL}/settings`, { allowedRadiusMeters: 200.0 }, adminAuthHeader);

    // 10. Summary
    console.log('\n====================================================');
    console.log(`   E2E TESTS COMPLETED: ${passedCount} PASSED, ${failedCount} FAILED   `);
    console.log('====================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error during E2E geofence test:', error.response?.data || error.message);
    process.exit(1);
  }
}

runGeofenceE2ETests();
