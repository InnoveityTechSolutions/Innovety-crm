const prisma = require('../backend/src/utils/db');

async function test() {
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, slug: true }
  });
  console.log('Orgs in DB:', orgs);

  const users = await prisma.user.findMany({
    select: { id: true, email: true, organizationId: true }
  });
  console.log('All Users OrgIds:', users);
  await prisma.$disconnect();
}
test();
