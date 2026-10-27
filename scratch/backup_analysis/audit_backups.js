const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('../../backend/node_modules/jszip');

async function verifyBackupZip(zipPath) {
  const result = {
    fileName: path.basename(zipPath),
    fullPath: zipPath,
    exists: false,
    sizeBytes: 0,
    sha256: null,
    validZip: false,
    entries: [],
    backupInfo: null,
    sqlStats: null,
    errors: []
  };

  if (!fs.existsSync(zipPath)) {
    result.errors.push('File does not exist');
    return result;
  }

  result.exists = true;
  const fileBuf = fs.readFileSync(zipPath);
  result.sizeBytes = fileBuf.length;
  result.sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');

  try {
    const zip = await JSZip.loadAsync(fileBuf);
    result.validZip = true;
    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
      result.entries.push({
        path: relativePath,
        dir: zipEntry.dir,
        uncompressedSize: zipEntry._data?.uncompressedSize || 0
      });
    }

    // Inspect backup_info.json if present
    const infoFile = zip.file('backup_info.json');
    if (infoFile) {
      const infoText = await infoFile.async('string');
      result.backupInfo = JSON.parse(infoText);
    }

    // Inspect SQL Dump if present
    const sqlFile = zip.file('database/innoveity_live.sql');
    if (sqlFile) {
      const sqlText = await sqlFile.async('string');
      const createMatches = sqlText.match(/CREATE TABLE `([^`]+)`/gi) || [];
      const insertMatches = sqlText.match(/INSERT INTO `([^`]+)`/gi) || [];
      result.sqlStats = {
        sqlLengthBytes: sqlText.length,
        createTableCount: createMatches.length,
        insertCount: insertMatches.length,
        hasDropTables: sqlText.includes('DROP TABLE IF EXISTS'),
        hasForeignKeyChecks: sqlText.includes('FOREIGN_KEY_CHECKS')
      };
    }
  } catch (err) {
    result.validZip = false;
    result.errors.push('Zip corruption or parse error: ' + err.message);
  }

  return result;
}

async function main() {
  console.log('=== AUDITING BACKUP INTEGRITY ===\n');

  const filesToCheck = [
    'backend/backups/restored_backup_2026-10-23_17-00.zip',
    'backend/backups/pre_restore_backup_2026-10-23_17-00.zip',
    'backend/backups/innoveity_live_backup_2026-10-14_12-27.zip'
  ];

  for (const rel of filesToCheck) {
    const absPath = path.resolve(__dirname, '../../', rel);
    console.log(`Auditing: ${rel}`);
    const res = await verifyBackupZip(absPath);
    console.log(`  Size: ${res.sizeBytes} bytes | SHA256: ${res.sha256?.slice(0, 16)}...`);
    console.log(`  Valid ZIP: ${res.validZip} | Entries: ${res.entries.map(e => e.path).join(', ')}`);
    if (res.backupInfo) {
      console.log(`  Metadata: Database=${res.backupInfo.database}, Tables=${res.backupInfo.totalTables}, Records=${res.backupInfo.totalRecords}, CreatedAt=${res.backupInfo.createdAt}`);
    }
    if (res.sqlStats) {
      console.log(`  SQL Stats: CREATE TABLEs=${res.sqlStats.createTableCount}, INSERTs=${res.sqlStats.insertCount}, Drops=${res.sqlStats.hasDropTables}`);
    }
    if (res.errors.length > 0) {
      console.log(`  Errors: ${res.errors.join(' | ')}`);
    }
    console.log('');
  }
}

main().catch(console.error);
