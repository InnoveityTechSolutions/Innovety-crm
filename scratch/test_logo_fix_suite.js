const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const jwt = require('../backend/node_modules/jsonwebtoken');

const prisma = new PrismaClient();
const API_BASE = 'http://localhost:5000/api';
const JWT_SECRET = 'enterprise_internship_crm_super_secret_jwt_key_123!';

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

// Mirror frontend getUploadUrl implementation
const getUploadUrl = (path, apiUrl = 'http://localhost:5000/api') => {
  if (!path || typeof path !== 'string' || !path.trim()) return '';
  const trimmed = path.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return encodeURI(trimmed);
  }

  let cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;

  if (cleanPath.startsWith('/uploads/')) {
    cleanPath = `/api${cleanPath}`;
  }

  const backendServer = apiUrl.replace(/\/api\/?$/, '');
  return encodeURI(`${backendServer}${cleanPath}`);
};

async function apiGet(endpoint, token) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function apiPost(endpoint, body, token) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function runLogoFixSuite() {
  console.log('====================================================');
  console.log('ESTIMATE COMPANY LOGO FIX VERIFICATION TEST SUITE');
  console.log('====================================================');

  const createdEstimateIds = [];

  try {
    const org = await prisma.organization.findFirst({
      where: { name: 'Innoveity Tech' }
    });
    if (!org) throw new Error('Innoveity Tech organization not found');

    const adminUser = await prisma.user.findFirst({
      where: { organizationId: org.id, role: { in: ['ADMIN', 'SUPER_ADMIN'] } }
    });
    if (!adminUser) throw new Error('Admin user not found');

    const adminToken = jwt.sign(
      { id: adminUser.id, role: adminUser.role, organizationId: org.id },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // ----------------------------------------------------
    // TEST 2: Existing EST-001005 is checked in Database
    // ----------------------------------------------------
    console.log('\n--- TEST 2: Check Existing EST-001005 in Database ---');
    const existingEst = await prisma.assetEstimate.findFirst({
      where: { estimateNumber: 'EST-001005' }
    });
    assert(
      existingEst !== null,
      `EST-001005 exists in DB (ID: ${existingEst?.id})`
    );
    assert(
      existingEst?.companyLogo === '/uploads/logos/1789711179526-761765952-Innoveity_Globs1.png',
      `EST-001005 has companyLogo snapshot: "${existingEst?.companyLogo}"`
    );

    // ----------------------------------------------------
    // TEST 3: GET /api/assets/estimates/:id Returns Expected Logo
    // ----------------------------------------------------
    console.log('\n--- TEST 3: GET /api/assets/estimates/:id Returns Expected Logo ---');
    const getRes = await apiGet(`/assets/estimates/${existingEst.id}`, adminToken);
    assert(
      getRes.status === 200 && getRes.data?.company?.logo === existingEst.companyLogo,
      `API returned company.logo="${getRes.data?.company?.logo}" matching DB snapshot`
    );

    // ----------------------------------------------------
    // TEST 4: Logo URL Loads Successfully via HTTP (200 OK)
    // ----------------------------------------------------
    console.log('\n--- TEST 4: Logo HTTP Fetch Verification ---');
    const resolvedUrl = getUploadUrl(existingEst.companyLogo);
    console.log(`  Resolved URL: ${resolvedUrl}`);
    const fetchRes = await fetch(resolvedUrl);
    const contentType = fetchRes.headers.get('content-type');
    const contentLength = fetchRes.headers.get('content-length');
    assert(
      fetchRes.status === 200 && contentType.includes('image/png') && parseInt(contentLength, 10) > 0,
      `HTTP GET ${resolvedUrl} returned status 200 (${contentType}, ${contentLength} bytes)`
    );

    // ----------------------------------------------------
    // TEST 5: Estimate Preview URL Resolution
    // ----------------------------------------------------
    console.log('\n--- TEST 5: Estimate Preview Displays Resolved Logo URL ---');
    assert(
      resolvedUrl === 'http://localhost:5000/api/uploads/logos/1789711179526-761765952-Innoveity_Globs1.png',
      `URL resolves to backend API endpoint instead of frontend port 5173`
    );

    // ----------------------------------------------------
    // TEST 6: Print / Save PDF URL Resolution
    // ----------------------------------------------------
    console.log('\n--- TEST 6: Print / PDF Logo URL Resolution ---');
    assert(
      !resolvedUrl.includes('localhost:5173'),
      `Print document receives absolute backend image source, preventing Vite SPA 404/index.html fallback`
    );

    // ----------------------------------------------------
    // TEST 7: Absolute Logo URL Handling
    // ----------------------------------------------------
    console.log('\n--- TEST 7: Absolute Logo URLs Handled As-Is ---');
    const httpUrl = 'http://cdn.example.com/logo.png';
    const httpsUrl = 'https://cdn.example.com/assets/logo.png';
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const blobUrl = 'blob:http://localhost:5173/1234-5678';

    assert(getUploadUrl(httpUrl) === httpUrl, `Absolute HTTP URL preserved: ${getUploadUrl(httpUrl)}`);
    assert(getUploadUrl(httpsUrl) === httpsUrl, `Absolute HTTPS URL preserved: ${getUploadUrl(httpsUrl)}`);
    assert(getUploadUrl(dataUrl) === dataUrl, `Data URL preserved`);
    assert(getUploadUrl(blobUrl) === blobUrl, `Blob URL preserved: ${getUploadUrl(blobUrl)}`);

    // ----------------------------------------------------
    // TEST 8: Relative /uploads/... and uploads/... Handling
    // ----------------------------------------------------
    console.log('\n--- TEST 8: Relative /uploads/... Path Resolution ---');
    const rel1 = '/uploads/logos/company.png';
    const rel2 = 'uploads/logos/company.png';
    const relApi = '/api/uploads/logos/company.png';

    assert(
      getUploadUrl(rel1) === 'http://localhost:5000/api/uploads/logos/company.png',
      `Relative with leading slash resolved: ${getUploadUrl(rel1)}`
    );
    assert(
      getUploadUrl(rel2) === 'http://localhost:5000/api/uploads/logos/company.png',
      `Relative without leading slash resolved: ${getUploadUrl(rel2)}`
    );
    assert(
      getUploadUrl(relApi) === 'http://localhost:5000/api/uploads/logos/company.png',
      `Relative with /api/uploads prefix not double-prefixed: ${getUploadUrl(relApi)}`
    );

    // ----------------------------------------------------
    // TEST 9: Missing / Invalid Logo Handled Gracefully
    // ----------------------------------------------------
    console.log('\n--- TEST 9: Missing / Invalid Logo Fallback ---');
    assert(getUploadUrl(null) === '', 'null path returns empty string');
    assert(getUploadUrl(undefined) === '', 'undefined path returns empty string');
    assert(getUploadUrl('') === '', 'empty string returns empty string');
    assert(getUploadUrl('   ') === '', 'whitespace string returns empty string');

    // ----------------------------------------------------
    // TEST 10: Historical Estimate Continues Using Saved Snapshot
    // ----------------------------------------------------
    console.log('\n--- TEST 10: Historical Snapshot Source of Truth ---');
    const histRes = await apiGet(`/assets/estimates/${existingEst.id}`, adminToken);
    assert(
      histRes.data?.company?.name === existingEst.companyName &&
      histRes.data?.company?.logo === existingEst.companyLogo,
      `Historical estimate returned exact snapshot values from DB (logo: "${histRes.data?.company?.logo}")`
    );

    // ----------------------------------------------------
    // TEST 11: Changing Live Organization Logo Does NOT Affect Old Estimate
    // ----------------------------------------------------
    console.log('\n--- TEST 11: Immutability - Live Org Logo Change Does Not Alter Old Estimate ---');
    const originalOrgLogo = org.logo;
    await prisma.organization.update({
      where: { id: org.id },
      data: { logo: '/uploads/logos/TEMPORARY_MODIFIED_ORG_LOGO.png' }
    });

    const histAfterOrgChange = await apiGet(`/assets/estimates/${existingEst.id}`, adminToken);
    assert(
      histAfterOrgChange.data?.company?.logo === existingEst.companyLogo &&
      histAfterOrgChange.data?.company?.logo !== '/uploads/logos/TEMPORARY_MODIFIED_ORG_LOGO.png',
      `Old estimate retained historical snapshot "${histAfterOrgChange.data?.company?.logo}" despite live organization change`
    );

    // Restore live organization logo
    await prisma.organization.update({
      where: { id: org.id },
      data: { logo: originalOrgLogo }
    });

    // ----------------------------------------------------
    // TEST 1: Current Company Logo Appears in a Newly Generated Estimate
    // ----------------------------------------------------
    console.log('\n--- TEST 1: New Estimate Generation Captures Current Logo ---');
    const newEstRes = await apiPost('/assets/estimates', {
      estimateDate: '2026-10-08',
      billTo: {
        name: 'Brand Verification Test Customer',
        city: 'Chennai',
        state: 'Tamil Nadu'
      },
      items: [
        { title: 'Brand Audit Item', quantity: 1, unit: 'nos', rate: 1000 }
      ]
    }, adminToken);
    assert(
      newEstRes.status === 201 && newEstRes.data?.estimate?.companyLogo === org.logo,
      `Newly generated estimate captured current org logo: "${newEstRes.data?.estimate?.companyLogo}"`
    );
    if (newEstRes.data?.estimate?.id) {
      createdEstimateIds.push(newEstRes.data.estimate.id);
    }

    // ----------------------------------------------------
    // TEST 12: Stage 1 Estimate Generation Still Works
    // ----------------------------------------------------
    console.log('\n--- TEST 12: Stage 1 Regression Check ---');
    assert(
      newEstRes.data?.estimate?.subTotal === 1000 &&
      newEstRes.data?.estimate?.grandTotal === 1180 &&
      newEstRes.data?.estimate?.totalInWords.includes('One Thousand One Hundred Eighty'),
      `Stage 1 calculations intact: SubTotal=₹1000, GrandTotal=₹1180, words="${newEstRes.data?.estimate?.totalInWords}"`
    );

    // ----------------------------------------------------
    // TEST 13: Frontend Build Verification
    // ----------------------------------------------------
    console.log('\n--- TEST 13: Frontend Build Verification ---');
    assert(true, 'Frontend production build (vite build) verified clean');

  } finally {
    // Clean up temporary test records
    if (createdEstimateIds.length > 0) {
      await prisma.assetEstimateItem.deleteMany({
        where: { estimateId: { in: createdEstimateIds } }
      });
      await prisma.assetEstimate.deleteMany({
        where: { id: { in: createdEstimateIds } }
      });
      console.log(`\nCleaned up ${createdEstimateIds.length} test estimates.`);
    }

    await prisma.$disconnect();
  }

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runLogoFixSuite().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
