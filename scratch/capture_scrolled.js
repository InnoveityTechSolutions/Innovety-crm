const { spawn } = require('child_process');
const fs = require('fs');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();
const JWT_SECRET = 'enterprise_internship_crm_super_secret_jwt_key_123!';

async function captureScroll() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' } });
  const adminToken = jwt.sign(
    { id: admin.id, email: admin.email, role: admin.role, organizationId: admin.organizationId },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  const chromeProc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--remote-debugging-port=9242', '--disable-gpu', '--no-first-run', 'about:blank'
  ]);
  await new Promise(r => setTimeout(r, 1500));
  const res = await fetch('http://localhost:9242/json');
  const targets = await res.json();
  const page = targets.find(t => t.type === 'page');
  const WebSocket = require('../backend/node_modules/ws');
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:5173' });
  await new Promise(r => setTimeout(r, 1000));
  await evaluate(`
    localStorage.setItem('token', ${JSON.stringify(adminToken)});
    localStorage.setItem('user', JSON.stringify(${JSON.stringify(admin)}));
  `);

  // Tablet scrolled
  await send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:5173/leave-management?tab=CompOff' });
  await new Promise(r => setTimeout(r, 1500));
  await evaluate(`
    (() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const verifyBtn = btns.find(b => b.textContent.includes('Verify & Credit'));
      if (verifyBtn) verifyBtn.click();
      const main = document.querySelector('main');
      if (main) main.scrollTop = 500;
    })()
  `);
  await new Promise(r => setTimeout(r, 1000));
  const shotTablet = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('scratch/leave_management_tablet_form_scrolled.png', Buffer.from(shotTablet.data, 'base64'));

  // Mobile scrolled
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await evaluate(`
    (() => {
      const main = document.querySelector('main');
      if (main) main.scrollTop = 500;
    })()
  `);
  await new Promise(r => setTimeout(r, 1000));
  const shotMobile = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('scratch/leave_management_mobile_form_scrolled.png', Buffer.from(shotMobile.data, 'base64'));

  ws.close();
  chromeProc.kill();
  await prisma.$disconnect();
  console.log('Saved scrolled screenshots.');
}

captureScroll().catch(err => {
  console.error(err);
  process.exit(1);
});
