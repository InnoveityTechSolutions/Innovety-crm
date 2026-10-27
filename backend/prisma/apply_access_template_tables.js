const prisma = require('../src/utils/db');

async function main() {
  console.log('=== Step 1: Creating accesstemplate table if not exists ===');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`accesstemplate\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`name\` VARCHAR(191) NOT NULL,
      \`description\` TEXT NULL,
      \`baseRole\` ENUM('ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER', 'INTERN', 'EMPLOYEE') NOT NULL,
      \`organizationId\` VARCHAR(191) NOT NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
      \`createdById\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`accesstemplate_organizationId_name_key\` (\`organizationId\`, \`name\`),
      INDEX \`accesstemplate_organizationId_idx\` (\`organizationId\`),
      INDEX \`accesstemplate_baseRole_idx\` (\`baseRole\`),
      INDEX \`accesstemplate_status_idx\` (\`status\`),
      CONSTRAINT \`accesstemplate_organizationId_fkey\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organization\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`accesstemplate_createdById_fkey\` FOREIGN KEY (\`createdById\`) REFERENCES \`user\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);
  console.log('accesstemplate table ready.');

  console.log('=== Step 2: Creating accesstemplatepermission table if not exists ===');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`accesstemplatepermission\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`templateId\` VARCHAR(191) NOT NULL,
      \`moduleKey\` VARCHAR(191) NOT NULL,
      \`accessLevel\` ENUM('VIEW', 'EDIT') NOT NULL DEFAULT 'VIEW',
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`accesstemplatepermission_templateId_moduleKey_key\` (\`templateId\`, \`moduleKey\`),
      INDEX \`accesstemplatepermission_templateId_idx\` (\`templateId\`),
      CONSTRAINT \`accesstemplatepermission_templateId_fkey\` FOREIGN KEY (\`templateId\`) REFERENCES \`accesstemplate\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);
  console.log('accesstemplatepermission table ready.');

  console.log('=== Step 3: Checking accessTemplateId column on user table ===');
  const cols = await prisma.$queryRawUnsafe('DESCRIBE `user`');
  const hasCol = cols.some(c => c.Field === 'accessTemplateId');
  if (!hasCol) {
    console.log('Adding accessTemplateId column to user table...');
    await prisma.$executeRawUnsafe(`ALTER TABLE \`user\` ADD COLUMN \`accessTemplateId\` VARCHAR(191) NULL;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE \`user\` ADD INDEX \`user_accessTemplateId_idx\` (\`accessTemplateId\`);`);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`user\` ADD CONSTRAINT \`user_accessTemplateId_fkey\` 
      FOREIGN KEY (\`accessTemplateId\`) REFERENCES \`accesstemplate\` (\`id\`) 
      ON DELETE SET NULL ON UPDATE CASCADE;
    `);
    console.log('accessTemplateId column and foreign key added.');
  } else {
    console.log('accessTemplateId column already exists.');
  }

  console.log('=== Verification: Testing Prisma Queries ===');
  const count = await prisma.accessTemplate.count();
  console.log('Current accessTemplate count:', count);
  console.log('Tables initialized safely without modifying existing data!');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
