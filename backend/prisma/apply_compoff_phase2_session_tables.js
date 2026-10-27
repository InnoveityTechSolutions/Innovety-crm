const prisma = require('../src/utils/db');

async function main() {
  console.log('=== Step 1: Creating compoffsession table if not exists ===');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`compoffsession\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`organizationId\` VARCHAR(191) NOT NULL,
      \`userId\` VARCHAR(191) NOT NULL,
      \`permissionRequestId\` VARCHAR(191) NOT NULL,
      \`workDate\` DATE NOT NULL,
      \`loginTime\` DATETIME(3) NOT NULL,
      \`clockOutTime\` DATETIME(3) NULL,
      \`durationHours\` DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
      \`status\` VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
      \`clockOutType\` VARCHAR(50) NULL,
      \`latitude\` DECIMAL(10, 7) NULL,
      \`longitude\` DECIMAL(10, 7) NULL,
      \`locationStatus\` VARCHAR(50) NOT NULL DEFAULT 'INSIDE',
      \`locationName\` VARCHAR(191) NULL,
      \`distanceMeters\` INT NULL,
      \`allowedRadiusMeters\` INT NULL,
      \`locationReason\` TEXT NULL,
      \`flaggedForReview\` BOOLEAN NOT NULL DEFAULT FALSE,
      \`ipAddress\` VARCHAR(191) NULL,
      \`device\` VARCHAR(191) NULL,
      \`browser\` VARCHAR(191) NULL,
      \`autoClockOutTarget\` DATETIME(3) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`compoffsession_userId_workDate_key\` (\`userId\`, \`workDate\`),
      UNIQUE INDEX \`compoffsession_permissionRequestId_key\` (\`permissionRequestId\`),
      INDEX \`compoffsession_organizationId_idx\` (\`organizationId\`),
      INDEX \`compoffsession_userId_status_idx\` (\`userId\`, \`status\`),
      INDEX \`compoffsession_status_idx\` (\`status\`),
      INDEX \`compoffsession_autoClockOutTarget_idx\` (\`autoClockOutTarget\`),
      CONSTRAINT \`compoffsession_organizationId_fkey\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organization\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`compoffsession_userId_fkey\` FOREIGN KEY (\`userId\`) REFERENCES \`user\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`compoffsession_permissionRequestId_fkey\` FOREIGN KEY (\`permissionRequestId\`) REFERENCES \`compoffpermissionrequest\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);
  console.log('compoffsession table ready.');

  console.log('=== Step 2: Verifying compoffsession table description ===');
  const desc = await prisma.$queryRawUnsafe('DESCRIBE `compoffsession`');
  console.log('compoffsession columns verified:', desc.map(d => `${d.Field}: ${d.Type}`));

  await prisma.$disconnect();
  console.log('=== Comp-Off Phase 2 Session Migration Completed Successfully ===');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
