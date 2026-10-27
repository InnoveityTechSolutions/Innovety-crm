const prisma = require('../backend/src/utils/db');

async function test() {
  const admin = await prisma.user.findUnique({
    where: { email: 'admin@enterprise-crm.com' },
    select: { id: true, email: true, role: true, organizationId: true }
  });
  console.log('Admin in DB:', admin);

  const other = await prisma.user.findFirst({
    where: { organizationId: { not: admin.organizationId, not: null } },
    select: { id: true, email: true, role: true, organizationId: true }
  });
  console.log('Other user in DB:', other);
  await prisma.$disconnect();
}
test();
