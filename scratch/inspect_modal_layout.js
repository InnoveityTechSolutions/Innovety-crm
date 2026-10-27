const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9227;

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
  const userDataDir = path.join(__dirname, 'chrome_inspect_profile');
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

  // Authenticate Admin
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

  await send('Page.navigate', { url: 'http://localhost:5173/attendance-audit' });
  await sleep(3500);

  // Click View on record
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        const rows = Array.from(document.querySelectorAll('table tbody tr'));
        const rowWithClockIn = rows.find(r => r.innerText.includes('AM') || r.innerText.includes('PM'));
        if (rowWithClockIn) {
          const btn = rowWithClockIn.querySelector('button[title="View Attendance Details"]');
          if (btn) btn.click();
        }
      })()
    `
  });
  await sleep(1500);

  // Helper to capture screenshot
  async function takeScreenshot(filename) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot && shot.data) {
      fs.writeFileSync(path.join(__dirname, filename), Buffer.from(shot.data, 'base64'));
      console.log(`📸 Saved ${filename}`);
    }
  }

  // Inspect DOM elements function
  async function inspectModal(viewName) {
    const details = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const backdrop = document.querySelector('.fixed.inset-0.z-50');
          const modalDialog = backdrop ? backdrop.querySelector('.bg-card.shadow-2xl') : null;
          const bodyContainer = modalDialog ? modalDialog.querySelector('.flex-1') : null;
          const grid = modalDialog ? modalDialog.querySelector('.grid.grid-cols-1') : null;
          const cards = grid ? Array.from(grid.children) : [];

          function getInfo(el, name) {
            if (!el) return { name, exists: false };
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return {
              name,
              exists: true,
              rect: { top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width, left: rect.left, right: rect.right },
              clientHeight: el.clientHeight,
              scrollHeight: el.scrollHeight,
              offsetHeight: el.offsetHeight,
              hasVerticalScrollbar: el.scrollHeight > el.clientHeight,
              overflowY: style.overflowY,
              paddingTop: style.paddingTop,
              paddingBottom: style.paddingBottom
            };
          }

          const inCard = cards[0];
          const outCard = cards[1];
          const inRect = inCard ? inCard.getBoundingClientRect() : null;
          const outRect = outCard ? outCard.getBoundingClientRect() : null;

          return {
            window: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
            backdrop: getInfo(backdrop, 'backdrop'),
            modalDialog: getInfo(modalDialog, 'modalDialog'),
            bodyContainer: getInfo(bodyContainer, 'bodyContainer'),
            clockInCard: getInfo(inCard, 'clockInCard'),
            clockOutCard: getInfo(outCard, 'clockOutCard'),
            sideBySide: inRect && outRect ? {
              sameTop: Math.abs(inRect.top - outRect.top) < 5,
              sameHeight: Math.abs(inRect.height - outRect.height) < 5,
              inHeight: inRect.height,
              outHeight: outRect.height,
              inTop: inRect.top,
              outTop: outRect.top
            } : null
          };
        })()
      `,
      returnByValue: true
    });
    console.log(`\n=== [${viewName}] INSPECTION ===\n`, JSON.stringify(details?.result?.value, null, 2));
    return details?.result?.value;
  }

  // 1. Desktop (1440x900)
  await inspectModal('DESKTOP 1440x900');
  await takeScreenshot('modal_desktop_fixed.png');

  // 2. Desktop shorter screen (1366x768 -> innerHeight ~720)
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1366,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false
  });
  await sleep(600);
  await inspectModal('DESKTOP 1366x720');
  await takeScreenshot('modal_desktop_720.png');

  // 3. Tablet (768x1024)
  await send('Emulation.setDeviceMetricsOverride', {
    width: 768,
    height: 1024,
    deviceScaleFactor: 1,
    mobile: false
  });
  await sleep(600);
  await inspectModal('TABLET 768x1024');
  await takeScreenshot('modal_tablet_fixed.png');

  // 4. Mobile (375x812)
  await send('Emulation.setDeviceMetricsOverride', {
    width: 375,
    height: 812,
    deviceScaleFactor: 2,
    mobile: true
  });
  await sleep(600);
  await inspectModal('MOBILE 375x812');
  await takeScreenshot('modal_mobile_fixed.png');

  // Clear Emulation
  await send('Emulation.clearDeviceMetricsOverride');

  chromeProc.kill();
  process.exit(0);
}

main().catch(console.error);
