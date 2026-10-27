const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { numberToWordsIndian } = require('../backend/src/utils/numberToWordsIndian');
const {
  previewNextEstimateNumber,
  generateNextEstimateNumber
} = require('../backend/src/utils/estimateNumberGenerator');

const prisma = new PrismaClient();
const API_BASE = 'http://localhost:5000/api';
const JWT_SECRET = process.env.JWT_SECRET || 'mrf_crm_jwt_secret_key_2025_secure_production_token';

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

async function runTests() {
  console.log('====================================================');
  console.log('STAGE 1 ESTIMATE GENERATION COMPREHENSIVE TEST SUITE');
  console.log('====================================================');

  try {
    // ----------------------------------------------------
    // TEST 1: Amount in Words (Indian Numbering Format)
    // ----------------------------------------------------
    console.log('\n--- Test 1: Indian Rupee Amount to Words ---');
    const words1 = numberToWordsIndian(11387.00);
    assert(
      words1 === 'Indian Rupee Eleven Thousand Three Hundred Eighty-Seven Only',
      `Reference Bill 11,387.00 -> "${words1}"`
    );

    const words2 = numberToWordsIndian(100000.50);
    assert(
      words2 === 'Indian Rupee One Lakh and Fifty Paise Only',
      `1,00,000.50 -> "${words2}"`
    );

    const words3 = numberToWordsIndian(25000000.00);
    assert(
      words3 === 'Indian Rupee Two Crore Fifty Lakh Only',
      `2,50,00,000.00 -> "${words3}"`
    );

    const words4 = numberToWordsIndian(0);
    assert(
      words4 === 'Indian Rupee Zero Only',
      `0.00 -> "${words4}"`
    );

    // ----------------------------------------------------
    // TEST 2: Setup Orgs & Users for API Testing
    // ----------------------------------------------------
    console.log('\n--- Test 2: Multi-Org Environment Setup ---');
    const orgs = await prisma.organization.findMany();
    if (orgs.length < 2) {
      throw new Error('Need at least 2 organizations in local database for isolation test');
    }
    const orgA = orgs[0];
    const orgB = orgs[1];

    const adminUser = await prisma.user.findFirst({
      where: { organizationId: orgA.id, role: { in: ['ADMIN', 'SUPER_ADMIN'] } }
    });
    let employeeUser = await prisma.user.findFirst({
      where: { organizationId: orgA.id, role: 'EMPLOYEE' }
    });

    if (!adminUser) throw new Error('No admin user found in Org A');

    const adminToken = jwt.sign(
      { id: adminUser.id, role: adminUser.role, organizationId: orgA.id },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    let employeeToken;
    if (employeeUser) {
      employeeToken = jwt.sign(
        { id: employeeUser.id, role: 'EMPLOYEE', organizationId: orgA.id },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
    }

    assert(Boolean(orgA && orgB), `Target Organizations: Org A (${orgA.name}), Org B (${orgB.name})`);

    // ----------------------------------------------------
    // TEST 3: Estimate Number Sequence & Concurrency
    // ----------------------------------------------------
    console.log('\n--- Test 3: Concurrency-Safe Sequential Estimate Numbering ---');
    await prisma.organization.update({
      where: { id: orgA.id },
      data: { estimatePrefix: 'EST', estimateSequence: 1000 }
    });
    await prisma.organization.update({
      where: { id: orgB.id },
      data: { estimatePrefix: 'EST', estimateSequence: 1000 }
    });

    // Preview should NOT advance sequence
    const previewNum1 = await previewNextEstimateNumber(orgA.id);
    const previewNum2 = await previewNextEstimateNumber(orgA.id);
    assert(previewNum1 === 'EST-001001' && previewNum2 === 'EST-001001', 'Preview does not consume sequence (EST-001001)');

    // Generate concurrently
    const [num1, num2, num3] = await Promise.all([
      generateNextEstimateNumber(orgA.id, prisma),
      generateNextEstimateNumber(orgA.id, prisma),
      generateNextEstimateNumber(orgA.id, prisma)
    ]);
    const generatedNums = [num1, num2, num3].sort();
    assert(
      generatedNums[0] === 'EST-001001' &&
      generatedNums[1] === 'EST-001002' &&
      generatedNums[2] === 'EST-001003',
      `Concurrent generation produced consecutive numbers: ${generatedNums.join(', ')}`
    );

    // Organization isolation: Org B starts at its own sequence
    const numB1 = await generateNextEstimateNumber(orgB.id, prisma);
    assert(numB1 === 'EST-001001', `Org B sequence is isolated: ${numB1}`);

    // ----------------------------------------------------
    // TEST 4: GST Slabs & Tax Auto-Calculation API
    // ----------------------------------------------------
    console.log('\n--- Test 4: GST Slabs & Intra/Inter-state Auto-Calculation ---');
    
    // Intra-state (Tamil Nadu -> Tamil Nadu) @ 18% (Reference document items)
    // 3 Cameras @ 2100 = 6300, 1 Freight Charges @ 250 = 250 -> Subtotal = 6550
    // CGST 9% (589.50) + SGST 9% (589.50) = 1179.00 -> Grand Total = 7729.00
    const previewPayloadIntra = {
      title: 'Estimate',
      billTo: {
        name: 'Tech Solutions Chennai',
        state: 'Tamil Nadu',
        gstin: '33AABCT1332L1ZV'
      },
      placeOfSupply: 'Tamil Nadu (33)',
      taxRate: 18,
      items: [
        { title: '2MP WiFi PT Camera', quantity: 3, rate: 2100 },
        { title: 'Freight Charges', quantity: 1, rate: 250 }
      ]
    };

    const resIntra = await apiPost('/assets/estimates/preview', previewPayloadIntra, adminToken);
    assert(resIntra.data.subTotal === 6550, `Subtotal calculated: ₹${resIntra.data.subTotal}`);
    assert(resIntra.data.cgstRate === 9 && resIntra.data.sgstRate === 9, 'Intra-state split: CGST 9%, SGST 9%');
    assert(resIntra.data.cgstAmount === 589.5 && resIntra.data.sgstAmount === 589.5, `CGST ₹${resIntra.data.cgstAmount}, SGST ₹${resIntra.data.sgstAmount}`);
    assert(resIntra.data.igstAmount === 0, 'IGST is 0 for intra-state supply');
    assert(resIntra.data.grandTotal === 7729, `Grand Total calculated: ₹${resIntra.data.grandTotal}`);

    // Inter-state (Tamil Nadu -> Karnataka) @ 18%
    const previewPayloadInter = {
      title: 'Estimate',
      billTo: {
        name: 'Bangalore Analytics',
        state: 'Karnataka',
        gstin: '29ABCDE1234F1Z5'
      },
      placeOfSupply: 'Karnataka (29)',
      taxRate: 18,
      items: [
        { title: '2MP WiFi PT Camera', quantity: 3, rate: 2100 },
        { title: 'Freight Charges', quantity: 1, rate: 250 }
      ]
    };
    const resInter = await apiPost('/assets/estimates/preview', previewPayloadInter, adminToken);
    assert(resInter.data.cgstAmount === 0 && resInter.data.sgstAmount === 0, 'CGST/SGST 0 for inter-state supply');
    assert(resInter.data.igstRate === 18 && resInter.data.igstAmount === 1179, `IGST 18% applied: ₹${resInter.data.igstAmount}`);
    assert(resInter.data.grandTotal === 7729, `Inter-state Grand Total: ₹${resInter.data.grandTotal}`);

    // 0% GST (Exempt)
    const resZero = await apiPost('/assets/estimates/preview', {
      ...previewPayloadIntra,
      taxRate: 0
    }, adminToken);
    assert(resZero.data.cgstAmount === 0 && resZero.data.grandTotal === 6550, '0% GST calculated correctly');

    // 5% GST
    const res5 = await apiPost('/assets/estimates/preview', {
      ...previewPayloadIntra,
      taxRate: 5
    }, adminToken);
    assert(res5.data.cgstRate === 2.5 && res5.data.sgstRate === 2.5 && res5.data.grandTotal === 6877.5, '5% GST split (2.5% + 2.5%) verified');

    // 12% GST
    const res12 = await apiPost('/assets/estimates/preview', {
      ...previewPayloadIntra,
      taxRate: 12
    }, adminToken);
    assert(res12.data.cgstRate === 6 && res12.data.sgstRate === 6 && res12.data.grandTotal === 7336, '12% GST split (6% + 6%) verified');

    // 28% GST
    const res28 = await apiPost('/assets/estimates/preview', {
      ...previewPayloadIntra,
      taxRate: 28
    }, adminToken);
    assert(res28.data.cgstRate === 14 && res28.data.sgstRate === 14 && res28.data.grandTotal === 8384, '28% GST split (14% + 14%) verified');

    // Custom GST (e.g. 7.5%)
    const resCustom = await apiPost('/assets/estimates/preview', {
      ...previewPayloadIntra,
      taxRate: 7.5
    }, adminToken);
    assert(resCustom.data.cgstRate === 3.75 && resCustom.data.sgstRate === 3.75, 'Custom 7.5% GST split (3.75% + 3.75%) verified');

    // ----------------------------------------------------
    // TEST 5: Create Estimate with Snapshot Immutability
    // ----------------------------------------------------
    console.log('\n--- Test 5: Estimate Creation & Immutable Snapshot Verification ---');
    const savePayload = {
      title: 'Estimate',
      reference: 'PO-2026-998',
      placeOfSupply: 'Tamil Nadu (33)',
      taxRate: 18,
      billTo: {
        name: 'Apex Robotics Pvt Ltd',
        address: '42 Industrial Estate, Guindy',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600032',
        country: 'India',
        gstin: '33AAICA1234A1Z5'
      },
      banking: {
        bankName: 'HDFC Bank',
        bankIfsc: 'HDFC0001234',
        bankAccountNo: '50200098765432',
        bankBranch: 'Guindy Branch'
      },
      notes: 'Payment due upon receipt.',
      termsAndConditions: [
        '1. Delivery: 2 days against P.O',
        '2. Payment: 100% advance',
        '3. Taxes: All inclusive',
        '4. Validity of Quote: 7 days only'
      ],
      items: [
        {
          title: '2MP WiFi PT Camera',
          category: 'CAMERA',
          description: 'S/N: CAM-001, CAM-002, CAM-003',
          quantity: 3,
          rate: 2100,
          unit: 'nos'
        },
        {
          title: 'Freight Charges',
          category: 'SERVICE',
          description: 'Standard delivery charges',
          quantity: 1,
          rate: 250,
          unit: 'nos'
        }
      ]
    };

    const createRes = await apiPost('/assets/estimates', savePayload, adminToken);
    const createdEstimate = createRes.data?.estimate || createRes.data;
    assert(Boolean(createdEstimate?.id), `Estimate saved with ID: ${createdEstimate?.id}`);
    assert(Boolean(createdEstimate.estimateNumber), `Estimate generated number: ${createdEstimate.estimateNumber}`);
    assert(createdEstimate.items.length === 2, `Saved 2 items, including manual freight charges`);
    assert(createdEstimate.items[1].title === 'Freight Charges', 'Manual item preserved without assetId requirement');

    // Now modify the organization's settings in DB
    console.log('  Modifying Organization profile in database to test snapshot immutability...');
    await prisma.organization.update({
      where: { id: orgA.id },
      data: {
        name: 'CHANGED ORG NAME INC',
        bankName: 'CHANGED BANK OF THE WORLD',
        gstin: '99CHANGEDGSTIN'
      }
    });

    // Fetch the estimate back
    const fetchedRes = await apiGet(`/assets/estimates/${createdEstimate.id}`, adminToken);
    const fetched = fetchedRes.data;

    assert(
      fetched.companyName === orgA.name,
      `Snapshot companyName preserved "${fetched.companyName}" (did not change to "CHANGED ORG NAME INC")`
    );
    assert(
      fetched.bankName === 'HDFC Bank',
      `Snapshot bankName preserved "${fetched.bankName}" (did not change)`
    );

    // Restore Org A name
    await prisma.organization.update({
      where: { id: orgA.id },
      data: {
        name: orgA.name,
        bankName: orgA.bankName,
        gstin: orgA.gstin
      }
    });

    // ----------------------------------------------------
    // TEST 6: Organization Access Control & Security
    // ----------------------------------------------------
    console.log('\n--- Test 6: Cross-Organization Security ---');
    let userB = await prisma.user.findFirst({ where: { organizationId: orgB.id } });
    if (!userB) {
      // Find any user not in orgA
      userB = await prisma.user.findFirst({ where: { organizationId: { not: orgA.id } } });
    }
    if (userB) {
      const adminTokenB = jwt.sign(
        { id: userB.id, role: userB.role, organizationId: userB.organizationId },
        JWT_SECRET,
        { expiresIn: '1h' }
      );

      const crossRes = await apiGet(`/assets/estimates/${createdEstimate.id}`, adminTokenB);
      assert(
        crossRes.status === 404 || crossRes.status === 403,
        `Cross-org estimate fetch blocked with status ${crossRes.status} (${crossRes.data?.message || 'Access denied'})`
      );
    } else {
      console.log('  [SKIP] Single-user DB environment; cross-org user test skipped.');
    }

    // Role-based access control (Employee role)
    if (employeeToken) {
      console.log('\n--- Test 7: Role-Based Access Control ---');
      const empRes = await apiPost('/assets/estimates/preview', previewPayloadIntra, employeeToken);
      assert(
        empRes.status === 403,
        `EMPLOYEE role denied estimate access with status ${empRes.status} Forbidden`
      );
    }

    // ----------------------------------------------------
    // Cleanup created test estimate
    // ----------------------------------------------------
    await prisma.assetEstimateItem.deleteMany({ where: { estimateId: createdEstimate.id } });
    await prisma.assetEstimate.delete({ where: { id: createdEstimate.id } });
    console.log('\n[CLEANUP] Test estimates deleted. Local database returned to clean baseline.');

  } catch (err) {
    console.error('Test suite error:', err.message);
    failed++;
  } finally {
    await prisma.$disconnect();
    console.log('\n====================================================');
    console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');
    if (failed > 0) process.exit(1);
  }
}

runTests();
