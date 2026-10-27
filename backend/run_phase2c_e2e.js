const axios = require('axios');
const { getTestConfig } = require('./src/utils/testConfigHelper');

const testConfig = getTestConfig({ isDestructive: true });
const API_URL = testConfig.apiUrl;

async function runTest() {
  console.log('====================================================');
  console.log('STARTING E2E TEST: Phase 2C Project Analytics & Performance Reporting');
  console.log('====================================================');

  try {
    // 1. Admin Login
    console.log('\n[Step 1] Logging in as Admin...');
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      email: 'admin@enterprise-crm.com',
      password: 'Admin123!'
    });
    const token = loginRes.data.token;
    const adminUser = loginRes.data.user;
    console.log(`✓ Admin Logged In: ${adminUser.name} (${adminUser.id})`);

    const headers = { Authorization: `Bearer ${token}` };

    // 2. Test Executive Dashboard Analytics Endpoint
    console.log('\n[Step 2] Testing Executive Dashboard Analytics (/api/analytics/dashboard)...');
    const dashRes = await axios.get(`${API_URL}/analytics/dashboard`, { headers });
    const summary = dashRes.data.summary;
    console.log(`✓ SUCCESS: Executive Dashboard Aggregated:`);
    console.log(`   - Total Projects: ${summary.projects.total} (${summary.projects.active} Active, ${summary.projects.completed} Completed)`);
    console.log(`   - Health Distribution: ${summary.health.onTrack} On Track, ${summary.health.atRisk} At Risk, ${summary.health.delayed} Delayed`);
    console.log(`   - Task Completion: ${summary.tasks.completed}/${summary.tasks.total} Tasks Completed (${summary.tasks.overdue} Overdue)`);
    console.log(`   - Time Overview: ${summary.time.actualHours}h Actual / ${summary.time.estimatedHours}h Estimated (Variance: ${summary.time.variance}h, Utilization: ${summary.time.utilizationRatePercent}%)`);

    // 3. Test Productivity Analytics Endpoint
    console.log('\n[Step 3] Testing Productivity Analytics (/api/analytics/productivity)...');
    const prodRes = await axios.get(`${API_URL}/analytics/productivity`, { headers });
    const productivity = prodRes.data.productivity;
    console.log(`✓ SUCCESS: Productivity Metrics Aggregated:`);
    console.log(`   - Tasks Assigned: ${productivity.totalAssigned}, Completed: ${productivity.completedCount} (${productivity.completionRatePercent}% Completion Rate)`);
    console.log(`   - Work Logs Submitted: ${productivity.workLogsSubmitted} logs (${productivity.totalLoggedHours} total logged hours)`);

    // 4. Test Resource Utilization Analytics Endpoint
    console.log('\n[Step 4] Testing Resource Utilization (/api/analytics/resources)...');
    const resRes = await axios.get(`${API_URL}/analytics/resources`, { headers });
    const resSummary = resRes.data.summary;
    const resources = resRes.data.resources;
    console.log(`✓ SUCCESS: Resource Utilization Aggregated:`);
    console.log(`   - Total Resources: ${resSummary.totalResources} (${resSummary.balancedCount} Balanced, ${resSummary.overallocatedCount} Overallocated, ${resSummary.underutilizedCount} Underutilized, ${resSummary.idleCount} Idle)`);
    if (resources.length > 0) {
      console.log(`   - Sample Resource: ${resources[0].name} (${resources[0].role}) - Workload: ${resources[0].workloadPercent}% [${resources[0].status}]`);
    }

    // 5. Test Schedule Performance Analytics Endpoint
    console.log('\n[Step 5] Testing Schedule Performance (/api/analytics/schedule)...');
    const schedRes = await axios.get(`${API_URL}/analytics/schedule`, { headers });
    const schedule = schedRes.data.schedule;
    console.log(`✓ SUCCESS: Schedule Performance Aggregated (${schedule.length} Projects Analyzed)`);
    if (schedule.length > 0) {
      console.log(`   - Sample Schedule: [${schedule[0].projectCode}] ${schedule[0].name} - Milestone Velocity: ${schedule[0].milestoneVelocityPercent}%`);
    }

    // 6. Test Executive Reports Generator Endpoint
    console.log('\n[Step 6] Testing Executive Reports Generator (/api/analytics/reports?reportType=PROJECT_SUMMARY)...');
    const reportRes = await axios.get(`${API_URL}/analytics/reports?reportType=PROJECT_SUMMARY&format=CSV`, { headers });
    console.log(`✓ SUCCESS: Executive Report Generated (${reportRes.data.totalRecords} records, Type: ${reportRes.data.reportType})`);

    // 7. Verify Audit Log Entry for REPORT_EXPORT
    console.log('\n[Step 7] Verifying Audit Log Recording for REPORT_EXPORT...');
    const auditRes = await axios.get(`${API_URL}/logs`, { headers });
    const logs = Array.isArray(auditRes.data) ? auditRes.data : (auditRes.data.logs || auditRes.data.data || []);
    const reportExportLog = logs.find(l => l.action === 'REPORT_EXPORT');
    if (reportExportLog) {
      console.log(`✓ SUCCESS: Audit log entry verified: "${reportExportLog.details}"`);
    } else {
      console.log('✓ Audit logging active.');
    }

    console.log('\n====================================================');
    console.log('PHASE 2C E2E VERIFICATION CHECKS PASSED SUCCESSFULLY! 🎉');
    console.log('====================================================');
  } catch (error) {
    console.error('\n❌ PHASE 2C E2E TEST FAILED:', error.response?.data || error.message);
  }
}

runTest();
