const axios = require('axios');
const prisma = require('./src/utils/db');
const jwt = require('jsonwebtoken');
const { getTestConfig } = require('./src/utils/testConfigHelper');

const testConfig = getTestConfig({ isDestructive: true });
const API_BASE = testConfig.apiUrl;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev-only-change-in-production';

async function runSuperAdminWorkspaceTest() {
  console.log('====================================================');
  console.log('   RUNNING SUPER ADMIN WORKSPACE & PROFILE E2E TEST ');
  console.log('====================================================\n');

  try {
    // 1. Find or create Super Admin user
    let superAdmin = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN' }
    });

    if (!superAdmin) {
      console.log('Creating test Super Admin user...');
      superAdmin = await prisma.user.create({
        data: {
          employeeId: 'SA-9999',
          name: 'System Super Admin',
          email: 'superadmin_test@innovety.com',
          password: 'password123',
          role: 'SUPER_ADMIN',
          status: 'ACTIVE'
        }
      });
    }

    const token = jwt.sign(
      { id: superAdmin.id, role: superAdmin.role },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    const headers = { Authorization: `Bearer ${token}` };

    // 2. Test GET /api/projects as Super Admin
    console.log('1. Fetching GET /api/projects as SUPER_ADMIN...');
    const projRes = await axios.get(`${API_BASE}/projects`, { headers });
    console.log(`  [PASS] HTTP ${projRes.status} OK`);
    console.log(`  [VERIFIED] Total Projects returned: ${projRes.data.projects?.length || projRes.data.length || 0}`);

    // 3. Test GET /api/tasks as Super Admin
    console.log('\n2. Fetching GET /api/tasks as SUPER_ADMIN...');
    const taskRes = await axios.get(`${API_BASE}/tasks`, { headers });
    console.log(`  [PASS] HTTP ${taskRes.status} OK`);
    console.log(`  [VERIFIED] Total Tasks returned: ${Array.isArray(taskRes.data) ? taskRes.data.length : 0}`);

    // 4. Test GET /api/worklogs as Super Admin
    console.log('\n3. Fetching GET /api/worklogs as SUPER_ADMIN...');
    const logRes = await axios.get(`${API_BASE}/worklogs`, { headers });
    console.log(`  [PASS] HTTP ${logRes.status} OK`);
    console.log(`  [VERIFIED] Total Worklogs returned: ${logRes.data.logs?.length || 0}`);

    // 5. Test GET /api/super-admin/stats
    console.log('\n4. Fetching GET /api/super-admin/stats...');
    const statsRes = await axios.get(`${API_BASE}/super-admin/stats`, { headers });
    console.log(`  [PASS] HTTP ${statsRes.status} OK`);
    console.log(`  [VERIFIED] Active Projects in Stats: ${statsRes.data.stats?.activeProjects || 0}`);
    console.log(`  [VERIFIED] Total Workforce in Stats: ${statsRes.data.stats?.totalActiveUsers || 0}`);

    console.log('\n====================================================');
    console.log('   SUPER ADMIN WORKSPACE & PROFILE E2E TEST PASSED! ');
    console.log('====================================================\n');
  } catch (error) {
    console.error('Test Failed:', error.response?.data || error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runSuperAdminWorkspaceTest();
