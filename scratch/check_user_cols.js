const prisma = require('../backend/src/utils/db');

async function main() {
  const cols = await prisma.$queryRawUnsafe('DESCRIBE `user`');
  const found = cols.find(c => c.Field === 'accessTemplateId');
  console.log('accessTemplateId in user:', !!found);
  await prisma.$disconnect();
}

main().catch(console.error);
