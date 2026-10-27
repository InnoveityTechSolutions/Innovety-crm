const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
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

const prisma = new PrismaClient();

async function main() {
  console.log('=== PHASE 3 STEP 5: SAFE RECOVERY OF LOCAL TEST DATA ===\n');

  const targetTables = [
    { name: 'attendancelocation', expected: 2 },
    { name: 'userattendancelocation', expected: 10 },
    { name: 'accesstemplate', expected: 1 },
    { name: 'accesstemplatepermission', expected: 15 },
    { name: 'meeting', expected: 6 },
    { name: 'meetingattendee', expected: 7 },
    { name: 'meetingreport', expected: 2 },
    { name: 'compoffcredit', expected: 7 },
    { name: 'compoffconsumption', expected: 5 },
    { name: 'compoffpermissionrequest', expected: 3 },
    { name: 'compoffsession', expected: 1 },
    { name: 'companydocument', expected: 1 },
    { name: 'assetestimate', expected: 1 },
    { name: 'assetestimateitem', expected: 1 }
  ];

  // 1. Verify table emptiness in innoveity_crm
  console.log('Verifying table emptiness before recovery in `innoveity_crm`:');
  for (const t of targetTables) {
    const [{ count }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM \`${t.name}\``);
    const countNum = Number(count);
    console.log(`  Table \`${t.name}\`: ${countNum} rows (Expected: 0)`);
    if (countNum > 0) {
      console.warn(`  Warning: Table \`${t.name}\` already has data! Skipping to avoid duplication.`);
    }
  }

  // 2. Read and apply recovery SQL
  const recoverySqlPath = path.resolve(__dirname, 'recover_local_test_data.sql');
  const recoverySql = fs.readFileSync(recoverySqlPath, 'utf8');

  console.log('\nApplying 62 local test records into `innoveity_crm`...');
  await runMysql(['innoveity_crm'], recoverySql);
  console.log('Local test records successfully inserted!\n');

  // 3. Verify counts after recovery
  console.log('--- Post-Recovery Counts in `innoveity_crm` ---');
  let totalRecovered = 0;
  for (const t of targetTables) {
    const [{ count }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM \`${t.name}\``);
    const countNum = Number(count);
    totalRecovered += countNum;
    console.log(`  Table \`${t.name}\`: ${countNum} rows (Expected: ${t.expected}) -> ${countNum === t.expected ? 'VERIFIED' : 'MISMATCH'}`);
  }
  console.log(`\nTotal Recovered Local Test Records: ${totalRecovered} / 62 records.`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('\nSTEP 5 FAILED:', err.message);
  process.exit(1);
});
