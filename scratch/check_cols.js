const p = require('../backend/src/utils/db');
async function run() {
  const cols = await p.$queryRawUnsafe('DESCRIBE user');
  console.log('Columns matching clock or setting:', cols.map(c => c.Field).filter(f => f.toLowerCase().includes('clock') || f.toLowerCase().includes('setting') || f.toLowerCase().includes('auto')));
  console.log('All user columns:', cols.map(c => c.Field));
  await p.$disconnect();
}
run();
