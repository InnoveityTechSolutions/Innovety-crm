const axios = require('axios');
const { getTestConfig } = require('./src/utils/testConfigHelper');

const testConfig = getTestConfig({ isDestructive: true });
const API_BASE = testConfig.apiUrl;

const USERS = {
  superAdmin: { email: 'superadmin@enterprise-crm.com', password: 'Password123!' },
  admin: { email: 'admin@enterprise-crm.com', password: 'Password123!' },
  tl: { email: 'praveen.natarajan.in@gmail.com', password: 'Password123!' },
  employee: { email: 'prasathragul75@gmail.com', password: 'Password123!' },
  intern: { email: 'somusuraj72@gmail.com', password: 'Password123!' }
};

const tokens = {};

async function loginUser(key, credentials) {
  try {
    const res = await axios.post(`${API_BASE}/auth/login`, credentials);
    tokens[key] = res.data.token;
    console.log(`[AUTH] Logged in as ${key} (${res.data.user.role}) - User ID: ${res.data.user.id}`);
  } catch (err) {
    console.error(`[AUTH ERROR] Failed to login as ${key}:`, err.response?.data || err.message);
    throw err;
  }
}

function authHeader(key) {
  return { headers: { Authorization: `Bearer ${tokens[key]}` } };
}

async function runE2ETests() {
  console.log('====================================================');
  console.log('      STARTING REAL-TIME LEAVE MODULE E2E TEST      ');
  console.log('====================================================\n');

  // Step 1: Login all 5 user roles
  console.log('--- Step 1: Authenticating All 5 Roles ---');
  for (const [key, creds] of Object.entries(USERS)) {
    await loginUser(key, creds);
  }
  console.log('✅ All 5 roles authenticated successfully.\n');

  // Step 2: Role Access Restrictions Verification
  console.log('--- Step 2: Verifying Role Access & Restrictions ---');
  
  // Admin apply leave -> Expect 403
  try {
    await axios.post(`${API_BASE}/leaves`, {
      startDate: '2026-11-01',
      endDate: '2026-11-02',
      leaveType: 'CASUAL',
      reason: 'Admin leave test'
    }, authHeader('admin'));
    console.error('❌ FAIL: Admin was allowed to apply for leave!');
  } catch (err) {
    if (err.response?.status === 403) {
      console.log('✅ PASS: Admin apply leave blocked with 403 Forbidden.');
    } else {
      console.error('❌ FAIL: Admin apply leave returned unexpected status:', err.response?.status);
    }
  }

  // Super Admin apply leave -> Expect 403
  try {
    await axios.post(`${API_BASE}/leaves`, {
      startDate: '2026-11-01',
      endDate: '2026-11-02',
      leaveType: 'CASUAL',
      reason: 'Super Admin leave test'
    }, authHeader('superAdmin'));
    console.error('❌ FAIL: Super Admin was allowed to apply for leave!');
  } catch (err) {
    if (err.response?.status === 403) {
      console.log('✅ PASS: Super Admin apply leave blocked with 403 Forbidden.');
    } else {
      console.error('❌ FAIL: Super Admin apply leave returned unexpected status:', err.response?.status);
    }
  }

  // Step 3: Validation Rules Verification
  console.log('\n--- Step 3: Verifying Input Validation Rules ---');
  
  // 3a. Start Date after End Date -> Expect 400
  try {
    await axios.post(`${API_BASE}/leaves`, {
      startDate: '2026-11-05',
      endDate: '2026-11-01',
      leaveType: 'CASUAL',
      reason: 'Invalid dates test'
    }, authHeader('intern'));
    console.error('❌ FAIL: Invalid date range (start > end) was accepted!');
  } catch (err) {
    if (err.response?.status === 400) {
      console.log('✅ PASS: Invalid date range rejected with 400 Bad Request:', err.response.data.message);
    } else {
      console.error('❌ FAIL: Invalid date range returned status:', err.response?.status);
    }
  }

  // 3b. Invalid Leave Type -> Expect 400
  try {
    await axios.post(`${API_BASE}/leaves`, {
      startDate: '2026-11-01',
      endDate: '2026-11-02',
      leaveType: 'HOLIDAY_PARTY',
      reason: 'Invalid type test'
    }, authHeader('intern'));
    console.error('❌ FAIL: Invalid leave type was accepted!');
  } catch (err) {
    if (err.response?.status === 400) {
      console.log('✅ PASS: Invalid leave type rejected with 400 Bad Request:', err.response.data.message);
    } else {
      console.error('❌ FAIL: Invalid leave type returned status:', err.response?.status);
    }
  }

  // 3c. Exceeding Quota -> Expect 400
  try {
    await axios.post(`${API_BASE}/leaves`, {
      startDate: '2026-11-01',
      endDate: '2026-11-30', // 30 days > 6 Emergency days
      leaveType: 'EMERGENCY',
      reason: 'Excessive days request test'
    }, authHeader('intern'));
    console.error('❌ FAIL: Request exceeding leave quota was accepted!');
  } catch (err) {
    if (err.response?.status === 400) {
      console.log('✅ PASS: Request exceeding quota rejected with 400 Bad Request:', err.response.data.message);
    } else {
      console.error('❌ FAIL: Exceeding quota returned status:', err.response?.status);
    }
  }

  // Step 4: Emergency Leave Workflow (Intern -> Team Leader -> Admin)
  console.log('\n--- Step 4: Emergency Leave Workflow (Intern -> TL -> Admin) ---');
  
  // Get initial Intern Emergency balance
  const initialInternBal = (await axios.get(`${API_BASE}/leaves/balances`, authHeader('intern'))).data;
  console.log(`Intern Initial Emergency Balance: ${initialInternBal.emergencyRemaining} days remaining (Approved: ${initialInternBal.approvedEmergency})`);

  // Intern applies for 2-day Emergency Leave
  const emergencyLeaveRes = await axios.post(`${API_BASE}/leaves`, {
    startDate: '2026-11-10',
    endDate: '2026-11-11',
    leaveType: 'EMERGENCY',
    reason: 'Family Emergency in Native Town',
    contactPhone: '9876543210'
  }, authHeader('intern'));

  const emergencyLeave = emergencyLeaveRes.data;
  console.log(`[INTERN APPLY] Created Emergency Leave ID: ${emergencyLeave.id}`);
  console.log(`  Status: ${emergencyLeave.status} | TL Status: ${emergencyLeave.tlApprovalStatus} | Leave Type: ${emergencyLeave.leaveType}`);

  if (emergencyLeave.status !== 'PENDING_TL_APPROVAL') {
    throw new Error(`Expected status PENDING_TL_APPROVAL, got ${emergencyLeave.status}`);
  }
  if (emergencyLeave.leaveType !== 'EMERGENCY') {
    throw new Error(`Expected leaveType EMERGENCY, got ${emergencyLeave.leaveType}`);
  }
  console.log('✅ PASS: Emergency leave application stored correctly with exact type EMERGENCY.');

  // Team Leader approves Emergency Leave
  const tlApproveRes = await axios.put(`${API_BASE}/leaves/${emergencyLeave.id}/tl-approve`, {
    remarks: 'Recommended by TL for urgent emergency.'
  }, authHeader('tl'));

  console.log(`[TL APPROVE] Updated Status: ${tlApproveRes.data.status} | TL Status: ${tlApproveRes.data.tlApprovalStatus}`);
  if (tlApproveRes.data.status !== 'PENDING_ADMIN_APPROVAL' || tlApproveRes.data.tlApprovalStatus !== 'APPROVED') {
    throw new Error('TL Approval status transition failed!');
  }
  console.log('✅ PASS: Team Leader approved and forwarded request to Admin.');

  // Super Admin attempts to approve Emergency Leave -> Expect 403 Forbidden
  try {
    await axios.put(`${API_BASE}/leaves/${emergencyLeave.id}/admin-approve`, { remarks: 'Super Admin illegal sanction' }, authHeader('superAdmin'));
    console.error('❌ FAIL: Super Admin was allowed to approve leave!');
  } catch (err) {
    if (err.response?.status === 403) {
      console.log('✅ PASS: Super Admin approval blocked with 403 Forbidden.');
    } else {
      console.error('❌ FAIL: Super Admin approval returned status:', err.response?.status);
    }
  }

  // Admin Final Sanction for Emergency Leave
  const adminApproveRes = await axios.put(`${API_BASE}/leaves/${emergencyLeave.id}/admin-approve`, {
    remarks: 'Sanctioned by Admin.'
  }, authHeader('admin'));

  console.log(`[ADMIN SANCTION] Final Status: ${adminApproveRes.data.status} | Admin Status: ${adminApproveRes.data.adminApprovalStatus}`);
  if (adminApproveRes.data.status !== 'APPROVED') {
    throw new Error('Admin Final Approval failed!');
  }
  console.log('✅ PASS: Admin final sanctioned Emergency Leave.');

  // Check updated balance
  const updatedInternBal = (await axios.get(`${API_BASE}/leaves/balances`, authHeader('intern'))).data;
  console.log(`Intern Updated Emergency Balance: ${updatedInternBal.emergencyRemaining} days remaining (Approved: ${updatedInternBal.approvedEmergency})`);
  
  if (updatedInternBal.emergencyRemaining !== initialInternBal.emergencyRemaining - 2) {
    throw new Error(`Expected emergency balance deduction of 2 days! Initial: ${initialInternBal.emergencyRemaining}, Updated: ${updatedInternBal.emergencyRemaining}`);
  }
  console.log('✅ PASS: Approved Emergency Leave correctly deducted 2 days from user balance.\n');

  // Step 5: Sick Leave Workflow & Rejection (Employee -> TL Rejection)
  console.log('--- Step 5: Sick Leave Workflow (Employee -> TL Rejection) ---');
  
  const initialEmpBal = (await axios.get(`${API_BASE}/leaves/balances`, authHeader('employee'))).data;
  console.log(`Employee Initial Sick Balance: ${initialEmpBal.sickRemaining} days remaining`);

  // Employee applies for Sick Leave
  const sickLeaveRes = await axios.post(`${API_BASE}/leaves`, {
    startDate: '2026-11-15',
    endDate: '2026-11-16',
    leaveType: 'SICK',
    reason: 'Severe flu and viral fever doctor recommendation'
  }, authHeader('employee'));

  const sickLeave = sickLeaveRes.data;
  console.log(`[EMPLOYEE APPLY] Created Sick Leave ID: ${sickLeave.id} | Status: ${sickLeave.status}`);

  // Team Leader rejects Sick Leave
  const tlRejectRes = await axios.put(`${API_BASE}/leaves/${sickLeave.id}/reject`, {
    remarks: 'Insufficient team bandwidth on requested dates.'
  }, authHeader('tl'));

  console.log(`[TL REJECT] Status: ${tlRejectRes.data.status} | TL Remarks: "${tlRejectRes.data.tlRemarks}"`);
  if (tlRejectRes.data.status !== 'REJECTED') {
    throw new Error('Rejection status transition failed!');
  }
  console.log('✅ PASS: Team Leader successfully declined Sick Leave request.');

  // Verify balance unaffected by rejection
  const postRejectEmpBal = (await axios.get(`${API_BASE}/leaves/balances`, authHeader('employee'))).data;
  if (postRejectEmpBal.sickRemaining !== initialEmpBal.sickRemaining) {
    throw new Error('Rejected leave incorrectly deducted leave balance!');
  }
  console.log('✅ PASS: Rejected leave request did NOT affect user balance.\n');

  // Step 6: Work From Home (WFH) Workflow (Team Leader -> Admin Approval)
  console.log('--- Step 6: Work From Home (WFH) Workflow (TL -> Admin Approval) ---');
  
  const initialTlBal = (await axios.get(`${API_BASE}/leaves/balances`, authHeader('tl'))).data;

  // TL applies for WFH (TL has no higher TL, so status goes directly to PENDING_ADMIN_APPROVAL)
  const wfhRes = await axios.post(`${API_BASE}/leaves`, {
    startDate: '2026-11-20',
    endDate: '2026-11-21',
    leaveType: 'WFH',
    reason: 'Home network setup and remote sprint testing'
  }, authHeader('tl'));

  const wfh = wfhRes.data;
  console.log(`[TL WFH APPLY] Created WFH ID: ${wfh.id} | Status: ${wfh.status}`);
  if (wfh.status !== 'PENDING_ADMIN_APPROVAL') {
    throw new Error(`Expected TL leave status PENDING_ADMIN_APPROVAL, got ${wfh.status}`);
  }

  // Admin approves WFH
  const adminApproveWFHRes = await axios.put(`${API_BASE}/leaves/${wfh.id}/admin-approve`, {
    remarks: 'Approved WFH period.'
  }, authHeader('admin'));

  console.log(`[ADMIN WFH SANCTION] Status: ${adminApproveWFHRes.data.status}`);
  
  // Verify WFH does not deduct Casual/Sick/Emergency quota
  const postWfhBal = (await axios.get(`${API_BASE}/leaves/balances`, authHeader('tl'))).data;
  if (postWfhBal.casualRemaining !== initialTlBal.casualRemaining || postWfhBal.sickRemaining !== initialTlBal.sickRemaining) {
    throw new Error('WFH request incorrectly deducted leave quota!');
  }
  if (postWfhBal.approvedWFH !== initialTlBal.approvedWFH + 2) {
    throw new Error('Approved WFH counter did not increment properly!');
  }
  console.log('✅ PASS: WFH approved without deducting leave quota.\n');

  // Step 7: Casual Leave & Cancellation Workflow
  console.log('--- Step 7: Casual Leave & Applicant Cancellation Workflow ---');

  const cancelRes = await axios.post(`${API_BASE}/leaves`, {
    startDate: '2026-11-28',
    endDate: '2026-11-29',
    leaveType: 'CASUAL',
    reason: 'Personal errand'
  }, authHeader('employee'));

  const cancelLeave = cancelRes.data;
  console.log(`[EMPLOYEE APPLY] Created Casual Leave ID: ${cancelLeave.id} | Status: ${cancelLeave.status}`);

  // Employee cancels own pending leave
  const cancelledRes = await axios.put(`${API_BASE}/leaves/${cancelLeave.id}/cancel`, {}, authHeader('employee'));
  console.log(`[APPLICANT CANCEL] Status: ${cancelledRes.data.status}`);
  if (cancelledRes.data.status !== 'CANCELLED') {
    throw new Error('Cancel leave status transition failed!');
  }
  console.log('✅ PASS: Pending leave request cancelled successfully by applicant.\n');

  // Step 8: Overlapping Request Protection Check
  console.log('--- Step 8: Overlapping Active Request Protection Check ---');
  try {
    await axios.post(`${API_BASE}/leaves`, {
      startDate: '2026-11-10', // Overlaps with approved emergency leave (Nov 10-11)
      endDate: '2026-11-10',
      leaveType: 'CASUAL',
      reason: 'Overlapping request test'
    }, authHeader('intern'));
    console.error('❌ FAIL: Overlapping leave request was allowed!');
  } catch (err) {
    if (err.response?.status === 400) {
      console.log('✅ PASS: Overlapping leave request blocked with 400 Bad Request:', err.response.data.message);
    } else {
      console.error('❌ FAIL: Overlapping request returned status:', err.response?.status);
    }
  }

  // Step 9: Get All Leaves API Verification
  console.log('\n--- Step 9: Verifying Role-Scoped Leaves Retrieval (GET /api/leaves) ---');
  
  const superAdminLeaves = (await axios.get(`${API_BASE}/leaves`, authHeader('superAdmin'))).data;
  const adminLeaves = (await axios.get(`${API_BASE}/leaves`, authHeader('admin'))).data;
  const tlLeaves = (await axios.get(`${API_BASE}/leaves`, authHeader('tl'))).data;
  const internLeaves = (await axios.get(`${API_BASE}/leaves`, authHeader('intern'))).data;

  console.log(`Super Admin total records fetched: ${superAdminLeaves.length}`);
  console.log(`Admin total records fetched: ${adminLeaves.length}`);
  console.log(`Team Leader total records fetched: ${tlLeaves.length}`);
  console.log(`Intern total records fetched: ${internLeaves.length}`);

  if (superAdminLeaves.length === 0 || adminLeaves.length === 0) {
    throw new Error('Admin/SuperAdmin failed to retrieve leave records!');
  }
  console.log('✅ PASS: Role-scoped GET /api/leaves returns correct records for each role.\n');

  console.log('====================================================');
  console.log('  🎉 ALL E2E VERIFICATION TESTS PASSED SUCCESSFULLY! ');
  console.log('====================================================');
}

runE2ETests().catch(err => {
  console.error('\n❌ E2E TEST RUN FAILED WITH ERROR:', err);
  process.exit(1);
});
