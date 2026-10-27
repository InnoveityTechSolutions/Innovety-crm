const prisma = require('../src/utils/db');

async function main() {
  console.log('=== Step 1: Creating meeting table if not exists ===');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`meeting\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`organizationId\` VARCHAR(191) NOT NULL,
      \`title\` VARCHAR(191) NOT NULL,
      \`description\` TEXT NULL,
      \`date\` DATETIME(3) NOT NULL,
      \`startTime\` DATETIME(3) NOT NULL,
      \`endTime\` DATETIME(3) NOT NULL,
      \`organizerId\` VARCHAR(191) NOT NULL,
      \`googleMeetUrl\` VARCHAR(191) NULL,
      \`status\` ENUM('UPCOMING', 'COMPLETED', 'RESCHEDULED', 'CANCELLED') NOT NULL DEFAULT 'UPCOMING',
      \`projectId\` VARCHAR(191) NULL,
      \`teamId\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`meeting_organizationId_idx\` (\`organizationId\`),
      INDEX \`meeting_organizerId_idx\` (\`organizerId\`),
      INDEX \`meeting_projectId_idx\` (\`projectId\`),
      INDEX \`meeting_teamId_idx\` (\`teamId\`),
      INDEX \`meeting_date_idx\` (\`date\`),
      INDEX \`meeting_status_idx\` (\`status\`),
      CONSTRAINT \`meeting_organizationId_fkey\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organization\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`meeting_organizerId_fkey\` FOREIGN KEY (\`organizerId\`) REFERENCES \`user\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`meeting_projectId_fkey\` FOREIGN KEY (\`projectId\`) REFERENCES \`project\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT \`meeting_teamId_fkey\` FOREIGN KEY (\`teamId\`) REFERENCES \`team\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);
  console.log('meeting table ready.');

  console.log('=== Step 2: Creating meetingattendee table if not exists ===');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`meetingattendee\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`meetingId\` VARCHAR(191) NOT NULL,
      \`userId\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`meetingattendee_meetingId_userId_key\` (\`meetingId\`, \`userId\`),
      INDEX \`meetingattendee_userId_idx\` (\`userId\`),
      INDEX \`meetingattendee_meetingId_idx\` (\`meetingId\`),
      CONSTRAINT \`meetingattendee_meetingId_fkey\` FOREIGN KEY (\`meetingId\`) REFERENCES \`meeting\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`meetingattendee_userId_fkey\` FOREIGN KEY (\`userId\`) REFERENCES \`user\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);
  console.log('meetingattendee table ready.');

  console.log('=== Step 3: Creating meetingreport table if not exists ===');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`meetingreport\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`meetingId\` VARCHAR(191) NOT NULL,
      \`summary\` TEXT NOT NULL,
      \`followUpTasks\` JSON NULL,
      \`createdById\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`meetingreport_meetingId_key\` (\`meetingId\`),
      INDEX \`meetingreport_createdById_idx\` (\`createdById\`),
      CONSTRAINT \`meetingreport_meetingId_fkey\` FOREIGN KEY (\`meetingId\`) REFERENCES \`meeting\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`meetingreport_createdById_fkey\` FOREIGN KEY (\`createdById\`) REFERENCES \`user\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);
  console.log('meetingreport table ready.');

  console.log('=== Step 4: Verification ===');
  const tables = await prisma.$queryRawUnsafe("SHOW TABLES LIKE 'meeting%'");
  console.log('Matching tables:', tables);
  console.log('All meeting tables created non-destructively without touching existing data!');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
