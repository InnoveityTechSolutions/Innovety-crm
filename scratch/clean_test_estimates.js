const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function clean() {
  const estimates = await prisma.assetEstimate.findMany({ select: { id: true, estimateNumber: true, billToName: true } });
  console.log('Current estimates in DB:', estimates);

  if (estimates.length > 0) {
    const ids = estimates.map(e => e.id);
    await prisma.assetEstimateItem.deleteMany({ where: { estimateId: { in: ids } } });
    await prisma.assetEstimate.deleteMany({ where: { id: { in: ids } } });
    console.log('All test estimates deleted.');
  }

  const [assetCount, orgCount, estimateCount, estimateItemCount] = await Promise.all([
    prisma.asset.count(),
    prisma.organization.count(),
    prisma.assetEstimate.count(),
    prisma.assetEstimateItem.count()
  ]);

  console.log('Counts after clean:');
  console.log(JSON.stringify({ assetCount, orgCount, estimateCount, estimateItemCount }, null, 2));

  await prisma.$disconnect();
}

clean();
