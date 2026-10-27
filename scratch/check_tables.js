const path = require('path');
module.paths.push(path.resolve(__dirname, '..', 'backend', 'node_modules'));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const tables = await prisma.$queryRawUnsafe('SHOW TABLES');
  const names = tables.map(t => Object.values(t)[0]);
  console.log('Total tables in DB:', names.length);
  console.log('Meeting tables exist?');
  console.log('  meeting:', names.includes('meeting'));
  console.log('  meetingattendee:', names.includes('meetingattendee'));
  console.log('  meetingreport:', names.includes('meetingreport'));
  await prisma.$disconnect();
}

check().catch(console.error);
