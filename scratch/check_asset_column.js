const prisma = require('../backend/src/utils/db');

async function check() {
  try {
    const col = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM asset LIKE 'category'");
    console.log('MYSQL ASSET CATEGORY COLUMN:');
    console.log(JSON.stringify(col, null, 2));

    const sample = await prisma.asset.findMany({
      take: 5,
      select: { id: true, name: true, category: true }
    });
    console.log('\nSAMPLE ASSETS IN DB:');
    console.log(JSON.stringify(sample, null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

check();
