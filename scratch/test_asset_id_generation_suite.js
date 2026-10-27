const axios = require('../backend/node_modules/axios');
const prisma = require('../backend/src/utils/db');

const API_BASE = 'http://localhost:5000/api';

async function runTestSuite() {
  console.log('================================================================');
  console.log('STARTING ASSET ID ENHANCEMENT COMPREHENSIVE VALIDATION SUITE');
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
    // 2. Setup Test Organizations: "MRF Innovation" and "MRF Corporation"
    console.log('--- Step 2: Create Test Organization "MRF Innovation" ---');
    const orgA = await prisma.organization.create({
      data: {
        name: 'MRF Innovation',
        slug: 'mrf-innovation-test',
        companyCode: 'MRFI01'
      }
    });
    createdOrgIds.push(orgA.id);

    console.log('--- Step 3: Create Test Organization "MRF Corporation" ---');
    const orgB = await prisma.organization.create({
      data: {
        name: 'MRF Corporation',
        slug: 'mrf-corporation-test',
        companyCode: 'MRFC01'
      }
    });
    createdOrgIds.push(orgB.id);

    // TEST 1 & 2: Assets for MRF Innovation -> MRFI-1001, MRFI-1002
    console.log('--- TEST 1: Create Asset 1 for MRF Innovation ---');
    const resA1 = await axios.post(`${API_BASE}/assets`, {
      name: 'MacBook Pro M3',
      category: 'LAPTOP',
      quantity: 1,
      organizationId: orgA.id
    }, { headers: authHeaders });
    console.log(`Asset 1 created: ID=${resA1.data.assetId}, Name=${resA1.data.name}`);
    createdAssetIds.push(resA1.data.id);
    if (resA1.data.assetId !== 'MRFI-1001') {
      throw new Error(`Expected MRFI-1001, got ${resA1.data.assetId}`);
    }
    console.log('✔ Correctly generated MRFI-1001\n');

    console.log('--- TEST 2: Create Asset 2 for MRF Innovation ---');
    const resA2 = await axios.post(`${API_BASE}/assets`, {
      name: 'Dell UltraSharp Monitor',
      category: 'MONITOR',
      quantity: 1,
      organizationId: orgA.id
    }, { headers: authHeaders });
    console.log(`Asset 2 created: ID=${resA2.data.assetId}, Name=${resA2.data.name}`);
    createdAssetIds.push(resA2.data.id);
    if (resA2.data.assetId !== 'MRFI-1002') {
      throw new Error(`Expected MRFI-1002, got ${resA2.data.assetId}`);
    }
    console.log('✔ Correctly generated MRFI-1002\n');

    // TEST 3 & 4: Assets for MRF Corporation -> MRFC-1001, MRFC-1002
    console.log('--- TEST 3: Create Asset 1 for MRF Corporation ---');
    const resB1 = await axios.post(`${API_BASE}/assets`, {
      name: 'ThinkPad X1 Carbon',
      category: 'LAPTOP',
      quantity: 1,
      organizationId: orgB.id
    }, { headers: authHeaders });
    console.log(`Asset 1 created: ID=${resB1.data.assetId}, Name=${resB1.data.name}`);
    createdAssetIds.push(resB1.data.id);
    if (resB1.data.assetId !== 'MRFC-1001') {
      throw new Error(`Expected MRFC-1001, got ${resB1.data.assetId}`);
    }
    console.log('✔ Correctly generated MRFC-1001\n');

    console.log('--- TEST 4: Create Asset 2 for MRF Corporation ---');
    const resB2 = await axios.post(`${API_BASE}/assets`, {
      name: 'HP EliteDesk',
      category: 'DESKTOP',
      quantity: 1,
      organizationId: orgB.id
    }, { headers: authHeaders });
    console.log(`Asset 2 created: ID=${resB2.data.assetId}, Name=${resB2.data.name}`);
    createdAssetIds.push(resB2.data.id);
    if (resB2.data.assetId !== 'MRFC-1002') {
      throw new Error(`Expected MRFC-1002, got ${resB2.data.assetId}`);
    }
    console.log('✔ Correctly generated MRFC-1002\n');

    // TEST 5: Verify MRFI and MRFC Never Collide
    console.log('--- TEST 5: Verify Distinct Prefixes & Non-Collision ---');
    const orgARefresh = await prisma.organization.findUnique({ where: { id: orgA.id } });
    const orgBRefresh = await prisma.organization.findUnique({ where: { id: orgB.id } });
    console.log(`Org A prefix: ${orgARefresh.assetPrefix}, Org B prefix: ${orgBRefresh.assetPrefix}`);
    if (orgARefresh.assetPrefix === orgBRefresh.assetPrefix) {
      throw new Error('Collision detected between Org A and Org B!');
    }
    console.log('✔ MRFI and MRFC are distinct and non-colliding.\n');

    // TEST 6: Similar Name Collision Handling ("MRF Infrastructure")
    console.log('--- TEST 6: Test Collision Handling for "MRF Infrastructure" ---');
    const orgC = await prisma.organization.create({
      data: {
        name: 'MRF Infrastructure',
        slug: 'mrf-infra-test',
        companyCode: 'MRFIN01'
      }
    });
    createdOrgIds.push(orgC.id);

    const resC1 = await axios.post(`${API_BASE}/assets`, {
      name: 'Cisco Core Switch',
      category: 'NETWORK',
      quantity: 1,
      organizationId: orgC.id
    }, { headers: authHeaders });
    console.log(`Asset C1 created: ID=${resC1.data.assetId}`);
    createdAssetIds.push(resC1.data.id);
    if (!resC1.data.assetId.startsWith('MRFIN-')) {
      throw new Error(`Expected MRFIN-1001, got ${resC1.data.assetId}`);
    }
    console.log(`✔ Collision resolved deterministically to ${resC1.data.assetId}\n`);

    // TEST 7: Rename an organization and verify existing Asset IDs remain unchanged
    console.log('--- TEST 7: Rename Organization and Verify Asset IDs ---');
    await prisma.organization.update({
      where: { id: orgA.id },
      data: { name: 'MRF Super Innovation International Group' }
    });
    console.log('Renamed Org A to "MRF Super Innovation International Group"');

    const resA3 = await axios.post(`${API_BASE}/assets`, {
      name: 'Apple iPad Pro',
      category: 'TABLET',
      quantity: 1,
      organizationId: orgA.id
    }, { headers: authHeaders });
    console.log(`Asset 3 created after rename: ID=${resA3.data.assetId}`);
    createdAssetIds.push(resA3.data.id);
    if (resA3.data.assetId !== 'MRFI-1003') {
      throw new Error(`Expected MRFI-1003 after rename, got ${resA3.data.assetId}`);
    }

    // Verify older assets are unchanged
    const verifyA1 = await prisma.asset.findUnique({ where: { id: resA1.data.id } });
    const verifyA2 = await prisma.asset.findUnique({ where: { id: resA2.data.id } });
    if (verifyA1.assetId !== 'MRFI-1001' || verifyA2.assetId !== 'MRFI-1002') {
      throw new Error('Historical asset IDs were altered after rename!');
    }
    console.log('✔ Older Asset IDs (MRFI-1001, MRFI-1002) untouched; new asset ID is MRFI-1003.\n');

    // TEST 8: Bulk Asset Creation Sequential Numbering
    console.log('--- TEST 8: Bulk Creation Sequential Numbering ---');
    const bulkRes = await axios.post(`${API_BASE}/assets`, {
      name: 'Ergonomic Office Chair',
      category: 'FURNITURE',
      quantity: 3,
      organizationId: orgB.id
    }, { headers: authHeaders });
    console.log(`Bulk created count: ${bulkRes.data.created}`);
    const bulkIds = bulkRes.data.assets.map(a => a.assetId);
    console.log('Bulk Asset IDs created:', bulkIds);
    for (const a of bulkRes.data.assets) {
      createdAssetIds.push(a.id);
    }
    if (bulkIds.join(',') !== 'MRFC-1003,MRFC-1004,MRFC-1005') {
      throw new Error(`Expected MRFC-1003,1004,1005, got ${bulkIds.join(',')}`);
    }
    console.log('✔ Bulk assets created with consecutive sequential IDs: MRFC-1003, 1004, 1005.\n');

    // TEST 9: Concurrency Safety (Simultaneous Asset Creation)
    console.log('--- TEST 9: Concurrency Test (5 Simultaneous Requests) ---');
    const concurrentPromises = [];
    for (let i = 1; i <= 5; i++) {
      concurrentPromises.push(
        axios.post(`${API_BASE}/assets`, {
          name: `Concurrent Device ${i}`,
          category: 'LAPTOP',
          quantity: 1,
          organizationId: orgA.id
        }, { headers: authHeaders })
      );
    }
    const concurrentResults = await Promise.all(concurrentPromises);
    const concurrentIds = concurrentResults.map(r => r.data.assetId);
    console.log('Concurrent Asset IDs generated:', concurrentIds);
    for (const r of concurrentResults) {
      createdAssetIds.push(r.data.id);
    }
    const uniqueIds = new Set(concurrentIds);
    if (uniqueIds.size !== 5) {
      throw new Error(`Concurrency race condition detected! Duplicate IDs: ${concurrentIds}`);
    }
    // Verify each ID starts with MRFI- and numbers are between 1004 and 1008
    const numList = concurrentIds.map(id => parseInt(id.replace('MRFI-', ''), 10)).sort((a, b) => a - b);
    console.log('Sorted sequential numbers from concurrent batch:', numList);
    if (numList.join(',') !== '1004,1005,1006,1007,1008') {
      throw new Error(`Concurrency sequence gap or mismatch: ${numList.join(',')}`);
    }
    console.log('✔ Concurrency test passed: 5 simultaneous requests produced 5 strictly unique sequential IDs without race conditions.\n');

    // TEST 10: Existing assets with AST-xxxx IDs are untouched
    console.log('--- TEST 10: Legacy AST-xxxx Asset Untouched Verification ---');
    const legacyAsset = await prisma.asset.create({
      data: {
        assetId: 'AST-9999',
        name: 'Legacy Legacy Asset',
        category: 'LAPTOP',
        organizationId: orgA.id
      }
    });
    createdAssetIds.push(legacyAsset.id);
    const fetchedLegacy = await prisma.asset.findUnique({ where: { assetId: 'AST-9999' } });
    if (!fetchedLegacy || fetchedLegacy.name !== 'Legacy Legacy Asset') {
      throw new Error('Legacy asset failed verification!');
    }
    console.log('✔ Legacy AST-9999 asset coexists without conflict or alteration.\n');

    // TEST 11: Custom Category (CAMERA/CCTV) with dynamic prefix
    console.log('--- TEST 11: Custom Category with Dynamic Asset ID ---');
    const customCatRes = await axios.post(`${API_BASE}/assets`, {
      name: 'Sony 8K Studio Camera',
      category: 'CAMERA',
      quantity: 1,
      organizationId: orgA.id
    }, { headers: authHeaders });
    console.log(`Custom category asset: ID=${customCatRes.data.assetId}, Category=${customCatRes.data.category}`);
    createdAssetIds.push(customCatRes.data.id);
    if (customCatRes.data.category !== 'CAMERA' || !customCatRes.data.assetId.startsWith('MRFI-')) {
      throw new Error('Custom category with dynamic Asset ID failed');
    }
    console.log('✔ Custom category CAMERA works seamlessly with dynamic Asset ID.\n');

    // TEST 12: Preview Next ID Endpoint
    console.log('--- TEST 12: Preview Next Asset ID Endpoint ---');
    const previewRes = await axios.get(`${API_BASE}/assets/next-id`, {
      params: { organizationId: orgA.id },
      headers: authHeaders
    });
    console.log('Preview next Asset ID for Org A:', previewRes.data.nextAssetId);
    if (previewRes.data.nextAssetId !== 'MRFI-1010') {
      throw new Error(`Expected preview MRFI-1010, got ${previewRes.data.nextAssetId}`);
    }
    console.log('✔ Preview endpoint returned MRFI-1010 accurately without consuming sequence.\n');

    // TEST 13: Filter, Edit & CSV Export
    console.log('--- TEST 13: Edit, Filter & CSV Export ---');
    // Edit custom asset from CAMERA to CCTV
    const editRes = await axios.put(`${API_BASE}/assets/${customCatRes.data.id}`, {
      category: 'CCTV'
    }, { headers: authHeaders });
    if (editRes.data.category !== 'CCTV') {
      throw new Error('Failed to edit category to CCTV');
    }
    console.log('✔ Edited category to CCTV successfully.');

    // Filter by organization
    const filterOrgARes = await axios.get(`${API_BASE}/assets`, {
      params: { organizationId: orgA.id },
      headers: authHeaders
    });
    console.log(`Org A assets count: ${filterOrgARes.data.assets.length}`);
    for (const a of filterOrgARes.data.assets) {
      if (a.assetId.startsWith('AST-')) continue; // skip legacy test asset
      if (!a.assetId.startsWith('MRFI-')) {
        throw new Error(`Asset ID ${a.assetId} leaked into Org A!`);
      }
    }
    console.log('✔ Organization-level data isolation verified.');

    // CSV Export for Org A
    const csvResA = await axios.get(`${API_BASE}/reports/assets?format=csv`, {
      params: { organizationId: orgA.id },
      headers: authHeaders
    });
    console.log('CSV preview Org A:\n' + csvResA.data.split('\r\n').slice(0, 3).join('\n'));
    if (!csvResA.data.includes('MRFI-1001') || !csvResA.data.includes('CCTV')) {
      throw new Error(`CSV export for Org A missing MRFI-1001 or CCTV! Content:\n${csvResA.data}`);
    }

    // CSV Export for Org B
    const csvResB = await axios.get(`${API_BASE}/reports/assets?format=csv`, {
      params: { organizationId: orgB.id },
      headers: authHeaders
    });
    console.log('CSV preview Org B:\n' + csvResB.data.split('\r\n').slice(0, 3).join('\n'));
    if (!csvResB.data.includes('MRFC-1001')) {
      throw new Error(`CSV export for Org B missing MRFC-1001! Content:\n${csvResB.data}`);
    }
    console.log('✔ CSV Export correctly includes dynamic Asset IDs and custom categories for both organizations.\n');

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
  console.log('ALL 13 TESTS PASSED SUCCESSFULLY! 🚀');
  console.log('================================================================');
}

runTestSuite()
  .catch(err => {
    console.error('Validation Suite Failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
