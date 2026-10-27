const prisma = require('../src/utils/db');

async function main() {
  console.log('=== Step 1: Checking and applying compOff columns to leavepolicy ===');
  const cols = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM `leavepolicy` LIKE 'compOffValidityDays'");
  if (cols.length === 0) {
    console.log('Adding compOffValidityDays and compOffClaimWindowDays to leavepolicy...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`leavepolicy\`
      ADD COLUMN \`compOffValidityDays\` INT NOT NULL DEFAULT 90,
      ADD COLUMN \`compOffClaimWindowDays\` INT NOT NULL DEFAULT 30;
    `);
    console.log('Columns added to leavepolicy.');
  } else {
    console.log('compOff columns already exist in leavepolicy.');
  }

  console.log('=== Step 2: Creating compoffcredit table if not exists ===');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`compoffcredit\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`organizationId\` VARCHAR(191) NOT NULL,
      \`userId\` VARCHAR(191) NOT NULL,
      \`workDate\` DATE NOT NULL,
      \`attendanceId\` VARCHAR(191) NULL,
      \`creditDays\` DOUBLE NOT NULL DEFAULT 1.0,
      \`usedDays\` DOUBLE NOT NULL DEFAULT 0.0,
      \`availableDays\` DOUBLE NOT NULL DEFAULT 1.0,
      \`earnedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`expiresAt\` DATETIME(3) NOT NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'APPROVED',
      \`reason\` TEXT NOT NULL,
      \`claimedByRole\` VARCHAR(191) NOT NULL,
      \`claimedById\` VARCHAR(191) NOT NULL,
      \`tlApprovedById\` VARCHAR(191) NULL,
      \`tlApprovedAt\` DATETIME(3) NULL,
      \`tlRemarks\` VARCHAR(191) NULL,
      \`adminApprovedById\` VARCHAR(191) NULL,
      \`adminApprovedAt\` DATETIME(3) NULL,
      \`adminRemarks\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`compoffcredit_userId_workDate_key\` (\`userId\`, \`workDate\`),
      INDEX \`compoffcredit_organizationId_idx\` (\`organizationId\`),
      INDEX \`compoffcredit_userId_status_idx\` (\`userId\`, \`status\`),
      INDEX \`compoffcredit_expiresAt_idx\` (\`expiresAt\`),
      INDEX \`compoffcredit_workDate_idx\` (\`workDate\`),
      INDEX \`compoffcredit_status_idx\` (\`status\`),
      CONSTRAINT \`compoffcredit_organizationId_fkey\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organization\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`compoffcredit_userId_fkey\` FOREIGN KEY (\`userId\`) REFERENCES \`user\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`compoffcredit_attendanceId_fkey\` FOREIGN KEY (\`attendanceId\`) REFERENCES \`attendance\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);
  console.log('compoffcredit table ready.');

  console.log('=== Step 3: Verifying compoffcredit table description ===');
  const desc = await prisma.$queryRawUnsafe("DESCRIBE `compoffcredit`");
  console.log('compoffcredit columns verified:', desc.map(d => `${d.Field}: ${d.Type}`));

  await prisma.$disconnect();
  console.log('=== Comp-Off Data Foundation Migration Completed Successfully ===');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
