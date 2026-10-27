const prisma = require('../backend/src/utils/db');

async function test() {
  try {
    const res = await prisma.accessTemplate.findMany();
    console.log('Query success! Count:', res.length);
  } catch (err) {
    console.log('Query error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

test();
