const prisma = require('../backend/src/utils/db');
const fs = require('fs');

async function main() {
  console.log('=== Step 1: Inspecting current Asset table ===');
  const count = await prisma.asset.count();
  console.log('Total asset records count:', count);

  const assets = await prisma.asset.findMany();
  const categoryCounts = {};
  let maxLen = 0;
  for (const a of assets) {
    categoryCounts[a.category] = (categoryCounts[a.category] || 0) + 1;
    if (a.category && a.category.length > maxLen) {
      maxLen = a.category.length;
    }
  }
  console.log('Category distribution:', JSON.stringify(categoryCounts, null, 2));
  console.log('Maximum category length found:', maxLen);

  const columns = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM asset LIKE 'category'");
  console.log('Current column definition:', JSON.stringify(columns, null, 2));

  console.log('\n=== Step 2: Creating local asset backup ===');
  // Backup to JSON file
  fs.writeFileSync('scratch/asset_backup_before_migration.json', JSON.stringify(assets, null, 2));
  console.log(`Saved ${assets.length} asset records to scratch/asset_backup_before_migration.json`);

  // Also create a backup table in MySQL for safety
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS asset_backup_pre_varchar AS SELECT * FROM asset;`);
  const [backupCount] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM asset_backup_pre_varchar;`);
  console.log('MySQL backup table asset_backup_pre_varchar created with rows:', backupCount.cnt);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
