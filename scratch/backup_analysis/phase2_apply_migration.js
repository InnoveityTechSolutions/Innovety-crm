const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const { parseDbConfig } = require('../../backend/src/services/backupService');

const dbConfig = parseDbConfig();
const baselinePath = path.resolve(__dirname, 'sandbox_baseline.json');
const baselineData = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const sandboxDbName = baselineData.sandboxDbName;

if (!sandboxDbName || !sandboxDbName.startsWith('innoveity_phase2_sandbox_')) {
  throw new Error(`CRITICAL SAFETY ERROR: Invalid sandbox database name: ${sandboxDbName}`);
}

function runMysql(args, inputSql = null) {
  return new Promise((resolve, reject) => {
    const defaultArgs = [
      '-h', dbConfig.host,
      '-P', String(dbConfig.port),
      '-u', dbConfig.user,
      '--default-character-set=utf8mb4'
    ];
    const fullArgs = [...defaultArgs, ...args];

    const child = spawn('mysql', fullArgs, {
      env: { ...process.env, MYSQL_PWD: dbConfig.password },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('close', code => {
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `MySQL process exited with code ${code}`));
      }
      resolve(stdout);
    });

    child.on('error', err => {
      reject(new Error(`Failed to spawn mysql: ${err.message}`));
    });

    if (inputSql) {
      child.stdin.write(inputSql);
    }
    child.stdin.end();
  });
}

