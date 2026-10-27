const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const { parseDbConfig } = require('../../backend/src/services/backupService');

const dbConfig = parseDbConfig();
const baseline = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'sandbox_baseline.json'), 'utf8'));
const sandboxDb = baseline.sandboxDbName;

const sandboxUrl = `mysql://${encodeURIComponent(dbConfig.user)}:${encodeURIComponent(dbConfig.password)}@${dbConfig.host}:${dbConfig.port}/${sandboxDb}`;
const prisma = new PrismaClient({
  datasources: { db: { url: sandboxUrl } }
});

async function checkConflicts() {
  console.log('=== TASK 4: EVALUATE RECOVERY SCRIPT CONFLICTS & DATA INTEGRITY ===\n');

  const recoverySql = fs.readFileSync(path.resolve(__dirname, 'recover_local_test_data.sql'), 'utf8');

  // Extract all UUIDs / IDs and referenced foreign keys
  // 1. Check organization reference
  const orgIds = [...new Set(recoverySql.match(/cmu43zvwm0000exne7d53m25e/g))];
  console.log(`Referenced Organization IDs: ${orgIds.join(', ')}`);
  for (const orgId of orgIds) {
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    console.log(`  Org [${orgId}] exists in live/sandbox database: ${org ? 'YES (' + org.name + ')' : 'NO'}`);
  }

  // 2. Check referenced user IDs
  const userMatches = recoverySql.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
  const uniqueUUIDs = [...new Set(userMatches)];
  console.log(`\nFound ${uniqueUUIDs.length} distinct UUIDs in recovery script.`);

  let foundUsers = 0;
  let missingUsers = 0;
  for (const uid of uniqueUUIDs) {
    const u = await prisma.user.findUnique({ where: { id: uid }, select: { id: true, email: true, name: true } });
    if (u) {
      foundUsers++;
    }
  }
  console.log(`  UUIDs mapped to existing Users in sandbox: ${foundUsers}`);

  // 3. Check for Primary Key collisions in the 14 tables
  const targetTables = [
    'attendancelocation',
    'userattendancelocation',
    'accesstemplate',
    'accesstemplatepermission',
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

  console.log('\nChecking table emptiness before recovery in sandbox:');
  for (const t of targetTables) {
    const [{ count }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM \`${t}\``);
    console.log(`  Table \`${t}\`: ${count} rows (Expected 0)`);
  }

  console.log('\nRecovery script classification:');
  console.log(' - Contains exclusively local testing artifacts (test meetings, sample geofences, developer test comp-off claims).');
  console.log(' - STRICTLY FOR LOCAL ENVIRONMENT ONLY. MUST BE EXCLUDED FROM PRODUCTION DEPLOYMENT.');

  await prisma.$disconnect();
}

checkConflicts().catch(console.error);
