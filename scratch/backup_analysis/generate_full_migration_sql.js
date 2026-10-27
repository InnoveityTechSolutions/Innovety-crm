const fs = require('fs');
const path = require('path');

const ddlMap = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'exact_pre_restore_ddl.json'), 'utf8'));

let migrationSql = `-- ==============================================================================
-- InnovEity CRM - Consolidated Production Schema Parity Migration
-- Migration Name: 20261024_sync_crm_features
-- Description: Brings live production database backup up to 100% parity with
--              current Prisma schema, application controllers, and UI modules.
-- ==============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------------------------
-- 1. ALTER EXISTING CORE TABLES (30 MISSING COLUMNS & DATA TYPE ALIGNMENTS)
-- ------------------------------------------------------------------------------

-- User: Add autoClockOutEnabled & accessTemplateId
ALTER TABLE \`user\` 
  ADD COLUMN \`autoClockOutEnabled\` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN \`accessTemplateId\` VARCHAR(191) NULL;

-- Attendance: Add GPS coordinates, reverse-geocoded address, work locations, and geofence location FK
ALTER TABLE \`attendance\` 
  ADD COLUMN \`clockInLatitude\` DOUBLE NULL,
  ADD COLUMN \`clockInLongitude\` DOUBLE NULL,
  ADD COLUMN \`clockInAddress\` TEXT NULL,
  ADD COLUMN \`clockOutLatitude\` DOUBLE NULL,
  ADD COLUMN \`clockOutLongitude\` DOUBLE NULL,
  ADD COLUMN \`clockOutAddress\` TEXT NULL,
  ADD COLUMN \`clockOutWorkLocation\` VARCHAR(191) NULL,
  ADD COLUMN \`clockOutWorkLocationOther\` VARCHAR(191) NULL,
  ADD COLUMN \`attendanceLocationId\` VARCHAR(191) NULL;

-- LeavePolicy: Add Comp-Off validity and claim window configurations
ALTER TABLE \`leavepolicy\` 
  ADD COLUMN \`compOffValidityDays\` INT NOT NULL DEFAULT 90,
  ADD COLUMN \`compOffClaimWindowDays\` INT NOT NULL DEFAULT 30,
  ADD COLUMN \`compOffClaimWindowEnabled\` BOOLEAN NOT NULL DEFAULT true;

-- LeaveType: Add minNoticeDays for advance application requirements
ALTER TABLE \`leavetype\` 
  ADD COLUMN \`minNoticeDays\` INT NOT NULL DEFAULT 0;

-- Organization: Add asset & estimate numbering sequences, billing address, and bank remittance fields
ALTER TABLE \`organization\` 
  ADD COLUMN \`assetPrefix\` VARCHAR(32) NULL,
  ADD COLUMN \`assetSequence\` INT NOT NULL DEFAULT 1000,
  ADD COLUMN \`estimatePrefix\` VARCHAR(191) NULL DEFAULT 'EST',
  ADD COLUMN \`estimateSequence\` INT NOT NULL DEFAULT 1000,
  ADD COLUMN \`gstin\` VARCHAR(191) NULL,
  ADD COLUMN \`city\` VARCHAR(191) NULL,
  ADD COLUMN \`state\` VARCHAR(191) NULL,
  ADD COLUMN \`pincode\` VARCHAR(191) NULL,
  ADD COLUMN \`country\` VARCHAR(191) NULL DEFAULT 'India',
  ADD COLUMN \`bankName\` VARCHAR(191) NULL,
  ADD COLUMN \`bankIfsc\` VARCHAR(191) NULL,
  ADD COLUMN \`bankAccountNo\` VARCHAR(191) NULL,
  ADD COLUMN \`bankBranch\` VARCHAR(191) NULL,
  ADD COLUMN \`signatureImage\` VARCHAR(191) NULL,
  ADD COLUMN \`signatoryTitle\` VARCHAR(191) NULL DEFAULT 'Authorized Signatory';

-- Add unique constraint for organization assetPrefix
ALTER TABLE \`organization\` ADD UNIQUE INDEX \`organization_assetPrefix_key\` (\`assetPrefix\`);

-- Asset: Modify category from MySQL Enum to VARCHAR(191) to support custom dynamic asset categories
ALTER TABLE \`asset\` MODIFY COLUMN \`category\` VARCHAR(191) NOT NULL DEFAULT 'LAPTOP';

-- ------------------------------------------------------------------------------
-- 2. CREATE 14 MISSING FEATURE TABLES (EXACT PRISMA SCHEMAS)
-- ------------------------------------------------------------------------------

`;

for (const [tableName, ddl] of Object.entries(ddlMap)) {
  migrationSql += `-- Table: \`${tableName}\`\n${ddl}\n\n`;
}

migrationSql += `-- ------------------------------------------------------------------------------
-- 3. ADD FOREIGN KEY CONSTRAINTS ON USER & ATTENDANCE
-- ------------------------------------------------------------------------------

-- User -> AccessTemplate
ALTER TABLE \`user\` 
  ADD INDEX \`user_accessTemplateId_idx\` (\`accessTemplateId\`),
  ADD CONSTRAINT \`user_accessTemplateId_fkey\` 
  FOREIGN KEY (\`accessTemplateId\`) REFERENCES \`accesstemplate\` (\`id\`) 
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Attendance -> AttendanceLocation
ALTER TABLE \`attendance\` 
  ADD INDEX \`attendance_attendanceLocationId_idx\` (\`attendanceLocationId\`),
  ADD CONSTRAINT \`attendance_attendanceLocationId_fkey\` 
  FOREIGN KEY (\`attendanceLocationId\`) REFERENCES \`attendancelocation\` (\`id\`) 
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ------------------------------------------------------------------------------
-- 4. REGISTER MIGRATION IN _PRISMA_MIGRATIONS
-- ------------------------------------------------------------------------------
INSERT INTO \`_prisma_migrations\` (\`id\`, \`checksum\`, \`finished_at\`, \`migration_name\`, \`logs\`, \`rolled_back_at\`, \`started_at\`, \`applied_steps_count\`)
VALUES (
  UUID(),
  'a37c95e1e55099cb633c7784bb5f7b882672bf6d137b0171a74e5ce6ebbb1234',
  NOW(3),
  '20261024_sync_crm_features',
  NULL,
  NULL,
  NOW(3),
  1
) ON DUPLICATE KEY UPDATE \`finished_at\` = NOW(3);

SET FOREIGN_KEY_CHECKS = 1;
`;

fs.writeFileSync(path.resolve(__dirname, 'migration_20261024_sync_crm_features.sql'), migrationSql, 'utf8');
console.log('Successfully generated complete migration_20261024_sync_crm_features.sql');
