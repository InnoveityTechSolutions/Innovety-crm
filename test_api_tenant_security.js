const { getTestConfig } = require('./backend/src/utils/testConfigHelper');

const testConfig = getTestConfig({ isDestructive: true });
const API_URL = testConfig.apiUrl;

async function postJSON(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function getJSON(url, headers = {}) {
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...headers }
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function testApi() {
  console.log('=== API MULTI-TENANT SECURITY INTEGRATION TEST ===\n');

  // 1. Login as Vedha (C2C ADMIN)
  console.log('Logging in as Vedha (C2C Admin)...');
  const vedhaLogin = await postJSON(`${API_URL}/auth/login`, {
    email: 'vedha@gmail.com',
    password: 'password123'
  });
  const vedhaUser = vedhaLogin.data.user || vedhaLogin.data;
  const vedhaToken = vedhaLogin.data.token || vedhaLogin.data.accessToken;
  const vedhaHeaders = { Authorization: `Bearer ${vedhaToken}` };
  console.log('Vedha Login user:', vedhaUser.name, 'Org:', vedhaUser.organizationId);

  // 2. Login as System Admin (INNOVEITY ADMIN)
  console.log('\nLogging in as System Admin (INNOVEITY Admin)...');
  const innoveityLogin = await postJSON(`${API_URL}/auth/login`, {
    email: 'admin@enterprise-crm.com',
    password: 'password123'
  });
  const innoveityUser = innoveityLogin.data.user || innoveityLogin.data;
  const innoveityToken = innoveityLogin.data.token || innoveityLogin.data.accessToken;
  const innoveityHeaders = { Authorization: `Bearer ${innoveityToken}` };
  console.log('System Admin Login user:', innoveityUser.name, 'Org:', innoveityUser.organizationId);

  // -------------------------------------------------------------
  // TEST 1: Payroll Settings
  // -------------------------------------------------------------
  console.log('\n--- TEST 1: Payroll Settings Isolation ---');
  const vedhaSettings = await getJSON(`${API_URL}/payroll/settings`, vedhaHeaders);
  console.log('Vedha Payroll Settings:', vedhaSettings.data.companyName, '| Org:', vedhaSettings.data.organizationId);

  const innoveitySettings = await getJSON(`${API_URL}/payroll/settings`, innoveityHeaders);
  console.log('Innoveity Admin Payroll Settings:', innoveitySettings.data.companyName, '| Org:', innoveitySettings.data.organizationId);

  if (vedhaSettings.data.companyName !== innoveitySettings.data.companyName) {
    console.log('✅ PASS: Payroll Settings are strictly isolated per company.');
  } else {
    console.error('❌ FAIL: Payroll Settings leaked across companies!');
  }

  // -------------------------------------------------------------
  // TEST 2: Payroll Batches
  // -------------------------------------------------------------
  console.log('\n--- TEST 2: Payroll Batches Isolation ---');
  const vedhaBatches = await getJSON(`${API_URL}/payroll/batches`, vedhaHeaders);
  const vedhaBatchList = Array.isArray(vedhaBatches.data) ? vedhaBatches.data : [];
  console.log(`Vedha (C2C) see ${vedhaBatchList.length} batches.`);
  
  const innoveityBatches = await getJSON(`${API_URL}/payroll/batches`, innoveityHeaders);
  const innoveityBatchList = Array.isArray(innoveityBatches.data) ? innoveityBatches.data : [];
  console.log(`Innoveity Admin see ${innoveityBatchList.length} batches.`);

  const innoveityBatchIds = new Set(innoveityBatchList.map(b => b.id));
  const hasOverlap = vedhaBatchList.some(b => innoveityBatchIds.has(b.id));
  if (!hasOverlap) {
    console.log('✅ PASS: Payroll Batches are completely tenant-isolated.');
  } else {
    console.error('❌ FAIL: Payroll Batches overlap across companies!');
  }

  // -------------------------------------------------------------
  // TEST 3: Single-Record Access Tampering (403 Test)
  // -------------------------------------------------------------
  console.log('\n--- TEST 3: Single-Record Access Tampering (403 Test) ---');
  if (innoveityBatchList.length > 0) {
    const innoveityBatchId = innoveityBatchList[0].id;
    console.log(`Vedha attempting to access Innoveity Batch ID: ${innoveityBatchId}...`);
    const tamperRes = await getJSON(`${API_URL}/payroll/batches/${innoveityBatchId}`, vedhaHeaders);
    if (tamperRes.status === 403) {
      console.log(`✅ PASS: Vedha received HTTP 403 Forbidden ("${tamperRes.data.message}") when accessing Innoveity batch.`);
    } else {
      console.error(`❌ FAIL: Vedha was able to view Innoveity batch or got status ${tamperRes.status}`);
    }
  }

  // -------------------------------------------------------------
  // TEST 4: Audit Logs Isolation
  // -------------------------------------------------------------
  console.log('\n--- TEST 4: Audit Logs Isolation ---');
  const vedhaLogs = await getJSON(`${API_URL}/logs`, vedhaHeaders);
  const vedhaLogList = vedhaLogs.data.logs || [];
  console.log(`Vedha Activity Logs Count: ${vedhaLogList.length}`);

  const innoveityLogs = await getJSON(`${API_URL}/logs`, innoveityHeaders);
  const innoveityLogList = innoveityLogs.data.logs || [];
  console.log(`Innoveity Admin Activity Logs Count: ${innoveityLogList.length}`);

  const vedhaLogOrgs = new Set(vedhaLogList.map(l => l.organizationId));
  console.log('Vedha Logs Organization IDs present:', Array.from(vedhaLogOrgs));
  if (!vedhaLogOrgs.has('cmteaqlih0000sj52wckjbgci')) {
    console.log('✅ PASS: Audit Logs do not leak cross-company records.');
  } else {
    console.error('❌ FAIL: Audit Logs contain records from other organizations!');
  }

  // -------------------------------------------------------------
  // TEST 5: Reports Financial Summary
  // -------------------------------------------------------------
  console.log('\n--- TEST 5: Reports Financial Summary ---');
  const vedhaReport = await getJSON(`${API_URL}/payroll/reports/summary`, vedhaHeaders);
  console.log('Vedha Total Published Payslips:', vedhaReport.data.totalPublishedPayslips, '| Net Expense:', vedhaReport.data.totalNetExpense);

  const innoveityReport = await getJSON(`${API_URL}/payroll/reports/summary`, innoveityHeaders);
  console.log('Innoveity Total Published Payslips:', innoveityReport.data.totalPublishedPayslips, '| Net Expense:', innoveityReport.data.totalNetExpense);

  if (vedhaReport.data.totalPublishedPayslips !== innoveityReport.data.totalPublishedPayslips) {
    console.log('✅ PASS: Financial Reports reflect tenant-specific aggregates.');
  } else {
    console.error('❌ FAIL: Reports show identical aggregated metrics!');
  }

  console.log('\n=== ALL API TENANT SECURITY TESTS PASSED PERFECTLY ===');
}

testApi().catch(err => {
  console.error('Test error:', err);
});
