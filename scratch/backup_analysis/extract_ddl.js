const fs = require('fs');
const path = require('path');
const JSZip = require('../../backend/node_modules/jszip');

async function main() {
  const preRestoreZipPath = path.resolve(__dirname, '../../backend/backups/pre_restore_backup_2026-10-23_17-00.zip');
  const data = fs.readFileSync(preRestoreZipPath);
  const zip = await JSZip.loadAsync(data);
  const sqlDump = await zip.file('database/innoveity_live.sql').async('string');

  const targetTables = [
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
    'compoffsession',
    'companydocument',
    'assetestimate',
    'assetestimateitem'
  ];

  console.log('=== EXTRACTING CREATE TABLE STATEMENTS FROM PRE-RESTORE DUMP ===\n');
  const ddlMap = {};
  for (const t of targetTables) {
    const regex = new RegExp(`CREATE TABLE \`${t}\` \\([\\s\\S]*?\\) ENGINE=InnoDB[\\s\\S]*?;`, 'i');
    const match = sqlDump.match(regex);
    if (match) {
      ddlMap[t] = match[0];
      console.log(`Found CREATE TABLE \`${t}\``);
    } else {
      console.log(`NOT found: \`${t}\``);
    }
  }

  fs.writeFileSync(
    path.resolve(__dirname, 'exact_pre_restore_ddl.json'),
    JSON.stringify(ddlMap, null, 2)
  );
  console.log('\nSaved exact DDLs to scratch/backup_analysis/exact_pre_restore_ddl.json');
}

main().catch(console.error);
