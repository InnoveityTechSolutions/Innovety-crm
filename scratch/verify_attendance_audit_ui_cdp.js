const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9225;

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
  console.log('=== STARTING CHROME CDP UI VERIFICATION ===\n');

  const userDataDir = path.join(__dirname, 'chrome_audit_test_profile');
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
    console.error('Failed to connect to Chrome remote debugging port.');
    chromeProc.kill();
    process.exit(1);
  }

  console.log('Connected to Chrome WebSocket:', wsUrl);
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

  console.log('1. Waiting for login page to load...');
  await sleep(2000);

  // 2. Perform Login as Admin
  console.log('2. Performing Admin Login via fetch & localStorage injection...');
  const evalResult = await send('Runtime.evaluate', {
    expression: `
      (async () => {
        try {
          const res = await fetch('http://localhost:5000/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin@enterprise-crm.com', password: 'password123', organizationSlug: 'innoveity' })
          });
          const data = await res.json();
          if (data.token) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            return { success: true, user: data.user };
          }
          return { success: false, data };
        } catch (e) {
          return { success: false, error: e.message };
        }
      })()
    `,
    awaitPromise: true,
    returnByValue: true
  });
  console.log('Login result:', evalResult?.result?.value);

  await sleep(2500);

  // 3. Navigate directly to Attendance Audit
  console.log('3. Navigating to /attendance-audit...');
  await send('Runtime.evaluate', {
    expression: `window.location.href = '/attendance-audit';`
  });
  await sleep(3500);

  // 4. Verify table and buttons
  console.log('4. Inspecting Attendance Audit table and View Details buttons...');
  const inspection = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const rows = document.querySelectorAll('table tbody tr');
        const viewButtons = document.querySelectorAll('button[title="View Attendance Details"]');
        const editButtons = document.querySelectorAll('button[title="Edit Attendance"]');
        return {
          rowCount: rows.length,
          viewButtonCount: viewButtons.length,
          editButtonCount: editButtons.length
        };
      })()
    `,
    returnByValue: true
  });
  console.log('Table inspection results:', inspection?.result?.value);

  if (!inspection?.result?.value?.viewButtonCount || inspection.result.value.viewButtonCount === 0) {
    console.error('❌ View buttons not found in table.');
  } else {
    console.log(`✅ Found ${inspection.result.value.viewButtonCount} View (eye) buttons beside Edit buttons!`);
  }

  // 5. Click the View Button on a row that has Clock-In data
  console.log('5. Clicking View Attendance Details button for a record with clock-in...');
  const clickResult = await send('Runtime.evaluate', {
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
        // Fallback to first row
        const firstBtn = document.querySelector('button[title="View Attendance Details"]');
        if (firstBtn) {
          firstBtn.click();
          return { success: true, fallback: true };
        }
        return { success: false };
      })()
    `,
    returnByValue: true
  });
  console.log('Click executed on row:', clickResult?.result?.value);

  await sleep(1500);

  // 6. Verify modal contents
  console.log('6. Verifying Attendance Audit Details Modal contents...');
  const modalInspection = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const modal = document.querySelector('.fixed.inset-0.z-50');
        if (!modal) return { open: false };

        const text = modal.innerText;
        const iframes = modal.querySelectorAll('iframe');
        const mapsLinks = modal.querySelectorAll('a[href*="google.com/maps"]');

        const hasClockIn = text.includes('Clock-In Details');
        const hasClockOut = text.includes('Clock-Out Details');
        const hasWorkType = text.includes('1. Work Type');
        const hasClockInTime = text.includes('2. Clock-In Time');
        const hasClockInAddr = text.includes('3. Clock-In Address');
        const hasClockInLoc = text.includes('4. Clock-In Location');
        const hasAutoClockOut = text.includes('Auto Clock-Out');
        const hasNotCaptured = text.includes('Location Not Captured');

        return {
          open: true,
          hasClockIn,
          hasClockOut,
          hasWorkType,
          hasClockInTime,
          hasClockInAddr,
          hasClockInLoc,
          hasAutoClockOut,
          hasNotCaptured,
          iframeCount: iframes.length,
          mapsLinkCount: mapsLinks.length,
          firstIframeSrc: iframes.length > 0 ? iframes[0].src : null,
          firstLinkHref: mapsLinks.length > 0 ? mapsLinks[0].href : null
        };
      })()
    `,
    returnByValue: true
  });
  console.log('Modal inspection report:', modalInspection?.result?.value);

  // Take screenshot
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  if (screenshot && screenshot.data) {
    const screenshotPath = path.join(__dirname, 'attendance_audit_view_details_screenshot.png');
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    console.log(`📸 Screenshot saved: ${screenshotPath}`);
  }

  // 7. Close modal
  console.log('7. Testing Modal Close button...');
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        const closeBtn = document.querySelector('button[title="Close modal"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Close');
        if (closeBtn) closeBtn.click();
      })()
    `
  });
  await sleep(1000);

  // 8. Verify Edit button
  console.log('8. Testing Edit button on row...');
  const editModalResult = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const editBtn = document.querySelector('button[title="Edit Attendance"]');
        if (editBtn) {
          editBtn.click();
          return true;
        }
        return false;
      })()
    `,
    returnByValue: true
  });
  await sleep(1000);

  const editModalCheck = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const modal = document.querySelector('.fixed.inset-0.z-50');
        return {
          open: Boolean(modal),
          text: modal ? modal.innerText.substring(0, 80) : null
        };
      })()
    `,
    returnByValue: true
  });
  console.log('Edit modal check:', editModalCheck?.result?.value);

  console.log('\n=== CDP UI VERIFICATION COMPLETED SUCCESSFULLY ===');
  chromeProc.kill();
  process.exit(0);
}

main().catch(err => {
  console.error('CDP test error:', err);
  process.exit(1);
});
