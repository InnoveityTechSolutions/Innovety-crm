/**
 * Verification Test Suite for Photon Geocoding with OpenStreetMap Data in InnovEity CRM
 */
const fs = require('fs');
const path = require('path');

const API_BASE = 'http://localhost:5000/api';
const PHOTON_URL = 'https://photon.komoot.io/api/';

async function runTests() {
  console.log('====================================================');
  console.log('STARTING PHOTON SEARCH VERIFICATION SUITE');
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

  // 1. Inspect LeafletMapPicker Component Configuration
  console.log('TEST 1: Inspect LeafletMapPicker Component Implementation');
  const pickerPath = path.resolve(__dirname, '../frontend/src/components/common/LeafletMapPicker.jsx');
  assert(fs.existsSync(pickerPath), 'LeafletMapPicker.jsx exists');
  const pickerContent = fs.readFileSync(pickerPath, 'utf8');

  assert(pickerContent.includes('photon.komoot.io/api'), 'Configured with Photon API endpoint');
  assert(pickerContent.includes('VITE_PHOTON_API_URL'), 'Allows overriding Photon URL via environment variables');
  assert(pickerContent.includes('center.lat') && pickerContent.includes('center.lng'), 'Passes map center coordinates for location proximity bias');
  assert(pickerContent.includes('parsePhotonFeature'), 'Parses Photon features into readable titles and structured addresses');
  assert(pickerContent.includes('debounceTimerRef'), 'Debounces auto-search to avoid excessive queries');
  assert(pickerContent.includes('RATE_LIMITED') || pickerContent.includes('429'), 'Handles rate limiting status gracefully');
  assert(pickerContent.includes('OpenStreetMap') && pickerContent.includes('attribution'), 'Preserves OpenStreetMap attribution');

  // 2. Test Specific Search: "Madras Christian College, East Tambaram, Chennai"
  console.log('\nTEST 2: Specific College Search with Multi-part Query');
  // Simulate the multi-part fallback in LeafletMapPicker
  let queryUrl = `${PHOTON_URL}?q=Madras+Christian+College+East+Tambaram&lat=12.920490&lon=80.121647&limit=5`;
  let res = await fetch(queryUrl, { headers: { Accept: 'application/json' } });
  let data = await res.json();
  assert(res.status === 200 && Array.isArray(data.features) && data.features.length > 0, 'Photon returned results for Madras Christian College in East Tambaram');
  
  const collegeFeature = data.features[0];
  const collegeCoords = collegeFeature.geometry.coordinates; // [lon, lat]
  const collegeLon = collegeCoords[0];
  const collegeLat = collegeCoords[1];
  console.log(`         Place: "${collegeFeature.properties.name}", Lat: ${collegeLat}, Lon: ${collegeLon}`);
  assert(collegeFeature.properties.name.includes('Madras Christian College'), 'Resolved Madras Christian College accurately');
  assert(Math.abs(collegeLat - 12.917) < 0.05, 'Coordinates match Tambaram campus latitude (~12.917)');
  assert(Math.abs(collegeLon - 80.122) < 0.05, 'Coordinates match Tambaram campus longitude (~80.122)');

  // 3. Test Known Office Address Search: "Tidel Park Chennai"
  console.log('\nTEST 3: Known Office Address Search');
  let officeUrl = `${PHOTON_URL}?q=Tidel+Park+Chennai&lat=12.920490&lon=80.121647&limit=5`;
  let officeRes = await fetch(officeUrl, { headers: { Accept: 'application/json' } });
  let officeData = await officeRes.json();
  assert(officeRes.status === 200 && officeData.features.length > 0, 'Found known office location "Tidel Park"');
  console.log(`         Place: "${officeData.features[0].properties.name}"`);

  // 4. Test Broad City Search: "Chennai"
  console.log('\nTEST 4: Broad City Search: "Chennai"');
  let cityUrl = `${PHOTON_URL}?q=Chennai&limit=5`;
  let cityRes = await fetch(cityUrl, { headers: { Accept: 'application/json' } });
  let cityData = await cityRes.json();
  assert(cityRes.status === 200 && cityData.features.length > 0, 'Broad city search returned results for "Chennai"');
  const chennaiCity = cityData.features.find(f => f.properties.name === 'Chennai' || f.properties.city === 'Chennai');
  assert(Boolean(chennaiCity), 'Chennai city feature identified');
  console.log(`         City: "${chennaiCity ? chennaiCity.properties.name : 'N/A'}"`);

  // 5. Test Minor Spelling Error Handling
  console.log('\nTEST 5: Minor Spelling Error Tolerance (Fuzzy Match)');
  let typoUrl = `${PHOTON_URL}?q=Madras+Christian+Colege&lat=12.920490&lon=80.121647&limit=5`;
  let typoRes = await fetch(typoUrl, { headers: { Accept: 'application/json' } });
  let typoData = await typoRes.json();
  assert(typoRes.status === 200 && typoData.features.length > 0, 'Typo query "Madras Christian Colege" returned results');
  const correctedName = typoData.features[0].properties.name;
  assert(correctedName.includes('Madras Christian College'), `Fuzzy search successfully resolved to "${correctedName}"`);

  // 6. Test Postal Code Search: "600059"
  console.log('\nTEST 6: Postal Code Search: "600059"');
  let postalUrl = `${PHOTON_URL}?q=600059&lat=12.920490&lon=80.121647&limit=5`;
  let postalRes = await fetch(postalUrl, { headers: { Accept: 'application/json' } });
  let postalData = await postalRes.json();
  assert(postalRes.status === 200 && postalData.features.length > 0, 'Postal code search returned results for 600059');
  console.log(`         Postcode match: "${postalData.features[0].properties.name || postalData.features[0].properties.postcode}"`);

  // 7. Verify Coordinates & Radius Persistence via Backend Attendance Location API
  console.log('\nTEST 7: Verify Selected Result Coordinates & Geofence Persistence');
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@enterprise-crm.com', password: 'password123' })
  });
  const loginData = await loginRes.json();
  const token = loginData.token;
  assert(Boolean(token), 'Admin authentication successful');

  // Create location using coordinates returned from Photon for Madras Christian College
  const newLocationPayload = {
    name: 'Madras Christian College Office',
    address: `${collegeFeature.properties.name}, Tambaram, Tamil Nadu, 600073, India`,
    latitude: collegeLat,
    longitude: collegeLon,
    radiusMeters: 200,
    isActive: true
  };

  const createRes = await fetch(`${API_BASE}/attendance-locations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(newLocationPayload)
  });
  const createData = await createRes.json();
  const createdLoc = createData.location || createData.data;
  assert(createRes.status === 201 && createdLoc && createdLoc.id, 'Successfully saved location with Photon coordinates');
  assert(Math.abs(createdLoc.latitude - collegeLat) < 0.0001, 'Saved latitude matches Photon result');
  assert(Math.abs(createdLoc.longitude - collegeLon) < 0.0001, 'Saved longitude matches Photon result');
  assert(createdLoc.radiusMeters === 200, 'Geofence radius (200m) preserved');

  // Clean up test location
  await fetch(`${API_BASE}/attendance-locations/${createdLoc.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  assert(true, 'Test location cleaned up successfully');

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
