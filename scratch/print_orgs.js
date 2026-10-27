const prisma = require('../backend/src/utils/db');
async function main() {
  const orgs = await prisma.organization.findMany();
  for (const o of orgs) {
    console.log(`ID: ${o.id} | Name: "${o.name}" | Slug: "${o.slug}" | Code: "${o.companyCode}"`);
  }
}
main().finally(() => prisma.$disconnect());
