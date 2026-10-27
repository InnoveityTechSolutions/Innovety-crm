const axios = require('../backend/node_modules/axios');
const prisma = require('../backend/src/utils/db');

const API_BASE = 'http://localhost:5000/api';

async function runTests() {
  console.log('================================================================');
  console.log('STARTING STAGE 1 ESTIMATE / BILLING BACKEND VALIDATION SUITE');
  console.log('================================================================\n');

  // Baseline inspection
  const baselineEstimateCount = await prisma.assetEstimate.count();
  const baselineOrgCount = await prisma.organization.count();
  console.log(`Baseline: ${baselineEstimateCount} estimates, ${baselineOrgCount} organizations.\n`);

  // 1. Authenticate as Super Admin
  console.log('--- Step 1: Authentication ---');
  const loginRes = await axios.post(`${API_BASE}/auth/login`, {
    userId: 'superadmin@enterprise-crm.com',
    password: 'Admin123!'
  });
  const token = loginRes.data.token;
  const authHeaders = { Authorization: `Bearer ${token}` };
  console.log(`✔ Authenticated as: ${loginRes.data.user.email}\n`);

  const createdOrgIds = [];
  const createdEstimateIds = [];

  try {
    // 2. Setup Test Organization
    console.log('--- Step 2: Create Test Organization "MRF Innovation" ---');
    const org = await prisma.organization.create({
      data: {
        name: 'MRF Innovation Systems',
        slug: 'mrf-innovation-billing-test',
        companyCode: 'MRFIBS',
        estimatePrefix: 'EST',
        estimateSequence: 223, // next will be 224
        address: 'New No 60 South Sivan Koil Street, Vadapalani',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600026',
        country: 'India',
        phone: '+91 9094021161',
        email: 'billing@mrf.com',
        gstin: '33ACFPN3295D2ZQ',
        bankName: 'INDIAN BANK',
        bankIfsc: 'IDIB000M126',
        bankAccountNo: '453691659',
        bankBranch: 'MADIPAKKAM',
        signatoryTitle: 'Authorized Signature'
      }
    });
    createdOrgIds.push(org.id);
    console.log(`✔ Org created: ${org.name} (estimateSequence: ${org.estimateSequence})\n`);

    // 3. Test Preview Endpoint
    console.log('--- TEST 1: POST /api/assets/estimates/preview ---');
    const previewPayload = {
      title: 'Estimate',
      reference: 'Wifi Pt camera',
      placeOfSupply: 'Tamil Nadu (33)',
      taxRate: 18,
      company: {
        name: org.name,
        address: org.address,
        city: org.city,
        state: org.state,
        pincode: org.pincode,
        country: org.country,
        phone: org.phone,
        email: org.email,
        gstin: org.gstin
      },
      billTo: {
        name: 'Innoveity',
        address: 'MCC - MFR Innovation Park, East Tambaram',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600059',
        country: 'India'
      },
      items: [
        {
          title: 'Camera',
          description: '2mp Wifi Pt camera Indoor',
          quantity: 2,
          unit: 'nos',
          rate: 2100
        },
        {
          title: 'Memory Card',
          description: '256 Gb micro sd card',
          quantity: 2,
          unit: 'nos',
          rate: 2600
        },
        {
          title: 'Freight Charges',
          description: '',
          quantity: 1,
          unit: 'nos',
          rate: 250
        }
      ]
    };

    const previewRes = await axios.post(`${API_BASE}/assets/estimates/preview`, previewPayload, {
      params: { organizationId: org.id },
      headers: authHeaders
    });

    console.log(`Preview Result:`);
    console.log(`  Estimate Number: ${previewRes.data.estimateNumber}`);
    console.log(`  Subtotal: ₹${previewRes.data.subTotal}`);
    console.log(`  CGST (9%): ₹${previewRes.data.cgstAmount}`);
    console.log(`  SGST (9%): ₹${previewRes.data.sgstAmount}`);
    console.log(`  Grand Total: ₹${previewRes.data.grandTotal}`);
    console.log(`  Total In Words: "${previewRes.data.totalInWords}"`);

    if (previewRes.data.estimateNumber !== 'EST-000224') {
      throw new Error(`Expected preview number EST-000224, got ${previewRes.data.estimateNumber}`);
    }
    if (previewRes.data.subTotal !== 9650) {
      throw new Error(`Expected subTotal 9650, got ${previewRes.data.subTotal}`);
    }
    if (previewRes.data.cgstAmount !== 868.5 || previewRes.data.sgstAmount !== 868.5) {
      throw new Error(`Expected CGST/SGST 868.50, got ${previewRes.data.cgstAmount}, ${previewRes.data.sgstAmount}`);
    }
    if (previewRes.data.grandTotal !== 11387) {
      throw new Error(`Expected grandTotal 11387, got ${previewRes.data.grandTotal}`);
    }
    if (!previewRes.data.totalInWords.includes('Eleven Thousand Three Hundred Eighty-Seven')) {
      throw new Error(`Total in words mismatch: ${previewRes.data.totalInWords}`);
    }

    // Verify preview did NOT write to database or consume sequence
    const orgAfterPreview = await prisma.organization.findUnique({ where: { id: org.id } });
    if (orgAfterPreview.estimateSequence !== 223) {
      throw new Error(`Preview consumed sequence! Sequence was ${orgAfterPreview.estimateSequence}`);
    }
    const estimateCountAfterPreview = await prisma.assetEstimate.count({ where: { organizationId: org.id } });
    if (estimateCountAfterPreview !== 0) {
      throw new Error(`Preview created database records! Count is ${estimateCountAfterPreview}`);
    }
    console.log('✔ Test 1 passed: Preview accurate, matches reference document calculations exactly, zero DB mutations.\n');

    // 4. Test Create Estimate (Intra-State: Tamil Nadu -> Tamil Nadu)
    console.log('--- TEST 2: POST /api/assets/estimates (Intra-State Creation) ---');
    const createRes = await axios.post(`${API_BASE}/assets/estimates`, previewPayload, {
      params: { organizationId: org.id },
      headers: authHeaders
    });

    const est = createRes.data.estimate;
    createdEstimateIds.push(est.id);
    console.log(`✔ Estimate Created: ID=${est.id}, Number=${est.estimateNumber}`);

    if (est.estimateNumber !== 'EST-000224') {
      throw new Error(`Expected EST-000224, got ${est.estimateNumber}`);
    }
    if (est.grandTotal !== 11387 || est.items.length !== 3) {
      throw new Error(`Data mismatch on created estimate: Total=${est.grandTotal}, Items=${est.items.length}`);
    }
    console.log('✔ Test 2 passed: Estimate EST-000224 persisted cleanly.\n');

    // 5. Test Sequential Concurrency (Next estimate must be EST-000225)
    console.log('--- TEST 3: Sequential Numbering (EST-000225) ---');
    const createRes2 = await axios.post(`${API_BASE}/assets/estimates`, {
      ...previewPayload,
      items: [{ title: 'Annual Server Maintenance', quantity: 1, rate: 50000 }]
    }, {
      params: { organizationId: org.id },
      headers: authHeaders
    });
    const est2 = createRes2.data.estimate;
    createdEstimateIds.push(est2.id);
    console.log(`✔ Second Estimate Created: Number=${est2.estimateNumber}`);
    if (est2.estimateNumber !== 'EST-000225') {
      throw new Error(`Expected EST-000225, got ${est2.estimateNumber}`);
    }
    console.log('✔ Test 3 passed: Numbering increments consecutively.\n');

    // 6. Test Inter-State Tax (Tamil Nadu -> Karnataka => IGST 18%)
    console.log('--- TEST 4: Inter-State GST (Tamil Nadu -> Karnataka => IGST) ---');
    const interStatePayload = {
      ...previewPayload,
      placeOfSupply: 'Karnataka (29)',
      billTo: {
        ...previewPayload.billTo,
        state: 'Karnataka'
      }
    };
    const interStateRes = await axios.post(`${API_BASE}/assets/estimates`, interStatePayload, {
      params: { organizationId: org.id },
      headers: authHeaders
    });
    const est3 = interStateRes.data.estimate;
    createdEstimateIds.push(est3.id);
    console.log(`✔ Inter-State Estimate Created: Number=${est3.estimateNumber}`);
    console.log(`  CGST: ₹${est3.cgstAmount}, SGST: ₹${est3.sgstAmount}, IGST: ₹${est3.igstAmount}`);
    if (est3.cgstAmount !== 0 || est3.sgstAmount !== 0 || est3.igstAmount !== 1737) {
      throw new Error(`Expected IGST 1737 and CGST/SGST 0, got IGST=${est3.igstAmount}, CGST=${est3.cgstAmount}`);
    }
    console.log('✔ Test 4 passed: Inter-state calculation applies IGST correctly.\n');

    // 7. Test Organization Isolation (Second organization starts its own sequence)
    console.log('--- TEST 5: Organization Isolation ---');
    const org2 = await prisma.organization.create({
      data: {
        name: 'Second Company Ltd',
        slug: 'second-company-billing-test',
        companyCode: 'SCBLT',
        estimatePrefix: 'EST',
        estimateSequence: 1000
      }
    });
    createdOrgIds.push(org2.id);

    const org2Res = await axios.post(`${API_BASE}/assets/estimates`, {
      ...previewPayload,
      company: { name: 'Second Company Ltd' }
    }, {
      params: { organizationId: org2.id },
      headers: authHeaders
    });
    const estOrg2 = org2Res.data.estimate;
    createdEstimateIds.push(estOrg2.id);
    console.log(`✔ Org 2 Estimate Created: Org=${org2.name}, Number=${estOrg2.estimateNumber}`);
    if (estOrg2.estimateNumber !== 'EST-001001') {
      throw new Error(`Expected Org 2 to start at EST-001001, got ${estOrg2.estimateNumber}`);
    }
    console.log('✔ Test 5 passed: Organization isolation guarantees independent sequences.\n');

    // 8. Test Historical Snapshot Immutability
    console.log('--- TEST 6: Historical Snapshot Immutability ---');
    // Alter Org 1 settings dramatically
    await prisma.organization.update({
      where: { id: org.id },
      data: {
        name: 'MODIFIED COMPANY NAME NEVER IN ESTIMATE',
        bankName: 'COMPLETELY DIFFERENT BANK',
        gstin: '99DIFFERENTGSTIN'
      }
    });

    // Fetch original estimate EST-000224
    const fetchedEst = await axios.get(`${API_BASE}/assets/estimates/${est.id}`, {
      params: { organizationId: org.id },
      headers: authHeaders
    });

    console.log(`Retrieved original estimate after org alteration:`);
    console.log(`  Stored Company Name: ${fetchedEst.data.companyName}`);
    console.log(`  Stored Bank: ${fetchedEst.data.bankName}`);
    console.log(`  Stored GSTIN: ${fetchedEst.data.companyGstin}`);

    if (fetchedEst.data.companyName !== 'MRF Innovation Systems' || fetchedEst.data.bankName !== 'INDIAN BANK') {
      throw new Error(`Immutability violated! Company name was mutated to ${fetchedEst.data.companyName}`);
    }
    console.log('✔ Test 6 passed: Stored snapshot remains 100% immutable regardless of subsequent organization changes.\n');

  } finally {
    console.log('--- CLEANUP: Removing Test Records ---');
    for (const id of createdEstimateIds) {
      await prisma.assetEstimateItem.deleteMany({ where: { estimateId: id } }).catch(() => {});
      await prisma.assetEstimate.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdOrgIds) {
      await prisma.organization.delete({ where: { id } }).catch(() => {});
    }
    const finalEstimateCount = await prisma.assetEstimate.count();
    const finalOrgCount = await prisma.organization.count();
    console.log(`Final state: ${finalEstimateCount} estimates, ${finalOrgCount} organizations.`);
    if (finalEstimateCount === baselineEstimateCount && finalOrgCount === baselineOrgCount) {
      console.log('✔ All test records cleaned up. Database returned to exact baseline.');
    }
  }

  console.log('\n================================================================');
  console.log('ALL BACKEND ESTIMATE TESTS COMPLETED SUCCESSFULLY! 🎉');
  console.log('================================================================');
}

runTests()
  .catch((err) => {
    console.error('Test Suite Failed:', err.response?.data || err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
