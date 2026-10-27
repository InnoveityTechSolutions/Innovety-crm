const axios = require('../backend/node_modules/axios');
const prisma = require('../backend/src/utils/db');

const API_BASE = 'http://localhost:5000/api';

async function runTests() {
  console.log('========================================================');
  console.log('STARTING COMPREHENSIVE ASSET CATEGORY VALIDATION SUITE');
  console.log('========================================================\n');

  // 1. DATABASE SCHEMA VERIFICATION
  console.log('--- TEST 1: Database Column Verification ---');
  const [colInfo] = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM asset LIKE 'category'");
  console.log('Column details:', colInfo);
  if (colInfo.Type.toLowerCase() !== 'varchar(64)') {
    throw new Error(`Expected varchar(64) but found ${colInfo.Type}`);
  }
  console.log('✔ Column type is correctly varchar(64).\n');

  // Baseline database count and assets
  const baselineCount = await prisma.asset.count();
  const baselineAssets = await prisma.asset.findMany();
  console.log(`Baseline database asset count: ${baselineCount}`);

  // 2. AUTHENTICATION
  console.log('--- TEST 2: Authentication ---');
  const loginRes = await axios.post(`${API_BASE}/auth/login`, {
    userId: 'admin@enterprise-crm.com',
    password: 'Admin123!'
  });
  const token = loginRes.data.token;
  const orgId = loginRes.data.user.organizationId || loginRes.data.user.organization?.id;
  const authHeaders = { Authorization: `Bearer ${token}` };
  console.log(`Logged in as: ${loginRes.data.user.email}, org: ${orgId}\n`);

  const createdAssetIds = [];

  try {
    // 3. PREDEFINED CATEGORY: LAPTOP
    console.log('--- TEST 3A: Predefined Category (LAPTOP) ---');
    const resA = await axios.post(
      `${API_BASE}/assets`,
      {
        name: 'Enterprise Precision Laptop',
        category: 'LAPTOP',
        quantity: 1,
        brand: 'Dell',
        model: '5560',
        status: 'AVAILABLE',
        organizationId: orgId
      },
      { headers: authHeaders }
    );
    console.log(`Status: ${resA.status}, Asset ID: ${resA.data.assetId}, Category: ${resA.data.category}`);
    if (resA.status !== 201 || resA.data.category !== 'LAPTOP') throw new Error('Test 3A failed');
    createdAssetIds.push(resA.data.id);
    console.log('✔ LAPTOP asset created successfully.\n');

    // 4. PREDEFINED CATEGORY: DESKTOP
    console.log('--- TEST 3B: Predefined Category (DESKTOP) ---');
    const resB = await axios.post(
      `${API_BASE}/assets`,
      {
        name: 'Workstation Desktop',
        category: 'DESKTOP',
        quantity: 1,
        brand: 'HP',
        model: 'Z4',
        status: 'AVAILABLE',
        organizationId: orgId
      },
      { headers: authHeaders }
    );
    console.log(`Status: ${resB.status}, Asset ID: ${resB.data.assetId}, Category: ${resB.data.category}`);
    if (resB.status !== 201 || resB.data.category !== 'DESKTOP') throw new Error('Test 3B failed');
    createdAssetIds.push(resB.data.id);
    console.log('✔ DESKTOP asset created successfully.\n');

    // 5. CUSTOM CATEGORY: CAMERA
    console.log('--- TEST 3C: Custom Category (CAMERA) ---');
    const resC = await axios.post(
      `${API_BASE}/assets`,
      {
        name: 'Sony 4K Studio Camera',
        category: 'CAMERA',
        quantity: 1,
        brand: 'Sony',
        model: 'FX3',
        status: 'AVAILABLE',
        organizationId: orgId
      },
      { headers: authHeaders }
    );
    console.log(`Status: ${resC.status}, Asset ID: ${resC.data.assetId}, Category: ${resC.data.category}`);
    if (resC.status !== 201 || resC.data.category !== 'CAMERA') throw new Error('Test 3C failed');
    createdAssetIds.push(resC.data.id);
    console.log('✔ Custom category CAMERA asset created successfully.\n');

    // 6. CUSTOM CATEGORY: CCTV
    console.log('--- TEST 3D: Custom Category (CCTV) ---');
    const resD = await axios.post(
      `${API_BASE}/assets`,
      {
        name: 'Hikvision Dome Security Unit',
        category: 'CCTV',
        quantity: 1,
        brand: 'Hikvision',
        model: 'DS-2CD',
        status: 'AVAILABLE',
        organizationId: orgId
      },
      { headers: authHeaders }
    );
    console.log(`Status: ${resD.status}, Asset ID: ${resD.data.assetId}, Category: ${resD.data.category}`);
    if (resD.status !== 201 || resD.data.category !== 'CCTV') throw new Error('Test 3D failed');
    createdAssetIds.push(resD.data.id);
    console.log('✔ Custom category CCTV asset created successfully.\n');

    // 7. CATEGORY LIST PERSISTENCE / PAGE REFRESH SIMULATION
    console.log('--- TEST 3E: Category List Persistence Across Refresh ---');
    const listRes = await axios.get(`${API_BASE}/assets`, {
      params: { organizationId: orgId },
      headers: authHeaders
    });
    console.log('Categories returned in getAllAssets API:', listRes.data.categories);
    if (!listRes.data.categories.includes('CAMERA') || !listRes.data.categories.includes('CCTV')) {
      throw new Error('Custom categories missing from API response categories list');
    }
    console.log('✔ Custom categories CAMERA and CCTV are present in categories list from DB.\n');

    // 8. ASSET EDIT: CAMERA -> CCTV
    console.log('--- TEST 3F: Edit Asset Category (CAMERA -> CCTV) ---');
    const editRes = await axios.put(
      `${API_BASE}/assets/${resC.data.id}`,
      {
        category: 'CCTV'
      },
      { headers: authHeaders }
    );
    console.log(`Edit Response Category: ${editRes.data.category}`);
    if (editRes.data.category !== 'CCTV') throw new Error('Test 3F edit failed');
    console.log('✔ Asset category edited from CAMERA to CCTV successfully.\n');

    // 9. CATEGORY FILTER
    console.log('--- TEST 3G: Filter by Category ---');
    const filterCctvRes = await axios.get(`${API_BASE}/assets`, {
      params: { category: 'CCTV', organizationId: orgId },
      headers: authHeaders
    });
    console.log(`CCTV Filter matched ${filterCctvRes.data.assets.length} assets.`);
    for (const a of filterCctvRes.data.assets) {
      if (a.category !== 'CCTV') throw new Error(`Filter returned unexpected category: ${a.category}`);
    }
    console.log('✔ Category filter for CCTV matched correctly.\n');

    // 10. CSV EXPORT VERIFICATION
    console.log('--- TEST 3H: Asset Report / CSV Export Verification ---');
    const csvRes = await axios.get(`${API_BASE}/reports/assets?format=csv`, {
      headers: authHeaders
    });
    console.log('CSV header preview:\n' + csvRes.data.split('\n').slice(0, 4).join('\n'));
    if (!csvRes.data.includes('CCTV') || !csvRes.data.includes('LAPTOP')) {
      throw new Error('CSV does not contain expected category strings');
    }
    console.log('✔ CSV Export correctly includes custom category CCTV and predefined LAPTOP.\n');

  } finally {
    // CLEANUP
    console.log('--- CLEANUP: Removing Test Assets ---');
    for (const id of createdAssetIds) {
      try {
        await axios.delete(`${API_BASE}/assets/${id}`, { headers: authHeaders });
      } catch (err) {
        console.error(`Failed to delete test asset ${id}:`, err.message);
      }
    }
    const finalCount = await prisma.asset.count();
    console.log(`Final database asset count after cleanup: ${finalCount}`);
    if (finalCount !== baselineCount) {
      console.warn(`Warning: Final count (${finalCount}) differs from baseline (${baselineCount})`);
    } else {
      console.log('✔ Final database row count matches baseline perfectly.');
    }
  }

  console.log('\n========================================================');
  console.log('ALL TESTS PASSED SUCCESSFULLY! 🚀');
  console.log('========================================================');
}

runTests()
  .catch(err => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
