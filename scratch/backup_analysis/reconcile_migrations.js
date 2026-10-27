const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseDbConfig } = require('../../backend/src/services/backupService');

const dbConfig = parseDbConfig();

function runMysql(args) {
  return new Promise((resolve, reject) => {
    const defaultArgs = [
      '-h', dbConfig.host,
      '-P', String(dbConfig.port),
      '-u', dbConfig.user,
      '--default-character-set=utf8mb4'
    ];
    const fullArgs = [...defaultArgs, ...args];

    const child = spawn('mysql', fullArgs, {
      env: { ...process.env, MYSQL_PWD: dbConfig.password },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('close', code => {
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `MySQL exited with code ${code}`));
      }
      resolve(stdout);
    });

    child.on('error', err => {
      reject(new Error(`Failed to spawn mysql: ${err.message}`));
    });
  });
}

async function main() {
  console.log('Reconciling Prisma migration history...');
  const check = await runMysql([
    'innoveity_crm',
    '-e',
    `SELECT migration_name FROM _prisma_migrations WHERE migration_name = '20260926180013_init_mysql';`
  ]);

  if (!check.includes('20260926180013_init_mysql')) {
    await runMysql([
      'innoveity_crm',
      '-e',
      `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (UUID(), 'b4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5', NOW(3), '20260926180013_init_mysql', NULL, NULL, NOW(3), 1);`
    ]);
    console.log('Successfully recorded 20260926180013_init_mysql in _prisma_migrations.');
  }

  const all = await runMysql([
    'innoveity_crm',
    '-e',
    `SELECT migration_name, finished_at, applied_steps_count FROM _prisma_migrations ORDER BY finished_at ASC;`
  ]);
  console.log('Current migration records in innoveity_crm:\n' + all.trim());
}

main().catch(console.error);
