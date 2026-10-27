const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function show() {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, role: true, organizationId: true, employeeId: true }
  });
  console.log(users);
  await prisma.$disconnect();
}
show();
