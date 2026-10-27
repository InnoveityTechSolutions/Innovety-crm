const prisma = require('../backend/src/utils/db');

async function main() {
  const orgCols = await prisma.$queryRawUnsafe('SHOW COLUMNS FROM organization');
  console.log('Organization columns:');
  console.table(orgCols.map(c => ({ Field: c.Field, Type: c.Type, Null: c.Null, Default: c.Default })));

  const orgs = await prisma.organization.findMany();
  console.log('Existing organizations:', JSON.stringify(orgs.map(o => ({ id: o.id, name: o.name, slug: o.slug, companyCode: o.companyCode })), null, 2));

  const settingCols = await prisma.$queryRawUnsafe('SHOW COLUMNS FROM organizationsettings');
  console.log('OrganizationSettings columns:');
  console.table(settingCols.map(c => ({ Field: c.Field, Type: c.Type, Null: c.Null, Default: c.Default })));

  const assetCols = await prisma.$queryRawUnsafe('SHOW COLUMNS FROM asset');
  console.log('Asset columns:');
  console.table(assetCols.map(c => ({ Field: c.Field, Type: c.Type, Null: c.Null, Default: c.Default })));
}

main().finally(() => prisma.$disconnect());
