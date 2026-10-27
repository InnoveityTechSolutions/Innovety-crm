const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const archiver = require('../../backend/node_modules/archiver');
const JSZip = require('../../backend/node_modules/jszip');
const { parseDbConfig, formatBytes } = require('../../backend/src/services/backupService');

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

function runMysqldump(dbName) {
  return new Promise((resolve, reject) => {
    const dumpArgs = [
      '-h', dbConfig.host,
      '-P', String(dbConfig.port),
      '-u', dbConfig.user,
      '--default-character-set=utf8mb4',
      '--single-transaction',
      '--routines',
      '--triggers',
      dbName
    ];

    const child = spawn('mysqldump', dumpArgs, {
      env: { ...process.env, MYSQL_PWD: dbConfig.password },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('close', code => {
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `mysqldump exited with code ${code}`));
      }
      resolve(stdout);
    });

    child.on('error', err => {
      reject(new Error(`Failed to spawn mysqldump: ${err.message}`));
    });
  });
}

async function main() {
  console.log('=== PHASE 3 STEP 2: CREATE & VERIFY SAFETY BACKUP OF ACTIVE LOCAL DB ===\n');
  console.log(`Target Active Local Database: \`${dbConfig.database}\` on ${dbConfig.host}:${dbConfig.port}`);

  // 1. Verify connection and current table count
  const verifyDb = await runMysql([dbConfig.database, '-e', 'SELECT DATABASE() as activeDb, VERSION() as version;']);
  console.log('Connection verified:\n' + verifyDb.trim());

  const tablesOut = await runMysql([
    dbConfig.database,
    '-e',
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${dbConfig.database}';`
  ]);
  const tableList = tablesOut.split(/\r?\n/).slice(1).map(t => t.trim()).filter(Boolean);
  console.log(`\nCurrent Table Count in \`${dbConfig.database}\`: ${tableList.length} tables`);

  // 2. Query critical baseline row counts
  const criticalTables = [
    'user',
    'organization',
    'attendance',
    'leavepolicy',
    'leavetype',
    'leaverequest',
    'payrollbatch',
    'asset',
    'shift',
    'workcalendar',
    '_prisma_migrations'
  ];

  console.log('\n--- ACTIVE LOCAL DB PRE-UPGRADE ROW COUNTS ---');
  const activeBaselineCounts = {};
  for (const tbl of criticalTables) {
    if (tableList.includes(tbl)) {
      const cntOut = await runMysql([dbConfig.database, '-e', `SELECT COUNT(*) as count FROM \`${tbl}\`;`]);
      const count = parseInt(cntOut.split(/\r?\n/)[1].trim(), 10);
      activeBaselineCounts[tbl] = count;
      console.log(`  Table \`${tbl}\`: ${count} rows`);
    } else {
      activeBaselineCounts[tbl] = 'MISSING';
      console.log(`  Table \`${tbl}\`: MISSING`);
    }
  }

  // 3. Dump the active database
  console.log('\nExecuting mysqldump on `innoveity_crm`...');
  const sqlDump = await runMysqldump(dbConfig.database);
  console.log(`mysqldump completed! SQL Dump Size: ${formatBytes(sqlDump.length)} (${sqlDump.length} bytes)`);

  // 4. Create ZIP archive
  const timestamp = Math.floor(Date.now() / 1000);
  const zipFileName = `phase3_safety_backup_before_upgrade_${timestamp}.zip`;
  const zipFilePath = path.resolve(__dirname, '../../backend/backups', zipFileName);

  const backupInfo = {
    database: dbConfig.database,
    totalTables: tableList.length,
    totalRecords: Object.values(activeBaselineCounts).reduce((a, b) => (typeof b === 'number' ? a + b : a), 0),
    createdAt: new Date().toISOString(),
    createdBy: 'Phase 3 Safety Protocol',
    mysqlVersion: '8.0.46',
    type: 'Pre-Upgrade Safety Backup'
  };

  const readme = `InnovEity CRM - Pre-Upgrade Safety Backup
Database: ${dbConfig.database}
Created: ${backupInfo.createdAt}
Tables: ${backupInfo.totalTables}
Purpose: Full safety snapshot taken immediately before Phase 3 local database upgrade.`;

  console.log(`Creating safety archive: ${zipFileName}...`);
  await new Promise((resolve, reject) => {
    const outStream = fs.createWriteStream(zipFilePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    outStream.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(outStream);
    archive.append(sqlDump, { name: 'database/innoveity_live.sql' });
    archive.append(JSON.stringify(backupInfo, null, 2), { name: 'backup_info.json' });
    archive.append(readme, { name: 'README.txt' });
    archive.finalize();
  });

  const zipStat = fs.statSync(zipFilePath);
  const zipBuf = fs.readFileSync(zipFilePath);
  const sha256 = crypto.createHash('sha256').update(zipBuf).digest('hex');
  console.log(`Safety ZIP created successfully! Size: ${formatBytes(zipStat.size)} (${zipStat.size} bytes)`);
  console.log(`SHA256: ${sha256}`);

  // 5. Test restore into a disposable verification database
  const verifyDbName = `innoveity_phase3_verify_backup_${timestamp}`;
  console.log(`\nTesting recoverability: Restoring backup into disposable database \`${verifyDbName}\`...`);

  await runMysql(['-e', `CREATE DATABASE \`${verifyDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`]);

  try {
    // Unzip and restore
    const zip = await JSZip.loadAsync(zipBuf);
    const sqlFromZip = await zip.file('database/innoveity_live.sql').async('string');
    await runMysql([verifyDbName], sqlFromZip);

    // Verify table count and counts in verifyDbName
    const verifyTablesOut = await runMysql([
      verifyDbName,
      '-e',
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${verifyDbName}';`
    ]);
    const verifyTableList = verifyTablesOut.split(/\r?\n/).slice(1).map(t => t.trim()).filter(Boolean);
    console.log(`Restored Table Count in Verification DB: ${verifyTableList.length} tables (Original: ${tableList.length})`);

    if (verifyTableList.length !== tableList.length) {
      throw new Error(`Restore Verification Mismatch: Expected ${tableList.length} tables, got ${verifyTableList.length}`);
    }

    console.log('Checking row count fidelity in verification database:');
    for (const [tbl, originalCount] of Object.entries(activeBaselineCounts)) {
      if (typeof originalCount === 'number') {
        const cntOut = await runMysql([verifyDbName, '-e', `SELECT COUNT(*) as count FROM \`${tbl}\`;`]);
        const restoredCount = parseInt(cntOut.split(/\r?\n/)[1].trim(), 10);
        if (restoredCount !== originalCount) {
          throw new Error(`Restore Row Count Mismatch for ${tbl}: Expected ${originalCount}, got ${restoredCount}`);
        }
        console.log(`  Table \`${tbl}\`: ${restoredCount} rows (Matches 100%)`);
      }
    }

    console.log('\nBackup archive integrity & restoration verified 100%!');
  } finally {
    console.log(`Cleaning up verification database \`${verifyDbName}\`...`);
    await runMysql(['-e', `DROP DATABASE IF EXISTS \`${verifyDbName}\`;`]);
    console.log(`Verification database \`${verifyDbName}\` dropped cleanly.`);
  }

  // Save audit record to scratch
  fs.writeFileSync(
    path.resolve(__dirname, 'phase3_safety_backup_audit.json'),
    JSON.stringify({
      zipFileName,
      zipFilePath,
      sizeBytes: zipStat.size,
      sha256,
      tableCount: tableList.length,
      baselineCounts: activeBaselineCounts,
      verifiedRestore: true,
      timestamp: new Date().toISOString()
    }, null, 2)
  );

  console.log('\nStep 2 Safety Backup completed and verified!');
}

main().catch(err => {
  console.error('\nSAFETY BACKUP FAILED:', err.message);
  process.exit(1);
});
