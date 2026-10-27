const prisma = require('../backend/src/utils/db');

async function main() {
  console.log('=== Step 1: Checking current columns in organization table ===');
  const orgCols = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM organization");
  const orgColNames = orgCols.map(c => c.Field);

  const columnsToAdd = [
    { name: 'estimatePrefix', def: 'VARCHAR(32) NOT NULL DEFAULT "EST"' },
    { name: 'estimateSequence', def: 'INT NOT NULL DEFAULT 1000' },
    { name: 'gstin', def: 'VARCHAR(32) NULL' },
    { name: 'city', def: 'VARCHAR(128) NULL' },
    { name: 'state', def: 'VARCHAR(128) NULL' },
    { name: 'pincode', def: 'VARCHAR(32) NULL' },
    { name: 'country', def: 'VARCHAR(64) NULL DEFAULT "India"' },
    { name: 'bankName', def: 'VARCHAR(128) NULL' },
    { name: 'bankIfsc', def: 'VARCHAR(32) NULL' },
    { name: 'bankAccountNo', def: 'VARCHAR(64) NULL' },
    { name: 'bankBranch', def: 'VARCHAR(128) NULL' },
    { name: 'signatureImage', def: 'VARCHAR(255) NULL' },
    { name: 'signatoryTitle', def: 'VARCHAR(128) NULL DEFAULT "Authorized Signatory"' }
  ];

  for (const col of columnsToAdd) {
    if (!orgColNames.includes(col.name)) {
      console.log(`Adding ${col.name} to organization table...`);
      await prisma.$executeRawUnsafe(`ALTER TABLE \`organization\` ADD COLUMN \`${col.name}\` ${col.def}`);
    } else {
      console.log(`Column ${col.name} already exists on organization.`);
    }
  }

  console.log('\n=== Step 2: Creating assetestimate table if not exists ===');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`assetestimate\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`organizationId\` VARCHAR(36) NULL,
      \`createdById\` VARCHAR(36) NULL,
      \`estimateNumber\` VARCHAR(64) NOT NULL,
      \`estimateDate\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`reference\` VARCHAR(255) NULL,
      \`placeOfSupply\` VARCHAR(128) NULL,
      \`status\` VARCHAR(32) NOT NULL DEFAULT 'GENERATED',
      \`title\` VARCHAR(64) NOT NULL DEFAULT 'Estimate',
      
      \`companyName\` VARCHAR(255) NOT NULL,
      \`companyAddress\` TEXT NULL,
      \`companyCity\` VARCHAR(128) NULL,
      \`companyState\` VARCHAR(128) NULL,
      \`companyPincode\` VARCHAR(32) NULL,
      \`companyCountry\` VARCHAR(64) NULL DEFAULT 'India',
      \`companyPhone\` VARCHAR(64) NULL,
      \`companyEmail\` VARCHAR(128) NULL,
      \`companyGstin\` VARCHAR(32) NULL,
      \`companyLogo\` VARCHAR(255) NULL,

      \`billToName\` VARCHAR(255) NOT NULL,
      \`billToAddress\` TEXT NULL,
      \`billToCity\` VARCHAR(128) NULL,
      \`billToState\` VARCHAR(128) NULL,
      \`billToPincode\` VARCHAR(32) NULL,
      \`billToCountry\` VARCHAR(64) NULL DEFAULT 'India',
      \`billToGstin\` VARCHAR(32) NULL,

      \`subTotal\` DOUBLE NOT NULL DEFAULT 0,
      \`cgstRate\` DOUBLE NOT NULL DEFAULT 0,
      \`sgstRate\` DOUBLE NOT NULL DEFAULT 0,
      \`igstRate\` DOUBLE NOT NULL DEFAULT 0,
      \`cgstAmount\` DOUBLE NOT NULL DEFAULT 0,
      \`sgstAmount\` DOUBLE NOT NULL DEFAULT 0,
      \`igstAmount\` DOUBLE NOT NULL DEFAULT 0,
      \`grandTotal\` DOUBLE NOT NULL DEFAULT 0,
      \`totalInWords\` TEXT NOT NULL,

      \`bankName\` VARCHAR(128) NULL,
      \`bankIfsc\` VARCHAR(32) NULL,
      \`bankAccountNo\` VARCHAR(64) NULL,
      \`bankBranch\` VARCHAR(128) NULL,
      \`notes\` TEXT NULL,
      \`termsAndConditions\` JSON NULL,
      \`signatureImage\` VARCHAR(255) NULL,
      \`signatoryTitle\` VARCHAR(128) NULL DEFAULT 'Authorized Signature',

      \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updatedAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

      PRIMARY KEY (\`id\`),
      INDEX \`idx_estimate_org\` (\`organizationId\`),
      INDEX \`idx_estimate_number\` (\`estimateNumber\`),
      UNIQUE KEY \`unique_org_estimate\` (\`organizationId\`, \`estimateNumber\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log('assetestimate table verified.');

  console.log('\n=== Step 3: Creating assetestimateitem table if not exists ===');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`assetestimateitem\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`estimateId\` VARCHAR(36) NOT NULL,
      \`assetId\` VARCHAR(36) NULL,
      \`itemIndex\` INT NOT NULL DEFAULT 1,
      \`title\` VARCHAR(255) NOT NULL,
      \`description\` TEXT NULL,
      \`quantity\` DOUBLE NOT NULL DEFAULT 1,
      \`unit\` VARCHAR(32) NULL DEFAULT 'nos',
      \`rate\` DOUBLE NOT NULL DEFAULT 0,
      \`cgstAmount\` DOUBLE NOT NULL DEFAULT 0,
      \`sgstAmount\` DOUBLE NOT NULL DEFAULT 0,
      \`igstAmount\` DOUBLE NOT NULL DEFAULT 0,
      \`amount\` DOUBLE NOT NULL DEFAULT 0,

      PRIMARY KEY (\`id\`),
      INDEX \`idx_item_estimate\` (\`estimateId\`),
      INDEX \`idx_item_asset\` (\`assetId\`),
      CONSTRAINT \`fk_item_estimate\` FOREIGN KEY (\`estimateId\`) REFERENCES \`assetestimate\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log('assetestimateitem table verified.');

  console.log('\n=== Step 4: Verification of created tables ===');
  const tables = await prisma.$queryRawUnsafe("SHOW TABLES LIKE 'assetestimate%'");
  console.log('Estimate tables in DB:', tables);

  console.log('Migration completed successfully and safely.');
}

main()
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
