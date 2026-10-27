const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const docs = await prisma.companyDocument.findMany();
  console.log('Docs in DB:', docs.map(d => ({ id: d.id, name: d.documentName, orgId: d.organizationId })));
  await prisma.$disconnect();
}
main();
