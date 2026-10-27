const fs = require('fs');
const path = require('path');

function reviewMigration() {
  console.log('=== TASK 1: MIGRATION SQL AUDIT & PRISMA SCHEMA VERIFICATION ===\n');

  const migrationPath = path.resolve(__dirname, '../../backend/prisma/migrations/20261024120000_sync_crm_features/migration.sql');
  const schemaPath = path.resolve(__dirname, '../../backend/prisma/schema.prisma');

  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  const schemaText = fs.readFileSync(schemaPath, 'utf8');

  // 1. Check for destructive operations
  const destructivePatterns = [
    /\bDROP\s+TABLE\b/i,
    /\bTRUNCATE\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bDROP\s+COLUMN\b/i,
    /\bDROP\s+DATABASE\b/i
  ];
  const foundDestructive = [];
  for (const pat of destructivePatterns) {
    if (pat.test(migrationSql)) {
      foundDestructive.push(pat.toString());
    }
  }
  console.log('Destructive statements found in migration.sql:', foundDestructive.length === 0 ? 'NONE (SAFE)' : foundDestructive);

  // 2. Identify created tables
  const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-zA-Z0-9_]+)`?\s*\(([\s\S]*?)\)\s*ENGINE/gi;
  const createdTables = [];
  let match;
  while ((match = createTableRegex.exec(migrationSql)) !== null) {
    createdTables.push({
      tableName: match[1],
      body: match[2]
    });
  }
  console.log(`\nNew tables defined in migration.sql (${createdTables.length}):`);
  createdTables.forEach((t, i) => {
    // Check if table is mapped in schema.prisma
    const mapped = schemaText.includes(`@@map("${t.tableName}")`) || schemaText.includes(`model ${t.tableName} `);
    console.log(`  ${i + 1}. \`${t.tableName}\` -> Mapped in schema.prisma: ${mapped ? 'YES' : 'MISSING'}`);
  });

  // 3. Identify altered tables and added columns
  const alterRegex = /ALTER\s+TABLE\s+`?([a-zA-Z0-9_]+)`?\s+([\s\S]*?)(?:;|$)/gi;
  const alteredTables = [];
  while ((match = alterRegex.exec(migrationSql)) !== null) {
    const tbl = match[1];
    const actions = match[2].trim();
    alteredTables.push({ tbl, actions });
  }
  console.log(`\nAltered tables in migration.sql (${alteredTables.length} statements):`);
  alteredTables.forEach((a, i) => {
    const firstLine = a.actions.split('\n')[0].trim();
    console.log(`  ${i + 1}. Table \`${a.tbl}\`: ${firstLine}...`);
  });

  // 4. Verify Enum to VARCHAR change on asset.category
  const assetCategoryAlter = migrationSql.includes("ALTER TABLE `asset` MODIFY COLUMN `category` VARCHAR(191) NOT NULL DEFAULT 'LAPTOP'");
  console.log('\nAsset Category Enum->VARCHAR alteration verified:', assetCategoryAlter ? 'YES (Preserves data, safe conversion)' : 'NO');

  // 5. Foreign key checks
  const fkMatches = migrationSql.match(/FOREIGN\s+KEY\s*\([^)]+\)\s*REFERENCES\s*`?([a-zA-Z0-9_]+)`?\s*\([^)]+\)/gi) || [];
  console.log(`\nTotal Foreign Key constraints defined: ${fkMatches.length}`);
  console.log('Foreign key check toggles present:');
  console.log(' - SET FOREIGN_KEY_CHECKS = 0 at start:', migrationSql.startsWith('SET FOREIGN_KEY_CHECKS = 0'));
  console.log(' - SET FOREIGN_KEY_CHECKS = 1 at end:', migrationSql.trim().endsWith('SET FOREIGN_KEY_CHECKS = 1;'));

  // 6. Prisma migration registration
  const prismaMigrationInsert = migrationSql.includes("INSERT INTO `_prisma_migrations`");
  console.log('Registers migration in _prisma_migrations:', prismaMigrationInsert ? 'YES' : 'NO');
}

reviewMigration();
