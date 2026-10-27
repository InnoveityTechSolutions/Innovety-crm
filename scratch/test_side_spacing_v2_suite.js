const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const prisma = new PrismaClient();
const JWT_SECRET = 'enterprise_internship_crm_super_secret_jwt_key_123!';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_PROFILE = path.join(process.env.TEMP || 'C:\\Temp', 'chrome-spacing2-profile-' + Date.now());

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
  console.log('COMPANY DOCUMENTS EXPANDED SIDE SPACING TEST SUITE');
  console.log('====================================================\n');

  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    include: { organization: true }
  });

  if (!admin) throw new Error('No active admin user found in database');

  const adminToken = jwt.sign(
    { id: admin.id, email: admin.email, role: admin.role, organizationId: admin.organizationId },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9232',
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
      const res = await fetch('http://localhost:9232/json');
      const targets = await res.json();
      pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (pageTarget) break;
    } catch (e) {}
  }

  if (!pageTarget) throw new Error('Chrome target not found');

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
    console.log(`\n----------------------------------------------------`);
    console.log(`TESTING VIEWPORT: ${vp.name} (${vp.width}x${vp.height})`);
    console.log(`----------------------------------------------------`);

    await sendCdp(ws, 'Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.mobile
    });
    await sleep(800);

    const metrics = await evaluate(ws, `
      (() => {
        const headerCard = document.querySelector('header > div');
        const main = document.querySelector('main');
        const pageContainer = document.querySelector('main > div');
        const headerSection = pageContainer?.querySelector('.border-b');
        const toolbarCard = pageContainer?.children[1]?.querySelector('form') ? pageContainer.children[1] : pageContainer?.children[2];
        const table = pageContainer?.querySelector('table');

        const hRect = headerCard ? headerCard.getBoundingClientRect() : { left: 0, right: 0, width: 0 };
        const mRect = main ? main.getBoundingClientRect() : { left: 0, right: 0, width: window.innerWidth };
        const pRect = pageContainer ? pageContainer.getBoundingClientRect() : { left: 0, right: 0, width: 0 };
        const hsRect = headerSection ? headerSection.getBoundingClientRect() : { left: 0, right: 0, width: 0 };
        const tbRect = toolbarCard ? toolbarCard.getBoundingClientRect() : { left: 0, right: 0, width: 0 };
        const tRect = table ? table.getBoundingClientRect() : { left: 0, right: 0, width: 0 };

        const availableWidth = mRect.width;
        const containerWidth = pRect.width;
        const widthPercentage = ((containerWidth / availableWidth) * 100).toFixed(1) + '%';
        const leftMargin = Math.round(pRect.left - mRect.left);
        const rightMargin = Math.round(mRect.right - pRect.right);

        // Alignment with header card
        const alignsWithHeaderLeft = Math.abs(pRect.left - hRect.left) <= 2;
        const alignsWithHeaderRight = Math.abs(pRect.right - hRect.right) <= 2;

        // Expanded together check
        const headerWidth = Math.round(hsRect.width);
        const toolbarWidth = Math.round(tbRect.width);
        const tableWidth = Math.round(tRect.width);
        const allExpandedTogether = Math.abs(headerWidth - toolbarWidth) <= 2;

        // Check horizontal scroll
        const hasHorizontalScroll = document.documentElement.scrollWidth > window.innerWidth || main.scrollWidth > main.clientWidth + 2;

        return {
          windowWidth: window.innerWidth,
          availableWidth: Math.round(availableWidth),
          containerWidth: Math.round(containerWidth),
          widthPercentage,
          leftMargin,
          rightMargin,
          headerCardWidth: Math.round(hRect.width),
          headerWidth,
          toolbarWidth,
          tableWidth,
          alignsWithHeaderLeft,
          alignsWithHeaderRight,
          allExpandedTogether,
          hasHorizontalScroll
        };
      })()
    `);

    console.log('Metrics:', JSON.stringify(metrics, null, 2));

    const screenshot = await sendCdp(ws, 'Page.captureScreenshot', { format: 'png' });
    const screenshotPath = path.join(__dirname, `company_docs_wide_${vp.width}x${vp.height}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    console.log(`Screenshot captured: ${screenshotPath}`);

    const isDesktop = !vp.name.includes('Mobile');
    const ratioNum = parseFloat(metrics.widthPercentage);
    const passedRatio = isDesktop ? ratioNum >= 95 : true;
    const passedAlignment = isDesktop ? (metrics.alignsWithHeaderLeft && metrics.alignsWithHeaderRight) : true;
    const passedNoScroll = !metrics.hasHorizontalScroll;
    const passed = passedRatio && passedAlignment && passedNoScroll;

    results.push({ viewport: vp.name, ...metrics, passed });
  }

  ws.close();
  chromeProc.kill();
  await prisma.$disconnect();

  console.log('\n====================================================');
  console.log('SIDE SPACING TEST RESULTS SUMMARY:');
  console.log('====================================================');
  let allPassed = true;
  for (const r of results) {
    const status = r.passed ? '✓ PASS' : '✗ FAIL';
    if (!r.passed) allPassed = false;
    console.log(`${status} ${r.viewport}:`);
    console.log(`   - Available Width: ${r.availableWidth}px | Container: ${r.containerWidth}px (${r.widthPercentage})`);
    console.log(`   - Header: ${r.headerWidth}px | Toolbar: ${r.toolbarWidth}px | Table: ${r.tableWidth}px`);
    console.log(`   - Aligned with Header Card: Left=${r.alignsWithHeaderLeft}, Right=${r.alignsWithHeaderRight}`);
    console.log(`   - Left Margin: ${r.leftMargin}px | Right Margin: ${r.rightMargin}px`);
    console.log(`   - Horizontal Scroll: ${r.hasHorizontalScroll}`);
  }
  console.log('====================================================');
  console.log(allPassed ? 'ALL TEST VIEWPORTS PASSED WITH PERFECT ALIGNMENT!' : 'SOME TESTS FAILED!');
  console.log('====================================================\n');
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  if (chromeProc) chromeProc.kill();
  prisma.$disconnect();
  process.exit(1);
});
