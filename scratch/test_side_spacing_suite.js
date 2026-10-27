const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const prisma = new PrismaClient();
const JWT_SECRET = 'enterprise_internship_crm_super_secret_jwt_key_123!';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_PROFILE = path.join(process.env.TEMP || 'C:\\Temp', 'chrome-spacing-profile-' + Date.now());

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let chromeProc = null;
let msgId = 1;
function sendCdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    const handler = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        }
      } catch (err) {}
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function evaluate(ws, expression) {
  return sendCdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    .then((r) => r?.result?.value);
}

async function run() {
  console.log('====================================================');
  console.log('COMPANY DOCUMENTS SIDE SPACING & RESPONSIVENESS SUITE');
  console.log('====================================================\n');

  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    include: { organization: true }
  });

  const adminToken = jwt.sign(
    { id: admin.id, email: admin.email, role: admin.role, organizationId: admin.organizationId },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9225',
    `--user-data-dir=${TEMP_PROFILE}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ], { stdio: 'ignore' });

  let pageTarget = null;
  for (let i = 0; i < 25; i++) {
    await sleep(400);
    try {
      const res = await fetch('http://localhost:9225/json');
      const targets = await res.json();
      pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (pageTarget) break;
    } catch (e) {}
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  await sendCdp(ws, 'Page.enable');
  await sendCdp(ws, 'Runtime.enable');
  await sendCdp(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  });

  await sendCdp(ws, 'Page.navigate', { url: 'http://localhost:5173' });
  await sleep(1500);

  // Set Auth in localStorage
  await evaluate(ws, `
    localStorage.setItem('token', ${JSON.stringify(adminToken)});
    localStorage.setItem('user', ${JSON.stringify(JSON.stringify(admin))});
  `);

  await sendCdp(ws, 'Page.navigate', { url: 'http://localhost:5173/company-documents' });
  await sleep(2500);

  const testViewports = [
    { name: '1920px Desktop', width: 1920, height: 1080, mobile: false },
    { name: '1440px Desktop', width: 1440, height: 900, mobile: false },
    { name: '1366px Laptop', width: 1366, height: 768, mobile: false },
    { name: 'Mobile (390px)', width: 390, height: 844, mobile: true }
  ];

  const results = [];

  for (const vp of testViewports) {
    console.log(`\nTesting viewport: ${vp.name} (${vp.width}x${vp.height})...`);
    await sendCdp(ws, 'Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.mobile
    });
    await sleep(800);

    const metrics = await evaluate(ws, `
      (() => {
        const container = document.querySelector('main > div') || document.querySelector('.max-w-\\\\[95\\\\%\\\\]') || document.querySelector('h1').closest('div.space-y-5, div.space-y-6');
        const main = document.querySelector('main');
        const table = document.querySelector('table');
        const toolbar = document.querySelector('form')?.parentElement;

        const mainRect = main ? main.getBoundingClientRect() : { width: window.innerWidth };
        const containerRect = container ? container.getBoundingClientRect() : { width: 0, left: 0, right: 0 };
        const tableRect = table ? table.getBoundingClientRect() : { width: 0 };
        const toolbarRect = toolbar ? toolbar.getBoundingClientRect() : { width: 0 };

        const availableWidth = mainRect.width;
        const containerWidth = containerRect.width;
        const widthRatio = (containerWidth / availableWidth) * 100;
        const leftMargin = containerRect.left - mainRect.left;
        const rightMargin = mainRect.right - containerRect.right;
        const hasHorizontalScroll = document.documentElement.scrollWidth > window.innerWidth || main.scrollWidth > main.clientWidth + 2;

        return {
          windowWidth: window.innerWidth,
          availableWidth: Math.round(availableWidth),
          containerWidth: Math.round(containerWidth),
          widthPercentage: widthRatio.toFixed(1) + '%',
          leftMargin: Math.round(leftMargin),
          rightMargin: Math.round(rightMargin),
          toolbarWidth: Math.round(toolbarRect.width),
          tableWidth: Math.round(tableRect.width),
          hasHorizontalScroll
        };
      })()
    `);

    console.log('Metrics:', JSON.stringify(metrics, null, 2));
    results.push({ viewport: vp.name, ...metrics });
  }

  // Take a visual screenshot at 1920x1080
  await sendCdp(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  });
  await sleep(600);

  const screenshot = await sendCdp(ws, 'Page.captureScreenshot', { format: 'png' });
  const screenshotPath = path.join(__dirname, 'company_documents_1920_spacing.png');
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  console.log(`\nScreenshot captured: ${screenshotPath}`);

  ws.close();
  chromeProc.kill();
  await prisma.$disconnect();

  console.log('\n====================================================');
  console.log('VIEWPORT VERIFICATION SUMMARY:');
  console.log('====================================================');
  for (const r of results) {
    const isDesktop = !r.viewport.includes('Mobile');
    const ratioNum = parseFloat(r.widthPercentage);
    const passedRatio = isDesktop ? ratioNum >= 88 && ratioNum <= 97 : true;
    const passedNoScroll = !r.hasHorizontalScroll;
    const status = passedRatio && passedNoScroll ? '✓ PASS' : '✗ FAIL';
    console.log(`${status} ${r.viewport}: Available = ${r.availableWidth}px | Container = ${r.containerWidth}px (${r.widthPercentage}) | LeftMargin = ${r.leftMargin}px | RightMargin = ${r.rightMargin}px | H-Scroll = ${r.hasHorizontalScroll}`);
  }
  console.log('====================================================\n');
}

run().catch((err) => {
  console.error('Test failed:', err);
  if (chromeProc) chromeProc.kill();
  prisma.$disconnect();
  process.exit(1);
});