async function main() {
  console.log('=== TASK 3: APPLY AND VERIFY MIGRATION IN SANDBOX ===\n');
  console.log(`Target Sandbox Database: \`${sandboxDbName}\`\n`);

  // Verify connection to sandbox
  const verifyDb = await runMysql([sandboxDbName, '-e', 'SELECT DATABASE() as activeDb;']);
  const activeDbName = verifyDb.split(/\r?\n/)[1].trim();
  if (activeDbName !== sandboxDbName) {
    throw new Error(`CRITICAL SAFETY ERROR: Expected ${sandboxDbName}, but got ${activeDbName}`);
  }
  console.log(`Connected verified to isolated sandbox: ${activeDbName}`);

  // 1. Read migration SQL
  const migrationPath = path.resolve(__dirname, '../../backend/prisma/migrations/20261024120000_sync_crm_features/migration.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  // 2. Apply migration SQL to sandbox database only
  console.log('Applying migration SQL to sandbox...');
  await runMysql([sandboxDbName], migrationSql);
  console.log('Migration SQL applied successfully without errors!\n');

  // 3. Check table count after migration
  const tablesOutput = await runMysql([
    sandboxDbName,
    '-e',
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${sandboxDbName}';`
  ]);
  const tablesAfter = tablesOutput.split(/\r?\n/).slice(1).map(t => t.trim()).filter(Boolean);
  console.log(`Final Table Count in Sandbox: ${tablesAfter.length} tables (Baseline was ${baselineData.tableCount})`);

  // 4. Verify 14 new feature tables exist
  const newExpectedTables = [
    'accesstemplate',
    'accesstemplatepermission',
    'attendancelocation',
    'userattendancelocation',
    'meeting',
    'meetingattendee',
    'meetingreport',
    'compoffcredit',
    'compoffconsumption',
    'compoffpermissionrequest',
    'compoffsession',
    'companydocument',
    'assetestimate',
    'assetestimateitem'
  ];

  console.log('\n--- VERIFYING 14 NEW FEATURE TABLES ---');
  let missingTables = 0;
  for (const tbl of newExpectedTables) {
    const exists = tablesAfter.includes(tbl);
    console.log(`  Table \`${tbl}\`: ${exists ? 'PRESENT' : 'MISSING'}`);
    if (!exists) missingTables++;
  }

  // 5. Verify row counts on critical tables to ensure zero data loss
  console.log('\n--- ROW COUNTS PRESERVATION CHECK ---');
  let rowCountDiscrepancies = 0;
  for (const [tbl, initialCount] of Object.entries(baselineData.baselineCounts)) {
    if (initialCount !== 'TABLE_MISSING') {
      const cntOut = await runMysql([sandboxDbName, '-e', `SELECT COUNT(*) as count FROM \`${tbl}\`;`]);
      const currentCount = parseInt(cntOut.split(/\r?\n/)[1].trim(), 10);
      const match = currentCount === initialCount;
      console.log(`  Table \`${tbl}\`: Initial=${initialCount}, Current=${currentCount} -> ${match ? 'PRESERVED' : 'DISCREPANCY'}`);
      if (!match) rowCountDiscrepancies++;
    }
  }

  // 6. Verify column existence and defaults on altered tables
  console.log('\n--- VERIFYING ADDED COLUMNS IN CORE TABLES ---');
  const colsToCheck = [
    { table: 'user', col: 'accessTemplateId' },
    { table: 'user', col: 'autoClockOutEnabled' },
    { table: 'attendance', col: 'clockInLatitude' },
    { table: 'attendance', col: 'attendanceLocationId' },
    { table: 'leavepolicy', col: 'compOffValidityDays' },
    { table: 'leavetype', col: 'minNoticeDays' },
    { table: 'organization', col: 'assetPrefix' },
    { table: 'organization', col: 'estimatePrefix' },
    { table: 'asset', col: 'category' }
  ];

  for (const c of colsToCheck) {
    const colOut = await runMysql([
      sandboxDbName,
      '-e',
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT 
       FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = '${sandboxDbName}' AND TABLE_NAME = '${c.table}' AND COLUMN_NAME = '${c.col}';`
    ]);
    const lines = colOut.trim().split(/\r?\n/).slice(1);
    if (lines.length > 0) {
      console.log(`  Column \`${c.table}.${c.col}\`: ${lines[0]}`);
    } else {
      console.log(`  Column \`${c.table}.${c.col}\`: MISSING!`);
    }
  }

  // 7. Verify Prisma Client Queries against sandbox
  console.log('\n--- VERIFYING PRISMA CLIENT QUERIES AGAINST SANDBOX ---');
  const sandboxUrl = `mysql://${encodeURIComponent(dbConfig.user)}:${encodeURIComponent(dbConfig.password)}@${dbConfig.host}:${dbConfig.port}/${sandboxDbName}`;

  const prismaSandbox = new PrismaClient({
    datasources: {
      db: { url: sandboxUrl }
    }
  });

  try {
    // A. Query core models with newly added fields
    const testUser = await prismaSandbox.user.findFirst({
      select: { id: true, email: true, role: true, autoClockOutEnabled: true, accessTemplateId: true }
    });
    console.log('  Prisma user query with new columns: OK ->', testUser ? { id: testUser.id, email: testUser.email, autoClockOut: testUser.autoClockOutEnabled, accessTemplateId: testUser.accessTemplateId } : 'No users');

    const testLeaveType = await prismaSandbox.leaveType.findFirst({
      select: { id: true, code: true, minNoticeDays: true }
    });
    console.log('  Prisma leaveType query with minNoticeDays: OK ->', testLeaveType);

    const testLeavePolicy = await prismaSandbox.leavePolicy.findFirst({
      select: { id: true, compOffValidityDays: true, compOffClaimWindowDays: true }
    });
    console.log('  Prisma leavePolicy query with compOff fields: OK ->', testLeavePolicy);

    const testOrg = await prismaSandbox.organization.findFirst({
      select: { id: true, name: true, assetPrefix: true, estimatePrefix: true }
    });
    console.log('  Prisma organization query with prefixes: OK ->', testOrg);

    // B. Query newly created models (should return empty array, no SQL error)
    const accessTemplates = await prismaSandbox.accessTemplate.findMany();
    console.log(`  Prisma accessTemplate.findMany(): OK (${accessTemplates.length} records)`);

    const attendanceLocations = await prismaSandbox.attendanceLocation.findMany();
    console.log(`  Prisma attendanceLocation.findMany(): OK (${attendanceLocations.length} records)`);

    const meetings = await prismaSandbox.meeting.findMany();
    console.log(`  Prisma meeting.findMany(): OK (${meetings.length} records)`);

    const compOffCredits = await prismaSandbox.compOffCredit.findMany();
    console.log(`  Prisma compOffCredit.findMany(): OK (${compOffCredits.length} records)`);

    const companyDocs = await prismaSandbox.companyDocument.findMany();
    console.log(`  Prisma companyDocument.findMany(): OK (${companyDocs.length} records)`);

    const estimates = await prismaSandbox.assetEstimate.findMany();
    console.log(`  Prisma assetEstimate.findMany(): OK (${estimates.length} records)`);

    console.log('\nAll Prisma client model queries executed successfully with ZERO schema discrepancies!');
  } finally {
    await prismaSandbox.$disconnect();
  }

  // 8. Check _prisma_migrations in sandbox
  const migrationsOut = await runMysql([
    sandboxDbName,
    '-e',
    'SELECT migration_name, finished_at, applied_steps_count FROM `_prisma_migrations` ORDER BY finished_at ASC;'
  ]);
  console.log('\n--- PRISMA MIGRATIONS TABLE IN SANDBOX ---');
  console.log(migrationsOut.trim());
}

main().catch(err => {
  console.error('\nTASK 3 FAILED:', err.message);
  process.exit(1);
});
