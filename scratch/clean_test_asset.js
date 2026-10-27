const prisma = require('../backend/src/utils/db');
async function main() {
  const res = await prisma.asset.deleteMany({ where: { name: 'Sony Alpha 7IV Camera' } });
  console.log('Cleaned up test asset:', res);
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS asset_backup_pre_varchar');
  console.log('Cleaned up temp backup table.');
}
main().finally(() => prisma.$disconnect());
