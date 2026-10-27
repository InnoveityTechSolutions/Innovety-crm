const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9233;

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

async function main() {
  console.log('=== STARTING COMPLETE MULTI-VIEWPORT VERIFICATION ===\n');

  const userDataDir = path.join(__dirname, 'chrome_verify_profile');
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
    console.error('Failed to connect to Chrome debugging port.');
    chromeProc.kill();
    process.exit(1);
  }

  const ws = new WebSocket(wsUrl);
  let id = 1;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  };

  const send = (method, params = {}) => {
    const msgId = id++;
    return new Promise((resolve) => {
      pending.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  };

  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');

  await sleep(1000);

  // 1. Authenticate Admin
  console.log('1. Logging in as Admin...');
  await send('Runtime.evaluate', {
    expression: `
      (async () => {
        const res = await fetch('http://localhost:5000/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'admin@enterprise-crm.com', password: 'password123', organizationSlug: 'innoveity' })
        });
        const data = await res.json();
        if (data.token) {
          localStorage.setItem('token', data.token);
          localStorage.setItem('user', JSON.stringify(data.user));
          return true;
        }
        return false;
      })()
    `,
    awaitPromise: true
  });

  // 2. Navigate to Attendance Audit
  console.log('2. Navigating to Attendance Audit...');
  await send('Page.navigate', { url: 'http://localhost:5173/attendance-audit' });
  
  // Wait for table to load
  let rowsReady = false;
  for (let i = 0; i < 20; i++) {
    await sleep(600);
    const check = await send('Runtime.evaluate', {
      expression: `document.querySelectorAll('table tbody tr').length`,
      returnByValue: true
    });
    if (check?.result?.value > 0) {
      console.log('Table loaded with', check.result.value, 'rows');
      rowsReady = true;
      break;
    }
  }

  // 3. Open Modal
  console.log('3. Opening View Details modal...');
  const clickRes = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const rows = Array.from(document.querySelectorAll('table tbody tr'));
        const row = rows.find(r => r.innerText.includes('AM') || r.innerText.includes('PM'));
        if (row) {
          const btn = row.querySelector('button[title="View Attendance Details"]');
          if (btn) {
            btn.click();
            return { clicked: true, text: row.innerText.substring(0, 40) };
          }
        }
        return { clicked: false, rowCount: rows.length };
      })()
    `,
    returnByValue: true
  });
  console.log('Row clicked:', clickRes?.result?.value);
  await sleep(1500);

  // Verify Body Scroll Lock
  const bodyScrollBeforeClose = await send('Runtime.evaluate', {
    expression: `
      (() => {
        return {
          bodyOverflow: document.body.style.overflow,
          isLocked: document.body.style.overflow === 'hidden'
        };
      })()
    `,
    returnByValue: true
  });
  console.log('\nBody Scroll Lock Check (Modal Open):', bodyScrollBeforeClose?.result?.value);

  // Inspection helper function
  async function inspectViewport(w, h, name) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: w === 375 ? 2 : 1,
      mobile: w === 375
    });
    await sleep(600);

    const data = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const backdrop = document.querySelector('.fixed.inset-0.z-\\\\[60\\\\]') || document.querySelector('.fixed.inset-0');
          const modalDialog = backdrop ? backdrop.querySelector('.bg-card.shadow-2xl') : null;
          const contentWrapper = modalDialog ? modalDialog.querySelector('.flex-1') : null;
          const grid = modalDialog ? modalDialog.querySelector('.grid.grid-cols-1') : null;
          const cards = grid ? Array.from(grid.children) : [];
          const clockInCard = cards[0];
          const clockOutCard = cards[1];
          const footer = modalDialog ? modalDialog.lastElementChild : null;
          const closeBtn = footer ? footer.querySelector('button') : null;

          const inRect = clockInCard ? clockInCard.getBoundingClientRect() : null;
          const outRect = clockOutCard ? clockOutCard.getBoundingClientRect() : null;
          const fRect = footer ? footer.getBoundingClientRect() : null;
          const cwRect = contentWrapper ? contentWrapper.getBoundingClientRect() : null;
          const mRect = modalDialog ? modalDialog.getBoundingClientRect() : null;

          return {
            name: "${name}",
            window: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
            modalDialog: modalDialog ? {
              height: mRect.height,
              clientHeight: modalDialog.clientHeight,
              scrollHeight: modalDialog.scrollHeight,
              hasScrollbar: modalDialog.scrollHeight > modalDialog.clientHeight,
              maxHeightStyle: window.getComputedStyle(modalDialog).maxHeight
            } : null,
            contentWrapper: contentWrapper ? {
              height: cwRect.height,
              clientHeight: contentWrapper.clientHeight,
              scrollHeight: contentWrapper.scrollHeight,
              hasInnerScrollbar: contentWrapper.scrollHeight > contentWrapper.clientHeight,
              overflowY: window.getComputedStyle(contentWrapper).overflowY
            } : null,
            clockInCard: clockInCard ? {
              height: inRect.height,
              clientHeight: clockInCard.clientHeight,
              scrollHeight: clockInCard.scrollHeight,
              top: inRect.top,
              bottom: inRect.bottom
            } : null,
            clockOutCard: clockOutCard ? {
              height: outRect.height,
              clientHeight: clockOutCard.clientHeight,
              scrollHeight: clockOutCard.scrollHeight,
              top: outRect.top,
              bottom: outRect.bottom
            } : null,
            cardsSideBySide: inRect && outRect ? {
              isSideBySide: outRect.left > inRect.left && Math.abs(inRect.top - outRect.top) < 5,
              sameHeight: Math.abs(inRect.height - outRect.height) < 5,
              inHeight: inRect.height,
              outHeight: outRect.height
            } : null,
            footerAndClipping: {
              footerTop: fRect ? fRect.top : null,
              cardsBottom: inRect ? inRect.bottom : null,
              hasClipping: fRect && inRect ? (inRect.bottom > fRect.top) : false,
              closeBtnVisible: Boolean(closeBtn && closeBtn.getBoundingClientRect().height > 0)
            }
          };
        })()
      `,
      returnByValue: true
    });

    const val = data?.result?.value;
    console.log(`\n--- [${name} (${w}x${h})] ---`);
    console.log(`Modal Height: ${val?.modalDialog?.height}px (dialog scrollbar: ${val?.modalDialog?.hasScrollbar})`);
    console.log(`Content Wrapper Height: ${val?.contentWrapper?.height}px (inner scrollbar: ${val?.contentWrapper?.hasInnerScrollbar})`);
    console.log(`ClockIn Card Height: ${val?.clockInCard?.height}px, ClockOut Card Height: ${val?.clockOutCard?.height}px`);
    console.log(`Side-by-side aligned: ${val?.cardsSideBySide?.isSideBySide}, Equal height: ${val?.cardsSideBySide?.sameHeight}`);
    console.log(`Clipped behind footer: ${val?.footerAndClipping?.hasClipping}, Close button visible: ${val?.footerAndClipping?.closeBtnVisible}`);

    // Capture screenshot
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot && shot.data) {
      const filename = `final_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.png`;
      fs.writeFileSync(path.join(__dirname, filename), Buffer.from(shot.data, 'base64'));
      console.log(`📸 Saved screenshot: ${filename}`);
    }

    return val;
  }

  // Run all required viewport tests
  await inspectViewport(1440, 900, 'Desktop_1440x900');
  await inspectViewport(1366, 720, 'Desktop_1366x720');
  await inspectViewport(1280, 650, 'Short_Viewport_650');
  await inspectViewport(1280, 600, 'Short_Viewport_600');
  await inspectViewport(768, 1024, 'Tablet_768x1024');
  await inspectViewport(375, 812, 'Mobile_375x812');

  // Clear Emulation & Reset to desktop
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(500);

  // 4. Test Closing Modal & Body Scroll Restoration
  console.log('\n4. Testing Modal Close & Body Scroll Restoration...');
  const closeRes = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const closeBtn = document.querySelector('button.ml-auto') || document.querySelector('button[title="Close modal"]');
        if (closeBtn) closeBtn.click();
        return { clicked: true };
      })()
    `,
    returnByValue: true
  });
  console.log('Close clicked:', closeRes?.result?.value);
  await sleep(600);

  const bodyScrollAfterClose = await send('Runtime.evaluate', {
    expression: `
      (() => {
        return {
          bodyOverflow: document.body.style.overflow,
          isRestored: document.body.style.overflow !== 'hidden'
        };
      })()
    `,
    returnByValue: true
  });
  console.log('Body Scroll Restoration Check (Modal Closed):', bodyScrollAfterClose?.result?.value);

  console.log('\n=== ALL CDP CHECKS COMPLETED SUCCESSFULLY ===');
  chromeProc.kill();
  process.exit(0);
}

main().catch(console.error);
