const prisma = require('../backend/src/utils/db');

async function main() {
  console.log('=== Step 1: Checking current columns in organization table ===');
  const cols = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM organization");
  const colNames = cols.map(c => c.Field);
  console.log('Columns before:', colNames.filter(c => c.includes('asset')));

  if (!colNames.includes('assetPrefix')) {
    console.log('Adding assetPrefix column to organization...');
    await prisma.$executeRawUnsafe("ALTER TABLE `organization` ADD COLUMN `assetPrefix` VARCHAR(32) NULL UNIQUE");
  } else {
    console.log('assetPrefix column already exists.');
  }

  if (!colNames.includes('assetSequence')) {
    console.log('Adding assetSequence column to organization...');
    await prisma.$executeRawUnsafe("ALTER TABLE `organization` ADD COLUMN `assetSequence` INT NOT NULL DEFAULT 1000");
  } else {
    console.log('assetSequence column already exists.');
  }

  console.log('\n=== Step 2: Verifying updated columns in organization table ===');
  const colsAfter = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM organization");
  const relevantCols = colsAfter.filter(c => c.Field === 'assetPrefix' || c.Field === 'assetSequence');
  console.log('Relevant columns:', relevantCols);

  console.log('\n=== Step 3: Initializing prefixes for existing organizations ===');
  const orgs = await prisma.organization.findMany();
  for (const org of orgs) {
    if (!org.assetPrefix) {
      let prefix = 'INNT';
      if (org.slug === 'innoveity-globs-private-limited') {
        prefix = 'INNG';
      }
      await prisma.$executeRawUnsafe(
        "UPDATE `organization` SET `assetPrefix` = ?, `assetSequence` = 1000 WHERE `id` = ?",
        prefix,
        org.id
      );
      console.log(`Initialized org "${org.name}" with prefix "${prefix}" and sequence 1000`);
    } else {
      console.log(`Org "${org.name}" already has prefix "${org.assetPrefix}"`);
    }
  }

  console.log('\n=== Step 4: Verification of organization records ===');
  const updatedOrgs = await prisma.$queryRawUnsafe("SELECT id, name, assetPrefix, assetSequence FROM organization");
  console.log(updatedOrgs);
  console.log('Migration completed successfully and non-destructively.');
}

main()
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
