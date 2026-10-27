const prisma = require('../backend/src/utils/db');

async function main() {
  try {
    const migrations = await prisma.$queryRawUnsafe('SELECT id, migration_name, finished_at FROM _prisma_migrations');
    console.log('Applied migrations in DB:');
    console.table(migrations);
  } catch (err) {
    console.log('Error querying _prisma_migrations:', err.message);
  }
}

main().finally(() => prisma.$disconnect());
