const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

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

async function main() {
  const userDataDir = path.join(__dirname, 'chrome_scrollbar_audit');
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

  // Find all elements in the entire document with scrollbars or overflow
  const audit = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const allElements = Array.from(document.querySelectorAll('*'));
        const scrollingElements = [];

        function getSelector(el) {
          if (!el) return '';
          let sel = el.tagName.toLowerCase();
          if (el.id) sel += '#' + el.id;
          if (el.className && typeof el.className === 'string') {
            const classes = el.className.trim().split(/\\s+/).slice(0, 3).join('.');
            if (classes) sel += '.' + classes;
          }
          return sel;
        }

        allElements.forEach(el => {
          const style = window.getComputedStyle(el);
          const hasScrollH = el.scrollHeight > el.clientHeight;
          const hasScrollW = el.scrollWidth > el.clientWidth;
          const isOverflowY = style.overflowY === 'auto' || style.overflowY === 'scroll';
          const isOverflowX = style.overflowX === 'auto' || style.overflowX === 'scroll';

          if ((hasScrollH && isOverflowY) || (hasScrollW && isOverflowX) || style.overflowY === 'scroll') {
            const rect = el.getBoundingClientRect();
            scrollingElements.push({
              tag: el.tagName,
              selector: getSelector(el),
              classes: el.className,
              rect: { top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width, left: rect.left, right: rect.right },
              clientHeight: el.clientHeight,
              scrollHeight: el.scrollHeight,
              clientWidth: el.clientWidth,
              scrollWidth: el.scrollWidth,
              overflowY: style.overflowY,
              overflowX: style.overflowX,
              maxHeight: style.maxHeight,
              height: style.height,
              isActuallyScrollableY: hasScrollH && isOverflowY,
              isActuallyScrollableX: hasScrollW && isOverflowX
            });
          }
        });

        // Check window & body & html specifically
        const html = document.documentElement;
        const body = document.body;

        return {
          window: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
          html: {
            clientHeight: html.clientHeight,
            scrollHeight: html.scrollHeight,
            overflowY: window.getComputedStyle(html).overflowY
          },
          body: {
            clientHeight: body.clientHeight,
            scrollHeight: body.scrollHeight,
            overflowY: window.getComputedStyle(body).overflowY
          },
          scrollingElements
        };
      })()
    `,
    returnByValue: true
  });

  console.log('SCROLLING ELEMENTS AUDIT:\n', JSON.stringify(audit?.result?.value, null, 2));

  // Also capture a full screenshot and an element screenshot of just the modal
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot && shot.data) {
    fs.writeFileSync(path.join(__dirname, 'audit_modal_full.png'), Buffer.from(shot.data, 'base64'));
    console.log('Saved audit_modal_full.png');
  }

  chromeProc.kill();
  process.exit(0);
}

main().catch(console.error);
