const fs = require('fs');
const path = require('path');

const migrationScripts = [
  'backend/prisma/apply_access_template_tables.js',
  'backend/prisma/apply_compoff_tables.js',
  'backend/prisma/apply_compoff_phase1_advance_tables.js',
  'backend/prisma/apply_compoff_phase2_session_tables.js',
  'backend/prisma/apply_compoff_phase3_tables.js',
  'backend/prisma/apply_compoff_phase3_verification_fields.js',
  'backend/prisma/apply_meeting_tables.js',
  'backend/prisma/apply_min_notice_days.js',
  'scratch/apply_asset_category_migration.js',
  'scratch/apply_db_column.js',
  'scratch/migrate_add_asset_prefix.js',
  'scratch/migrate_add_attendance_audit_fields.js',
  'scratch/migrate_add_attendance_locations.js',
  'scratch/migrate_add_company_document.js',
  'scratch/migrate_add_estimate_tables.js',
  'scratch/migrate_stage2_estimates.js'
];

console.log('=== TRACING MIGRATION SCRIPTS ===\n');
for (const relPath of migrationScripts) {
  const fullPath = path.resolve(__dirname, '../../', relPath);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf8');
    const ddlMatches = content.match(/(CREATE TABLE|ALTER TABLE)[\s\S]*?(;|\`\))/gi) || [];
    console.log(`--- File: ${relPath} ---`);
    for (const ddl of ddlMatches) {
      const summary = ddl.replace(/\s+/g, ' ').slice(0, 150);
      console.log('  DDL: ' + summary + '...');
    }
    console.log('');
  } else {
    console.log(`--- File: ${relPath} (NOT FOUND) ---`);
  }
}
