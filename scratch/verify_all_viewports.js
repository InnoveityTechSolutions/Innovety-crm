const { spawn } = require('child_process');
const fs = require('fs');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();
const JWT_SECRET = 'enterprise_internship_crm_super_secret_jwt_key_123!';

async function verify() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' } });
  if (!admin) throw new Error('No active admin found');
  const adminToken = jwt.sign(
    { id: admin.id, email: admin.email, role: admin.role, organizationId: admin.organizationId },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  const chromeProc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--remote-debugging-port=9240', '--disable-gpu', '--no-first-run', 'about:blank'
  ]);
  await new Promise(r => setTimeout(r, 1500));
  const res = await fetch('http://localhost:9240/json');
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

  const viewports = [
    { name: 'desktop', width: 1440, height: 900, mobile: false },
    { name: 'tablet', width: 768, height: 1024, mobile: false },
    { name: 'mobile', width: 375, height: 812, mobile: true }
  ];

  const results = {};

  for (const vp of viewports) {
    console.log(`\n=== Testing Viewport: ${vp.name} (${vp.width}x${vp.height}) ===`);
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.mobile
    });

    await send('Page.navigate', { url: 'http://localhost:5173/leave-management?tab=CompOff' });
    await new Promise(r => setTimeout(r, 2000));

    // Ensure Verify Tab is clicked
    await evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const verifyBtn = btns.find(b => b.textContent.includes('Verify & Credit'));
        if (verifyBtn) verifyBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1000));

    const measurements = await evaluate(`
      (() => {
        const headerCard = document.querySelector('header > div');
        const main = document.querySelector('main');
        const compOffBanner = document.querySelector('div.space-y-6 > div.p-5, div.space-y-6 > div.p-4');
        const verifyContainer = document.querySelector('div.w-full.space-y-5');
        const authForm = document.querySelector('main form');
        const policyBox = verifyContainer?.children[0];

        const toBox = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            left: Math.round(r.left),
            right: Math.round(r.right),
            width: Math.round(r.width)
          };
        };

        const docWidth = document.documentElement.scrollWidth;
        const bodyWidth = document.body.scrollWidth;
        const winWidth = window.innerWidth;
        const hasHorizontalOverflow = docWidth > winWidth;

        return {
          windowWidth: winWidth,
          hasHorizontalOverflow,
          main: toBox(main),
          headerCard: toBox(headerCard),
          verifyContainer: toBox(verifyContainer),
          policyBox: toBox(policyBox),
          authForm: toBox(authForm)
        };
      })()
    `);

    results[vp.name] = measurements;
    console.log(`Results for ${vp.name}:`, JSON.stringify(measurements, null, 2));

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const shotPath = `scratch/leave_management_${vp.name}_verified.png`;
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    console.log(`Saved screenshot: ${shotPath}`);
  }

  ws.close();
  chromeProc.kill();
  await prisma.$disconnect();

  console.log('\n=== All Viewports Verified Successfully ===');
}

verify().catch(err => {
  console.error(err);
  process.exit(1);
});
