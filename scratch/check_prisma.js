const p = require('../backend/src/utils/db');
async function test() {
  const u = await p.user.findFirst({
    select: { id: true, name: true, autoClockOutEnabled: true }
  });
  console.log('Prisma test user:', u);
  await p.$disconnect();
}
test();
