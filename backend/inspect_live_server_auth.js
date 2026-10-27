const https = require('https');

const LIVE_HOST = process.env.LIVE_SERVER_HOST || 'crm.innoveity.tech';
const LIVE_PORT = Number(process.env.LIVE_SERVER_PORT || 443);

function makeRequest(path, method = 'GET', postData = null) {
  return new Promise((resolve) => {
    const options = {
      hostname: LIVE_HOST,
      port: LIVE_PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(postData));
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', err => resolve({ error: err.message }));
    if (postData) req.write(JSON.stringify(postData));
    req.end();
  });
}

async function inspectLiveServerData() {
  console.log('=== INSPECTING LIVE PRODUCTION SERVER DATA (crm.innoveity.tech) ===\n');

  const health = await makeRequest('/api/health');
  console.log(`Health Check: ${health.status} -> ${health.body}`);

  const orgs = await makeRequest('/api/organizations');
  console.log(`Organizations: ${orgs.status} -> ${orgs.body}`);

  const settings = await makeRequest('/api/platform/settings');
  console.log(`Platform Settings: ${settings.status} -> ${settings.body}`);

  // Test login with Super Admin credentials
  const superAdminLogin = await makeRequest('/api/auth/login', 'POST', {
    email: 'superadmin@enterprise-crm.com',
    password: 'password123',
    organizationSlug: 'innoveity'
  });
  console.log(`Super Admin Login: ${superAdminLogin.status} -> ${superAdminLogin.body}`);

  // Test login with Admin credentials
  const adminLogin = await makeRequest('/api/auth/login', 'POST', {
    email: 'admin@enterprise-crm.com',
    password: 'password123',
    organizationSlug: 'innoveity'
  });
  console.log(`System Admin Login: ${adminLogin.status} -> ${adminLogin.body}`);
}

inspectLiveServerData();
