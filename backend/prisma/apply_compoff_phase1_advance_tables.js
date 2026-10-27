const prisma = require('../src/utils/db');

async function main() {
  console.log('=== Step 1: Checking and applying compOffClaimWindowEnabled to leavepolicy ===');
  const cols = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM `leavepolicy` LIKE 'compOffClaimWindowEnabled'");
  if (cols.length === 0) {
    console.log('Adding compOffClaimWindowEnabled column to leavepolicy...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`leavepolicy\`
      ADD COLUMN \`compOffClaimWindowEnabled\` BOOLEAN NOT NULL DEFAULT TRUE;
    `);
    console.log('compOffClaimWindowEnabled added to leavepolicy.');
  } else {
    console.log('compOffClaimWindowEnabled column already exists in leavepolicy.');
  }

  console.log('=== Step 2: Creating compoffpermissionrequest table if not exists ===');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`compoffpermissionrequest\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`organizationId\` VARCHAR(191) NOT NULL,
      \`userId\` VARCHAR(191) NOT NULL,
      \`workDate\` DATE NOT NULL,
      \`holidayType\` VARCHAR(191) NOT NULL DEFAULT 'WEEKLY_OFF',
      \`reason\` TEXT NOT NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
      \`approvedById\` VARCHAR(191) NULL,
      \`approvedAt\` DATETIME(3) NULL,
      \`rejectionReason\` TEXT NULL,
      \`adminRemarks\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`compoffpermissionrequest_userId_workDate_key\` (\`userId\`, \`workDate\`),
      INDEX \`compoffpermissionrequest_organizationId_idx\` (\`organizationId\`),
      INDEX \`compoffpermissionrequest_userId_status_idx\` (\`userId\`, \`status\`),
      INDEX \`compoffpermissionrequest_workDate_idx\` (\`workDate\`),
      INDEX \`compoffpermissionrequest_status_idx\` (\`status\`),
      CONSTRAINT \`compoffpermissionrequest_organizationId_fkey\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organization\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`compoffpermissionrequest_userId_fkey\` FOREIGN KEY (\`userId\`) REFERENCES \`user\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`compoffpermissionrequest_approvedById_fkey\` FOREIGN KEY (\`approvedById\`) REFERENCES \`user\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);
  console.log('compoffpermissionrequest table ready.');

  console.log('=== Step 3: Verifying compoffpermissionrequest table description ===');
  const desc = await prisma.$queryRawUnsafe('DESCRIBE `compoffpermissionrequest`');
  console.log('compoffpermissionrequest columns verified:', desc.map(d => `${d.Field}: ${d.Type}`));

  await prisma.$disconnect();
  console.log('=== Comp-Off Phase 1 Advance Foundation Migration Completed Successfully ===');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
