const prisma = require('../src/utils/db');

async function main() {
  console.log('=== Step 1: Adding verification fields to compoffsession table ===');

  const sessionCols = await prisma.$queryRawUnsafe(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'compoffsession'
  `);
  const sessionColSet = new Set(sessionCols.map(c => c.COLUMN_NAME.toLowerCase()));

  if (!sessionColSet.has('approvalstatus')) {
    console.log('Adding approvalStatus to compoffsession...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`compoffsession\`
      ADD COLUMN \`approvalStatus\` VARCHAR(50) NOT NULL DEFAULT 'PENDING'
    `);
  }

  if (!sessionColSet.has('adminapprovedbyid')) {
    console.log('Adding adminApprovedById to compoffsession...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`compoffsession\`
      ADD COLUMN \`adminApprovedById\` VARCHAR(191) NULL
    `);
  }

  if (!sessionColSet.has('adminapprovedat')) {
    console.log('Adding adminApprovedAt to compoffsession...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`compoffsession\`
      ADD COLUMN \`adminApprovedAt\` DATETIME(3) NULL
    `);
  }

  if (!sessionColSet.has('adminremarks')) {
    console.log('Adding adminRemarks to compoffsession...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`compoffsession\`
      ADD COLUMN \`adminRemarks\` TEXT NULL
    `);
  }

  if (!sessionColSet.has('rejectionreason')) {
    console.log('Adding rejectionReason to compoffsession...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`compoffsession\`
      ADD COLUMN \`rejectionReason\` TEXT NULL
    `);
  }

  if (!sessionColSet.has('creditid')) {
    console.log('Adding creditId to compoffsession...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`compoffsession\`
      ADD COLUMN \`creditId\` VARCHAR(191) NULL
    `);
  }

  if (!sessionColSet.has('calculatedcredit')) {
    console.log('Adding calculatedCredit to compoffsession...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`compoffsession\`
      ADD COLUMN \`calculatedCredit\` DECIMAL(3, 1) NULL
    `);
  }

  // Add index on approvalStatus
  try {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX \`compoffsession_approvalStatus_idx\` ON \`compoffsession\` (\`approvalStatus\`)
    `);
  } catch (e) {
    // Index might already exist
  }

  console.log('=== Step 2: Adding sessionId to compoffcredit table ===');
  const creditCols = await prisma.$queryRawUnsafe(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'compoffcredit'
  `);
  const creditColSet = new Set(creditCols.map(c => c.COLUMN_NAME.toLowerCase()));

  if (!creditColSet.has('sessionid')) {
    console.log('Adding sessionId to compoffcredit...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`compoffcredit\`
      ADD COLUMN \`sessionId\` VARCHAR(191) NULL
    `);
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX \`compoffcredit_sessionId_idx\` ON \`compoffcredit\` (\`sessionId\`)
      `);
    } catch (e) {}
  }

  console.log('=== Step 3: Verifying columns in compoffsession and compoffcredit ===');
  const descSession = await prisma.$queryRawUnsafe('DESCRIBE `compoffsession`');
  console.log('compoffsession columns:', descSession.map(d => `${d.Field}: ${d.Type}`));

  const descCredit = await prisma.$queryRawUnsafe('DESCRIBE `compoffcredit`');
  console.log('compoffcredit columns:', descCredit.map(d => `${d.Field}: ${d.Type}`));

  await prisma.$disconnect();
  console.log('=== Comp-Off Phase 3 Verification Fields Migration Completed Successfully ===');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
