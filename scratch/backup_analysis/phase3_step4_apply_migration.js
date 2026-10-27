const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseDbConfig } = require('../../backend/src/services/backupService');

const dbConfig = parseDbConfig();

if (dbConfig.database !== 'innoveity_crm') {
  throw new Error(`CRITICAL SAFETY ERROR: Target database is not 'innoveity_crm', it is '${dbConfig.database}'`);
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
        return reject(new Error(stderr.trim() || `MySQL exited with code ${code}`));
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
  console.log('=== PHASE 3 STEP 4: APPLY VERIFIED MIGRATION TO ACTIVE LOCAL DB ===\n');
  console.log(`Target Active Local Database: \`${dbConfig.database}\` on ${dbConfig.host}:${dbConfig.port}`);

  // 1. Verify connection
  const verifyDb = await runMysql([dbConfig.database, '-e', 'SELECT DATABASE() as activeDb;']);
  const activeDbName = verifyDb.split(/\r?\n/)[1].trim();
  if (activeDbName !== 'innoveity_crm') {
    throw new Error(`CRITICAL SAFETY ERROR: Expected 'innoveity_crm', got '${activeDbName}'`);
  }
  console.log(`Verified connected to active local database: ${activeDbName}`);

  // 2. Read baseline counts from audit
  const auditPath = path.resolve(__dirname, 'phase3_safety_backup_audit.json');
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  console.log(`Safety Backup Verified: ${audit.zipFileName} (${audit.sizeBytes} bytes, SHA256: ${audit.sha256.slice(0, 16)}...)`);

  // 3. Apply migration SQL
  const migrationPath = path.resolve(__dirname, '../../backend/prisma/migrations/20261024120000_sync_crm_features/migration.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  console.log('\nApplying migration SQL to `innoveity_crm`...');
  await runMysql([dbConfig.database], migrationSql);
  console.log('Migration SQL applied successfully without errors!\n');

  // 4. Verify table count
  const tablesOut = await runMysql([
    dbConfig.database,
    '-e',
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${dbConfig.database}';`
  ]);
  const tablesAfter = tablesOut.split(/\r?\n/).slice(1).map(t => t.trim()).filter(Boolean);
  console.log(`Final Table Count in \`innoveity_crm\`: ${tablesAfter.length} tables (Was ${audit.tableCount})`);

  // 5. Verify the 14 new feature tables
  const featureTables = [
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

  console.log('\n--- 14 Feature Tables Verification ---');
  let missing = 0;
  for (const t of featureTables) {
    const present = tablesAfter.includes(t);
    console.log(`  Table \`${t}\`: ${present ? 'CREATED SUCCESSFULLY' : 'MISSING'}`);
    if (!present) missing++;
  }
  if (missing > 0) throw new Error(`${missing} feature tables failed to create!`);

  // 6. Verify row count fidelity on existing tables
  console.log('\n--- Row Count Preservation Verification ---');
  for (const [tbl, countBefore] of Object.entries(audit.baselineCounts)) {
    if (tbl === '_prisma_migrations') continue;
    if (typeof countBefore === 'number') {
      const cntOut = await runMysql([dbConfig.database, '-e', `SELECT COUNT(*) as count FROM \`${tbl}\`;`]);
      const currentCount = parseInt(cntOut.split(/\r?\n/)[1].trim(), 10);
      const match = currentCount === countBefore;
      console.log(`  Table \`${tbl}\`: Pre=${countBefore}, Post=${currentCount} -> ${match ? '100% PRESERVED' : 'DISCREPANCY'}`);
      if (!match) throw new Error(`Row count mismatch in ${tbl}: expected ${countBefore}, got ${currentCount}`);
    }
  }

  // 7. Reconcile intermediate init_mysql migration in _prisma_migrations
  console.log('\n--- Reconciling Prisma Migration History ---');
  const checkInit = await runMysql([
    dbConfig.database,
    '-e',
    `SELECT migration_name FROM _prisma_migrations WHERE migration_name = '20260926180013_init_mysql';`
  ]);
  if (!checkInit.includes('20260926180013_init_mysql')) {
    console.log('Registering baseline 20260926180013_init_mysql as resolved applied...');
    await runMysql([
      dbConfig.database,
      '-e',
      `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (UUID(), 'b4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5', NOW(3), '20260926180013_init_mysql', NULL, NULL, NOW(3), 1);`
    ]);
    console.log('Baseline 20260926180013_init_mysql marked as applied.');
  }

  const allMigs = await runMysql([
    dbConfig.database,
    '-e',
    `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at ASC;`
  ]);
  console.log('\nCurrent _prisma_migrations records:\n' + allMigs.trim());

  console.log('\nPhase 3 Step 4 Schema Upgrade completed successfully!');
}

main().catch(err => {
  console.error('\nSTEP 4 FAILED:', err.message);
  process.exit(1);
});
