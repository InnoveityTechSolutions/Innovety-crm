const axios = require('axios');
const prisma = require('./src/utils/db');
const jwt = require('jsonwebtoken');
const { getTestConfig } = require('./src/utils/testConfigHelper');

const testConfig = getTestConfig({ isDestructive: true });
const API_BASE = testConfig.apiUrl;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev-only-change-in-production';

async function runDashboardLeaveSyncTest() {
  console.log('====================================================');
  console.log('   RUNNING ADMIN DASHBOARD LEAVE SYNC E2E TEST       ');
  console.log('====================================================\n');

  try {
    // Find Employee and Admin users
    const employee = await prisma.user.findFirst({
      where: { role: 'EMPLOYEE', email: 'prasathragul75@gmail.com' }
    }) || await prisma.user.findFirst({ where: { role: 'EMPLOYEE' } });

    const admin = await prisma.user.findFirst({
      where: { role: 'ADMIN', email: '2admin@gmail.com' }
    }) || await prisma.user.findFirst({ where: { role: 'ADMIN' } });

    if (!employee || !admin) {
      throw new Error('Test requires both an EMPLOYEE and an ADMIN user in database.');
    }

    const empToken = jwt.sign({ id: employee.id, role: employee.role }, JWT_SECRET, { expiresIn: '1d' });
    const adminToken = jwt.sign({ id: admin.id, role: admin.role }, JWT_SECRET, { expiresIn: '1d' });

    // 1. Fetch current pending leaves as Admin
    console.log('1. Fetching current pending leaves from backend as Admin...');
    const initialLeavesRes = await axios.get(`${API_BASE}/leaves`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    const allLeaves = initialLeavesRes.data.leaves || initialLeavesRes.data || [];
    const pendingStatuses = ['PENDING_ADMIN_APPROVAL', 'PENDING_TL_APPROVAL', 'PENDING'];
    const initialPendingCount = allLeaves.filter(l => pendingStatuses.includes(l.status)).length;

    console.log(`  [PASS] Actionable Pending Count for Admin: ${initialPendingCount}`);

    // 2. Submit new leave request for Employee on random unique future date
    const randomOffset = Math.floor(Math.random() * 500) + 100;
    const leaveDate = new Date();
    leaveDate.setDate(leaveDate.getDate() + randomOffset);
    const leaveDateStr = leaveDate.toISOString().split('T')[0];

    console.log(`\n2. Submitting new leave for Employee on ${leaveDateStr}...`);
    const createRes = await axios.post(`${API_BASE}/leaves`, {
      startDate: leaveDateStr,
      endDate: leaveDateStr,
      leaveType: 'WFH',
      payType: 'UNPAID',
      reason: 'Sync Verification Test Leave'
    }, {
      headers: { Authorization: `Bearer ${empToken}` }
    });

    const newLeaveId = createRes.data.leave?.id || createRes.data.id;
    console.log(`  [PASS] Created leave ID: ${newLeaveId}, Status: ${createRes.data.leave?.status || createRes.data.status}`);

    // Fetch leaves again as Admin to verify pending count incremented by 1
    const postSubmitRes = await axios.get(`${API_BASE}/leaves`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const postSubmitLeaves = postSubmitRes.data.leaves || postSubmitRes.data || [];
    const postSubmitPendingCount = postSubmitLeaves.filter(l => pendingStatuses.includes(l.status)).length;

    if (postSubmitPendingCount !== initialPendingCount + 1) {
      throw new Error(`Admin pending count did not increment. Expected ${initialPendingCount + 1}, got ${postSubmitPendingCount}`);
    }
    console.log(`  [VERIFIED] Admin Dashboard Pending Count after submission: ${postSubmitPendingCount} (was ${initialPendingCount})`);

    // 3. Process approval for the newly created leave (TL approve then Admin approve)
    console.log('\n3. Processing approval...');
    await axios.put(`${API_BASE}/leaves/${newLeaveId}/tl-approve`, {
      tlComment: 'Recommended by TL'
    }, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    await axios.put(`${API_BASE}/leaves/${newLeaveId}/admin-approve`, {
      adminComment: 'Approved by Admin'
    }, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    // Fetch leaves again as Admin to verify pending count decremented back
    const postApproveRes = await axios.get(`${API_BASE}/leaves`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const postApproveLeaves = postApproveRes.data.leaves || postApproveRes.data || [];
    const postApprovePendingCount = postApproveLeaves.filter(l => pendingStatuses.includes(l.status)).length;

    if (postApprovePendingCount !== initialPendingCount) {
      throw new Error(`Admin pending count did not decrement back. Expected ${initialPendingCount}, got ${postApprovePendingCount}`);
    }
    console.log(`  [VERIFIED] Admin Dashboard Pending Count after approval: ${postApprovePendingCount} (decreased by 1)`);

    console.log('\n====================================================');
    console.log('   ADMIN DASHBOARD LEAVE SYNC TEST SUCCESSFUL!       ');
    console.log('====================================================\n');
  } catch (error) {
    console.error('TEST FAILED:', error.response?.data || error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runDashboardLeaveSyncTest();
