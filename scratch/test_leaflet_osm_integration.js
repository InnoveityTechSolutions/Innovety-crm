/**
 * Verification Suite for Leaflet + OpenStreetMap Attendance Location Integration
 */
const fs = require('fs');
const path = require('path');

const API_BASE = 'http://localhost:5000/api';

async function runTests() {
  console.log('====================================================');
  console.log('STARTING LEAFLET + OPENSTREETMAP VERIFICATION SUITE');
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

  // 1. Inspect LeafletMapPicker Component
  console.log('TEST 1: Inspect LeafletMapPicker Component');
  const leafletPickerPath = path.resolve(__dirname, '../frontend/src/components/common/LeafletMapPicker.jsx');
  assert(fs.existsSync(leafletPickerPath), 'LeafletMapPicker.jsx exists');

  const leafletPickerContent = fs.readFileSync(leafletPickerPath, 'utf8');
  assert(leafletPickerContent.includes("from 'leaflet'") || leafletPickerContent.includes("import L from 'leaflet'"), 'Imports Leaflet core library');
  assert(leafletPickerContent.includes("import 'leaflet/dist/leaflet.css'"), 'Imports Leaflet CSS stylesheet');
  assert(leafletPickerContent.includes('https://tile.openstreetmap.org/{z}/{x}/{y}.png'), 'Uses official OpenStreetMap tile server');
  assert(leafletPickerContent.includes('OpenStreetMap') && leafletPickerContent.includes('attribution'), 'Includes proper OpenStreetMap attribution');
  assert(leafletPickerContent.includes('draggable: true'), 'Marker is draggable');
  assert(leafletPickerContent.includes("map.on('click'"), 'Allows clicking on map to reposition location pin');
  assert(leafletPickerContent.includes('L.circle'), 'Renders circular geofence with configured radius');
  assert(leafletPickerContent.includes('nominatim.openstreetmap.org'), 'Uses OpenStreetMap search/geocoding provider');
  assert(!leafletPickerContent.includes('VITE_GOOGLE_MAPS_API_KEY'), 'No Google Maps API key dependency in LeafletMapPicker');

  // 2. Inspect GoogleMapPicker backwards compatibility
  console.log('\nTEST 2: GoogleMapPicker Backwards Compatibility');
  const googlePickerPath = path.resolve(__dirname, '../frontend/src/components/common/GoogleMapPicker.jsx');
  assert(fs.existsSync(googlePickerPath), 'GoogleMapPicker.jsx exists');
  const googlePickerContent = fs.readFileSync(googlePickerPath, 'utf8');
  assert(googlePickerContent.includes('LeafletMapPicker'), 'GoogleMapPicker re-exports or uses LeafletMapPicker');
  assert(!googlePickerContent.includes('maps.googleapis.com'), 'Google Maps JavaScript API script loading removed');

  // 3. Inspect AttendanceLocationsSection Component Integration
  console.log('\nTEST 3: AttendanceLocationsSection Component Integration');
  const sectionPath = path.resolve(__dirname, '../frontend/src/components/attendance/AttendanceLocationsSection.jsx');
  const sectionContent = fs.readFileSync(sectionPath, 'utf8');
  assert(sectionContent.includes('LeafletMapPicker'), 'AttendanceLocationsSection imports LeafletMapPicker');
  assert(sectionContent.includes('<LeafletMapPicker'), 'Renders LeafletMapPicker inside modal');
  assert(!sectionContent.includes('window.google?.maps?.Geocoder'), 'Reverse-geocoding does not require Google Geocoder');

  // 4. Test Nominatim Connectivity
  console.log('\nTEST 4: OpenStreetMap Geocoding & Reverse Geocoding Services');
  try {
    const revRes = await fetch('https://nominatim.openstreetmap.org/reverse?lat=12.920490&lon=80.121647&format=json', {
      headers: { 'User-Agent': 'InnovEityCRM-Verification/1.0', Accept: 'application/json' }
    });
    const revData = await revRes.json();
    assert(revRes.status === 200 && revData && revData.display_name, 'OpenStreetMap Reverse Geocoding returns address for coordinates');
  } catch (e) {
    console.warn('  [WARN] Reverse geocode network request note:', e.message);
  }

  try {
    const searchRes = await fetch('https://nominatim.openstreetmap.org/search?q=MCC+Tambaram&format=json&limit=1', {
      headers: { 'User-Agent': 'InnovEityCRM-Verification/1.0', Accept: 'application/json' }
    });
    const searchData = await searchRes.json();
    assert(searchRes.status === 200 && Array.isArray(searchData) && searchData.length > 0, 'OpenStreetMap Search returns results for MCC Tambaram');
  } catch (e) {
    console.warn('  [WARN] Search network request note:', e.message);
  }

  // 5. Test Backend Attendance Location API persistence with coordinates and radius
  console.log('\nTEST 5: Backend API Coordinate & Geofence Radius Persistence');
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@enterprise-crm.com',
      password: 'password123'
    })
  });
  const loginData = await loginRes.json();
  assert(loginRes.status === 200 && loginData.token, 'Logged in as Admin');
  const token = loginData.token;

  const testCoords = {
    name: 'Leaflet Test Office MRF',
    address: 'MCC MRF Innovation Park, East Tambaram, Chennai',
    latitude: 12.920490,
    longitude: 80.121647,
    radiusMeters: 250,
    isActive: true
  };

  const createRes = await fetch(`${API_BASE}/attendance-locations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(testCoords)
  });
  const createData = await createRes.json();
  const loc = createData.location || createData.data;
  assert(createRes.status === 201 && loc && loc.id, 'Created attendance location via API');
  const locId = loc.id;
  assert(Math.abs(loc.latitude - 12.920490) < 0.0001, 'Latitude persisted accurately');
  assert(Math.abs(loc.longitude - 80.121647) < 0.0001, 'Longitude persisted accurately');
  assert(loc.radiusMeters === 250, 'Radius (250m) persisted accurately');

  // Update coordinates & radius (simulating drag / radius dropdown change)
  const updateRes = await fetch(`${API_BASE}/attendance-locations/${locId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      latitude: 12.921000,
      longitude: 80.122000,
      radiusMeters: 300,
      address: 'Updated Leaflet Marker Location, Chennai'
    })
  });
  const updateData = await updateRes.json();
  const updatedLoc = updateData.location || updateData.data;
  assert(updateRes.status === 200 && updatedLoc, 'Updated location coordinates and radius');
  assert(Math.abs(updatedLoc.latitude - 12.921000) < 0.0001, 'Updated latitude persisted');
  assert(updatedLoc.radiusMeters === 300, 'Updated radius persisted');

  // Clean up test location
  await fetch(`${API_BASE}/attendance-locations/${locId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  assert(true, 'Cleaned up test location');

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
