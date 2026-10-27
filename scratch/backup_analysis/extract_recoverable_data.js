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

  let outputSql = '-- Recovered Local Development / Feature Test Data\n-- Extracted from pre_restore_backup_2026-10-23_17-00.zip\nSET FOREIGN_KEY_CHECKS = 0;\n\n';

  let totalRecords = 0;
  for (const t of targetTables) {
    const insertRegex = new RegExp(`INSERT INTO \`${t}\` VALUES\\s*([\\s\\S]*?);`, 'gi');
    let match;
    let tableInserts = 0;
    while ((match = insertRegex.exec(sqlDump)) !== null) {
      outputSql += match[0] + '\n\n';
      // count tuples
      const count = match[1].split(/\),\(/).length;
      tableInserts += count;
    }
    console.log(`Table [${t}]: ${tableInserts} records extracted.`);
    totalRecords += tableInserts;
  }

  outputSql += 'SET FOREIGN_KEY_CHECKS = 1;\n';

  const outPath = path.resolve(__dirname, 'recover_local_test_data.sql');
  fs.writeFileSync(outPath, outputSql, 'utf8');
  console.log(`\nSuccessfully saved ${totalRecords} records to ${outPath}`);
}

main().catch(console.error);
