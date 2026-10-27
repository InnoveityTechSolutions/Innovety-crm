const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseDbConfig } = require('../../backend/src/services/backupService');

const dbConfig = parseDbConfig();

function runMysql(args) {
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
  });
}

async function main() {
  console.log('=== PHASE 3 STEP 3: PRECISE SCHEMA COMPARISON ON ACTIVE LOCAL DB ===\n');

  // 1. Check all 14 feature tables
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

  const tablesOut = await runMysql([
    dbConfig.database,
    '-e',
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${dbConfig.database}';`
  ]);
  const activeTables = tablesOut.split(/\r?\n/).slice(1).map(t => t.trim()).filter(Boolean);

  console.log('--- 14 Feature Tables in Active DB ---');
  featureTables.forEach(t => {
    console.log(`  Table \`${t}\`: ${activeTables.includes(t) ? 'ALREADY EXISTS' : 'MISSING'}`);
  });

  // 2. Check all missing columns in core tables
  const cols = [
    { table: 'user', col: 'autoClockOutEnabled' },
    { table: 'user', col: 'accessTemplateId' },
    { table: 'attendance', col: 'clockInLatitude' },
    { table: 'attendance', col: 'clockInLongitude' },
    { table: 'attendance', col: 'clockInAddress' },
    { table: 'attendance', col: 'clockOutLatitude' },
    { table: 'attendance', col: 'clockOutLongitude' },
    { table: 'attendance', col: 'clockOutAddress' },
    { table: 'attendance', col: 'clockOutWorkLocation' },
    { table: 'attendance', col: 'clockOutWorkLocationOther' },
    { table: 'attendance', col: 'attendanceLocationId' },
    { table: 'leavepolicy', col: 'compOffValidityDays' },
    { table: 'leavepolicy', col: 'compOffClaimWindowDays' },
    { table: 'leavepolicy', col: 'compOffClaimWindowEnabled' },
    { table: 'leavetype', col: 'minNoticeDays' },
    { table: 'organization', col: 'assetPrefix' },
    { table: 'organization', col: 'assetSequence' },
    { table: 'organization', col: 'estimatePrefix' },
    { table: 'organization', col: 'estimateSequence' },
    { table: 'organization', col: 'gstin' },
    { table: 'organization', col: 'city' },
    { table: 'organization', col: 'state' },
    { table: 'organization', col: 'pincode' },
    { table: 'organization', col: 'country' },
    { table: 'organization', col: 'bankName' },
    { table: 'organization', col: 'bankIfsc' },
    { table: 'organization', col: 'bankAccountNo' },
    { table: 'organization', col: 'bankBranch' },
    { table: 'organization', col: 'signatureImage' },
    { table: 'organization', col: 'signatoryTitle' },
    { table: 'asset', col: 'category' }
  ];

  console.log('\n--- Missing Columns in Core Tables ---');
  for (const c of cols) {
    const colOut = await runMysql([
      dbConfig.database,
      '-e',
      `SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${dbConfig.database}' AND TABLE_NAME = '${c.table}' AND COLUMN_NAME = '${c.col}';`
    ]);
    const exists = colOut.trim().split(/\r?\n/).length > 1;
    console.log(`  \`${c.table}.${c.col}\`: ${exists ? 'ALREADY EXISTS (' + colOut.trim().split(/\r?\n/)[1] + ')' : 'MISSING'}`);
  }

  // 3. Check migration history
  const migOut = await runMysql([
    dbConfig.database,
    '-e',
    `SELECT migration_name FROM _prisma_migrations;`
  ]);
  console.log('\n--- Active _prisma_migrations Table ---');
  console.log(migOut.trim());
}

main().catch(console.error);
