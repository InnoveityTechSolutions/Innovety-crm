const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== Step 1: Creating companydocument table if not exists ===');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`companydocument\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`organizationId\` VARCHAR(191) NOT NULL,
      \`documentName\` VARCHAR(255) NOT NULL,
      \`category\` VARCHAR(128) NOT NULL,
      \`description\` TEXT NULL,
      \`filePath\` VARCHAR(255) NOT NULL,
      \`originalFileName\` VARCHAR(255) NOT NULL,
      \`fileType\` VARCHAR(64) NOT NULL,
      \`fileSize\` INT NOT NULL,
      \`uploadedById\` VARCHAR(191) NOT NULL,
      \`expiryDate\` DATETIME NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`companydocument_organizationId_idx\` (\`organizationId\`),
      INDEX \`companydocument_category_idx\` (\`category\`),
      INDEX \`companydocument_expiryDate_idx\` (\`expiryDate\`),
      CONSTRAINT \`companydocument_organizationId_fkey\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organization\`(\`id\` ) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`companydocument_uploadedById_fkey\` FOREIGN KEY (\`uploadedById\`) REFERENCES \`user\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  console.log('companydocument table created successfully.');
  const cols = await prisma.$queryRawUnsafe(`DESCRIBE companydocument;`);
  console.log('Columns:', cols.map(c => `${c.Field} (${c.Type})`));
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
