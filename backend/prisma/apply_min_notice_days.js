const prisma = require('../src/utils/db');

async function main() {
  console.log('=== Adding minNoticeDays column to leavetype table ===');

  const cols = await prisma.$queryRawUnsafe(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leavetype'
  `);
  const colSet = new Set(cols.map(c => c.COLUMN_NAME.toLowerCase()));

  if (!colSet.has('minnoticedays')) {
    console.log('Adding minNoticeDays to leavetype...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`leavetype\`
      ADD COLUMN \`minNoticeDays\` INT NOT NULL DEFAULT 0
    `);
    console.log('Column minNoticeDays added successfully with default 0.');
  } else {
    console.log('Column minNoticeDays already exists in leavetype.');
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
