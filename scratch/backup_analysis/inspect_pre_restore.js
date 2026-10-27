const fs = require('fs');
const path = require('path');
const JSZip = require('../../backend/node_modules/jszip');

async function main() {
  const preRestoreZipPath = path.resolve(__dirname, '../../backend/backups/pre_restore_backup_2026-10-23_17-00.zip');
  const data = fs.readFileSync(preRestoreZipPath);
  const zip = await JSZip.loadAsync(data);
  const infoRaw = await zip.file('backup_info.json').async('string');
  const info = JSON.parse(infoRaw);

  console.log('=== PRE-RESTORE SAFETY BACKUP INFO ===');
  console.log('Total Tables in Pre-Restore Backup:', info.totalTables);
  console.log('Total Records in Pre-Restore Backup:', info.totalRecords);
  console.log('Created At:', info.createdAt);
  console.log('Tables:', info.tablesList.length);

  // Check how many records were in the 14 tables in the pre-restore backup!
  const sqlDump = await zip.file('database/innoveity_live.sql').async('string');
  const missing14 = [
    'assetestimate',
    'assetestimateitem',
    'companydocument',
    'attendancelocation',
    'userattendancelocation',
    'accesstemplate',
    'accesstemplatepermission',
    'meeting',
    'meetingattendee',
    'meetingreport',
    'compoffcredit',
    'compoffconsumption',
    'compoffpermissionrequest',
    'compoffsession'
  ];

  console.log('\n--- Records in the 14 tables in PRE-RESTORE backup ---');
  for (const t of missing14) {
    const insertMatch = sqlDump.match(new RegExp(`INSERT INTO \`${t}\` VALUES\\s*([\\s\\S]*?);`, 'i'));
    if (insertMatch) {
      const rows = insertMatch[1].split(/\),\(/).length;
      console.log(`  Table [${t}]: HAD ${rows} rows in pre-restore database!`);
    } else {
      console.log(`  Table [${t}]: 0 rows / no inserts in pre-restore database`);
    }
  }
}

main().catch(console.error);
