const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9224;

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
  console.log('=== INVESTIGATING LOGOUT / LOGIN FLOW ===\n');

  const userDataDir = path.join(__dirname, 'chrome_investigate_profile');
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--disable-gpu',
    '--window-size=1440,900',
    'http://localhost:5173/login'
  ]);

  let ws;
  let msgId = 1;
  const pending = new Map();

  const send = (method, params = {}) => {
    const id = msgId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res?.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res?.result?.value;
  };

  try {
    await sleep(2000);
    const wsUrl = await getWsUrl();
    ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg.result);
      }
    };

    await new Promise((resolve) => (ws.onopen = resolve));
    await send('Runtime.enable');
    await send('Page.enable');
    await send('DOM.enable');

    // 1. Authenticate via API
    console.log('[Step 1] Logging in via API...');
    const loginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'admin@enterprise-crm.com',
        password: 'Admin123!'
      })
    });
    const loginData = await loginRes.json();
    const token = loginData.token;
    const user = loginData.user;
    const orgIdBefore = user.organizationId || user.organization?.id;
    const storageKeyBefore = `attendance_audit_selected_members_${orgIdBefore}`;

    console.log(`[Step 1] Organization ID before logout: "${orgIdBefore}"`);
    console.log(`[Step 1] Storage Key before logout: "${storageKeyBefore}"`);

    // Seed session into browser
    await evaluate(`
      (function() {
        localStorage.setItem('token', ${JSON.stringify(token)});
        localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});
        localStorage.setItem('mrf_selected_company_id', ${JSON.stringify(orgIdBefore)});
      })()
    `);

    // Navigate to attendance audit
    console.log('[Step 2] Navigating to Attendance Audit...');
    await send('Page.navigate', { url: 'http://localhost:5173/attendance-audit' });
    await sleep(3000);

    // Open reports panel
    await evaluate(`
      (function() {
        const btn = document.getElementById('toggle-attendance-reports-btn');
        if (btn) btn.click();
      })()
    `);
    await sleep(2500);

    // Select only 2 members
    console.log('[Step 3] Selecting only 2 members...');
    const memberIds = await evaluate(`
      (function() {
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        const ids = cbs.map(c => c.id.replace('select-member-', ''));
        const targetIds = ids.slice(0, 2);
        cbs.forEach(cb => {
          const id = cb.id.replace('select-member-', '');
          const shouldCheck = targetIds.includes(id);
          if (cb.checked !== shouldCheck) cb.click();
        });
        return targetIds;
      })()
    `);
    await sleep(500);

    // Inspect localStorage
    const savedBeforeLogout = await evaluate(`localStorage.getItem('${storageKeyBefore}')`);
    console.log(`[Step 3] localStorage [${storageKeyBefore}] value:`, savedBeforeLogout);

    const allKeysBeforeLogout = await evaluate(`
      (function() {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
        return keys;
      })()
    `);
    console.log('[Step 3] All localStorage keys before logout:', allKeysBeforeLogout);

    // Step 4: Perform Logout via Profile Dropdown
    console.log('\n[Step 4] Triggering Logout via Profile menu...');
    await evaluate(`
      (function() {
        // The profile dropdown trigger button is in header:
        // <button onClick={() => setProfileOpen(!profileOpen)} ...>
        // Let's find button with UserAvatar or near notification button in header
        const header = document.querySelector('header');
        if (header) {
          const profileBtn = header.querySelector('button.relative, button:has(img), button:has(span.font-bold)');
          // Try clicking the button containing user info in header
          const allHeaderBtns = Array.from(header.querySelectorAll('button'));
          // Profile button is typically the last button or contains avatar
          const target = allHeaderBtns.reverse().find(b => b.querySelector('img') || b.textContent.includes('Admin') || b.textContent.includes('System'));
          if (target) {
            target.click();
            console.log('Clicked header profile button');
          }
        }
      })()
    `);
    await sleep(600);

    // Now click the Logout button inside the dropdown
    const logoutClicked = await evaluate(`
      (function() {
        const btns = Array.from(document.querySelectorAll('button'));
        const logoutBtn = btns.find(b => b.textContent.trim().toLowerCase() === 'logout');
        if (logoutBtn) {
          logoutBtn.click();
          return true;
        }
        return false;
      })()
    `);
    console.log('[Step 4] Logout button clicked in dropdown:', logoutClicked);
    await sleep(2000);

    // Inspect localStorage after logout
    const allKeysAfterLogout = await evaluate(`
      (function() {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
        return keys;
      })()
    `);
    console.log('\n[Step 4] All localStorage keys AFTER logout:', allKeysAfterLogout);
    const keyExistsAfterLogout = await evaluate(`localStorage.getItem('${storageKeyBefore}')`);
    console.log(`[Step 4] Does [${storageKeyBefore}] exist after logout?`, keyExistsAfterLogout !== null ? 'YES' : 'NO (DELETED)');

    // Step 5: Login again
    console.log('\n[Step 5] Logging in again via API...');
    const loginRes2 = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'admin@enterprise-crm.com',
        password: 'Admin123!'
      })
    });
    const loginData2 = await loginRes2.json();
    const token2 = loginData2.token;
    const user2 = loginData2.user;
    const orgIdAfter = user2.organizationId || user2.organization?.id;
    const storageKeyAfter = `attendance_audit_selected_members_${orgIdAfter}`;

    console.log(`[Step 5] Organization ID after login: "${orgIdAfter}"`);
    console.log(`[Step 5] Storage Key after login: "${storageKeyAfter}"`);
    console.log(`[Step 5] Are org IDs identical? ${orgIdBefore === orgIdAfter ? 'YES' : 'NO'}`);
    console.log(`[Step 5] Are storage keys identical? ${storageKeyBefore === storageKeyAfter ? 'YES' : 'NO'}`);

    // Seed session back into browser
    await evaluate(`
      (function() {
        localStorage.setItem('token', ${JSON.stringify(token2)});
        localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user2))});
        localStorage.setItem('mrf_selected_company_id', ${JSON.stringify(orgIdAfter)});
      })()
    `);

    // Navigate to Attendance Audit
    console.log('\n[Step 6] Navigating to Attendance Audit after login...');
    await send('Page.navigate', { url: 'http://localhost:5173/attendance-audit' });
    await sleep(3000);

    // Open reports panel
    await evaluate(`
      (function() {
        const btn = document.getElementById('toggle-attendance-reports-btn');
        if (btn) btn.click();
      })()
    `);
    await sleep(2500);

    const checkedAfterLogin = await evaluate(`
      (function() {
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        return {
          total: cbs.length,
          checkedCount: cbs.filter(c => c.checked).length,
          checkedIds: cbs.filter(c => c.checked).map(c => c.id.replace('select-member-', ''))
        };
      })()
    `);
    console.log(`[Step 6] After login & re-opening Attendance Audit:`);
    console.log(`  Total displayed members: ${checkedAfterLogin.total}`);
    console.log(`  Total checked members: ${checkedAfterLogin.checkedCount}`);
    console.log(`  Checked IDs:`, checkedAfterLogin.checkedIds);
    console.log(`  Are ALL members selected? ${checkedAfterLogin.total === checkedAfterLogin.checkedCount ? 'YES' : 'NO'}`);

    console.log('\n=== INVESTIGATION COMPLETED ===');
  } catch (err) {
    console.error('Error during investigation:', err);
  } finally {
    if (ws) ws.close();
    chromeProc.kill();
  }
}

main();
