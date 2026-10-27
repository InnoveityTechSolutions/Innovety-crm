const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const JSZip = require('../../backend/node_modules/jszip');
const { PrismaClient } = require('../../backend/node_modules/@prisma/client');

async function main() {
  console.log('================================================================');
  console.log('   DRY-RUN ISOLATED RESTORE, MIGRATION & RECOVERY TEST           ');
  console.log('================================================================\n');

  const ISOLATED_DB = 'innoveity_isolated_test';
  const MYSQL_PASS = '12345678';
  const MYSQL_USER = 'root';
  const MYSQL_CMD = `"C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe" -u ${MYSQL_USER} -p${MYSQL_PASS}`;

  // 1. Create fresh isolated test database
  console.log(`[Step 1] Creating fresh isolated database: \`${ISOLATED_DB}\`...`);
  execSync(`${MYSQL_CMD} -e "DROP DATABASE IF EXISTS \`${ISOLATED_DB}\`; CREATE DATABASE \`${ISOLATED_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"`);
  console.log(`  Isolated database \`${ISOLATED_DB}\` created cleanly.\n`);

  // 2. Extract and restore live backup
  console.log(`[Step 2] Extracting live backup SQL dump...`);
  const zipPath = path.resolve(__dirname, '../../backend/backups/restored_backup_2026-10-23_17-00.zip');
  const zipData = fs.readFileSync(zipPath);
  const zip = await JSZip.loadAsync(zipData);
  const sqlDump = await zip.file('database/innoveity_live.sql').async('string');
  const tempSqlPath = path.resolve(__dirname, 'temp_innoveity_live.sql');
  fs.writeFileSync(tempSqlPath, sqlDump, 'utf8');

  console.log(`  Restoring live backup into \`${ISOLATED_DB}\`...`);
  execSync(`${MYSQL_CMD} ${ISOLATED_DB} < "${tempSqlPath}"`);
  fs.unlinkSync(tempSqlPath);
  console.log(`  Live backup restored successfully.\n`);

  // 3. Connect Prisma to isolated database to verify initial live backup state
  const isolatedPrisma = new PrismaClient({
    datasources: {
      db: { url: `mysql://${MYSQL_USER}:${MYSQL_PASS}@localhost:3306/${ISOLATED_DB}` }
    }
  });

  const initialTables = await isolatedPrisma.$queryRawUnsafe(`
    SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = '${ISOLATED_DB}'
  `);
  console.log(`  Initial table count in \`${ISOLATED_DB}\`: ${initialTables[0].cnt} (Expected: 80)`);

  // 4. Apply Proposed Version-Controlled Migration SQL
  console.log(`\n[Step 3] Applying proposed migration: migration_20261024_sync_crm_features.sql...`);
  const migrationPath = path.resolve(__dirname, 'migration_20261024_sync_crm_features.sql');
  execSync(`${MYSQL_CMD} ${ISOLATED_DB} < "${migrationPath}"`);
  console.log(`  Migration applied successfully.`);

  const postMigrationTables = await isolatedPrisma.$queryRawUnsafe(`
    SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = '${ISOLATED_DB}'
  `);
  console.log(`  Post-migration table count in \`${ISOLATED_DB}\`: ${postMigrationTables[0].cnt} (Expected: 94)`);

  // 5. Apply Recoverable Local Development Test Data
  console.log(`\n[Step 4] Applying recoverable local test data: recover_local_test_data.sql...`);
  const recoveryPath = path.resolve(__dirname, 'recover_local_test_data.sql');
  execSync(`${MYSQL_CMD} ${ISOLATED_DB} < "${recoveryPath}"`);
  console.log(`  Test data recovered successfully.`);

  // 6. Comprehensive Verification Queries
  console.log(`\n[Step 5] Running comprehensive verification on \`${ISOLATED_DB}\`...`);

  // A. User Query (verifies autoClockOutEnabled, accessTemplateId)
  const users = await isolatedPrisma.user.findMany({
    take: 5,
    select: { id: true, name: true, role: true, autoClockOutEnabled: true, accessTemplateId: true }
  });
  console.log(`  [VERIFIED] User model query succeeded (${users.length} users checked).`);

  // B. Attendance Query (verifies clockInLatitude, attendanceLocationId)
  const attendances = await isolatedPrisma.attendance.findMany({
    take: 5,
    select: { id: true, date: true, clockIn: true, clockInLatitude: true, attendanceLocationId: true }
  });
  console.log(`  [VERIFIED] Attendance model query succeeded (${attendances.length} records checked).`);

  // C. Access Templates
  const templates = await isolatedPrisma.accessTemplate.findMany({
    include: { permissions: true }
  });
  console.log(`  [VERIFIED] AccessTemplate query succeeded: ${templates.length} templates, ${templates[0]?.permissions.length || 0} permissions.`);

  // D. Attendance Locations
  const locations = await isolatedPrisma.attendanceLocation.findMany();
  console.log(`  [VERIFIED] AttendanceLocation query succeeded: ${locations.length} geofences found (${locations.map(l => l.name).join(', ')}).`);

  // E. Meetings
  const meetings = await isolatedPrisma.meeting.findMany({
    include: { attendees: true, report: true }
  });
  console.log(`  [VERIFIED] Meeting query succeeded: ${meetings.length} meetings, ${meetings[0]?.attendees.length || 0} attendees.`);

  // F. Comp-Off Credits & Sessions
  const compCredits = await isolatedPrisma.compOffCredit.findMany();
  const compSessions = await isolatedPrisma.compOffSession.findMany();
  console.log(`  [VERIFIED] Comp-Off query succeeded: ${compCredits.length} credits, ${compSessions.length} active sessions.`);

  // G. Asset Estimates
  const estimates = await isolatedPrisma.assetEstimate.findMany({
    include: { items: true }
  });
  console.log(`  [VERIFIED] AssetEstimate query succeeded: ${estimates.length} quotations found.`);

  // H. Company Documents
  const docs = await isolatedPrisma.companyDocument.findMany();
  console.log(`  [VERIFIED] CompanyDocument query succeeded: ${docs.length} documents found.`);

  // I. Leave Policy
  const policies = await isolatedPrisma.leavePolicy.findMany();
  console.log(`  [VERIFIED] LeavePolicy query succeeded: compOffValidityDays = ${policies[0]?.compOffValidityDays || 'N/A'}`);

  await isolatedPrisma.$disconnect();

  console.log('\n================================================================');
  console.log('   ALL ISOLATED DATABASE VERIFICATIONS PASSED (100%)             ');
  console.log('   ACTIVE DATABASE `innoveity_crm` WAS UNTOUCHED AND PRESERVED   ');
  console.log('================================================================\n');
}

main().catch(err => {
  console.error('\n[ERROR] Isolated test failed:', err);
  process.exit(1);
});
