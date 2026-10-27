const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== Step 1: Creating attendancelocation table if not exists ===');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`attendancelocation\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`organizationId\` VARCHAR(191) NOT NULL,
      \`name\` VARCHAR(255) NOT NULL,
      \`address\` TEXT NULL,
      \`latitude\` DOUBLE NOT NULL,
      \`longitude\` DOUBLE NOT NULL,
      \`radiusMeters\` DOUBLE NOT NULL DEFAULT 100.0,
      \`isActive\` BOOLEAN NOT NULL DEFAULT true,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`attendancelocation_organizationId_idx\` (\`organizationId\`),
      INDEX \`attendancelocation_organizationId_isActive_idx\` (\`organizationId\`, \`isActive\`),
      CONSTRAINT \`attendancelocation_organizationId_fkey\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organization\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);
  console.log('attendancelocation table created successfully.');

  console.log('=== Step 2: Creating userattendancelocation table if not exists ===');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`userattendancelocation\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`userId\` VARCHAR(191) NOT NULL,
      \`attendanceLocationId\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`userattendancelocation_userId_attendanceLocationId_key\` (\`userId\`, \`attendanceLocationId\`),
      INDEX \`userattendancelocation_userId_idx\` (\`userId\`),
      INDEX \`userattendancelocation_attendanceLocationId_idx\` (\`attendanceLocationId\`),
      CONSTRAINT \`userattendancelocation_userId_fkey\` FOREIGN KEY (\`userId\`) REFERENCES \`user\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`userattendancelocation_attendanceLocationId_fkey\` FOREIGN KEY (\`attendanceLocationId\`) REFERENCES \`attendancelocation\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);
  console.log('userattendancelocation table created successfully.');

  console.log('=== Step 3: Adding attendanceLocationId column to attendance table if not exists ===');
  const cols = await prisma.$queryRawUnsafe(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance' AND COLUMN_NAME = 'attendanceLocationId';
  `);

  if (cols.length === 0) {
    console.log('Adding attendanceLocationId column and FK to attendance...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`attendance\`
      ADD COLUMN \`attendanceLocationId\` VARCHAR(191) NULL;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`attendance\`
      ADD INDEX \`attendance_attendanceLocationId_idx\` (\`attendanceLocationId\`);
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`attendance\`
      ADD CONSTRAINT \`attendance_attendanceLocationId_fkey\`
      FOREIGN KEY (\`attendanceLocationId\`) REFERENCES \`attendancelocation\`(\`id\`)
      ON DELETE SET NULL ON UPDATE CASCADE;
    `);
    console.log('attendanceLocationId added to attendance table successfully.');
  } else {
    console.log('attendanceLocationId column already exists on attendance table.');
  }

  await prisma.$disconnect();
  console.log('Migration finished successfully.');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
