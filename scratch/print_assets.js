const prisma = require('../backend/src/utils/db');
async function main() {
  const assets = await prisma.asset.findMany();
  console.log(`Total assets: ${assets.length}`);
  for (const a of assets) {
    console.log(`Asset: ${a.assetId} | Name: "${a.name}" | Org: ${a.organizationId}`);
  }
}
main().finally(() => prisma.$disconnect());
