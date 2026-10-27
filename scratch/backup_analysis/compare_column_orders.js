const fs = require('fs');
const path = require('path');
const JSZip = require('../../backend/node_modules/jszip');

async function checkColumnOrders() {
  const buf = fs.readFileSync(path.resolve(__dirname, '../../backend/backups/pre_restore_backup_2026-10-23_17-00.zip'));
  const zip = await JSZip.loadAsync(buf);
  const sql = await zip.file('database/innoveity_live.sql').async('string');

  const migrationSql = fs.readFileSync(path.resolve(__dirname, '../../backend/prisma/migrations/20261024120000_sync_crm_features/migration.sql'), 'utf8');

  const tables = [
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

  function extractColumns(sqlText, tbl) {
    const lines = sqlText.split(/\r?\n/);
    const start = lines.findIndex(l => l.includes('CREATE TABLE') && l.includes(`\`${tbl}\``));
    if (start === -1) return [];
    const end = lines.findIndex((l, idx) => idx > start && l.startsWith(') ENGINE'));
    const cols = [];
    for (let i = start + 1; i < end; i++) {
      const line = lines[i].trim();
      const m = line.match(/^`([a-zA-Z0-9_]+)`/);
      if (m) cols.push(m[1]);
    }
    return cols;
  }

  for (const t of tables) {
    const preCols = extractColumns(sql, t);
    const migCols = extractColumns(migrationSql, t);
    const same = JSON.stringify(preCols) === JSON.stringify(migCols);
    console.log(`Table \`${t}\`: Columns match? ${same ? 'YES' : 'DIFFERENT'}`);
    if (!same) {
      console.log('  pre_restore cols:', preCols);
      console.log('  migration   cols:', migCols);
    }
  }
}

checkColumnOrders().catch(console.error);
