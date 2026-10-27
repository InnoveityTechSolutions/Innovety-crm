const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const [assetCount, orgCount, estimateCount, estimateItemCount] = await Promise.all([
    prisma.asset.count(),
    prisma.organization.count(),
    prisma.assetEstimate.count(),
    prisma.assetEstimateItem.count()
  ]);

  console.log(JSON.stringify({ assetCount, orgCount, estimateCount, estimateItemCount }, null, 2));
  await prisma.$disconnect();
}

check().catch(console.error);
