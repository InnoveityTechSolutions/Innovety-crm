const prisma = require('../backend/src/utils/db');
async function main() {
  const superAdmins = await prisma.user.findMany({
    where: { role: 'SUPER_ADMIN' },
    select: { id: true, email: true, role: true }
  });
  console.log('Super Admins:', superAdmins);
}
main().finally(() => prisma.$disconnect());
