const prisma = require('../backend/src/utils/db');

async function check() {
  const assets = await prisma.asset.findMany({
    select: { id: true, assetId: true, name: true, category: true }
  });
  console.log('Total assets:', assets.length);
  const categories = [...new Set(assets.map(a => a.category))];
  console.log('Unique categories in DB:', categories);
  console.log('Sample assets:');
  assets.slice(0, 10).forEach(a => console.log(`  ${a.assetId}: ${a.name} [${a.category}]`));
  await prisma.$disconnect();
}

check().catch(console.error);
