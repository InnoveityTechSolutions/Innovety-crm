const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const { parseDbConfig } = require('../../backend/src/services/backupService');

const dbConfig = parseDbConfig();
const baselinePath = path.resolve(__dirname, 'sandbox_baseline.json');
const baselineData = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const sandboxDbName = baselineData.sandboxDbName;

const sandboxUrl = `mysql://${encodeURIComponent(dbConfig.user)}:${encodeURIComponent(dbConfig.password)}@${dbConfig.host}:${dbConfig.port}/${sandboxDbName}`;

const prismaSandbox = new PrismaClient({
  datasources: {
    db: { url: sandboxUrl }
  }
});

async function testAllPrismaModels() {
  console.log('Testing all Prisma client models against migrated sandbox...');
  const models = [
    'user',
    'organization',
    'attendance',
    'leavePolicy',
    'leaveType',
    'leaveRequest',
    'payrollBatch',
    'asset',
    'accessTemplate',
    'accessTemplatePermission',
    'attendanceLocation',
    'userAttendanceLocation',
    'meeting',
    'meetingAttendee',
    'meetingReport',
    'compOffCredit',
    'compOffConsumption',
    'compOffPermissionRequest',
    'compOffSession',
    'companyDocument',
    'assetEstimate',
    'assetEstimateItem'
  ];

  const results = {};
  for (const m of models) {
    try {
      if (prismaSandbox[m]) {
        const rows = await prismaSandbox[m].findMany({ take: 1 });
        results[m] = { success: true, count: rows.length };
      } else {
        results[m] = { success: false, error: 'Model not on PrismaClient instance' };
      }
    } catch (err) {
      results[m] = { success: false, error: err.message };
    }
  }

  for (const [m, res] of Object.entries(results)) {
    if (res.success) {
      console.log(`  Model [${m}]: OK`);
    } else {
      console.log(`  Model [${m}]: FAILED -> ${res.error}`);
    }
  }

  await prismaSandbox.$disconnect();
}

testAllPrismaModels();
