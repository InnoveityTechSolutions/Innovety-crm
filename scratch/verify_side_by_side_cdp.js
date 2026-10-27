const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9226;

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
  console.log('=== STARTING SIDE-BY-SIDE LAYOUT VERIFICATION ===\n');

  const userDataDir = path.join(__dirname, 'chrome_side_by_side_profile');
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

  await sleep(1500);

  // 1. Authenticate Admin
  console.log('1. Setting Admin Token...');
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
  console.log('2. Navigating to /attendance-audit...');
  await send('Page.navigate', { url: 'http://localhost:5173/attendance-audit' });
  await sleep(3500);

  // 3. Click View on a record with clock-in
  console.log('3. Clicking View on a record with clock-in data...');
  const clickRes = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const rows = Array.from(document.querySelectorAll('table tbody tr'));
        const rowWithClockIn = rows.find(r => r.innerText.includes('AM') || r.innerText.includes('PM'));
        if (rowWithClockIn) {
          const btn = rowWithClockIn.querySelector('button[title="View Attendance Details"]');
          if (btn) {
            btn.click();
            return { success: true, text: rowWithClockIn.innerText.replace(/\\n/g, ' • ').substring(0, 100) };
          }
        }
        return { success: false };
      })()
    `,
    returnByValue: true
  });
  console.log('Clicked row:', clickRes?.result?.value);
  await sleep(1500);

  // 4. Test Desktop Layout (1440px wide)
  console.log('4. Inspecting Desktop Layout (Side-by-Side Two Columns)...');
  const desktopInspection = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const modal = document.querySelector('.fixed.inset-0.z-50');
        if (!modal) return { open: false };

        const grid = modal.querySelector('.grid.grid-cols-1.md\\\\:grid-cols-2');
        const cards = grid ? Array.from(grid.children) : [];

        const clockInCard = cards[0];
        const clockOutCard = cards[1];

        const inRect = clockInCard ? clockInCard.getBoundingClientRect() : null;
        const outRect = clockOutCard ? clockOutCard.getBoundingClientRect() : null;

        // Verify side-by-side: same top within 5px, clockOut left > clockIn right
        const isSideBySide = inRect && outRect && Math.abs(inRect.top - outRect.top) < 15 && outRect.left > inRect.left;

        const clockInText = clockInCard ? clockInCard.innerText : '';
        const clockOutText = clockOutCard ? clockOutCard.innerText : '';

        const clockInIframe = clockInCard ? clockInCard.querySelector('iframe') : null;
        const clockOutIframe = clockOutCard ? clockOutCard.querySelector('iframe') : null;

        return {
          open: true,
          hasGrid: Boolean(grid),
          cardCount: cards.length,
          isSideBySide,
          inRect: inRect ? { left: inRect.left, top: inRect.top, width: inRect.width, height: inRect.height } : null,
          outRect: outRect ? { left: outRect.left, top: outRect.top, width: outRect.width, height: outRect.height } : null,
          clockInHasIframe: Boolean(clockInIframe),
          clockOutHasIframe: Boolean(clockOutIframe),
          clockInIframeSrc: clockInIframe ? clockInIframe.src : null,
          clockInTextSnippets: {
            hasHeading: clockInText.includes('Clock-In Details'),
            hasWorkType: clockInText.includes('Work Type'),
            hasClockInTime: clockInText.includes('Clock-In Time'),
            hasClockInAddr: clockInText.includes('Clock-In Address'),
            hasLocationLabel: clockInText.includes('Clock-In Location'),
            hasMapsLink: clockInText.includes('Open in Google Maps')
          },
          clockOutTextSnippets: {
            hasHeading: clockOutText.includes('Clock-Out Details'),
            hasAutoClockOut: clockOutText.includes('Auto Clock-Out'),
            hasNotCaptured: clockOutText.includes('Location Not Captured'),
            hasWorkType: clockOutText.includes('Work Type')
          }
        };
      })()
    `,
    returnByValue: true
  });
  console.log('Desktop Layout Inspection:', JSON.stringify(desktopInspection?.result?.value, null, 2));

  // Capture Desktop Screenshot
  const desktopScreenshot = await send('Page.captureScreenshot', { format: 'png' });
  if (desktopScreenshot?.data) {
    fs.writeFileSync(path.join(__dirname, 'modal_desktop_side_by_side.png'), Buffer.from(desktopScreenshot.data, 'base64'));
    console.log('📸 Saved modal_desktop_side_by_side.png');
  }

  // 5. Test Tablet Layout (768px wide)
  console.log('\n5. Testing Tablet Viewport (768x1024)...');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 768,
    height: 1024,
    deviceScaleFactor: 1,
    mobile: false
  });
  await sleep(1000);

  const tabletInspection = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const grid = document.querySelector('.grid.grid-cols-1.md\\\\:grid-cols-2');
        const cards = grid ? Array.from(grid.children) : [];
        const inRect = cards[0]?.getBoundingClientRect();
        const outRect = cards[1]?.getBoundingClientRect();
        return {
          cardCount: cards.length,
          isSideBySide: inRect && outRect && Math.abs(inRect.top - outRect.top) < 20 && outRect.left > inRect.left,
          inRect: inRect ? { left: inRect.left, top: inRect.top, width: inRect.width } : null,
          outRect: outRect ? { left: outRect.left, top: outRect.top, width: outRect.width } : null
        };
      })()
    `,
    returnByValue: true
  });
  console.log('Tablet Layout Inspection:', tabletInspection?.result?.value);

  const tabletScreenshot = await send('Page.captureScreenshot', { format: 'png' });
  if (tabletScreenshot?.data) {
    fs.writeFileSync(path.join(__dirname, 'modal_tablet_view.png'), Buffer.from(tabletScreenshot.data, 'base64'));
    console.log('📸 Saved modal_tablet_view.png');
  }

  // 6. Test Mobile Layout (375px wide)
  console.log('\n6. Testing Mobile Viewport (375x812)...');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 375,
    height: 812,
    deviceScaleFactor: 2,
    mobile: true
  });
  await sleep(1000);

  const mobileInspection = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const grid = document.querySelector('.grid.grid-cols-1.md\\\\:grid-cols-2');
        const cards = grid ? Array.from(grid.children) : [];
        const inRect = cards[0]?.getBoundingClientRect();
        const outRect = cards[1]?.getBoundingClientRect();
        // Mobile should be stacked: outRect.top > inRect.bottom
        return {
          cardCount: cards.length,
          isStacked: inRect && outRect && outRect.top >= inRect.bottom - 5,
          inRect: inRect ? { left: inRect.left, top: inRect.top, width: inRect.width } : null,
          outRect: outRect ? { left: outRect.left, top: outRect.top, width: outRect.width } : null
        };
      })()
    `,
    returnByValue: true
  });
  console.log('Mobile Layout Inspection (Stacked):', mobileInspection?.result?.value);

  const mobileScreenshot = await send('Page.captureScreenshot', { format: 'png' });
  if (mobileScreenshot?.data) {
    fs.writeFileSync(path.join(__dirname, 'modal_mobile_view.png'), Buffer.from(mobileScreenshot.data, 'base64'));
    console.log('📸 Saved modal_mobile_view.png');
  }

  // Reset Emulation
  await send('Emulation.clearDeviceMetricsOverride');

  console.log('\n=== SIDE-BY-SIDE CDP TEST FINISHED ===');
  chromeProc.kill();
  process.exit(0);
}

main().catch(err => {
  console.error('CDP test error:', err);
  process.exit(1);
});
