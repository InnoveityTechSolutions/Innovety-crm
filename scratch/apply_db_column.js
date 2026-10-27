const prisma = require('../backend/src/utils/db');

async function main() {
  console.log('Checking user table columns...');
  const cols = await prisma.$queryRawUnsafe('DESCRIBE user');
  const exists = cols.some(c => c.Field === 'autoClockOutEnabled');
  if (exists) {
    console.log('Column autoClockOutEnabled already exists in user table.');
  } else {
    console.log('Adding autoClockOutEnabled BOOLEAN NOT NULL DEFAULT true to user table...');
    await prisma.$queryRawUnsafe('ALTER TABLE user ADD COLUMN autoClockOutEnabled BOOLEAN NOT NULL DEFAULT true');
    console.log('Column added successfully!');
  }

  const check = await prisma.$queryRawUnsafe('DESCRIBE user');
  const colInfo = check.find(c => c.Field === 'autoClockOutEnabled');
  console.log('Column Info:', colInfo);

  const sampleUsers = await prisma.$queryRawUnsafe('SELECT id, name, email, autoClockOutEnabled FROM user LIMIT 5');
  console.log('Sample Users with autoClockOutEnabled:', sampleUsers);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
