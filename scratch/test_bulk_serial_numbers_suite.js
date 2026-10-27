const axios = require('../backend/node_modules/axios');
const prisma = require('../backend/src/utils/db');

const API_BASE = 'http://localhost:5000/api';

async function runTestSuite() {
  console.log('================================================================');
  console.log('STARTING DYNAMIC SERIAL NUMBER BULK CREATION VALIDATION SUITE');
  console.log('================================================================\n');

  // Baseline inspection
  const baselineAssetCount = await prisma.asset.count();
  const baselineOrgCount = await prisma.organization.count();
  console.log(`Initial baseline: ${baselineAssetCount} assets, ${baselineOrgCount} organizations.\n`);

  // 1. Authenticate as Super Admin
  console.log('--- Step 1: Super Admin Authentication ---');
  const loginRes = await axios.post(`${API_BASE}/auth/login`, {
    userId: 'superadmin@enterprise-crm.com',
    password: 'Admin123!'
  });
  const token = loginRes.data.token;
  const authHeaders = { Authorization: `Bearer ${token}` };
  console.log(`✔ Authenticated successfully as: ${loginRes.data.user.email}\n`);

  const createdOrgIds = [];
  const createdAssetIds = [];

  try {
    // 2. Setup Test Organization: "MRF Innovation"
    console.log('--- Step 2: Setup Test Organization "MRF Innovation" ---');
    const org = await prisma.organization.create({
      data: {
        name: 'MRF Innovation Bulk Test',
        slug: 'mrf-innovation-bulk-test',
        companyCode: 'MRFIBT'
      }
    });
    createdOrgIds.push(org.id);
    console.log(`✔ Test Organization created: ID=${org.id}, Name=${org.name}\n`);

    // TEST A: Quantity = 1
    console.log('--- TEST A: Quantity = 1 (Single Asset with Serial Number) ---');
    const resA = await axios.post(`${API_BASE}/assets`, {
      name: 'Single Asset Test',
      category: 'LAPTOP',
      quantity: 1,
      serialNumber: 'SN-SINGLE-001',
      brand: 'Apple',
      model: 'MacBook Pro',
      organizationId: org.id
    }, { headers: authHeaders });

    if (!resA.data.id || resA.data.serialNumber !== 'SN-SINGLE-001') {
      throw new Error(`Test A failed: Expected single asset with SN-SINGLE-001, got ${JSON.stringify(resA.data)}`);
    }
    createdAssetIds.push(resA.data.id);
    console.log(`✔ Test A passed: Created 1 asset (${resA.data.assetId}) with SN: ${resA.data.serialNumber}\n`);

    // TEST B: Quantity = 2
    console.log('--- TEST B: Quantity = 2 (Two unique serial numbers) ---');
    const resB = await axios.post(`${API_BASE}/assets`, {
      name: 'Dual Monitor Setup',
      category: 'MONITOR',
      quantity: 2,
      serialNumbers: ['SN-MON-001', 'SN-MON-002'],
      brand: 'Dell',
      model: 'U2723QE',
      organizationId: org.id
    }, { headers: authHeaders });

    if (resB.data.created !== 2 || resB.data.assets?.length !== 2) {
      throw new Error(`Test B failed: Expected 2 assets created, got ${JSON.stringify(resB.data)}`);
    }
    const [b1, b2] = resB.data.assets;
    createdAssetIds.push(b1.id, b2.id);
    if (b1.assetId === b2.assetId) {
      throw new Error(`Test B failed: Both assets have identical Asset ID ${b1.assetId}`);
    }
    if (b1.serialNumber !== 'SN-MON-001' || b2.serialNumber !== 'SN-MON-002') {
      throw new Error(`Test B failed: Serial numbers not mapped correctly (${b1.serialNumber}, ${b2.serialNumber})`);
    }
    console.log(`✔ Test B passed: Created 2 assets with distinct IDs (${b1.assetId}, ${b2.assetId}) and SNs (${b1.serialNumber}, ${b2.serialNumber})\n`);

    // TEST C & H: Quantity = 3 with Sequential Asset IDs
    console.log('--- TEST C & H: Quantity = 3 (Three unique serial numbers & Consecutive IDs) ---');
    const resC = await axios.post(`${API_BASE}/assets`, {
      name: 'Office Keyboard Bulk',
      category: 'KEYBOARD',
      quantity: 3,
      serialNumbers: ['SN-KEY-101', 'SN-KEY-102', 'SN-KEY-103'],
      brand: 'Keychron',
      model: 'K2 V2',
      cost: 8500,
      organizationId: org.id
    }, { headers: authHeaders });

    if (resC.data.created !== 3 || resC.data.assets?.length !== 3) {
      throw new Error(`Test C failed: Expected 3 assets created, got ${JSON.stringify(resC.data)}`);
    }
    const cAssets = resC.data.assets;
    cAssets.forEach(a => createdAssetIds.push(a.id));

    // Verify sequential Asset IDs (e.g. MRFIBT-1004, MRFIBT-1005, MRFIBT-1006)
    const idNums = cAssets.map(a => {
      const match = a.assetId.match(/-(\d+)$/);
      return match ? parseInt(match[1], 10) : null;
    });
    console.log(`Generated Asset IDs: ${cAssets.map(a => a.assetId).join(', ')}`);
    console.log(`Asset ID Sequences: ${idNums.join(', ')}`);
    if (idNums[1] !== idNums[0] + 1 || idNums[2] !== idNums[1] + 1) {
      throw new Error(`Test H failed: Asset IDs are not consecutive! IDs: ${cAssets.map(a => a.assetId)}`);
    }
    // Verify serial numbers mapping
    if (cAssets[0].serialNumber !== 'SN-KEY-101' || cAssets[1].serialNumber !== 'SN-KEY-102' || cAssets[2].serialNumber !== 'SN-KEY-103') {
      throw new Error(`Test C failed: Serial numbers not assigned in order.`);
    }
    console.log('✔ Test C & H passed: 3 assets created with consecutive IDs and mapped serial numbers.\n');

    // TEST D: Empty Serial Number
    console.log('--- TEST D: Empty serial number in bulk submission (Blocked) ---');
    let testDBlocked = false;
    try {
      await axios.post(`${API_BASE}/assets`, {
        name: 'Empty SN Test',
        category: 'MOUSE',
        quantity: 3,
        serialNumbers: ['SN-M-01', '   ', 'SN-M-03'],
        organizationId: org.id
      }, { headers: authHeaders });
    } catch (err) {
      if (err.response && err.response.status === 400 && err.response.data.message.includes('Serial number 2 is required')) {
        testDBlocked = true;
        console.log(`✔ Correctly blocked with HTTP 400: "${err.response.data.message}"`);
      } else {
        throw new Error(`Unexpected error on Test D: ${err.response?.data?.message || err.message}`);
      }
    }
    if (!testDBlocked) throw new Error('Test D failed: Creation was not blocked for empty serial number!');
    console.log('✔ Test D passed.\n');

    // TEST E: Duplicate serial numbers in same request
    console.log('--- TEST E: Duplicate serial numbers in same request (Blocked) ---');
    let testEBlocked = false;
    try {
      await axios.post(`${API_BASE}/assets`, {
        name: 'Duplicate SN Request',
        category: 'HEADSET',
        quantity: 3,
        serialNumbers: ['SN-DUPL-01', 'SN-DUPL-02', 'SN-DUPL-01'],
        organizationId: org.id
      }, { headers: authHeaders });
    } catch (err) {
      if (err.response && err.response.status === 400 && err.response.data.message.includes('unique within the submission')) {
        testEBlocked = true;
        console.log(`✔ Correctly blocked with HTTP 400: "${err.response.data.message}"`);
      } else {
        throw new Error(`Unexpected error on Test E: ${err.response?.data?.message || err.message}`);
      }
    }
    if (!testEBlocked) throw new Error('Test E failed: Creation was not blocked for duplicates in same request!');
    console.log('✔ Test E passed.\n');

    // TEST F: Duplicate serial number already in database
    console.log('--- TEST F: Duplicate serial number already in database (Blocked) ---');
    let testFBlocked = false;
    try {
      await axios.post(`${API_BASE}/assets`, {
        name: 'Existing SN Request',
        category: 'LAPTOP',
        quantity: 2,
        serialNumbers: ['SN-SINGLE-001', 'SN-NEW-999'], // SN-SINGLE-001 already created in Test A
        organizationId: org.id
      }, { headers: authHeaders });
    } catch (err) {
      if (err.response && err.response.status === 400 && err.response.data.message.includes('already exists')) {
        testFBlocked = true;
        console.log(`✔ Correctly blocked with HTTP 400: "${err.response.data.message}"`);
      } else {
        throw new Error(`Unexpected error on Test F: ${err.response?.data?.message || err.message}`);
      }
    }
    if (!testFBlocked) throw new Error('Test F failed: Creation was not blocked for duplicate existing serial number!');
    console.log('✔ Test F passed.\n');

    // TEST G: Quantity change preservation logic simulation
    console.log('--- TEST G: Quantity change preservation logic simulation ---');
    function simulateQtyChange(prevSerials, newQty) {
      const next = [...prevSerials];
      if (newQty === 1) return [next[0] || ''];
      while (next.length < newQty) next.push('');
      return next.slice(0, newQty);
    }
    let serials = ['SN001', 'SN002', 'SN003']; // Qty = 3
    serials = simulateQtyChange(serials, 2); // Change to 2
    if (serials.length !== 2 || serials[0] !== 'SN001' || serials[1] !== 'SN002') {
      throw new Error(`Test G step 1 failed: Expected ['SN001', 'SN002'], got ${JSON.stringify(serials)}`);
    }
    serials = simulateQtyChange(serials, 3); // Change back to 3
    if (serials.length !== 3 || serials[0] !== 'SN001' || serials[1] !== 'SN002' || serials[2] !== '') {
      throw new Error(`Test G step 2 failed: Expected ['SN001', 'SN002', ''], got ${JSON.stringify(serials)}`);
    }
    serials[2] = 'SN003_NEW';
    serials = simulateQtyChange(serials, 5); // Change to 5
    if (serials.length !== 5 || serials[0] !== 'SN001' || serials[1] !== 'SN002' || serials[2] !== 'SN003_NEW') {
      throw new Error(`Test G step 3 failed: Values not preserved when expanding to 5`);
    }
    console.log('✔ Test G passed: Dynamic quantity adjustment preserves existing values in both shrink and expand.\n');

    // TEST I: Transaction safety (Atomic rollback)
    console.log('--- TEST I: Transaction Safety & Atomic Rollback ---');
    const assetCountBeforeI = await prisma.asset.count();
    let testIBlocked = false;
    try {
      // Provide 3 serial numbers where the 3rd collides with SN-MON-001
      await axios.post(`${API_BASE}/assets`, {
        name: 'Transaction Rollback Test',
        category: 'PRINTER',
        quantity: 3,
        serialNumbers: ['SN-ROLL-1', 'SN-ROLL-2', 'SN-MON-001'],
        organizationId: org.id
      }, { headers: authHeaders });
    } catch (err) {
      if (err.response && err.response.status === 400) {
        testIBlocked = true;
        console.log(`✔ Request rejected with message: "${err.response.data.message}"`);
      }
    }
    if (!testIBlocked) throw new Error('Test I failed: Request was not rejected.');
    const assetCountAfterI = await prisma.asset.count();
    if (assetCountBeforeI !== assetCountAfterI) {
      throw new Error(`Test I failed: Partial assets created! Count before: ${assetCountBeforeI}, after: ${assetCountAfterI}`);
    }
    // Verify none of the non-colliding serial numbers were persisted
    const ghostAsset = await prisma.asset.findFirst({ where: { serialNumber: 'SN-ROLL-1' } });
    if (ghostAsset) {
      throw new Error('Test I failed: SN-ROLL-1 was created despite transaction failure!');
    }
    console.log('✔ Test I passed: Zero partial assets created. Rollback and pre-check guarantees atomic safety.\n');

    // TEST J: Existing Functionality (Custom Category CAMERA/CCTV, Edit, Filter, Export)
    console.log('--- TEST J: Existing Functionality Retention ---');
    // J1: Custom category with bulk creation
    console.log('J1: Bulk creation with custom category "CAMERA"');
    const resJ1 = await axios.post(`${API_BASE}/assets`, {
      name: 'Security Camera 4K',
      category: 'CAMERA',
      quantity: 2,
      serialNumbers: ['SN-CAM-001', 'SN-CAM-002'],
      brand: 'Hikvision',
      model: 'DS-2CD2386G2',
      organizationId: org.id
    }, { headers: authHeaders });
    if (resJ1.data.created !== 2 || resJ1.data.assets[0].category !== 'CAMERA') {
      throw new Error(`Test J1 failed: Custom category CAMERA not preserved.`);
    }
    const [cam1, cam2] = resJ1.data.assets;
    createdAssetIds.push(cam1.id, cam2.id);
    console.log(`✔ J1 passed: Custom category CAMERA created 2 assets (${cam1.assetId}, ${cam2.assetId})`);

    // J2: Edit Asset
    console.log('J2: Edit an existing asset details');
    const updateRes = await axios.put(`${API_BASE}/assets/${cam1.id}`, {
      name: 'Security Camera 4K Pro Updated',
      category: 'CAMERA',
      serialNumber: 'SN-CAM-001-EDITED',
      cost: 12500
    }, { headers: authHeaders });
    if (updateRes.data.name !== 'Security Camera 4K Pro Updated' || updateRes.data.serialNumber !== 'SN-CAM-001-EDITED') {
      throw new Error(`Test J2 failed: Asset update not reflected.`);
    }
    console.log(`✔ J2 passed: Asset updated successfully.`);

    // J3: Filter assets by category CAMERA
    console.log('J3: Filter assets by category');
    const filterRes = await axios.get(`${API_BASE}/assets`, {
      params: { category: 'CAMERA', organizationId: org.id },
      headers: authHeaders
    });
    if (filterRes.data.assets.length !== 2) {
      throw new Error(`Test J3 failed: Expected 2 CAMERA assets, got ${filterRes.data.assets.length}`);
    }
    console.log(`✔ J3 passed: Filtering by category CAMERA works correctly.`);

    // J4: CSV Export
    console.log('J4: CSV Export validation');
    const csvRes = await axios.get(`${API_BASE}/reports/assets?format=csv`, {
      params: { organizationId: org.id },
      headers: authHeaders
    });
    if (!csvRes.data.includes('SN-CAM-001-EDITED') || !csvRes.data.includes('SN-CAM-002') || !csvRes.data.includes('CAMERA')) {
      throw new Error(`Test J4 failed: CSV Export does not contain serial numbers or custom category.`);
    }
    console.log(`✔ J4 passed: CSV Export correctly contains serial numbers and custom categories.\n`);

  } finally {
    console.log('--- CLEANUP: Removing Test Records ---');
    for (const id of createdAssetIds) {
      try {
        await prisma.asset.delete({ where: { id } }).catch(() => {});
      } catch (err) {}
    }
    for (const id of createdOrgIds) {
      try {
        await prisma.organization.delete({ where: { id } }).catch(() => {});
      } catch (err) {}
    }
    const finalAssetCount = await prisma.asset.count();
    const finalOrgCount = await prisma.organization.count();
    console.log(`Final state: ${finalAssetCount} assets, ${finalOrgCount} organizations.`);
    if (finalAssetCount === baselineAssetCount && finalOrgCount === baselineOrgCount) {
      console.log('✔ All test records cleaned up. Database returned to exact baseline.');
    }
  }

  console.log('\n================================================================');
  console.log('ALL TEST CASES (A THROUGH J) COMPLETED SUCCESSFULLY! 🎉');
  console.log('================================================================');
}

runTestSuite()
  .catch((err) => {
    console.error('Validation Suite Failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
