const fs = require('fs');
const path = require('path');
const JSZip = require('../../backend/node_modules/jszip');

async function inspectPreRestore() {
  const buf = fs.readFileSync(path.resolve(__dirname, '../../backend/backups/pre_restore_backup_2026-10-23_17-00.zip'));
  const zip = await JSZip.loadAsync(buf);
  const sql = await zip.file('database/innoveity_live.sql').async('string');

  function getDDL(tbl) {
    const lines = sql.split(/\r?\n/);
    const start = lines.findIndex(l => l.includes(`CREATE TABLE \`${tbl}\``));
    if (start === -1) return 'NOT FOUND';
    const end = lines.findIndex((l, idx) => idx > start && l.startsWith(') ENGINE'));
    return lines.slice(start, end + 1).join('\n');
  }

  console.log('=== pre_restore DDL for companydocument ===\n' + getDDL('companydocument'));
  console.log('\n=== pre_restore DDL for assetestimate ===\n' + getDDL('assetestimate'));
  console.log('\n=== pre_restore DDL for assetestimateitem ===\n' + getDDL('assetestimateitem'));
}

inspectPreRestore();
