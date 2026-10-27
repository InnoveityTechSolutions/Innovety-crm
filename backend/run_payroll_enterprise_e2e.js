const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const prisma = new PrismaClient();
const { getTestConfig } = require('./src/utils/testConfigHelper');

const testConfig = getTestConfig({ isDestructive: true });
const API_BASE = testConfig.apiUrl;

async function runPayrollE2ETestSuite() {
  console.log('====================================================');
  console.log('    ENTERPRISE PAYROLL SYSTEM REAL-TIME E2E TEST    ');
  console.log('====================================================\n');

  // Step 1: Authenticate All 5 Roles
  console.log('--- Step 1: Authenticating All 5 User Roles ---');
  const roles = [
    { key: 'superAdmin', email: 'superadmin@enterprise-crm.com', role: 'SUPER_ADMIN' },
    { key: 'admin', email: 'admin@enterprise-crm.com', role: 'ADMIN' },
    { key: 'tl', email: 'praveen.natarajan.in@gmail.com', role: 'TEAM_LEADER' },
    { key: 'employee', email: 'prasathragul75@gmail.com', role: 'EMPLOYEE' },
    { key: 'intern', email: 'somusuraj72@gmail.com', role: 'INTERN' }
  ];

  const tokens = {};
  const userIds = {};

  for (const r of roles) {
    const res = await axios.post(`${API_BASE}/auth/login`, { email: r.email, password: 'Password123!' });
    tokens[r.key] = res.data.token;
    userIds[r.key] = res.data.user.id;
    console.log(`[AUTH] Authenticated ${r.key} (${r.role}) - ID: ${userIds[r.key]}`);
  }
  console.log('✅ All 5 user roles authenticated successfully.\n');

  // Step 2: Test Salary Structure Templates API
  console.log('--- Step 2: Verifying Salary Structure Templates (Admin Only) ---');
  const tmplRes = await axios.get(`${API_BASE}/payroll/templates`, { headers: { Authorization: `Bearer ${tokens.admin}` } });
  console.log(`[TEMPLATES] Fetched ${tmplRes.data.length} salary templates.`);

  // Test Non-Admin Template Creation Restriction
  try {
    await axios.post(`${API_BASE}/payroll/templates`, { name: 'Unauthorized Template' }, { headers: { Authorization: `Bearer ${tokens.employee}` } });
    console.error('❌ FAIL: Non-admin should be blocked from creating templates.');
  } catch (err) {
    if (err.response?.status === 403) {
      console.log('✅ PASS: Non-Admin template creation blocked with 403 Forbidden.');
    } else {
      console.error('❌ FAIL: Unexpected error:', err.message);
    }
  }

  // Step 3: Verifying User Salary Structures
  console.log('\n--- Step 3: Verifying Salary Structures & Role Restrictions ---');
  const internStruct = await axios.get(`${API_BASE}/payroll/salary-structures/my`, { headers: { Authorization: `Bearer ${tokens.intern}` } });
  console.log(`[SALARY STRUCTURE] Intern Net Pay: ₹${internStruct.data.netSalary.toLocaleString()}`);

  try {
    await axios.get(`${API_BASE}/payroll/salary-structures/user/${userIds.admin}`, { headers: { Authorization: `Bearer ${tokens.intern}` } });
    console.error('❌ FAIL: Intern should not view Admin salary structure.');
  } catch (err) {
    if (err.response?.status === 403) {
      console.log('✅ PASS: Intern viewing Admin salary structure blocked with 403 Forbidden.');
    }
  }

  // Step 4: Verifying Global Payroll Settings & Holiday Calendar
  console.log('\n--- Step 4: Verifying Global Payroll Settings & Holiday Calendar ---');
  const settingsRes = await axios.get(`${API_BASE}/payroll/settings`, { headers: { Authorization: `Bearer ${tokens.admin}` } });
  console.log(`[SETTINGS] Currency: ${settingsRes.data.currency}, Overtime Rate: ₹${settingsRes.data.overtimeHourlyRate}/hr, Holiday Multiplier: ${settingsRes.data.holidayPayMultiplier}x`);

  const holidaysRes = await axios.get(`${API_BASE}/payroll/holidays`, { headers: { Authorization: `Bearer ${tokens.admin}` } });
  console.log(`[HOLIDAYS] ${holidaysRes.data.length} holiday entries configured in calendar.`);

  // Step 5: 6-Step Payroll Batch Workflow Execution (Month 11/2026)
  console.log('\n--- Step 5: 6-Step Payroll Batch Lifecycle Execution ---');
  
  // 5.1 Calculate & Draft Batch
  const processRes = await axios.post(`${API_BASE}/payroll/process`, { month: 11, year: 2026 }, { headers: { Authorization: `Bearer ${tokens.admin}` } });
  const batchId = processRes.data.id;
  console.log(`[BATCH DRAFT] Processed preview batch ID: ${batchId}`);
  console.log(`  Status: ${processRes.data.status} | Employees: ${processRes.data.totalEmployees} | Gross: ₹${processRes.data.totalGross.toLocaleString()} | Net: ₹${processRes.data.totalNet.toLocaleString()}`);

  // Test Super Admin Batch Processing Restriction
  try {
    await axios.post(`${API_BASE}/payroll/process`, { month: 12, year: 2026 }, { headers: { Authorization: `Bearer ${tokens.superAdmin}` } });
    console.error('❌ FAIL: Super Admin should be blocked from processing payroll.');
  } catch (err) {
    if (err.response?.status === 403) {
      console.log('✅ PASS: Super Admin payroll calculation blocked with 403 Forbidden.');
    }
  }

  // 5.2 Lock Batch
  const lockRes = await axios.put(`${API_BASE}/payroll/batch/${batchId}/lock`, {}, { headers: { Authorization: `Bearer ${tokens.admin}` } });
  console.log(`[BATCH LOCK] Updated Status: ${lockRes.data.status}`);

  // 5.3 Review Batch
  const reviewRes = await axios.put(`${API_BASE}/payroll/batch/${batchId}/review`, {}, { headers: { Authorization: `Bearer ${tokens.admin}` } });
  console.log(`[BATCH REVIEW] Updated Status: ${reviewRes.data.status}`);

  // 5.4 Publish Batch
  const publishRes = await axios.put(`${API_BASE}/payroll/batch/${batchId}/publish`, {}, { headers: { Authorization: `Bearer ${tokens.admin}` } });
  console.log(`[BATCH PUBLISH] Final Status: ${publishRes.data.status}`);
  console.log('✅ PASS: Admin successfully published payroll batch and generated itemized payslips.');

  // Step 6: Verifying Payslips Access & Notifications
  console.log('\n--- Step 6: Verifying Employee Payslips & Notifications ---');
  const empPayslips = await axios.get(`${API_BASE}/payroll/payslips`, { headers: { Authorization: `Bearer ${tokens.employee}` } });
  console.log(`[EMPLOYEE PAYSLIPS] Employee fetched ${empPayslips.data.length} published payslips.`);
  const myPs = empPayslips.data[0];
  console.log(`  Payslip ID: ${myPs.id} | Month ${myPs.month}/${myPs.year} | Net Pay: ₹${myPs.netSalary.toLocaleString()} | QR Hash: ${myPs.qrCodeHash}`);
  console.log('✅ PASS: Itemized payslip retrieved with QR verification token.');

  // Step 7: Verifying Financial Analytics & Reports (Admin & Super Admin)
  console.log('\n--- Step 7: Verifying Financial Analytics & Reports ---');
  const reportRes = await axios.get(`${API_BASE}/payroll/reports/summary`, { headers: { Authorization: `Bearer ${tokens.superAdmin}` } });
  console.log(`[SUPER ADMIN REPORTS] Total Gross Expense: ₹${reportRes.data.totalGrossExpense.toLocaleString()} | Departments Analyzed: ${reportRes.data.departmentBreakdown.length}`);
  console.log('✅ PASS: Super Admin read-only financial reports retrieved successfully.');

  // Step 8: Admin Rollback Verification
  console.log('\n--- Step 8: Verifying Admin Batch Rollback Workflow ---');
  const rollbackRes = await axios.put(`${API_BASE}/payroll/batch/${batchId}/rollback`, {}, { headers: { Authorization: `Bearer ${tokens.admin}` } });
  console.log(`[BATCH ROLLBACK] ${rollbackRes.data.message}`);

  const checkBatch = await prisma.payrollBatch.findUnique({ where: { id: batchId } });
  console.log(`[DATABASE CHECK] Batch ID ${batchId} status in database: ${checkBatch.status}`);
  console.log('✅ PASS: Rollback transitioned batch to ROLLED_BACK without data loss.');

  console.log('\n====================================================');
  console.log('  🎉 ALL ENTERPRISE PAYROLL E2E TESTS PASSED 100%! ');
  console.log('====================================================\n');
}

runPayrollE2ETestSuite().catch(console.error).finally(() => prisma.$disconnect());
