const prisma = require('../backend/src/utils/db');

async function main() {
  const cols = await prisma.$queryRawUnsafe(`
    SELECT COLUMN_NAME, DATA_TYPE, COLUMN_DEFAULT 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leavetype'
  `);
  console.log('Columns in leavetype:', cols);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
