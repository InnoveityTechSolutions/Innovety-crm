const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();
async function clean() {
  const res = await prisma.companyDocument.deleteMany({
    where: {
      OR: [
        { documentName: { contains: 'Automated Test' } },
        { documentName: 'company_b_charter' }
      ]
    }
  });
  console.log('Cleaned test docs:', res.count);
  await prisma.$disconnect();
}
clean();
