const prisma = require('../backend/src/utils/db');

async function testPrismaDirect() {
  console.log('=== TEST 1: Direct Prisma Creation ===\n');

  // Test A: Predefined Category (LAPTOP)
  console.log('Testing category = "LAPTOP"...');
  try {
    const assetA = await prisma.asset.create({
      data: {
        assetId: 'TEST-AST-001',
        name: 'Test Dell Laptop',
        category: 'LAPTOP',
        quantity: 1,
        status: 'AVAILABLE'
      }
    });
    console.log('✓ Success creating LAPTOP:', assetA.id, assetA.category);

    // Clean up test asset
    await prisma.asset.delete({ where: { id: assetA.id } });
    console.log('✓ Cleaned up test LAPTOP asset.');
  } catch (err) {
    console.error('✗ Failed creating LAPTOP:', err);
  }

  // Test B: Custom Category (CAMERA)
  console.log('\nTesting category = "CAMERA"...');
  try {
    const assetB = await prisma.asset.create({
      data: {
        assetId: 'TEST-AST-002',
        name: 'Sony A7IV Camera',
        category: 'CAMERA',
        quantity: 1,
        status: 'AVAILABLE'
      }
    });
    console.log('✓ Success creating CAMERA:', assetB.id);
  } catch (err) {
    console.log('✗ EXACT PRISMA ERROR FOR "CAMERA":');
    console.log('Error Name:', err.name);
    console.log('Error Code:', err.code);
    console.log('Error Message:', err.message);
  }

  // Test C: Custom Category (OTHER)
  console.log('\nTesting category = "OTHER"...');
  try {
    const assetC = await prisma.asset.create({
      data: {
        assetId: 'TEST-AST-003',
        name: 'Sony A7IV Camera (as OTHER)',
        category: 'OTHER',
        quantity: 1,
        status: 'AVAILABLE'
      }
    });
    console.log('✓ Success creating OTHER:', assetC.id, assetC.category);
    await prisma.asset.delete({ where: { id: assetC.id } });
    console.log('✓ Cleaned up test OTHER asset.');
  } catch (err) {
    console.error('✗ Failed creating OTHER:', err);
  }

  await prisma.$disconnect();
}

testPrismaDirect();
