const prisma = require('../../backend/src/utils/db');

async function main() {
  console.log('=== CHECKING COLUMNS IN ACTIVE innoveity_crm ===');

  const checkCols = {
    user: ['autoClockOutEnabled', 'accessTemplateId'],
    attendance: ['clockInLatitude', 'clockInLongitude', 'attendanceLocationId'],
    leavepolicy: ['compOffValidityDays', 'compOffClaimWindowDays', 'compOffClaimWindowEnabled'],
    leavetype: ['minNoticeDays'],
    organization: ['assetPrefix', 'assetSequence', 'estimatePrefix']
  };

  for (const [tbl, cols] of Object.entries(checkCols)) {
    const rawCols = await prisma.$queryRawUnsafe(`DESCRIBE \`${tbl}\``);
    const existingColNames = new Set(rawCols.map(c => c.Field));
    console.log(`\nTable [${tbl}]:`);
    for (const c of cols) {
      console.log(`  - ${c}: ${existingColNames.has(c) ? 'EXISTS' : 'MISSING'}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
