const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function runStage2Migration() {
  console.log('--- Applying Stage 2 Non-Destructive Database Migration ---');

  // Check columns
  const cols = await prisma.$queryRawUnsafe(`DESCRIBE assetestimate;`);
  const colNames = cols.map(c => c.Field);

  if (!colNames.includes('cancelledAt')) {
    console.log('Adding column cancelledAt...');
    await prisma.$executeRawUnsafe(`ALTER TABLE assetestimate ADD COLUMN cancelledAt DATETIME NULL;`);
  }
  if (!colNames.includes('cancelledById')) {
    console.log('Adding column cancelledById...');
    await prisma.$executeRawUnsafe(`ALTER TABLE assetestimate ADD COLUMN cancelledById VARCHAR(191) NULL;`);
  }
  if (!colNames.includes('cancellationReason')) {
    console.log('Adding column cancellationReason...');
    await prisma.$executeRawUnsafe(`ALTER TABLE assetestimate ADD COLUMN cancellationReason TEXT NULL;`);
  }

  // Check indexes
  const indexes = await prisma.$queryRawUnsafe(`SHOW INDEX FROM assetestimate;`);
  const idxNames = new Set(indexes.map(i => i.Key_name));

  if (!idxNames.has('idx_estimate_org_created')) {
    console.log('Adding index idx_estimate_org_created...');
    await prisma.$executeRawUnsafe(`CREATE INDEX idx_estimate_org_created ON assetestimate (organizationId, createdAt);`);
  }
  if (!idxNames.has('idx_estimate_org_status')) {
    console.log('Adding index idx_estimate_org_status...');
    await prisma.$executeRawUnsafe(`CREATE INDEX idx_estimate_org_status ON assetestimate (organizationId, status);`);
  }
  if (!idxNames.has('idx_estimate_org_date')) {
    console.log('Adding index idx_estimate_org_date...');
    await prisma.$executeRawUnsafe(`CREATE INDEX idx_estimate_org_date ON assetestimate (organizationId, estimateDate);`);
  }
  if (!idxNames.has('idx_estimate_org_customer')) {
    console.log('Adding index idx_estimate_org_customer...');
    await prisma.$executeRawUnsafe(`CREATE INDEX idx_estimate_org_customer ON assetestimate (organizationId, billToName);`);
  }

  console.log('Stage 2 Database Migration applied successfully.');
  await prisma.$disconnect();
}

runStage2Migration().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
