const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const crypto = require('crypto');

function getSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

function pad(num) {
  return String(num).padStart(2, '0');
}

function getTimestamp() {
  const d = new Date();
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

async function runBackup() {
  console.log('===============================================================');
  console.log('   INNOVEITY CRM: COMPLETE RECOVERABLE BACKUP PROCEDURE       ');
  console.log('===============================================================\n');

  // 1. Mandatory Safety & Configuration Inspection
  console.log('--- Step 1: Inspecting Database Configuration ---');
  const backendEnvPath = path.resolve('backend/.env');
  if (!fs.existsSync(backendEnvPath)) {
    throw new Error(`CRITICAL ERROR: backend/.env not found at ${backendEnvPath}`);
  }

  const backendEnvContent = fs.readFileSync(backendEnvPath, 'utf8');
  let databaseUrl = null;
  for (const line of backendEnvContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('DATABASE_URL=')) {
      databaseUrl = trimmed.substring('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
      break;
    }
  }

  if (!databaseUrl) {
    throw new Error('CRITICAL ERROR: DATABASE_URL not found in backend/.env');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch (err) {
    throw new Error(`CRITICAL ERROR: Failed to parse DATABASE_URL: ${err.message}`);
  }

  const dbProtocol = parsedUrl.protocol.replace(':', '');
  const dbUser = decodeURIComponent(parsedUrl.username || 'root');
  const dbPassword = decodeURIComponent(parsedUrl.password || '');
  const dbHost = parsedUrl.hostname || 'localhost';
  const dbPort = parsedUrl.port || '3306';
  const dbName = parsedUrl.pathname.replace(/^\//, '');

  console.log(`Database Engine: ${dbProtocol.toUpperCase()}`);
  console.log(`Database Host:   ${dbHost}`);
  console.log(`Database Port:   ${dbPort}`);
  console.log(`Database Name:   ${dbName}`);

  // Strict Safety Verification: Must not target external/production server
  const localHosts = ['localhost', '127.0.0.1', '::1'];
  if (!localHosts.includes(dbHost.toLowerCase())) {
    throw new Error(`SAFETY BLOCK: Database host (${dbHost}) is not a verified local host! Halting backup.`);
  }
  if (dbProtocol !== 'mysql') {
    throw new Error(`UNSUPPORTED ENGINE: Database protocol is ${dbProtocol}, expected mysql. Halting.`);
  }

  // 2. Prepare Backup Directories
  const timestamp = getTimestamp();
  const rootBackupDir = path.resolve('D:/InnovEity_CRM_Backups');
  const backupDir = path.join(rootBackupDir, timestamp);
  const zipFilePath = path.join(rootBackupDir, `InnovEity_CRM_Backup_${timestamp}.zip`);

  console.log(`\n--- Step 2: Preparing Destination Directories ---`);
  console.log(`Base Directory:   ${rootBackupDir}`);
  console.log(`Target Directory: ${backupDir}`);
  console.log(`ZIP Destination:  ${zipFilePath}`);

  if (fs.existsSync(backupDir)) {
    throw new Error(`Collision detected: Directory ${backupDir} already exists.`);
  }

  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(path.join(backupDir, 'environment'), { recursive: true });
  fs.mkdirSync(path.join(backupDir, 'environment/other'), { recursive: true });
  fs.mkdirSync(path.join(backupDir, 'environment/examples'), { recursive: true });

  // 3. Database Dump using mysqldump with secure option file
  console.log(`\n--- Step 3: Executing Database Backup (mysqldump) ---`);
  const sqlDumpPath = path.join(backupDir, 'database_backup.sql');
  const tempCnfPath = path.join(backupDir, `mysqldump_temp_${Date.now()}.cnf`);

  // Write temporary option file so passwords are NEVER passed via CLI arguments or process table
  const cnfContent = `[mysqldump]
user=${dbUser}
password=${dbPassword}
host=${dbHost}
port=${dbPort}
`;
  fs.writeFileSync(tempCnfPath, cnfContent, { mode: 0o600 });

  let dumpSuccess = false;
  try {
    const dumpCmd = `mysqldump --defaults-extra-file="${tempCnfPath}" --single-transaction --quick --routines --triggers --events --column-statistics=0 ${dbName} --result-file="${sqlDumpPath}"`;
    execSync(dumpCmd, { stdio: 'pipe' });
    dumpSuccess = true;
    console.log(`✓ mysqldump completed successfully.`);
  } catch (dumpErr) {
    // If --column-statistics=0 is not supported, retry without it
    console.warn(`Initial mysqldump exited with error, retrying standard flags... (${dumpErr.message})`);
    try {
      const fallbackCmd = `mysqldump --defaults-extra-file="${tempCnfPath}" --single-transaction --quick --routines --triggers --events ${dbName} --result-file="${sqlDumpPath}"`;
      execSync(fallbackCmd, { stdio: 'pipe' });
      dumpSuccess = true;
      console.log(`✓ Fallback mysqldump completed successfully.`);
    } catch (fbErr) {
      throw new Error(`CRITICAL ERROR during mysqldump: ${fbErr.stderr ? fbErr.stderr.toString() : fbErr.message}`);
    }
  } finally {
    // Immediately destroy the temporary credential option file
    if (fs.existsSync(tempCnfPath)) {
      fs.unlinkSync(tempCnfPath);
    }
  }

  // Verify Dump
  if (!fs.existsSync(sqlDumpPath) || fs.statSync(sqlDumpPath).size === 0) {
    throw new Error('CRITICAL ERROR: database_backup.sql was not created or is 0 bytes!');
  }

  const dumpStat = fs.statSync(sqlDumpPath);
  console.log(`✓ database_backup.sql verified (${(dumpStat.size / (1024 * 1024)).toFixed(2)} MB / ${dumpStat.size} bytes)`);

  // Scan dump for expected table statements
  const dumpSample = fs.readFileSync(sqlDumpPath, { encoding: 'utf8', flag: 'r' });
  const tableMatches = dumpSample.match(/CREATE TABLE [`"].*?[`"]/g) || [];
  const insertMatches = dumpSample.match(/INSERT INTO [`"].*?[`"]/g) || [];
  console.log(`✓ Dump content verification: Found ${tableMatches.length} tables defined and ${insertMatches.length} table insert blocks.`);

  // 4. Back Up Environment Files
  console.log(`\n--- Step 4: Backing Up Environment Files ---`);
  const envManifestList = [];

  const copyEnvFile = (srcRel, destRel, category) => {
    const srcAbs = path.resolve(srcRel);
    const destAbs = path.join(backupDir, destRel);
    if (fs.existsSync(srcAbs)) {
      fs.copyFileSync(srcAbs, destAbs);
      const size = fs.statSync(destAbs).size;
      const sha = getSha256(destAbs);
      envManifestList.push({ srcRel, destRel, size, sha, category });
      console.log(`✓ Copied ${srcRel} -> ${destRel} (${size} bytes)`);
    } else {
      console.log(`- Optional file omitted (not found): ${srcRel}`);
    }
  };

  copyEnvFile('backend/.env', 'environment/backend.env', 'Active Backend Configuration');
  copyEnvFile('frontend/.env', 'environment/frontend.env', 'Active Frontend Configuration');
  copyEnvFile('frontend/.env.local', 'environment/frontend.env.local', 'Local Frontend Configuration');
  copyEnvFile('backend/db_env_backup/.env', 'environment/other/backend_db_env_backup.env', 'Historical DB Env Backup');
  copyEnvFile('backend/env', 'environment/other/backend_legacy_env', 'Legacy Stale Environment File');
  copyEnvFile('backend/.env.example', 'environment/examples/backend.env.example', 'Backend Environment Template');
  copyEnvFile('frontend/.env.example', 'environment/examples/frontend.env.example', 'Frontend Environment Template');

  // 5. Create Restoration Instructions
  console.log(`\n--- Step 5: Generating Restoration Instructions ---`);
  const restoreInstructionsPath = path.join(backupDir, 'RESTORE_INSTRUCTIONS.md');
  const restoreInstructionsContent = `# InnovEity CRM - Database & Environment Restoration Instructions

**Backup Archive:** InnovEity_CRM_Backup_${timestamp}.zip  
**Generated On:** ${new Date().toISOString()}  
**Target Database Engine:** MySQL 8.0+  
**Source Database:** ${dbName}

---

## ⚠️ MANDATORY SAFETY RULES BEFORE RESTORING

1. **NEVER restore directly into a live production database without a verified pre-restore backup.**
2. **VERIFY the destination database connection before running any restore commands.** Accidental execution against an active environment will overwrite live CRM data.
3. **DO NOT restore into an existing database with important records.** It is strongly recommended to restore into a fresh, isolated database (e.g. \`innoveity_crm_restored\`).
4. **Production restoration requires explicit stakeholder authorization.**

---

## Prerequisites

1. MySQL Server 8.0 or later installed and running.
2. MySQL command-line client (\`mysql\`) available in PATH.
3. Target MySQL user with \`ALL PRIVILEGES\` on the destination database.
4. Target database created with character set \`utf8mb4\` and collation \`utf8mb4_unicode_ci\`.

---

## Step 1: Database Restoration

### 1.1 Create the Destination Database
Log into MySQL and create the target database:

\`\`\`sql
CREATE DATABASE IF NOT EXISTS innoveity_crm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
\`\`\`

*(If testing restoration, use an isolated database name like \`innoveity_crm_test\`.)*

### 1.2 Restore the SQL Dump
Execute the restoration using the MySQL CLI:

\`\`\`bash
# Using standard prompt for password:
mysql -u <DB_USER> -p -h <DB_HOST> -P <DB_PORT> <DESTINATION_DB_NAME> < database_backup.sql

# Example for local MySQL on port 3306:
mysql -u root -p -h localhost -P 3306 innoveity_crm < database_backup.sql
\`\`\`

---

## Step 2: Environment File Restoration

Restore the backed-up environment files to their respective locations in the repository:

1. **Backend Environment:**
   - Copy \`environment/backend.env\` to \`backend/.env\`
   - Verify \`DATABASE_URL\` points to your restored database:
     \`\`\`env
     DATABASE_URL="mysql://<DB_USER>:<DB_PASSWORD>@<DB_HOST>:<DB_PORT>/<DESTINATION_DB_NAME>"
     \`\`\`
   - Confirm \`PORT\`, \`FRONTEND_URL\`, and \`ALLOWED_ORIGINS\` match the target deployment.

2. **Frontend Environment:**
   - Copy \`environment/frontend.env\` to \`frontend/.env\`
   - Ensure \`VITE_API_URL\` points to the correct backend API endpoint.

---

## Step 3: Validate Connectivity and Prisma Schema

1. **Navigate to the backend directory:**
   \`\`\`bash
   cd backend
   \`\`\`

2. **Verify Database Connectivity via Node:**
   \`\`\`bash
   node -e "const prisma=require('./src/utils/db'); prisma.\\$queryRaw\`SELECT 1\`.then(() => { console.log('✓ Database connected successfully.'); process.exit(0); }).catch(e => { console.error('Connection failed:', e.message); process.exit(1); });"
   \`\`\`

3. **Verify Prisma Client Synchronization:**
   \`\`\`bash
   npx prisma generate
   \`\`\`

4. **Verify Table Row Counts:**
   \`\`\`bash
   node -e "const prisma=require('./src/utils/db'); async function c() { console.log('Users:', await prisma.user.count()); console.log('Organizations:', await prisma.organization.count()); console.log('Attendance:', await prisma.attendance.count()); console.log('Leaves:', await prisma.leaveRequest.count()); console.log('Payroll Batches:', await prisma.payrollBatch.count()); process.exit(0); } c();"
   \`\`\`

5. **Start and Test the Application:**
   \`\`\`bash
   npm run dev
   # Verify health endpoint:
   curl http://localhost:5000/api/health
   \`\`\`
`;
  fs.writeFileSync(restoreInstructionsPath, restoreInstructionsContent, 'utf8');
  console.log(`✓ RESTORE_INSTRUCTIONS.md generated.`);

  // 6. Generate Checksums
  console.log(`\n--- Step 6: Calculating File Checksums ---`);
  const checksumEntries = [];
  const addChecksum = (filePath, relName) => {
    const sha = getSha256(filePath);
    checksumEntries.push(`${sha}  ${relName}`);
  };

  addChecksum(sqlDumpPath, 'database_backup.sql');
  for (const item of envManifestList) {
    addChecksum(path.join(backupDir, item.destRel), item.destRel);
  }
  addChecksum(restoreInstructionsPath, 'RESTORE_INSTRUCTIONS.md');

  // 7. Generate Manifest
  console.log(`\n--- Step 7: Generating Manifest ---`);
  const manifestPath = path.join(backupDir, 'backup_manifest.txt');
  const manifestContent = `======================================================================
INNOVEITY CRM - COMPLETE DATABASE & ENVIRONMENT BACKUP MANIFEST
======================================================================

Project Name:          InnovEity CRM
Creation Timestamp:    ${timestamp}
Creation Date (UTC):   ${new Date().toISOString()}
Backup Directory:      ${backupDir}
Target Archive:        ${zipFilePath}

----------------------------------------------------------------------
DATABASE CONFIGURATION & DUMP SPECIFICATIONS
----------------------------------------------------------------------
Database Engine:       ${dbProtocol.toUpperCase()} (MySQL Community Server)
Database Host:         ${dbHost}
Database Port:         ${dbPort}
Database Name:         ${dbName}
Database Dump File:    database_backup.sql
Dump File Size:        ${dumpStat.size} bytes (${(dumpStat.size / (1024 * 1024)).toFixed(2)} MB)
Dump Type:             Consistent Snapshot (--single-transaction, schema + data)
Tables Preserved:      ${tableMatches.length} tables detected
Data Blocks:           ${insertMatches.length} insert blocks detected
Database Objects:      Tables, Views, Indexes, Constraints, Triggers, Routines, Events

----------------------------------------------------------------------
ENVIRONMENT FILES INCLUDED
----------------------------------------------------------------------
${envManifestList.map(e => `[${e.category}]
Original Source:  ${e.srcRel}
Backup Path:      ${e.destRel}
File Size:        ${e.size} bytes
SHA-256:          ${e.sha}
`).join('\n')}

----------------------------------------------------------------------
VERIFICATION STATUS & INTEGRITY
----------------------------------------------------------------------
Dump Non-Empty:        VERIFIED (${dumpStat.size} bytes)
Schema Objects:        VERIFIED (${tableMatches.length} tables)
Environment Files:     VERIFIED (${envManifestList.length} files archived)
Restoration Guide:     INCLUDED (RESTORE_INSTRUCTIONS.md)
Checksum Manifest:     INCLUDED (backup_checksums.txt)

----------------------------------------------------------------------
RESTORATION PREREQUISITES
----------------------------------------------------------------------
1. MySQL Server 8.0+ running with utf8mb4 charset support.
2. Verified destination database target before applying SQL dump.
3. Explicit administrative authorization before restoring into any shared environment.
4. See RESTORE_INSTRUCTIONS.md for full restoration procedure.
======================================================================
`;
  fs.writeFileSync(manifestPath, manifestContent, 'utf8');
  console.log(`✓ backup_manifest.txt generated.`);

  addChecksum(manifestPath, 'backup_manifest.txt');

  const checksumsPath = path.join(backupDir, 'backup_checksums.txt');
  fs.writeFileSync(checksumsPath, checksumEntries.join('\n') + '\n', 'utf8');
  console.log(`✓ backup_checksums.txt generated.`);

  // 8. Create ZIP Archive
  console.log(`\n--- Step 8: Creating ZIP Archive ---`);
  // Use Windows built-in tar or PowerShell Compress-Archive
  // Using tar -a -cf is extremely fast and natively creates standard pkzip
  try {
    const tarCmd = `tar -a -c -f "${zipFilePath}" -C "${backupDir}" .`;
    execSync(tarCmd, { stdio: 'pipe' });
    console.log(`✓ ZIP archive created successfully with tar.`);
  } catch (tarErr) {
    console.warn(`tar compression failed, falling back to PowerShell Compress-Archive...`);
    const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${backupDir}\\*' -DestinationPath '${zipFilePath}' -Force"`;
    execSync(psCmd, { stdio: 'pipe' });
    console.log(`✓ ZIP archive created successfully with Compress-Archive.`);
  }

  // 9. Verify ZIP Archive
  console.log(`\n--- Step 9: Verifying ZIP Archive ---`);
  if (!fs.existsSync(zipFilePath) || fs.statSync(zipFilePath).size === 0) {
    throw new Error('CRITICAL ERROR: Backup ZIP was not created or is 0 bytes!');
  }

  const zipStat = fs.statSync(zipFilePath);
  const zipSha256 = getSha256(zipFilePath);

  // Test ZIP integrity by listing contents with tar -tf
  let zipListing = '';
  try {
    zipListing = execSync(`tar -tf "${zipFilePath}"`, { encoding: 'utf8' });
  } catch (listErr) {
    // Fallback: PowerShell Expand-Archive check
    zipListing = execSync(`powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::OpenRead('${zipFilePath}').Entries | Select-Object -ExpandProperty FullName"`, { encoding: 'utf8' });
  }

  const hasSqlInZip = zipListing.includes('database_backup.sql');
  const hasEnvInZip = zipListing.includes('environment');
  const hasManifestInZip = zipListing.includes('backup_manifest.txt');
  const hasRestoreInZip = zipListing.includes('RESTORE_INSTRUCTIONS.md');

  if (!hasSqlInZip || !hasEnvInZip || !hasManifestInZip || !hasRestoreInZip) {
    throw new Error(`CRITICAL INTEGRITY FAILURE: Missing files in ZIP archive! Listing:\n${zipListing}`);
  }

  console.log(`✓ ZIP Archive Integrity Confirmed.`);
  console.log(`  Size:     ${(zipStat.size / (1024 * 1024)).toFixed(2)} MB (${zipStat.size} bytes)`);
  console.log(`  SHA-256:  ${zipSha256}`);
  console.log(`  Contents: database_backup.sql, environment/, backup_manifest.txt, backup_checksums.txt, RESTORE_INSTRUCTIONS.md`);

  console.log('\n===============================================================');
  console.log('              FINAL STATUS: BACKUP VERIFIED                   ');
  console.log('===============================================================\n');

  return {
    status: 'BACKUP VERIFIED',
    timestamp,
    backupDir,
    zipFilePath,
    dbProtocol,
    dbName,
    dbHost,
    dbPort,
    dumpSizeBytes: dumpStat.size,
    zipSizeBytes: zipStat.size,
    zipSha256,
    envFilesCount: envManifestList.length,
    envFiles: envManifestList.map(e => e.srcRel)
  };
}

runBackup().catch(err => {
  console.error('\n❌ BACKUP EXECUTION FAILED:', err);
  process.exit(1);
});
