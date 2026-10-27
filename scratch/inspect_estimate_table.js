const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function inspectTable() {
  const columns = await prisma.$queryRawUnsafe(`DESCRIBE assetestimate;`);
  console.log('Columns in assetestimate:', columns.map(c => c.Field));
  const indexes = await prisma.$queryRawUnsafe(`SHOW INDEX FROM assetestimate;`);
  console.log('Indexes in assetestimate:', [...new Set(indexes.map(i => i.Key_name))]);
  await prisma.$disconnect();
}

inspectTable().catch(console.error);
