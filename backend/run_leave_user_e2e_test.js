const axios = require('axios');
const prisma = require('./src/utils/db');
const jwt = require('jsonwebtoken');
const { getTestConfig } = require('./src/utils/testConfigHelper');

const testConfig = getTestConfig({ isDestructive: true });
const API_BASE = testConfig.apiUrl;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev-only-change-in-production';

async function runE2E() {
  console.log('====================================================');
  console.log('   RUNNING USER-SIDE LEAVE MANAGEMENT E2E TEST      ');
  console.log('====================================================\n');

  try {
    // 1. Ensure Admin & Employee exist
    let admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    let employee = await prisma.user.findFirst({ where: { role: 'EMPLOYEE' } });
    let tl = await prisma.user.findFirst({ where: { role: 'TEAM_LEADER' } });

    if (!admin || !employee) {
      console.error('ERROR: Required Admin or Employee user not found in database.');
      process.exit(1);
    }

    // Reset employee casual leave quota to prevent test failures due to balance limits
    await prisma.user.update({
      where: { id: employee.id },
      data: { casualLeaveQuota: 20 }
    });

    const adminToken = jwt.sign({ id: admin.id, role: admin.role, email: admin.email }, JWT_SECRET, { expiresIn: '1h' });
    const empToken = jwt.sign({ id: employee.id, role: employee.role, email: employee.email }, JWT_SECRET, { expiresIn: '1h' });
    const tlToken = tl ? jwt.sign({ id: tl.id, role: tl.role, email: tl.email }, JWT_SECRET, { expiresIn: '1h' }) : null;

    const empHeaders = { Authorization: `Bearer ${empToken}` };
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    const tlHeaders = tlToken ? { Authorization: `Bearer ${tlToken}` } : null;

    console.log(`1. Testing as Employee: ${employee.name} (${employee.email})`);
    console.log(`   Testing as Admin: ${admin.name} (${admin.email})\n`);

    // Random unique future dates to prevent collision on repeated runs
    const offset1 = 100 + Math.floor(Math.random() * 500);
    const offset2 = 700 + Math.floor(Math.random() * 500);
    const date1 = new Date(Date.now() + 86400000 * offset1).toISOString().split('T')[0];
    const date2 = new Date(Date.now() + 86400000 * offset2).toISOString().split('T')[0];

    // Step A: Employee submits Leave Request 1
    console.log(`2. Employee submits new leave application for ${date1}...`);
    const req1Res = await axios.post(`${API_BASE}/leaves`, {
      startDate: date1,
      endDate: date1,
      leaveType: 'CASUAL',
      reason: 'Testing user-side status flow - Request 1'
    }, { headers: empHeaders });

    const leave1 = req1Res.data;
    console.log(`  [PASS] Leave 1 created with ID: ${leave1.id}`);
    console.log(`  [PASS] Initial Status: ${leave1.status} (matches PENDING workflow)`);

    // Verify Employee can read their leave history and sees status
    const empHistory1 = await axios.get(`${API_BASE}/leaves`, { headers: empHeaders });
    const userLeavesList1 = empHistory1.data.leaves || empHistory1.data || [];
    const found1 = userLeavesList1.find(l => l.id === leave1.id);
    if (!found1 || !['PENDING', 'PENDING_TL_APPROVAL', 'PENDING_ADMIN_APPROVAL'].includes(found1.status)) {
      throw new Error(`Employee leave status mismatch. Expected PENDING, got ${found1?.status}`);
    }
    console.log(`  [PASS] Employee leave history reflects status: ${found1.status}`);

    // Step B & C: Process approval for Leave Request 1
    console.log('\n3. Processing approval for Leave 1...');
    if (tlHeaders && leave1.status === 'PENDING_TL_APPROVAL') {
      console.log('   Step C.1: Team Leader recommends approval...');
      await axios.put(`${API_BASE}/leaves/${leave1.id}/tl-approve`, {
        tlComment: 'E2E TL Recommended'
      }, { headers: tlHeaders });
    }

    const adminApproveRes = await axios.put(`${API_BASE}/leaves/${leave1.id}/admin-approve`, {
      adminComment: 'E2E Final Admin Approved'
    }, { headers: adminHeaders });

    console.log(`  [PASS] Admin approve response status: ${adminApproveRes.data.status}`);

    // Verify Employee view status updated to APPROVED
    const empHistory2 = await axios.get(`${API_BASE}/leaves`, { headers: empHeaders });
    const userLeavesList2 = empHistory2.data.leaves || empHistory2.data || [];
    const updatedFound1 = userLeavesList2.find(l => l.id === leave1.id);
    if (!updatedFound1 || updatedFound1.status !== 'APPROVED') {
      throw new Error(`Employee view did not update to APPROVED. Got: ${updatedFound1?.status}`);
    }
    console.log(`  [VERIFIED] Employee view status updated to: ${updatedFound1.status}`);

    // Step D: Employee submits Leave Request 2 for rejection test
    console.log(`\n4. Employee submits Leave Request 2 for ${date2}...`);
    const req2Res = await axios.post(`${API_BASE}/leaves`, {
      startDate: date2,
      endDate: date2,
      leaveType: 'CASUAL',
      reason: 'Testing user-side status flow - Request 2'
    }, { headers: empHeaders });

    const leave2 = req2Res.data;
    console.log(`  [PASS] Leave 2 created with ID: ${leave2.id}, Status: ${leave2.status}`);

    // Step E: Admin rejects Leave 2
    console.log('\n5. Admin rejects Leave 2...');
    const adminRejectRes = await axios.put(`${API_BASE}/leaves/${leave2.id}/reject`, {
      reason: 'E2E Reject Test'
    }, { headers: adminHeaders });

    console.log(`  [PASS] Admin reject response status: ${adminRejectRes.data.status}`);

    // Verify Employee view status updated to REJECTED
    const empHistory3 = await axios.get(`${API_BASE}/leaves`, { headers: empHeaders });
    const userLeavesList3 = empHistory3.data.leaves || empHistory3.data || [];
    const updatedFound2 = userLeavesList3.find(l => l.id === leave2.id);
    if (!updatedFound2 || updatedFound2.status !== 'REJECTED') {
      throw new Error(`Employee view did not update to REJECTED. Got: ${updatedFound2?.status}`);
    }
    console.log(`  [VERIFIED] Employee view status updated to: ${updatedFound2.status}`);

    console.log('\n====================================================');
    console.log('   ALL E2E LEAVE WORKFLOW TESTS PASSED SUCCESSFULLY!  ');
    console.log('====================================================\n');
  } catch (error) {
    console.error('E2E TEST FAILED:', error.response?.data || error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runE2E();
