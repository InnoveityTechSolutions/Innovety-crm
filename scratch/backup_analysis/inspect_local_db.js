const prisma = require('../../backend/src/utils/db');

async function main() {
  console.log('=== INSPECTING CURRENT LOCAL DATABASE ===');
  
  // 1. Check all tables in current MySQL database
  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name, table_rows 
    FROM information_schema.tables 
    WHERE table_schema = DATABASE()
    ORDER BY table_name ASC
  `);
  console.log(`Local database currently has ${tables.length} tables.`);

  // 2. Check the 14 previously missing tables and their row counts
  const missing14 = [
    'assetestimate',
    'assetestimateitem',
    'companydocument',
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
    'compoffsession'
  ];

  console.log('\n--- Status of the 14 New Tables in Local Database ---');
  for (const t of missing14) {
    try {
      const countRes = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM \`${t}\``);
      const count = Number(countRes[0].count);
      console.log(`  Table [${t}]: EXISTS, Count = ${count}`);
    } catch (err) {
      console.log(`  Table [${t}]: DOES NOT EXIST (${err.message})`);
    }
  }

  // 3. Inspect asset.category values to verify if data loss occurred during Enum -> Varchar conversion
  console.log('\n--- Inspecting asset.category in Local Database ---');
  const assetSample = await prisma.$queryRawUnsafe(`SELECT id, assetId, name, category FROM \`asset\` LIMIT 15`);
  console.log(assetSample);

  // 4. Inspect user columns
  console.log('\n--- Inspecting User table columns in Local Database ---');
  const userCols = await prisma.$queryRawUnsafe(`DESCRIBE \`user\``);
  const userColNames = userCols.map(c => c.Field);
  console.log('Has autoClockOutEnabled?', userColNames.includes('autoClockOutEnabled'));
  console.log('Has accessTemplateId?', userColNames.includes('accessTemplateId'));

  // 5. Inspect attendance columns
  console.log('\n--- Inspecting Attendance table columns in Local Database ---');
  const attCols = await prisma.$queryRawUnsafe(`DESCRIBE \`attendance\``);
  const attColNames = attCols.map(c => c.Field);
  console.log('Has clockInLatitude?', attColNames.includes('clockInLatitude'));
  console.log('Has attendanceLocationId?', attColNames.includes('attendanceLocationId'));

  // 6. Check _prisma_migrations in Local Database
  console.log('\n--- _prisma_migrations in Local Database ---');
  const migs = await prisma.$queryRawUnsafe(`SELECT id, migration_name, finished_at, rolled_back_at FROM \`_prisma_migrations\``);
  console.log(migs);

  await prisma.$disconnect();
}

main().catch(console.error);
