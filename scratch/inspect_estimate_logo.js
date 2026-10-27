const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const estimates = await prisma.assetEstimate.findMany({
    select: {
      id: true,
      estimateNumber: true,
      companyName: true,
      companyLogo: true,
      organizationId: true
    }
  });
  console.log('Estimates in DB:');
  console.log(estimates);

  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      logo: true,
      settings: true
    }
  });
  console.log('\nOrganizations in DB:');
  console.log(JSON.stringify(orgs, null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
