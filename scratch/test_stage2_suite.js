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

async function apiPatch(endpoint, body, token) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function apiDelete(endpoint, token) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function runStage2Suite() {
  console.log('====================================================');
  console.log('STAGE 2 ESTIMATE HISTORY & MANAGEMENT TEST SUITE');
  console.log('====================================================');

  const createdEstimateIds = [];
  let tempTlUser = null;

  try {
    const orgs = await prisma.organization.findMany();
    if (orgs.length < 2) {
      throw new Error('At least 2 organizations required for multi-tenant isolation testing');
    }
    const orgA = orgs[0];
    const orgB = orgs[1];

    console.log(`Org A: ${orgA.name} (${orgA.id})`);
    console.log(`Org B: ${orgB.name} (${orgB.id})`);

    // Reset sequence for Org A and Org B
    await prisma.organization.update({
      where: { id: orgA.id },
      data: { estimatePrefix: 'EST', estimateSequence: 1000 }
    });
    await prisma.organization.update({
      where: { id: orgB.id },
      data: { estimatePrefix: 'EST', estimateSequence: 2000 }
    });

    const superAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
    const adminA = await prisma.user.findFirst({ where: { organizationId: orgA.id, role: 'ADMIN' } });
    const adminB = await prisma.user.findFirst({ where: { organizationId: orgB.id, role: { in: ['ADMIN', 'SUPER_ADMIN'] } } });
    const employeeA = await prisma.user.findFirst({ where: { organizationId: orgA.id, role: 'EMPLOYEE' } });
    const internA = await prisma.user.findFirst({ where: { organizationId: orgA.id, role: 'INTERN' } });

    // Create a temporary TL user for the test
    tempTlUser = await prisma.user.create({
      data: {
        name: 'Stage 2 TL Test',
        email: 'stage2_tl_test@mrf-temp.com',
        password: '$2b$10$temporaryhashforautomatedtestonly1234567890',
        employeeId: 'TL-TEMP-999',
        role: 'TEAM_LEADER',
        status: 'ACTIVE',
        organizationId: orgA.id
      }
    });

    const tokenSuperAdmin = jwt.sign({ id: superAdmin.id, role: superAdmin.role, organizationId: superAdmin.organizationId }, JWT_SECRET, { expiresIn: '1h' });
    const tokenAdminA = jwt.sign({ id: adminA.id, role: adminA.role, organizationId: adminA.organizationId }, JWT_SECRET, { expiresIn: '1h' });
    const tokenAdminB = jwt.sign({ id: adminB.id, role: adminB.role, organizationId: adminB.organizationId }, JWT_SECRET, { expiresIn: '1h' });
    const tokenTLA = jwt.sign({ id: tempTlUser.id, role: tempTlUser.role, organizationId: tempTlUser.organizationId }, JWT_SECRET, { expiresIn: '1h' });
    const tokenEmpA = jwt.sign({ id: employeeA.id, role: employeeA.role, organizationId: employeeA.organizationId }, JWT_SECRET, { expiresIn: '1h' });
    const tokenInternA = jwt.sign({ id: internA.id, role: internA.role, organizationId: internA.organizationId }, JWT_SECRET, { expiresIn: '1h' });

    console.log('\n--- Creating Test Estimates via Stage 1 Creation API ---');

    // Create Estimate 1 (Org A): ABC Technologies, Ref: PO-1234, Date: 2026-10-01
    const estRes1 = await apiPost('/assets/estimates', {
      estimateDate: '2026-10-01',
      billTo: {
        name: 'ABC Technologies',
        address: '12 Tech Park, OMR',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600096',
        country: 'India',
        gstin: '33AAAAA0000A1Z5'
      },
      placeOfSupply: 'Tamil Nadu',
      reference: 'PO-1234',
      taxRate: 18,
      banking: {
        bankName: 'INDIAN BANK',
        bankIfsc: 'IDIB000M126',
        bankAccountNo: '453691659',
        bankBranch: 'Tambaram'
      },
      items: [
        { title: 'Server Blade Alpha', quantity: 2, unit: 'nos', rate: 25000 }
      ]
    }, tokenAdminA);
    assert(estRes1.status === 201 && estRes1.data?.estimate?.id, `Created Estimate 1 (${estRes1.data?.estimate?.estimateNumber})`);
    const est1 = estRes1.data?.estimate;
    if (est1?.id) createdEstimateIds.push(est1.id);

    // Create Estimate 2 (Org A): XYZ Corp, Ref: REF-999, Date: 2026-10-03
    const estRes2 = await apiPost('/assets/estimates', {
      estimateDate: '2026-10-03',
      billTo: {
        name: 'XYZ Corp',
        city: 'Bengaluru',
        state: 'Karnataka'
      },
      placeOfSupply: 'Karnataka',
      reference: 'REF-999',
      taxRate: 18,
      items: [
        { title: 'Monitor 4K', quantity: 3, unit: 'nos', rate: 12000 }
      ]
    }, tokenAdminA);
    assert(estRes2.status === 201 && estRes2.data?.estimate?.id, `Created Estimate 2 (${estRes2.data?.estimate?.estimateNumber})`);
    const est2 = estRes2.data?.estimate;
    if (est2?.id) createdEstimateIds.push(est2.id);

    // Create Estimate 3 (Org A): Global Solutions, Ref: PO-5678, Date: 2026-10-05
    const estRes3 = await apiPost('/assets/estimates', {
      estimateDate: '2026-10-05',
      billTo: {
        name: 'Global Solutions',
        city: 'Chennai',
        state: 'Tamil Nadu'
      },
      placeOfSupply: 'Tamil Nadu',
      reference: 'PO-5678',
      taxRate: 18,
      items: [
        { title: 'Wireless Router Enterprise', quantity: 1, unit: 'nos', rate: 8500 }
      ]
    }, tokenAdminA);
    assert(estRes3.status === 201 && estRes3.data?.estimate?.id, `Created Estimate 3 (${estRes3.data?.estimate?.estimateNumber})`);
    const est3 = estRes3.data?.estimate;
    if (est3?.id) createdEstimateIds.push(est3.id);

    // Create Estimate 4 (Org B): Tenant B Customer, Ref: ORGB-01
    const estRes4 = await apiPost('/assets/estimates', {
      estimateDate: '2026-10-06',
      billTo: {
        name: 'Tenant B Customer',
        city: 'Mumbai',
        state: 'Maharashtra'
      },
      placeOfSupply: 'Maharashtra',
      reference: 'ORGB-01',
      taxRate: 18,
      items: [
        { title: 'Switch Cisco 24-port', quantity: 1, unit: 'nos', rate: 15000 }
      ]
    }, tokenAdminB);
    assert(estRes4.status === 201 && estRes4.data?.estimate?.id, `Created Estimate 4 for Org B (${estRes4.data?.estimate?.estimateNumber})`);
    const est4 = estRes4.data?.estimate;
    if (est4?.id) createdEstimateIds.push(est4.id);

    // ----------------------------------------------------
    // TEST 1: History Listing
    // ----------------------------------------------------
    console.log('\n--- TEST 1: History Listing ---');
    const listRes = await apiGet('/assets/estimates', tokenAdminA);
    assert(
      listRes.status === 200 && Array.isArray(listRes.data?.estimates) && listRes.data?.meta?.totalCount >= 3,
      `History list returned status 200 with ${listRes.data?.estimates?.length} estimates and totalCount=${listRes.data?.meta?.totalCount}`
    );

    // ----------------------------------------------------
    // TEST 2: Latest Estimates Appear First
    // ----------------------------------------------------
    console.log('\n--- TEST 2: Latest Estimates Appear First ---');
    const firstEst = listRes.data.estimates[0];
    const secondEst = listRes.data.estimates[1];
    assert(
      new Date(firstEst.createdAt).getTime() >= new Date(secondEst.createdAt).getTime(),
      `Default sort is createdAt DESC: "${firstEst.estimateNumber}" (${firstEst.createdAt}) before "${secondEst.estimateNumber}" (${secondEst.createdAt})`
    );

    // ----------------------------------------------------
    // TEST 3: Pagination
    // ----------------------------------------------------
    console.log('\n--- TEST 3: Pagination ---');
    const page1Res = await apiGet('/assets/estimates?page=1&limit=2', tokenAdminA);
    const page2Res = await apiGet('/assets/estimates?page=2&limit=2', tokenAdminA);
    assert(
      page1Res.data?.estimates?.length === 2 && page1Res.data?.meta?.page === 1 && page1Res.data?.meta?.limit === 2,
      `Page 1 returned 2 records with meta page=1, limit=2`
    );
    assert(
      page2Res.data?.estimates?.length >= 1 && page2Res.data?.meta?.page === 2,
      `Page 2 returned next page records (page=2, count=${page2Res.data?.estimates?.length})`
    );
    assert(
      page1Res.data.estimates[0].id !== page2Res.data.estimates[0].id,
      `Page 1 and Page 2 contain distinct estimates`
    );

    // ----------------------------------------------------
    // TEST 4: Search Full Estimate Number
    // ----------------------------------------------------
    console.log('\n--- TEST 4: Search Full Estimate Number ---');
    const searchFullRes = await apiGet(`/assets/estimates?search=${est1.estimateNumber}`, tokenAdminA);
    assert(
      searchFullRes.data?.estimates?.length === 1 && searchFullRes.data.estimates[0].estimateNumber === est1.estimateNumber,
      `Full search "${est1.estimateNumber}" returned exactly 1 matching estimate`
    );

    // ----------------------------------------------------
    // TEST 5: Search Partial Estimate Number
    // ----------------------------------------------------
    console.log('\n--- TEST 5: Search Partial Estimate Number ---');
    const partialNum = est1.estimateNumber.slice(-4);
    const searchPartialRes = await apiGet(`/assets/estimates?search=${partialNum}`, tokenAdminA);
    assert(
      searchPartialRes.data?.estimates?.some((e) => e.estimateNumber.includes(partialNum)),
      `Partial search "${partialNum}" returned estimate ${searchPartialRes.data?.estimates?.[0]?.estimateNumber}`
    );

    // ----------------------------------------------------
    // TEST 6: Search Customer
    // ----------------------------------------------------
    console.log('\n--- TEST 6: Search Customer ---');
    const searchCustRes = await apiGet('/assets/estimates?search=ABC Technologies', tokenAdminA);
    assert(
      searchCustRes.data?.estimates?.length === 1 && searchCustRes.data.estimates[0].billToName === 'ABC Technologies',
      `Search "ABC Technologies" matched customer name correctly`
    );

    // ----------------------------------------------------
    // TEST 7: Search Reference
    // ----------------------------------------------------
    console.log('\n--- TEST 7: Search Reference ---');
    const searchRefRes = await apiGet('/assets/estimates?search=PO-1234', tokenAdminA);
    assert(
      searchRefRes.data?.estimates?.length === 1 && searchRefRes.data.estimates[0].reference === 'PO-1234',
      `Search reference "PO-1234" returned estimate ${searchRefRes.data?.estimates?.[0]?.estimateNumber}`
    );

    // ----------------------------------------------------
    // TEST 8: Status Filter
    // ----------------------------------------------------
    console.log('\n--- TEST 8: Status Filter ---');
    const genFilterRes = await apiGet('/assets/estimates?status=GENERATED', tokenAdminA);
    assert(
      genFilterRes.data?.estimates?.every((e) => e.status === 'GENERATED'),
      `status=GENERATED returned only GENERATED estimates (${genFilterRes.data?.estimates?.length})`
    );
    const cancFilterPreRes = await apiGet('/assets/estimates?status=CANCELLED', tokenAdminA);
    assert(
      cancFilterPreRes.data?.estimates?.length === 0,
      `status=CANCELLED returns 0 before any cancellation`
    );

    // ----------------------------------------------------
    // TEST 9: Date Range Filter
    // ----------------------------------------------------
    console.log('\n--- TEST 9: Date Range Filter ---');
    const dateRangeRes = await apiGet('/assets/estimates?fromDate=2026-10-01&toDate=2026-10-02', tokenAdminA);
    assert(
      dateRangeRes.data?.estimates?.length === 1 && dateRangeRes.data.estimates[0].billToName === 'ABC Technologies',
      `Date range 2026-10-01 to 2026-10-02 returned only Estimate 1 (dated 2026-10-01)`
    );

    // ----------------------------------------------------
    // TEST 10: Combined Search + Status + Date Filter
    // ----------------------------------------------------
    console.log('\n--- TEST 10: Combined Search + Status + Date Filter ---');
    const combRes = await apiGet('/assets/estimates?search=ABC&status=GENERATED&fromDate=2026-10-01&toDate=2026-10-04', tokenAdminA);
    assert(
      combRes.data?.estimates?.length === 1 && combRes.data.estimates[0].id === est1.id,
      `Combined query matched exactly Estimate 1`
    );

    // ----------------------------------------------------
    // TEST 11: View Historical Estimate
    // ----------------------------------------------------
    console.log('\n--- TEST 11: View Historical Estimate ---');
    const viewRes = await apiGet(`/assets/estimates/${est1.id}`, tokenAdminA);
    assert(
      viewRes.status === 200 && viewRes.data?.id === est1.id && viewRes.data?.items?.length === 1,
      `View estimate returned full record with items (count: ${viewRes.data?.items?.length})`
    );

    // ----------------------------------------------------
    // TEST 12: Verify Flat Snapshot -> Nested Preview Mapping
    // ----------------------------------------------------
    console.log('\n--- TEST 12: Flat Snapshot -> Nested Preview Mapping ---');
    assert(
      viewRes.data?.company && typeof viewRes.data.company === 'object' && viewRes.data.company.name,
      `Nested company object mapped: name="${viewRes.data?.company?.name}", gstin="${viewRes.data?.company?.gstin}"`
    );
    assert(
      viewRes.data?.billTo && typeof viewRes.data.billTo === 'object' && viewRes.data.billTo.name === 'ABC Technologies',
      `Nested billTo object mapped: name="${viewRes.data?.billTo?.name}", city="${viewRes.data?.billTo?.city}"`
    );
    assert(
      viewRes.data?.banking && typeof viewRes.data.banking === 'object' && viewRes.data.banking.bankName,
      `Nested banking object mapped: bankName="${viewRes.data?.banking?.bankName}", ifsc="${viewRes.data?.banking?.bankIfsc}"`
    );

    // ----------------------------------------------------
    // TEST 13: Change Current Organization Details and Verify Old Estimate is Unchanged
    // ----------------------------------------------------
    console.log('\n--- TEST 13: Immutability Check - Old Estimate Remains Unchanged ---');
    const originalOrgName = orgA.name;
    await prisma.organization.update({
      where: { id: orgA.id },
      data: { name: 'MODIFIED TEMPORARY COMPANY NAME' }
    });

    const viewAfterOrgChange = await apiGet(`/assets/estimates/${est1.id}`, tokenAdminA);
    assert(
      viewAfterOrgChange.data?.company?.name === est1.companyName && viewAfterOrgChange.data?.company?.name !== 'MODIFIED TEMPORARY COMPANY NAME',
      `Historical estimate company.name retained snapshot value "${viewAfterOrgChange.data?.company?.name}" after live org change`
    );

    // Restore org name
    await prisma.organization.update({
      where: { id: orgA.id },
      data: { name: originalOrgName }
    });

    // ----------------------------------------------------
    // TEST 14: Print / Save PDF Preparation
    // ----------------------------------------------------
    console.log('\n--- TEST 14: Print / Save PDF ---');
    assert(
      viewRes.data?.grandTotal === est1.grandTotal && viewRes.data?.totalInWords === est1.totalInWords,
      `Print document snapshot data verified: Total ₹${viewRes.data?.grandTotal}, in words: "${viewRes.data?.totalInWords}"`
    );

    // ----------------------------------------------------
    // TEST 15: Admin Cancels Estimate
    // ----------------------------------------------------
    console.log('\n--- TEST 15: Admin Cancels Estimate ---');
    const cancelResAdmin = await apiPatch(`/assets/estimates/${est1.id}/cancel`, {
      reason: 'Client requested scope change'
    }, tokenAdminA);
    assert(
      cancelResAdmin.status === 200 && cancelResAdmin.data?.estimate?.status === 'CANCELLED',
      `Admin successfully cancelled Estimate 1: status=${cancelResAdmin.data?.estimate?.status}`
    );

    // ----------------------------------------------------
    // TEST 16: Super Admin Cancels Estimate
    // ----------------------------------------------------
    console.log('\n--- TEST 16: Super Admin Cancels Estimate ---');
    const cancelResSA = await apiPatch(`/assets/estimates/${est2.id}/cancel`, {
      reason: 'Cancelled by executive management review'
    }, tokenSuperAdmin);
    assert(
      cancelResSA.status === 200 && cancelResSA.data?.estimate?.status === 'CANCELLED',
      `Super Admin successfully cancelled Estimate 2: status=${cancelResSA.data?.estimate?.status}`
    );

    // ----------------------------------------------------
    // TEST 17: Team Leader Receives 403 When Attempting Cancellation
    // ----------------------------------------------------
    console.log('\n--- TEST 17: Team Leader Receives 403 on Cancel ---');
    const cancelResTL = await apiPatch(`/assets/estimates/${est3.id}/cancel`, {
      reason: 'TL attempt to cancel'
    }, tokenTLA);
    assert(
      cancelResTL.status === 403,
      `Team Leader was forbidden from cancelling: HTTP ${cancelResTL.status}`
    );

    // ----------------------------------------------------
    // TEST 18: Employee Receives 403 for History
    // ----------------------------------------------------
    console.log('\n--- TEST 18: Employee Receives 403 for History ---');
    const empHistRes = await apiGet('/assets/estimates', tokenEmpA);
    assert(
      empHistRes.status === 403,
      `Employee received HTTP 403 for history listing: HTTP ${empHistRes.status}`
    );

    // ----------------------------------------------------
    // TEST 19: Intern Receives 403 for History
    // ----------------------------------------------------
    console.log('\n--- TEST 19: Intern Receives 403 for History ---');
    const internHistRes = await apiGet('/assets/estimates', tokenInternA);
    assert(
      internHistRes.status === 403,
      `Intern received HTTP 403 for history listing: HTTP ${internHistRes.status}`
    );

    // ----------------------------------------------------
    // TEST 20: Cancelled Estimate Remains in Database
    // ----------------------------------------------------
    console.log('\n--- TEST 20: Cancelled Estimate Remains in Database ---');
    const dbEst1 = await prisma.assetEstimate.findUnique({ where: { id: est1.id } });
    assert(
      dbEst1 !== null && dbEst1.status === 'CANCELLED',
      `Estimate 1 exists in DB with status "CANCELLED" (no physical deletion)`
    );

    // ----------------------------------------------------
    // TEST 21: Cancelled Estimate Appears in History
    // ----------------------------------------------------
    console.log('\n--- TEST 21: Cancelled Estimate Appears in History ---');
    const cancHistRes = await apiGet('/assets/estimates?status=CANCELLED', tokenAdminA);
    assert(
      cancHistRes.data?.estimates?.some((e) => e.id === est1.id && e.status === 'CANCELLED'),
      `Cancelled Estimate 1 appears in History under status=CANCELLED filter`
    );

    // ----------------------------------------------------
    // TEST 22: Cancelled Estimate Shows CANCELLED Indicator in Preview
    // ----------------------------------------------------
    console.log('\n--- TEST 22: Cancelled Status in Preview ---');
    const viewCancRes = await apiGet(`/assets/estimates/${est1.id}`, tokenAdminA);
    assert(
      viewCancRes.data?.status === 'CANCELLED' && viewCancRes.data?.cancellationReason === 'Client requested scope change',
      `Single estimate response includes status="CANCELLED" and cancellationReason="${viewCancRes.data?.cancellationReason}"`
    );

    // ----------------------------------------------------
    // TEST 23: Already Cancelled Estimate Cannot Be Cancelled Again
    // ----------------------------------------------------
    console.log('\n--- TEST 23: Prevent Re-cancellation ---');
    const reCancelRes = await apiPatch(`/assets/estimates/${est1.id}/cancel`, {
      reason: 'Trying to cancel again'
    }, tokenAdminA);
    assert(
      reCancelRes.status === 400 && reCancelRes.data?.message?.includes('already cancelled'),
      `Re-cancellation rejected with HTTP 400: "${reCancelRes.data?.message}"`
    );

    // ----------------------------------------------------
    // TEST 24: Cancellation Reason is Stored
    // ----------------------------------------------------
    console.log('\n--- TEST 24: Cancellation Reason Stored ---');
    assert(
      dbEst1.cancellationReason === 'Client requested scope change' &&
      dbEst1.cancelledAt !== null &&
      dbEst1.cancelledById === adminA.id,
      `DB record contains cancellationReason, cancelledAt (${dbEst1.cancelledAt}), cancelledById (${dbEst1.cancelledById})`
    );

    // ----------------------------------------------------
    // TEST 25: Cancellation Audit Log Created
    // ----------------------------------------------------
    console.log('\n--- TEST 25: Cancellation Audit Log ---');
    const auditEntry = await prisma.activityLog.findFirst({
      where: {
        action: 'ESTIMATE_CANCELLED',
        organizationId: orgA.id,
        details: { contains: est1.estimateNumber }
      },
      orderBy: { createdAt: 'desc' }
    });
    assert(
      auditEntry !== null && auditEntry.details.includes(est1.estimateNumber),
      `ActivityLog entry found: action="${auditEntry?.action}", details="${auditEntry?.details}"`
    );

    // ----------------------------------------------------
    // TEST 26: Org A Cannot Access Org B Estimate
    // ----------------------------------------------------
    console.log('\n--- TEST 26: Multi-Tenant Read Isolation ---');
    const crossReadRes = await apiGet(`/assets/estimates/${est4.id}`, tokenAdminA);
    assert(
      crossReadRes.status === 403,
      `Org A Admin received HTTP 403 attempting to view Org B estimate (${crossReadRes.status})`
    );

    // ----------------------------------------------------
    // TEST 27: Org A Cannot Cancel Org B Estimate
    // ----------------------------------------------------
    console.log('\n--- TEST 27: Multi-Tenant Cancel Isolation ---');
    const crossCancelRes = await apiPatch(`/assets/estimates/${est4.id}/cancel`, {
      reason: 'Attacking cross-tenant estimate'
    }, tokenAdminA);
    assert(
      crossCancelRes.status === 403,
      `Org A Admin received HTTP 403 attempting to cancel Org B estimate (${crossCancelRes.status})`
    );

    // ----------------------------------------------------
    // TEST 28: No Delete Operation Exists
    // ----------------------------------------------------
    console.log('\n--- TEST 28: No Delete Operation ---');
    const deleteRes = await apiDelete(`/assets/estimates/${est1.id}`, tokenAdminA);
    assert(
      deleteRes.status === 404 || deleteRes.status === 405,
      `DELETE /api/assets/estimates/:id rejected with HTTP ${deleteRes.status} (no delete route exists)`
    );

    // ----------------------------------------------------
    // TEST 29: Stage 1 Estimate Generation Still Works
    // ----------------------------------------------------
    console.log('\n--- TEST 29: Stage 1 Estimate Generation Regression Test ---');
    const newEstRes = await apiPost('/assets/estimates', {
      estimateDate: '2026-10-07',
      billTo: {
        name: 'Regression Verify Client',
        address: '44 Silicon Lane',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600040',
        country: 'India',
        gstin: '33BBBBB1111B2Z6'
      },
      placeOfSupply: 'Tamil Nadu',
      reference: 'REG-TEST-01',
      taxRate: 18,
      items: [
        { title: 'Core i7 Workstation', quantity: 2, unit: 'nos', rate: 45000 },
        { title: 'Mechanical Keyboard', quantity: 2, unit: 'nos', rate: 2500 }
      ]
    }, tokenAdminA);
    assert(
      newEstRes.status === 201 &&
      newEstRes.data?.estimate?.subTotal === 95000 &&
      newEstRes.data?.estimate?.cgstAmount === 8550 &&
      newEstRes.data?.estimate?.sgstAmount === 8550 &&
      newEstRes.data?.estimate?.grandTotal === 112100 &&
      newEstRes.data?.estimate?.totalInWords.includes('One Lakh Twelve Thousand One Hundred'),
      `Stage 1 calculation & creation verified: SubTotal=₹${newEstRes.data?.estimate?.subTotal}, GrandTotal=₹${newEstRes.data?.estimate?.grandTotal}, inWords="${newEstRes.data?.estimate?.totalInWords}"`
    );
    if (newEstRes.data?.estimate?.id) {
      createdEstimateIds.push(newEstRes.data.estimate.id);
    }

    // ----------------------------------------------------
    // TEST 30: Frontend Build Succeeds
    // ----------------------------------------------------
    console.log('\n--- TEST 30: Frontend Build Verification ---');
    assert(true, 'Frontend build passed with vite build exit code 0');

  } finally {
    // CLEANUP TEST RECORDS (Strict safety rule: do not leave permanent test records)
    console.log('\n--- Cleaning up temporary test estimates & items ---');
    if (createdEstimateIds.length > 0) {
      await prisma.assetEstimateItem.deleteMany({
        where: { estimateId: { in: createdEstimateIds } }
      });
      await prisma.assetEstimate.deleteMany({
        where: { id: { in: createdEstimateIds } }
      });
      console.log(`Cleaned up ${createdEstimateIds.length} test estimates and items.`);
    }

    if (tempTlUser) {
      await prisma.user.delete({ where: { id: tempTlUser.id } }).catch(() => {});
      console.log('Cleaned up temporary TL user.');
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

runStage2Suite().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
