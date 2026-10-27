const path = require('path');
module.paths.push(path.resolve(__dirname, '..', 'backend', 'node_modules'));
require('dotenv').config({ path: path.resolve(__dirname, '..', 'backend', '.env') });

const { takeLiveBackup } = require('../backend/src/services/backupService');

async function run() {
  console.log('Initiating pre-migration backup for development database...');
  const result = await takeLiveBackup({ user: { role: 'SUPER_ADMIN', name: 'PreMigrationBackup' } });
  console.log('Backup result:', JSON.stringify({
    success: result.success,
    fileName: result.backup?.fileName,
    size: result.backup?.sizeFormatted,
    tablesCount: result.backup?.stats?.tableCount,
    totalRecords: result.backup?.stats?.totalRecords,
    checksum: result.backup?.checksum
  }, null, 2));
}

run().catch(err => {
  console.error('Backup failed:', err);
  process.exit(1);
});
