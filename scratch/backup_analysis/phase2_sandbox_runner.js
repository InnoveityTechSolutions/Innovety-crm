const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const JSZip = require('../../backend/node_modules/jszip');
const { parseDbConfig } = require('../../backend/src/services/backupService');

const dbConfig = parseDbConfig();
const timestamp = Math.floor(Date.now() / 1000);
const sandboxDbName = `innoveity_phase2_sandbox_${timestamp}`;

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
  console.log('=== TASK 2: CREATE ISOLATED SANDBOX & RESTORE LIVE BACKUP ===\n');
  console.log(`Target MySQL host: ${dbConfig.host}:${dbConfig.port}`);
  console.log(`Disposable Sandbox Name: ${sandboxDbName}\n`);

  // 1. Verify backup file
  const backupZipPath = path.resolve(__dirname, '../../backend/backups/restored_backup_2026-10-23_17-00.zip');
  if (!fs.existsSync(backupZipPath)) {
    throw new Error(`Backup file not found at: ${backupZipPath}`);
  }

  const zipBuf = fs.readFileSync(backupZipPath);
  const sha256 = crypto.createHash('sha256').update(zipBuf).digest('hex');
  console.log(`Source Backup File: restored_backup_2026-10-23_17-00.zip`);
  console.log(`File Size: ${zipBuf.length} bytes`);
  console.log(`SHA256 Checksum: ${sha256}`);

  const zip = await JSZip.loadAsync(zipBuf);
  const metadataEntry = zip.file('backup_info.json');
  if (metadataEntry) {
    const meta = JSON.parse(await metadataEntry.async('string'));
    console.log(`Metadata: DB=${meta.database}, TotalTables=${meta.totalTables}, TotalRecords=${meta.totalRecords}, CreatedAt=${meta.createdAt}`);
  }

  const sqlEntry = zip.file('database/innoveity_live.sql');
  if (!sqlEntry) {
    throw new Error('Missing database/innoveity_live.sql inside the backup archive!');
  }
  const sqlDump = await sqlEntry.async('string');
  console.log(`Uncompressed SQL Dump Size: ${sqlDump.length} bytes\n`);

  // 2. Safety check: ensure sandbox does NOT exist
  const existingDatabases = await runMysql(['-e', `SHOW DATABASES LIKE '${sandboxDbName}';`]);
  if (existingDatabases.includes(sandboxDbName)) {
    throw new Error(`Safety violation: Database ${sandboxDbName} already exists!`);
  }

  // 3. Create sandbox database
  console.log(`Creating isolated database \`${sandboxDbName}\`...`);
  await runMysql(['-e', `CREATE DATABASE \`${sandboxDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`]);
  console.log(`Database \`${sandboxDbName}\` created successfully.`);

  // 4. Restore SQL dump into sandbox
  console.log(`Restoring live backup SQL dump into \`${sandboxDbName}\`...`);
  await runMysql([sandboxDbName], sqlDump);
  console.log('Restoration into sandbox completed successfully!\n');

  // 5. Verify active DB inside sandbox session
  const verifyDb = await runMysql([sandboxDbName, '-e', 'SELECT DATABASE() as activeDb;']);
  console.log('Active DB verification:\n' + verifyDb.trim());

  // 6. Query initial table count
  const tablesOutput = await runMysql([
    sandboxDbName,
    '-e',
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${sandboxDbName}';`
  ]);
  const tableNames = tablesOutput.split(/\r?\n/).slice(1).map(t => t.trim()).filter(Boolean);
  console.log(`\nInitial Table Count in Sandbox: ${tableNames.length} tables`);

  // 7. Query baseline counts for critical tables
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
    'ticket',
    'task',
    '_prisma_migrations'
  ];

  console.log('\n--- BASELINE ROW COUNTS IN SANDBOX ---');
  const baselineCounts = {};
  for (const tbl of criticalTables) {
    if (tableNames.includes(tbl)) {
      const cntOut = await runMysql([sandboxDbName, '-e', `SELECT COUNT(*) as count FROM \`${tbl}\`;`]);
      const count = parseInt(cntOut.split(/\r?\n/)[1].trim(), 10);
      baselineCounts[tbl] = count;
      console.log(`  Table \`${tbl}\`: ${count} rows`);
    } else {
      baselineCounts[tbl] = 'TABLE_MISSING';
      console.log(`  Table \`${tbl}\`: MISSING`);
    }
  }

  // Save baseline record
  fs.writeFileSync(
    path.resolve(__dirname, 'sandbox_baseline.json'),
    JSON.stringify({
      sandboxDbName,
      backupSource: 'backend/backups/restored_backup_2026-10-23_17-00.zip',
      sha256,
      tableCount: tableNames.length,
      baselineCounts,
      createdAt: new Date().toISOString()
    }, null, 2)
  );

  console.log('\nBaseline successfully stored in scratch/backup_analysis/sandbox_baseline.json');
}

main().catch(err => {
  console.error('\nEXECUTION FAILED:', err.message);
  process.exit(1);
});
