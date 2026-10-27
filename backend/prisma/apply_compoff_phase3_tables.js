const prisma = require('../src/utils/db');

async function main() {
  console.log('=== Step 1: Checking and applying compoffconsumption table ===');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`compoffconsumption\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`organizationId\` VARCHAR(191) NOT NULL,
      \`creditId\` VARCHAR(191) NOT NULL,
      \`leaveRequestId\` VARCHAR(191) NOT NULL,
      \`userId\` VARCHAR(191) NOT NULL,
      \`consumedDays\` DOUBLE NOT NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'CONSUMED',
      \`restoredAt\` DATETIME(3) NULL,
      \`restoredById\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`compoffconsumption_leaveRequestId_creditId_key\` (\`leaveRequestId\`, \`creditId\`),
      INDEX \`compoffconsumption_organizationId_idx\` (\`organizationId\`),
      INDEX \`compoffconsumption_creditId_idx\` (\`creditId\`),
      INDEX \`compoffconsumption_leaveRequestId_idx\` (\`leaveRequestId\`),
      INDEX \`compoffconsumption_userId_idx\` (\`userId\`),
      INDEX \`compoffconsumption_status_idx\` (\`status\`),
      CONSTRAINT \`compoffconsumption_organizationId_fkey\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organization\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`compoffconsumption_creditId_fkey\` FOREIGN KEY (\`creditId\`) REFERENCES \`compoffcredit\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`compoffconsumption_leaveRequestId_fkey\` FOREIGN KEY (\`leaveRequestId\`) REFERENCES \`leaverequest\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`compoffconsumption_userId_fkey\` FOREIGN KEY (\`userId\`) REFERENCES \`user\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);
  console.log('compoffconsumption table ready.');

  console.log('=== Step 2: Verifying compoffconsumption table description ===');
  const desc = await prisma.$queryRawUnsafe('DESCRIBE `compoffconsumption`');
  console.log('compoffconsumption columns verified:', desc.map(d => `${d.Field}: ${d.Type}`));

  await prisma.$disconnect();
  console.log('=== Comp-Off Phase 3 Migration Completed Successfully ===');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
