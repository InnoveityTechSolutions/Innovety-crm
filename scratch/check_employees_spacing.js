const { spawn } = require('child_process');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();
const JWT_SECRET = 'enterprise_internship_crm_super_secret_jwt_key_123!';

async function check() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' } });
  const adminToken = jwt.sign({ id: admin.id, email: admin.email, role: admin.role, organizationId: admin.organizationId }, JWT_SECRET, { expiresIn: '1d' });
  const chromeProc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--remote-debugging-port=9231', '--disable-gpu', '--no-first-run', 'about:blank'
  ]);
  await new Promise(r => setTimeout(r, 1500));
  const res = await fetch('http://localhost:9231/json');
  const targets = await res.json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const curId = id++;
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === curId) { ws.removeEventListener('message', h); resolve(m.result); }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: curId, method, params }));
  });
  const evaluate = (expr) => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(r => r?.result?.value);
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:5173' });
  await new Promise(r => setTimeout(r, 1000));
  await evaluate(`
    localStorage.setItem('token', ${JSON.stringify(adminToken)});
    localStorage.setItem('user', JSON.stringify(${JSON.stringify(admin)}));
  `);
  await send('Page.navigate', { url: 'http://localhost:5173/employees' });
  await new Promise(r => setTimeout(r, 2000));
  const layout = await evaluate(`
    (() => {
      const headerCard = document.querySelector('header > div');
      const main = document.querySelector('main');
      const pageContainer = document.querySelector('main > div');
      const table = document.querySelector('table');
      const hRect = headerCard ? headerCard.getBoundingClientRect() : {};
      const mRect = main ? main.getBoundingClientRect() : {};
      const pRect = pageContainer ? pageContainer.getBoundingClientRect() : {};
      const tRect = table ? table.getBoundingClientRect() : {};
      return {
        main: { left: Math.round(mRect.left), right: Math.round(mRect.right), width: Math.round(mRect.width) },
        headerCard: { left: Math.round(hRect.left), right: Math.round(hRect.right), width: Math.round(hRect.width) },
        pageContainer: { left: Math.round(pRect.left), right: Math.round(pRect.right), width: Math.round(pRect.width) },
        table: { left: Math.round(tRect.left), right: Math.round(tRect.right), width: Math.round(tRect.width) }
      };
    })()
  `);
  console.log('Employees layout measurements at 1920x1080:', JSON.stringify(layout, null, 2));
  ws.close();
  chromeProc.kill();
  await prisma.$disconnect();
}
check().catch(err => {
  console.error(err);
  process.exit(1);
});
