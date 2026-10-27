const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../backend/node_modules/ws');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const prisma = new PrismaClient();
const JWT_SECRET = 'enterprise_internship_crm_super_secret_jwt_key_123!';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_PROFILE = path.join(process.env.TEMP || 'C:\\Temp', 'chrome-compoff-profile-' + Date.now());

let chromeProc = null;

function sendCdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
    const handler = (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.id === id) {
          ws.removeListener('message', handler);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        }
      } catch (err) {}
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function evaluate(ws, expression) {
  return sendCdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    .then(r => r?.result?.value);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runBrowserViewportsTest() {
  console.log('========================================================================');
  console.log('  InnovEity CRM — Comp-Off Phase 5: Chrome Viewport & Responsive Audit');
  console.log('========================================================================\n');

  // 1. Get Admin user for auth session
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    include: { organization: true }
  });

  const token = jwt.sign(
    {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      organizationId: admin.organizationId
    },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  const debugPort = 9235;
  console.log(`Launching Chrome in headless mode with debugging port ${debugPort}...`);
  chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${TEMP_PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    let pageTarget = null;
    for (let i = 0; i < 25; i++) {
      await sleep(400);
      try {
        const res = await fetch(`http://127.0.0.1:${debugPort}/json`);
        const targets = await res.json();
        pageTarget = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
        if (pageTarget) break;
      } catch (e) {}
    }

    if (!pageTarget) throw new Error('Could not find page target in Chrome.');

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise(res => ws.on('open', res));

    await sendCdp(ws, 'Page.enable');
    await sendCdp(ws, 'Runtime.enable');
    await sendCdp(ws, 'DOM.enable');

    console.log('Navigating to http://localhost:5173...');
    await sendCdp(ws, 'Page.navigate', { url: 'http://localhost:5173' });
    await sleep(2000);

    // Inject Auth Token and User Info in localStorage
    console.log('Injecting Admin authentication tokens into localStorage...');
    await evaluate(ws, `
      localStorage.setItem('token', ${JSON.stringify(token)});
      localStorage.setItem('user', ${JSON.stringify(JSON.stringify(admin))});
    `);

    // Navigate directly to /leaves
    console.log('Navigating to http://localhost:5173/leaves...');
    await sendCdp(ws, 'Page.navigate', { url: 'http://localhost:5173/leaves' });
    await sleep(3000);

    // -------------------------------------------------------------------------
    // TEST 1: Desktop Viewport (1440 x 900)
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Testing Desktop Viewport (1440 x 900) ---');
    await sendCdp(ws, 'Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await sleep(1000);

    // Verify Comp-Off Tab Button presence and click it
    const compOffTabFound = await evaluate(ws, `
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b => b.textContent && b.textContent.includes('Comp-Off Ledger'));
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()
    `);
    console.log(`  ✓ Desktop: "Comp-Off Ledger & Claims" tab clicked: ${compOffTabFound}`);
    await sleep(2000);

    // Verify Tab 1 Elements: KPI cards and Export CSV button
    const desktopAudit = await evaluate(ws, `
      (() => {
        const text = document.body.innerText;
        return {
          hasTotalAuthorized: text.includes('Total Authorized') || text.includes('Available Balance'),
          hasExportCsvBtn: Boolean(Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Export CSV'))),
          hasVerifyTab: Boolean(Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Verify & Credit'))),
          hasAdminQueueTab: Boolean(Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Admin Queue'))),
          hasStatusFilters: text.includes('All Records') || text.includes('Active')
        };
      })()
    `);
    console.log('  Desktop Elements Audit Result:', desktopAudit);

    const desktopShot = await sendCdp(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('scratch/compoff_desktop_1440x900.png', Buffer.from(desktopShot.data, 'base64'));
    console.log('  ✓ Desktop screenshot saved: scratch/compoff_desktop_1440x900.png');

    // -------------------------------------------------------------------------
    // TEST 2: Tablet Viewport (768 x 1024)
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Testing Tablet Viewport (768 x 1024) ---');
    await sendCdp(ws, 'Emulation.setDeviceMetricsOverride', {
      width: 768,
      height: 1024,
      deviceScaleFactor: 1,
      mobile: true
    });
    await sleep(1000);

    const tabletAudit = await evaluate(ws, `
      (() => {
        const text = document.body.innerText;
        const scrollWidth = document.documentElement.scrollWidth;
        const clientWidth = document.documentElement.clientWidth;
        return {
          hasHorizontalOverflow: scrollWidth > clientWidth,
          hasKpiCards: text.includes('Total Authorized') || text.includes('Available Balance'),
          hasExportCsvBtn: Boolean(Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Export CSV'))),
          clientWidth,
          scrollWidth
        };
      })()
    `);
    console.log('  Tablet Elements Audit Result:', tabletAudit);

    const tabletShot = await sendCdp(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('scratch/compoff_tablet_768x1024.png', Buffer.from(tabletShot.data, 'base64'));
    console.log('  ✓ Tablet screenshot saved: scratch/compoff_tablet_768x1024.png');

    // -------------------------------------------------------------------------
    // TEST 3: Mobile Viewport (375 x 812)
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Testing Mobile Viewport (375 x 812) ---');
    await sendCdp(ws, 'Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true
    });
    await sleep(1000);

    const mobileAudit = await evaluate(ws, `
      (() => {
        const text = document.body.innerText;
        const scrollWidth = document.documentElement.scrollWidth;
        const clientWidth = document.documentElement.clientWidth;
        return {
          hasHorizontalOverflow: scrollWidth > clientWidth,
          hasKpiCards: text.includes('Total Authorized') || text.includes('Available Balance'),
          hasSubTabs: Boolean(Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Verify'))),
          clientWidth,
          scrollWidth
        };
      })()
    `);
    console.log('  Mobile Elements Audit Result:', mobileAudit);

    const mobileShot = await sendCdp(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('scratch/compoff_mobile_375x812.png', Buffer.from(mobileShot.data, 'base64'));
    console.log('  ✓ Mobile screenshot saved: scratch/compoff_mobile_375x812.png');

    ws.close();
    console.log('\n========================================================================');
    console.log('  CHROME VIEWPORT & RESPONSIVE AUDIT COMPLETED SUCCESSFULLY');
    console.log('========================================================================\n');
  } catch (err) {
    console.error('Browser viewport test error:', err);
    throw err;
  } finally {
    if (chromeProc) {
      chromeProc.kill('SIGKILL');
    }
    try {
      fs.rmSync(TEMP_PROFILE, { recursive: true, force: true });
    } catch (e) {}
  }
}

runBrowserViewportsTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
