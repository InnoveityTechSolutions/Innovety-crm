const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prisma = require('../../backend/src/utils/db');

async function main() {
  const migPath = path.resolve(__dirname, '../../backend/prisma/migrations/20261024120000_sync_crm_features/migration.sql');
  const content = fs.readFileSync(migPath, 'utf8');
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  console.log('File SHA256:', hash);

  const recs = await prisma.$queryRaw`SELECT id, migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations`;
  console.log('Current _prisma_migrations records:');
  console.log(recs);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
