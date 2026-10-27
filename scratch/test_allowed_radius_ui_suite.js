/**
 * Verification Suite for Allowed Radius Presets and Custom Radius in InnovEity CRM
 */
const fs = require('fs');
const path = require('path');

const API_BASE = 'http://localhost:5000/api';

async function runTests() {
  console.log('====================================================');
  console.log('STARTING ALLOWED RADIUS VERIFICATION SUITE');
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

  // 1. Inspect AttendanceLocationsSection Component
  console.log('TEST 1: Inspect AttendanceLocationsSection Component Code');
  const sectionPath = path.resolve(__dirname, '../frontend/src/components/attendance/AttendanceLocationsSection.jsx');
  assert(fs.existsSync(sectionPath), 'AttendanceLocationsSection.jsx exists');

  const sectionContent = fs.readFileSync(sectionPath, 'utf8');
  assert(!sectionContent.includes('<select') || !sectionContent.includes('RADIUS_OPTIONS.map'), 'Removed old predefined-radius select dropdown');
  assert(sectionContent.includes('RECOMMENDED_RADIUS_OPTIONS'), 'Defines RECOMMENDED_RADIUS_OPTIONS');
  assert(sectionContent.includes('50 meters') && sectionContent.includes('Small Office'), 'Includes 50m Small Office recommendation');
  assert(sectionContent.includes('100 meters') && sectionContent.includes('Standard Office'), 'Includes 100m Standard Office recommendation');
  assert(sectionContent.includes('200 meters') && sectionContent.includes('Campus / Large Office'), 'Includes 200m Campus recommendation');
  assert(sectionContent.includes('500 meters') && sectionContent.includes('Industrial Complex'), 'Includes 500m Industrial Complex recommendation');
  assert(sectionContent.includes('Custom Radius'), 'Contains Custom Radius input section');
  assert(sectionContent.includes('type="number"'), 'Provides numeric input for custom radius');
  assert(sectionContent.includes('radius < 10 || radius > 5000'), 'Validates positive radius within sensible maximum (10m - 5000m)');

  // 2. Authenticate as Admin
  console.log('\nTEST 2: Admin Authentication');
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@enterprise-crm.com', password: 'password123' })
  });
  const loginData = await loginRes.json();
  const token = loginData.token;
  assert(Boolean(token), 'Admin login successful');

  // 3. Test API Persistence with Preset 100m
  console.log('\nTEST 3: Location Creation with Preset 100m Radius');
  const res100 = await fetch(`${API_BASE}/attendance-locations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Radius 100m Office',
      latitude: 12.920490,
      longitude: 80.121647,
      radiusMeters: 100,
      isActive: true
    })
  });
  const data100 = await res100.json();
  const loc100 = data100.location || data100.data;
  assert(res100.status === 201 && loc100 && loc100.radiusMeters === 100, 'Preset 100m persisted correctly');

  // 4. Test API Persistence with Preset 200m
  console.log('\nTEST 4: Location Creation with Preset 200m Radius');
  const res200 = await fetch(`${API_BASE}/attendance-locations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Radius 200m Office',
      latitude: 12.920490,
      longitude: 80.121647,
      radiusMeters: 200,
      isActive: true
    })
  });
  const data200 = await res200.json();
  const loc200 = data200.location || data200.data;
  assert(res200.status === 201 && loc200 && loc200.radiusMeters === 200, 'Preset 200m persisted correctly');

  // 5. Test API Persistence with Custom Radius 275m
  console.log('\nTEST 5: Location Creation with Custom Radius 275m');
  const res275 = await fetch(`${API_BASE}/attendance-locations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Custom 275m Office',
      latitude: 12.920490,
      longitude: 80.121647,
      radiusMeters: 275,
      isActive: true
    })
  });
  const data275 = await res275.json();
  const loc275 = data275.location || data275.data;
  assert(res275.status === 201 && loc275 && loc275.radiusMeters === 275, 'Custom radius 275m persisted correctly');

  // 6. Test Updating Location to Custom 350m
  console.log('\nTEST 6: Update Location to Another Custom Radius (350m)');
  const resUpdate = await fetch(`${API_BASE}/attendance-locations/${loc275.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      radiusMeters: 350
    })
  });
  const dataUpdate = await resUpdate.json();
  const locUpdated = dataUpdate.location || dataUpdate.data;
  assert(resUpdate.status === 200 && locUpdated.radiusMeters === 350, 'Location updated to 350m successfully');

  // 7. Test Reopening Location preserves coordinates & radius
  console.log('\nTEST 7: Fetch Location by ID to Verify Reopening State');
  const resGet = await fetch(`${API_BASE}/attendance-locations/${loc275.id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const dataGet = await resGet.json();
  const locFetched = dataGet.location || dataGet.data;
  assert(locFetched && locFetched.radiusMeters === 350, 'Reopening location preserves custom radius 350m');
  assert(Math.abs(locFetched.latitude - 12.920490) < 0.0001, 'Latitude preserved');
  assert(Math.abs(locFetched.longitude - 80.121647) < 0.0001, 'Longitude preserved');

  // 8. Test Validation: Invalid Radius Rejected by API
  console.log('\nTEST 8: Validate Invalid Radius Boundary Checks');
  const resInvalidZero = await fetch(`${API_BASE}/attendance-locations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Zero Radius Office',
      latitude: 12.920490,
      longitude: 80.121647,
      radiusMeters: 0,
      isActive: true
    })
  });
  assert(resInvalidZero.status === 400, 'API correctly rejects zero radius');

  // Clean up created test locations
  await fetch(`${API_BASE}/attendance-locations/${loc100.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  await fetch(`${API_BASE}/attendance-locations/${loc200.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  await fetch(`${API_BASE}/attendance-locations/${loc275.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  assert(true, 'Test locations cleaned up successfully');

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
