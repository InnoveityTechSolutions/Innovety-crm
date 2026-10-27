const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9232;

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
  const userDataDir = path.join(__dirname, 'chrome_shrink_profile');
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

  // Authenticate
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
        return { clicked: false, totalRows: rows.length };
      })()
    `,
    returnByValue: true
  });
  console.log('Click result:', clickRes?.result?.value);
  await sleep(1500);

  // Test various viewport heights
  const heights = [900, 800, 750, 700, 650, 600, 550];
  const results = [];

  for (const h of heights) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: h,
      deviceScaleFactor: 1,
      mobile: false
    });
    await sleep(400);

    const data = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const backdrop = document.querySelector('.fixed.inset-0.z-50');
          const modalDialog = backdrop ? backdrop.querySelector('.bg-card.shadow-2xl') : null;
          const contentWrapper = modalDialog ? modalDialog.querySelector('.flex-1') : null;
          const grid = modalDialog ? modalDialog.querySelector('.grid.grid-cols-1') : null;
          const cards = grid ? Array.from(grid.children) : [];
          const clockInCard = cards[0];
          const clockOutCard = cards[1];
          const footer = modalDialog ? modalDialog.lastElementChild : null;
          const closeBtn = footer ? footer.querySelector('button') : null;
          const main = document.querySelector('main');

          return {
            viewportHeight: window.innerHeight,
            modalDialog: modalDialog ? {
              height: modalDialog.getBoundingClientRect().height,
              clientHeight: modalDialog.clientHeight,
              scrollHeight: modalDialog.scrollHeight,
              hasScrollbar: modalDialog.scrollHeight > modalDialog.clientHeight,
              overflowY: window.getComputedStyle(modalDialog).overflowY,
              maxHeightStyle: window.getComputedStyle(modalDialog).maxHeight
            } : null,
            contentWrapper: contentWrapper ? {
              height: contentWrapper.getBoundingClientRect().height,
              clientHeight: contentWrapper.clientHeight,
              scrollHeight: contentWrapper.scrollHeight,
              hasScrollbar: contentWrapper.scrollHeight > contentWrapper.clientHeight,
              overflowY: window.getComputedStyle(contentWrapper).overflowY
            } : null,
            clockInCard: clockInCard ? {
              height: clockInCard.getBoundingClientRect().height,
              clientHeight: clockInCard.clientHeight,
              scrollHeight: clockInCard.scrollHeight,
              bottom: clockInCard.getBoundingClientRect().bottom
            } : null,
            footer: footer ? {
              top: footer.getBoundingClientRect().top,
              bottom: footer.getBoundingClientRect().bottom,
              height: footer.getBoundingClientRect().height
            } : null,
            main: main ? {
              hasScrollbar: main.scrollHeight > main.clientHeight,
              overflowY: window.getComputedStyle(main).overflowY
            } : null
          };
        })()
      `,
      returnByValue: true
    });

    results.push(data?.result?.value);

    // Save screenshot at 650px and 700px
    if (h === 700 || h === 650) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(__dirname, `modal_height_${h}.png`), Buffer.from(shot.data, 'base64'));
    }
  }

  console.log('VIEWPORT HEIGHT SWEEP:\n', JSON.stringify(results, null, 2));

  chromeProc.kill();
  process.exit(0);
}

main().catch(console.error);
