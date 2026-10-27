const prisma = require('d:/P R O J E C T S/Web/MRF-crm/backend/src/utils/db');

async function check() {
  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      role: true,
      employeeId: true,
      organizationId: true,
      joiningDate: true,
      salaryStructure: {
        include: { template: true }
      }
    },
    take: 10
  });

  console.log(`Found ${users.length} active users.`);
  users.forEach(u => {
    console.log(`- ${u.name} (${u.employeeId || u.id}) role: ${u.role}, org: ${u.organizationId}, structure: ${u.salaryStructure ? 'YES (Gross: ' + u.salaryStructure.grossSalary + ')' : 'NO'}`);
  });
  await prisma.$disconnect();
}

check().catch(console.error);
