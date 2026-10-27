const fs = require('fs');
const path = require('path');
const JSZip = require('../../backend/node_modules/jszip');

async function main() {
  const backupZipPath = path.resolve(__dirname, '../../backend/backups/restored_backup_2026-10-23_17-00.zip');
  const data = fs.readFileSync(backupZipPath);
  const zip = await JSZip.loadAsync(data);
  const sqlDump = await zip.file('database/innoveity_live.sql').async('string');

  // Find INSERT INTO `user`
  const userInsertMatch = sqlDump.match(/INSERT INTO `user` VALUES\s*([\s\S]*?);/i);
  if (userInsertMatch) {
    console.log('=== USER INSERTS IN BACKUP ===');
    const valuesStr = userInsertMatch[1];
    // Split rows roughly
    const rows = valuesStr.split(/\),\(/);
    console.log(`Found ${rows.length} users in backup.`);
    for (const r of rows) {
      if (r.includes('superadmin@enterprise-crm.com') || r.includes('SUPER_ADMIN')) {
        console.log('Super Admin record row snippet:');
        // Redact any sensitive hash partially
        const safeSnippet = r.replace(/(\$2[ab]\$\d+\$)[^',]+/g, '$1[HASH_REDACTED]');
        console.log(safeSnippet);
      }
    }
  }
}

main().catch(console.error);
