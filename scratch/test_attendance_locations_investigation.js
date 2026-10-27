const http = require('http');

async function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function run() {
  console.log('--- 1. Login as superadmin ---');
  const saLogin = await request('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { userId: 'superadmin@enterprise-crm.com', password: 'Admin123!' }
  });
  console.log('Superadmin Login status:', saLogin.status, 'user:', saLogin.body?.user?.role, 'org:', saLogin.body?.user?.organizationId);
  const saToken = saLogin.body?.token;

  console.log('\n--- 2. Login as admin ---');
  const adminLogin = await request('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { email: 'admin@enterprise-crm.com', password: 'password123' }
  });
  console.log('Admin Login status:', adminLogin.status, 'user:', adminLogin.body?.user?.role, 'org:', adminLogin.body?.user?.organizationId);
  const adminToken = adminLogin.body?.token;

  console.log('\n--- 3. Fetch existing attendance locations (SuperAdmin without query param) ---');
  const saLocations1 = await request('http://localhost:5000/api/attendance-locations', {
    headers: { Authorization: `Bearer ${saToken}` }
  });
  console.log('GET /attendance-locations status:', saLocations1.status, 'count:', saLocations1.body?.locations?.length);
  if (saLocations1.body?.locations?.length) {
    console.log('Existing locations:', saLocations1.body.locations.map(l => ({ id: l.id, name: l.name, radius: l.radiusMeters, org: l.organizationId })));
  }

  console.log('\n--- 4. Fetch existing attendance locations (SuperAdmin with organizationId=all) ---');
  const saLocationsAll = await request('http://localhost:5000/api/attendance-locations?organizationId=all', {
    headers: { Authorization: `Bearer ${saToken}` }
  });
  console.log('GET /attendance-locations?organizationId=all status:', saLocationsAll.status, 'count:', saLocationsAll.body?.locations?.length);

  console.log('\n--- 5. Test Add Attendance Location as SuperAdmin when organizationId is "all" ---');
  const addAllRes = await request('http://localhost:5000/api/attendance-locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${saToken}` },
    body: {
      name: 'Test All Org Location',
      address: 'Test Address',
      latitude: 12.920490,
      longitude: 80.121647,
      radiusMeters: 200,
      isActive: true,
      organizationId: 'all'
    }
  });
  console.log('POST with organizationId="all": status:', addAllRes.status, 'body:', addAllRes.body);

  console.log('\n--- 6. Test Add Attendance Location as SuperAdmin without organizationId in body ---');
  const addNoOrgRes = await request('http://localhost:5000/api/attendance-locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${saToken}` },
    body: {
      name: 'Test No Org Location',
      address: 'Test Address',
      latitude: 12.920490,
      longitude: 80.121647,
      radiusMeters: 200,
      isActive: true
    }
  });
  console.log('POST without organizationId: status:', addNoOrgRes.status, 'body:', addNoOrgRes.body);

  console.log('\n--- 7. Test Add Attendance Location as Admin ---');
  const addAdminRes = await request('http://localhost:5000/api/attendance-locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: {
      name: 'Test Admin Location',
      address: 'Test Address',
      latitude: 12.920490,
      longitude: 80.121647,
      radiusMeters: 250,
      isActive: true
    }
  });
  console.log('POST as Admin: status:', addAdminRes.status, 'body:', addAdminRes.body);

  let testLocId = addAdminRes.body?.location?.id;

  if (testLocId) {
    console.log('\n--- 8. Test Edit Attendance Location: change radius from 250 to 300 ---');
    const updateRes = await request(`http://localhost:5000/api/attendance-locations/${testLocId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: {
        name: 'Test Admin Location Updated',
        address: 'Test Address Updated',
        latitude: 12.920490,
        longitude: 80.121647,
        radiusMeters: 300,
        isActive: true,
        organizationId: adminLogin.body?.user?.organizationId
      }
    });
    console.log('PUT as Admin (250m -> 300m): status:', updateRes.status, 'body:', updateRes.body);

    // Clean up test location
    await request(`http://localhost:5000/api/attendance-locations/${testLocId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
  }
}

run().catch(console.error);
