const { spawn } = require('child_process');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();
const JWT_SECRET = 'enterprise_internship_crm_super_secret_jwt_key_123!';

async function inspect() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' } });
  if (!admin) throw new Error('No active admin found');
  const adminToken = jwt.sign(
    { id: admin.id, email: admin.email, role: admin.role, organizationId: admin.organizationId },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  const chromeProc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--remote-debugging-port=9238', '--disable-gpu', '--no-first-run', 'about:blank'
  ]);
  await new Promise(r => setTimeout(r, 1500));
  const res = await fetch('http://localhost:9238/json');
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

  console.log('--- Inspecting Leave Management: Default / Sanction Tab ---');
  await send('Page.navigate', { url: 'http://localhost:5173/leave-management' });
  await new Promise(r => setTimeout(r, 2000));

  const layoutDefault = await evaluate(`
    (() => {
      const headerCard = document.querySelector('header > div');
      const main = document.querySelector('main');
      const pageRoot = main?.children[0];
      const table = document.querySelector('table');
      const toBox = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return {
          tag: el.tagName,
          className: el.className,
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
          marginLeft: style.marginLeft,
          marginRight: style.marginRight,
          maxWidth: style.maxWidth
        };
      };
      return {
        headerCard: toBox(headerCard),
        main: toBox(main),
        pageRoot: toBox(pageRoot),
        table: toBox(table)
      };
    })()
  `);
  console.log('Sanction Tab Layout:', JSON.stringify(layoutDefault, null, 2));

  console.log('\n--- Inspecting Comp-Off Tab (verify form) ---');
  await send('Page.navigate', { url: 'http://localhost:5173/leave-management?tab=CompOff' });
  await new Promise(r => setTimeout(r, 2000));

  // Click on "Verify & Credit" sub-tab if needed
  await evaluate(`
    (() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const verifyBtn = btns.find(b => b.textContent.includes('Verify & Credit'));
      if (verifyBtn) verifyBtn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 1000));

  const layoutCompOffVerify = await evaluate(`
    (() => {
      const headerCard = document.querySelector('header > div');
      const main = document.querySelector('main');
      const pageRoot = main?.children[0];
      const verifyContainer = document.querySelector('div.w-full.space-y-5');
      const authForm = document.querySelector('main form');
      const policyBox = verifyContainer?.children[0];
      const toBox = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return {
          tag: el.tagName,
          className: el.className,
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
          marginLeft: style.marginLeft,
          marginRight: style.marginRight,
          maxWidth: style.maxWidth
        };
      };
      return {
        headerCard: toBox(headerCard),
        main: toBox(main),
        pageRoot: toBox(pageRoot),
        verifyContainer: toBox(verifyContainer),
        policyBox: toBox(policyBox),
        authForm: toBox(authForm)
      };
    })()
  `);
  console.log('Comp-Off Verify Tab Layout (After):', JSON.stringify(layoutCompOffVerify, null, 2));

  // Take a screenshot of the verify tab
  const fs = require('fs');
  const screenshotData = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('scratch/leave_management_compoff_verify_after.png', Buffer.from(screenshotData.data, 'base64'));
  console.log('Saved scratch/leave_management_compoff_verify_after.png');

  console.log('\n--- Inspecting Comp-Off Tab (ledger) ---');
  await evaluate(`
    (() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const ledgerBtn = btns.find(b => b.textContent.includes('Credit Ledger'));
      if (ledgerBtn) ledgerBtn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 1000));

  const layoutCompOffLedger = await evaluate(`
    (() => {
      const headerCard = document.querySelector('header > div');
      const main = document.querySelector('main');
      const table = document.querySelector('table');
      const filtersBar = document.querySelector('div.p-4.rounded-3xl.bg-card');
      const toBox = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return {
          tag: el.tagName,
          className: el.className,
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
          marginLeft: style.marginLeft,
          marginRight: style.marginRight,
          maxWidth: style.maxWidth
        };
      };
      return {
        headerCard: toBox(headerCard),
        main: toBox(main),
        filtersBar: toBox(filtersBar),
        table: toBox(table)
      };
    })()
  `);
  console.log('Comp-Off Ledger Tab Layout:', JSON.stringify(layoutCompOffLedger, null, 2));

  ws.close();
  chromeProc.kill();
  await prisma.$disconnect();
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
