const fs = require('fs');
const path = require('path');
const JSZip = require('../../backend/node_modules/jszip');

async function main() {
  const backupZipPath = path.resolve(__dirname, '../../backend/backups/restored_backup_2026-10-23_17-00.zip');
  const data = fs.readFileSync(backupZipPath);
  const zip = await JSZip.loadAsync(data);
  const sqlDump = await zip.file('database/innoveity_live.sql').async('string');

  // Let's inspect the `asset` table definition in SQL
  const assetTableMatch = sqlDump.match(/CREATE TABLE `asset` \(([\s\S]*?)\) ENGINE=/i);
  if (assetTableMatch) {
    console.log('=== ASSET TABLE IN BACKUP ===');
    console.log(assetTableMatch[0]);
  }

  // Let's inspect the `user` table definition in SQL
  const userTableMatch = sqlDump.match(/CREATE TABLE `user` \(([\s\S]*?)\) ENGINE=/i);
  if (userTableMatch) {
    console.log('\n=== USER TABLE IN BACKUP (Columns) ===');
    const cols = userTableMatch[1].split('\n').filter(l => l.trim().startsWith('`'));
    console.log(cols.map(c => c.trim().replace(/,$/, '')).join('\n'));
  }

  // Let's inspect `attendance` table in SQL
  const attMatch = sqlDump.match(/CREATE TABLE `attendance` \(([\s\S]*?)\) ENGINE=/i);
  if (attMatch) {
    console.log('\n=== ATTENDANCE TABLE IN BACKUP (Columns) ===');
    const cols = attMatch[1].split('\n').filter(l => l.trim().startsWith('`'));
    console.log(cols.map(c => c.trim().replace(/,$/, '')).join('\n'));
  }

  // Let's inspect `_prisma_migrations` in the backup to see what migrations had been run on live!
  const migrationDataMatch = sqlDump.match(/INSERT INTO `_prisma_migrations` VALUES\s*([\s\S]*?);/i);
  if (migrationDataMatch) {
    console.log('\n=== _PRISMA_MIGRATIONS IN BACKUP ===');
    console.log(migrationDataMatch[0]);
  } else {
    console.log('\n=== NO _PRISMA_MIGRATIONS INSERT FOUND IN BACKUP ===');
    // Check if CREATE TABLE _prisma_migrations exists
    const pmCreate = sqlDump.match(/CREATE TABLE `_prisma_migrations` \(([\s\S]*?)\) ENGINE=/i);
    console.log('Exists CREATE TABLE _prisma_migrations?', !!pmCreate);
  }
}

main().catch(console.error);
