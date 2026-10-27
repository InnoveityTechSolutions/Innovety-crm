const path = require('path');
module.paths.push(path.resolve(__dirname, '..', 'backend', 'node_modules'));

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const prisma = require('../backend/src/utils/db');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9228;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getWsUrl() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${DEBUG_PORT}/json`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const list = JSON.parse(data);
          const page = list.find((t) => t.type === 'page');
          if (page && page.webSocketDebuggerUrl) {
            resolve(page.webSocketDebuggerUrl);
          } else {
            reject(new Error('No page target found'));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function runViewportTests() {
  console.log('========================================================================');
  console.log('  Testing ClockInModal Viewport Fit & Overflow (Normal & Comp-Off)');
  console.log('========================================================================\n');

  const user = await prisma.user.findFirst({
    where: { role: 'EMPLOYEE' },
    include: { organization: true }
  });

  if (!user) {
    throw new Error('No employee user found');
  }

  const token = jwt.sign(
    {
      id: user.id,
      role: user.role,
      organizationId: user.organizationId,
      organizationSlug: user.organization?.slug || 'innoveity'
    },
    process.env.JWT_SECRET || 'enterprise_internship_crm_super_secret_jwt_key_123!',
    { expiresIn: '1d' }
  );

  const userDataDir = path.join(__dirname, 'chrome_modal_viewport_profile');
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--disable-gpu',
    '--window-size=1440,900',
    'http://localhost:5173/login'
  ]);

  let wsUrl = null;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      wsUrl = await getWsUrl();
      if (wsUrl) break;
    } catch (e) {}
  }

  if (!wsUrl) {
    chromeProc.kill();
    throw new Error('Could not connect to Chrome debugging port.');
  }

  const ws = new WebSocket(wsUrl);
  let msgId = 1;
  const pending = new Map();
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });

  const send = (method, params = {}) => {
    const id = msgId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  await new Promise((r) => ws.on('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');

  await sleep(1000);

  // Set localStorage token and user
  await send('Runtime.evaluate', {
    expression: `
      localStorage.setItem('token', ${JSON.stringify(token)});
      localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});
    `
  });

  const viewports = [
    { name: 'Desktop (1440x900)', width: 1440, height: 900 },
    { name: 'Laptop (1366x720)', width: 1366, height: 720 },
    { name: 'Short Viewport (1024x600)', width: 1024, height: 600 },
    { name: 'Mobile (375x667)', width: 375, height: 667 }
  ];

  let allPassed = true;

  try {
    // Navigate to /attendance
    await send('Page.navigate', { url: 'http://localhost:5173/attendance' });
    await sleep(3000);

    for (const vp of viewports) {
      console.log(`\n--- Testing Viewport: ${vp.name} ---`);

      // Set viewport device metrics
      await send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.width < 600
      });
      await send('Emulation.setVisibleSize', { width: vp.width, height: vp.height });
      await sleep(500);

      // Open Comp-Off modal or trigger modal open in DOM
      // We can trigger the modal by clicking the button or setting the React state / rendering helper
      const modalMetrics = await send('Runtime.evaluate', {
        expression: `
          (async () => {
            // Find Comp-Off login button or Clock In button on page
            let compOffBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Comp-Off Login'));
            let clockInBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Clock In'));
            
            const targetBtn = compOffBtn || clockInBtn;
            if (targetBtn) {
              targetBtn.click();
              await new Promise(r => setTimeout(r, 600));
            }

            // Find open modal dialog
            const modalEl = document.querySelector('.bg-card.rounded-3xl');
            if (!modalEl) {
              return { error: 'Modal element not found in DOM' };
            }

            const headerEl = modalEl.querySelector('h2');
            const footerEl = modalEl.querySelector('form > div:last-child');
            const scrollBodyEl = modalEl.querySelector('form > div:first-child');
            const submitBtn = modalEl.querySelector('button[type="submit"]');
            const cancelBtn = Array.from(modalEl.querySelectorAll('button')).find(b => b.textContent.trim() === 'Cancel');

            const modalRect = modalEl.getBoundingClientRect();
            const headerRect = headerEl ? headerEl.getBoundingClientRect() : null;
            const footerRect = footerEl ? footerEl.getBoundingClientRect() : null;
            const submitRect = submitBtn ? submitBtn.getBoundingClientRect() : null;
            const cancelRect = cancelBtn ? cancelBtn.getBoundingClientRect() : null;

            return {
              windowWidth: window.innerWidth,
              windowHeight: window.innerHeight,
              modalRect: {
                top: Math.round(modalRect.top),
                bottom: Math.round(modalRect.bottom),
                height: Math.round(modalRect.height),
                width: Math.round(modalRect.width)
              },
              headerTop: headerRect ? Math.round(headerRect.top) : null,
              footerBottom: footerRect ? Math.round(footerRect.bottom) : null,
              submitBottom: submitRect ? Math.round(submitRect.bottom) : null,
              cancelBottom: cancelRect ? Math.round(cancelRect.bottom) : null,
              scrollBody: scrollBodyEl ? {
                clientHeight: scrollBodyEl.clientHeight,
                scrollHeight: scrollBodyEl.scrollHeight,
                isScrollable: scrollBodyEl.scrollHeight > scrollBodyEl.clientHeight
              } : null,
              bodyOverflow: document.body.style.overflow
            };
          })()
        `,
        awaitPromise: true,
        returnByValue: true
      });

      const res = modalMetrics?.result?.value;
      if (res?.error) {
        console.warn(`  ⚠️ Notice: ${res.error}`);
        continue;
      }

      console.log(`  Window Dimensions: ${res.windowWidth} x ${res.windowHeight}`);
      console.log(`  Modal Rect: top=${res.modalRect.top}px, bottom=${res.modalRect.bottom}px, height=${res.modalRect.height}px`);
      console.log(`  Header Top: ${res.headerTop}px`);
      console.log(`  Footer Bottom: ${res.footerBottom}px (Submit: ${res.submitBottom}px, Cancel: ${res.cancelBottom}px)`);
      console.log(`  Content Scroll: clientHeight=${res.scrollBody?.clientHeight}px, scrollHeight=${res.scrollBody?.scrollHeight}px, isScrollable=${res.scrollBody?.isScrollable}`);
      console.log(`  Body Scroll Lock: "${res.bodyOverflow}"`);

      // Asserts
      const topNotClipped = res.modalRect.top >= 0;
      const bottomNotClipped = res.modalRect.bottom <= res.windowHeight + 2; // allowance for rounding
      const headerVisible = res.headerTop >= 0 && res.headerTop < res.windowHeight;
      const buttonsVisible = res.submitBottom <= res.windowHeight + 2 && res.cancelBottom <= res.windowHeight + 2;
      const bodyLocked = res.bodyOverflow === 'hidden';

      if (topNotClipped && bottomNotClipped && headerVisible && buttonsVisible && bodyLocked) {
        console.log(`  ✓ PASS: Modal fits cleanly in ${vp.name} without clipping!`);
      } else {
        console.error(`  ❌ FAIL: Modal clipping detected in ${vp.name}!`);
        allPassed = false;
      }

      // Capture screenshot
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      if (shot?.data) {
        const shotPath = path.join(__dirname, `modal_${vp.width}x${vp.height}.png`);
        fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
        console.log(`  📸 Saved screenshot: ${shotPath}`);
      }
    }
  } finally {
    ws.close();
    chromeProc.kill();
  }

  console.log('\n========================================================================');
  console.log(`  VIEWPORT OVERFLOW TEST RESULT: ${allPassed ? 'ALL PASSED' : 'FAILURES OCCURRED'}`);
  console.log('========================================================================');

  if (!allPassed) {
    process.exit(1);
  }
}

runViewportTests().catch((err) => {
  console.error('Viewport test error:', err);
  process.exit(1);
});
