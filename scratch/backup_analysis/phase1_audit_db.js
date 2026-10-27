const prisma = require('../../backend/src/utils/db');

async function main() {
  console.log('=== PHASE 1: READ-ONLY DATABASE AUDIT ===');
  
  // 1. Current database name
  const dbNameRes = await prisma.$queryRawUnsafe('SELECT DATABASE() as dbName');
  const dbName = dbNameRes[0]?.dbName;
  console.log('Current Active Local Database:', dbName);

  // 2. Table count
  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = DATABASE()
    ORDER BY table_name ASC
  `);
  console.log(`Total Tables in ${dbName}: ${tables.length}`);

  // 3. Row counts for important tables
  const importantTables = [
    'user',
    'organization',
    'attendance',
    'leavepolicy',
    'leaverequest',
    'leavetype',
    'asset',
    'project',
    'task',
    'payrollbatch',
    'payslip',
    'shift',
    'workcalendar',
    '_prisma_migrations',
    // Check the 14 new feature tables
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

  console.log('\n--- Row Counts for Core & Feature Tables in Local DB ---');
  for (const tbl of importantTables) {
    try {
      const res = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM \`${tbl}\``);
      console.log(`  Table [${tbl}]: ${res[0].cnt} rows`);
    } catch (e) {
      console.log(`  Table [${tbl}]: NOT FOUND (${e.message})`);
    }
  }

  // 4. Migration Status in _prisma_migrations
  console.log('\n--- Prisma Migration Records in Local DB ---');
  try {
    const migs = await prisma.$queryRawUnsafe(`SELECT id, migration_name, finished_at, rolled_back_at FROM \`_prisma_migrations\` ORDER BY started_at ASC`);
    console.log(migs);
  } catch (e) {
    console.log('_prisma_migrations error:', e.message);
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Audit script error:', err.message);
  process.exit(1);
});
