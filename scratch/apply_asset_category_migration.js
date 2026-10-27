const prisma = require('../backend/src/utils/db');

async function main() {
  console.log('=== STEP 1: PRE-MIGRATION VERIFICATION ===');
  
  // Check if we have an organization to attach test asset if needed
  const org = await prisma.organization.findFirst();
  const orgId = org ? org.id : null;

  // Check current row count
  let countBefore = await prisma.asset.count();
  console.log('Current asset count before migration:', countBefore);

  // If 0, create a predefined category asset to verify data preservation
  let testAssetId = null;
  if (countBefore === 0) {
    const created = await prisma.asset.create({
      data: {
        assetId: 'AST-PRE-MIGRATE-01',
        name: 'Pre-Migration Test Laptop',
        category: 'LAPTOP',
        brand: 'Lenovo',
        model: 'ThinkPad T14',
        status: 'AVAILABLE',
        quantity: 1,
        organizationId: orgId
      }
    });
    testAssetId = created.id;
    countBefore = await prisma.asset.count();
    console.log('Created baseline asset for preservation verification. Count is now:', countBefore);
  }

  // Inspect existing category values
  const assetsBefore = await prisma.asset.findMany({ select: { id: true, assetId: true, category: true } });
  console.log('Assets before migration:', JSON.stringify(assetsBefore, null, 2));

  // Inspect current column definition
  const [colBefore] = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM asset LIKE 'category'");
  console.log('Column definition BEFORE:', colBefore);

  console.log('\n=== STEP 2: APPLYING SAFE ALTER TABLE ===');
  const alterSql = "ALTER TABLE `asset` MODIFY COLUMN `category` VARCHAR(64) NOT NULL DEFAULT 'LAPTOP';";
  console.log('Executing SQL:', alterSql);
  await prisma.$executeRawUnsafe(alterSql);
  console.log('SQL executed successfully.');

  console.log('\n=== STEP 3: POST-MIGRATION VERIFICATION ===');
  // Verify column definition
  const [colAfter] = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM asset LIKE 'category'");
  console.log('Column definition AFTER:', colAfter);

  // Verify row count
  const countAfter = await prisma.asset.count();
  console.log('Asset count after migration:', countAfter);
  if (countAfter !== countBefore) {
    throw new Error(`Data safety violation! Count changed: before=${countBefore}, after=${countAfter}`);
  }

  // Verify existing values
  const assetsAfter = await prisma.asset.findMany({ select: { id: true, assetId: true, category: true } });
  console.log('Assets after migration:', JSON.stringify(assetsAfter, null, 2));

  for (const b of assetsBefore) {
    const match = assetsAfter.find(a => a.id === b.id);
    if (!match || match.category !== b.category) {
      throw new Error(`Data safety violation! Asset ${b.id} category changed from ${b.category} to ${match?.category}`);
    }
  }
  console.log('SUCCESS: All pre-existing asset records and categories are 100% preserved!');

  // Test direct insertion of custom category 'CAMERA' at the DB level
  console.log('\n=== STEP 4: VERIFY MYSQL ACCEPTS CUSTOM CATEGORY (CAMERA) ===');
  const customAssetId = 'AST-PRE-MIGRATE-02';
  await prisma.$executeRawUnsafe(`
    INSERT INTO \`asset\` (id, organizationId, assetId, name, category, status, quantity, createdAt, updatedAt)
    VALUES (UUID(), ${orgId ? `'${orgId}'` : 'NULL'}, '${customAssetId}', 'Nikon Z6 Camera', 'CAMERA', 'AVAILABLE', 1, NOW(), NOW())
  `);
  const [insertedCustom] = await prisma.$queryRawUnsafe(`SELECT assetId, name, category FROM \`asset\` WHERE assetId = '${customAssetId}'`);
  console.log('Direct MySQL custom category asset inserted:', insertedCustom);

  // Clean up the custom test asset
  await prisma.$executeRawUnsafe(`DELETE FROM \`asset\` WHERE assetId = '${customAssetId}'`);
  if (testAssetId) {
    // Also clean up baseline asset
    await prisma.$executeRawUnsafe(`DELETE FROM \`asset\` WHERE id = '${testAssetId}'`);
  }
  console.log('Cleaned up migration verification test assets.');
}

main()
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
