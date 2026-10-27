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
  console.log('=== ATTENDANCE AUDIT LOGOUT / LOGIN PERSISTENCE SUITE ===\n');

  const userDataDir = path.join(__dirname, 'chrome_suite_profile');
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

    const loginUser = async () => {
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
      const orgId = user.organizationId || user.organization?.id || 'default';
      const storageKey = `attendance_audit_selected_members_${orgId}`;

      await evaluate(`
        (function() {
          localStorage.setItem('token', ${JSON.stringify(token)});
          localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});
          localStorage.setItem('mrf_selected_company_id', ${JSON.stringify(orgId)});
        })()
      `);
      await sleep(300);
      return { token, user, orgId, storageKey };
    };

    const performUiLogout = async () => {
      await evaluate(`
        (function() {
          const header = document.querySelector('header');
          if (header) {
            const allHeaderBtns = Array.from(header.querySelectorAll('button'));
            const target = allHeaderBtns.reverse().find(b => b.querySelector('img') || b.textContent.includes('Admin') || b.textContent.includes('System'));
            if (target) target.click();
          }
        })()
      `);
      await sleep(600);

      await evaluate(`
        (function() {
          const btns = Array.from(document.querySelectorAll('button'));
          const logoutBtn = btns.find(b => b.textContent.trim().toLowerCase() === 'logout');
          if (logoutBtn) logoutBtn.click();
        })()
      `);
      await sleep(2000);
    };

    const openReportsPanel = async () => {
      const isOpen = await evaluate(`!!document.getElementById('select-all-daily')`);
      if (!isOpen) {
        await evaluate(`
          (function() {
            const btn = document.getElementById('toggle-attendance-reports-btn');
            if (btn) btn.click();
          })()
        `);
        await sleep(2500);
      }
    };

    // Initial Login
    console.log('[Setup] Logging in user...');
    const { orgId, storageKey } = await loginUser();
    console.log(`[Setup] Organization ID: ${orgId}`);
    console.log(`[Setup] Storage key: ${storageKey}`);

    // Navigate to attendance audit
    console.log('[Setup] Navigating to Attendance Audit...');
    await send('Page.navigate', { url: 'http://localhost:5173/attendance-audit' });
    await sleep(3000);
    await openReportsPanel();

    // -------------------------------------------------------------
    // PART 1: Flow with 2 members selected across navigate, reload, logout, login
    // -------------------------------------------------------------
    console.log('\n--- PART 1: 2 Members Selected -> Navigate -> Reload -> Logout -> Login ---');

    // Get all member IDs
    const allMemberIds = await evaluate(`
      (function() {
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        return cbs.map(c => c.id.replace('select-member-', ''));
      })()
    `);
    const targetTwoIds = allMemberIds.slice(0, 2);
    console.log('[Part 1] Total members:', allMemberIds.length);
    console.log('[Part 1] Target 2 member IDs:', targetTwoIds);

    // Select only those 2 members
    await evaluate(`
      (function() {
        const target = ${JSON.stringify(targetTwoIds)};
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        cbs.forEach(cb => {
          const id = cb.id.replace('select-member-', '');
          const shouldCheck = target.includes(id);
          if (cb.checked !== shouldCheck) cb.click();
        });
      })()
    `);
    await sleep(500);

    const savedTwo = await evaluate(`localStorage.getItem('${storageKey}')`);
    console.log('[Part 1] Step 4 - LocalStorage saved 2 members:', savedTwo);
    const step4Pass = savedTwo === JSON.stringify(targetTwoIds);
    console.log(`  Step 4 Result: ${step4Pass ? 'PASS' : 'FAIL'}`);

    // Step 5: Navigate elsewhere and return
    console.log('[Part 1] Step 5 - Navigating to /employees and returning...');
    await send('Page.navigate', { url: 'http://localhost:5173/employees' });
    await sleep(2000);
    await send('Page.navigate', { url: 'http://localhost:5173/attendance-audit' });
    await sleep(3000);
    await openReportsPanel();

    const checkedAfterNav = await evaluate(`
      (function() {
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        return cbs.filter(c => c.checked).map(c => c.id.replace('select-member-', ''));
      })()
    `);
    const step5Pass =
      checkedAfterNav.length === 2 &&
      targetTwoIds.every((id) => checkedAfterNav.includes(id));
    console.log(`[Part 1] Step 5 - Checked after return: ${JSON.stringify(checkedAfterNav)}`);
    console.log(`  Step 5 Result: ${step5Pass ? 'PASS' : 'FAIL'}`);

    // Step 6: Refresh
    console.log('[Part 1] Step 6 - Refreshing page...');
    await send('Page.reload');
    await sleep(3000);
    await openReportsPanel();

    const checkedAfterReload = await evaluate(`
      (function() {
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        return cbs.filter(c => c.checked).map(c => c.id.replace('select-member-', ''));
      })()
    `);
    const step6Pass =
      checkedAfterReload.length === 2 &&
      targetTwoIds.every((id) => checkedAfterReload.includes(id));
    console.log(`[Part 1] Step 6 - Checked after reload: ${JSON.stringify(checkedAfterReload)}`);
    console.log(`  Step 6 Result: ${step6Pass ? 'PASS' : 'FAIL'}`);

    // Step 7: Logout
    console.log('[Part 1] Step 7 - Triggering Logout...');
    await performUiLogout();

    // Step 8: Confirm attendance key still exists, token is cleared
    const savedAfterLogout = await evaluate(`localStorage.getItem('${storageKey}')`);
    const tokenAfterLogout = await evaluate(`localStorage.getItem('token')`);
    const userAfterLogout = await evaluate(`localStorage.getItem('user')`);

    console.log(`[Part 1] Step 8 - LocalStorage key [${storageKey}] after logout:`, savedAfterLogout);
    console.log(`[Part 1] Step 8 - token after logout:`, tokenAfterLogout);
    console.log(`[Part 1] Step 8 - user after logout:`, userAfterLogout);

    const step8Pass =
      savedAfterLogout === JSON.stringify(targetTwoIds) &&
      tokenAfterLogout === null &&
      userAfterLogout === null;
    console.log(`  Step 8 Result (Attendance key preserved & auth cleared): ${step8Pass ? 'PASS' : 'FAIL'}`);

    // Step 9 & 10: Login again & navigate to Attendance Audit
    console.log('[Part 1] Step 9 & 10 - Logging in again & navigating to Attendance Audit...');
    await loginUser();
    await send('Page.navigate', { url: 'http://localhost:5173/attendance-audit' });
    await sleep(3000);
    await openReportsPanel();

    // Step 11: Confirm ONLY those same 2 members are selected
    const checkedAfterReLogin = await evaluate(`
      (function() {
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        return {
          total: cbs.length,
          checkedCount: cbs.filter(c => c.checked).length,
          checkedIds: cbs.filter(c => c.checked).map(c => c.id.replace('select-member-', ''))
        };
      })()
    `);
    console.log(`[Part 1] Step 11 - Checked members after login: ${checkedAfterReLogin.checkedCount} / ${checkedAfterReLogin.total}`);
    console.log(`[Part 1] Step 11 - Checked IDs:`, checkedAfterReLogin.checkedIds);

    const step11Pass =
      checkedAfterReLogin.checkedCount === 2 &&
      targetTwoIds.every((id) => checkedAfterReLogin.checkedIds.includes(id));
    console.log(`  Step 11 Result (ONLY same 2 selected): ${step11Pass ? 'PASS' : 'FAIL'}`);

    // -------------------------------------------------------------
    // PART 2: Select All -> Logout -> Login -> Confirm All remain selected
    // -------------------------------------------------------------
    console.log('\n--- PART 2: Select All -> Logout -> Login ---');
    await evaluate(`
      (function() {
        const selectAllCb = document.getElementById('select-all-daily');
        if (selectAllCb) selectAllCb.click();
      })()
    `);
    await sleep(500);

    const countAllSaved = JSON.parse((await evaluate(`localStorage.getItem('${storageKey}')`)) || '[]').length;
    console.log(`[Part 2] Saved all members count: ${countAllSaved}`);

    await performUiLogout();
    await loginUser();
    await send('Page.navigate', { url: 'http://localhost:5173/attendance-audit' });
    await sleep(3000);
    await openReportsPanel();

    const checkedAfterSelectAllRelogin = await evaluate(`
      (function() {
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        const selectAllCb = document.getElementById('select-all-daily');
        return {
          total: cbs.length,
          checkedCount: cbs.filter(c => c.checked).length,
          selectAllChecked: selectAllCb ? selectAllCb.checked : false
        };
      })()
    `);
    console.log(`[Part 2] Result: ${checkedAfterSelectAllRelogin.checkedCount} / ${checkedAfterSelectAllRelogin.total} checked, selectAll=${checkedAfterSelectAllRelogin.selectAllChecked}`);
    const part2Pass =
      checkedAfterSelectAllRelogin.total > 0 &&
      checkedAfterSelectAllRelogin.total === checkedAfterSelectAllRelogin.checkedCount &&
      checkedAfterSelectAllRelogin.selectAllChecked;
    console.log(`>>> PART 2 RESULT: ${part2Pass ? 'PASS' : 'FAIL'}`);

    // -------------------------------------------------------------
    // PART 3: Select None -> Logout -> Login -> Confirm None remain selected
    // -------------------------------------------------------------
    console.log('\n--- PART 3: Select None -> Logout -> Login ---');
    await evaluate(`
      (function() {
        const selectAllCb = document.getElementById('select-all-daily');
        if (selectAllCb) selectAllCb.click(); // Deselects all
      })()
    `);
    await sleep(500);

    const savedEmpty = await evaluate(`localStorage.getItem('${storageKey}')`);
    console.log(`[Part 3] Saved empty selection: ${savedEmpty}`);

    await performUiLogout();
    await loginUser();
    await send('Page.navigate', { url: 'http://localhost:5173/attendance-audit' });
    await sleep(3000);
    await openReportsPanel();

    const checkedAfterSelectNoneRelogin = await evaluate(`
      (function() {
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        return cbs.filter(c => c.checked).length;
      })()
    `);
    console.log(`[Part 3] Checked count after re-login: ${checkedAfterSelectNoneRelogin}`);
    const part3Pass = checkedAfterSelectNoneRelogin === 0;
    console.log(`>>> PART 3 RESULT: ${part3Pass ? 'PASS' : 'FAIL'}`);

    // -------------------------------------------------------------
    // PART 4: Different Organization Keys Isolation
    // -------------------------------------------------------------
    console.log('\n--- PART 4: Different Organization Keys Isolation ---');
    const orgKeyA = 'attendance_audit_selected_members_ORG_AAA';
    const orgKeyB = 'attendance_audit_selected_members_ORG_BBB';

    await evaluate(`
      (function() {
        localStorage.setItem('${orgKeyA}', JSON.stringify(['id-1', 'id-2']));
        localStorage.setItem('${orgKeyB}', JSON.stringify(['id-3']));
      })()
    `);

    await performUiLogout();

    const readOrgA = await evaluate(`localStorage.getItem('${orgKeyA}')`);
    const readOrgB = await evaluate(`localStorage.getItem('${orgKeyB}')`);
    console.log('[Part 4] Org A preserved value:', readOrgA);
    console.log('[Part 4] Org B preserved value:', readOrgB);

    const part4Pass =
      readOrgA === JSON.stringify(['id-1', 'id-2']) &&
      readOrgB === JSON.stringify(['id-3']);
    console.log(`>>> PART 4 RESULT: ${part4Pass ? 'PASS' : 'FAIL'}`);

    // Cleanup test keys
    await evaluate(`
      (function() {
        localStorage.removeItem('${orgKeyA}');
        localStorage.removeItem('${orgKeyB}');
      })()
    `);

    // -------------------------------------------------------------
    // FINAL SUMMARY
    // -------------------------------------------------------------
    console.log('\n====================================');
    console.log('LOGOUT / LOGIN SUITE SUMMARY:');
    console.log(`Part 1 (2 members across logout/login): ${step4Pass && step5Pass && step6Pass && step8Pass && step11Pass ? 'PASSED' : 'FAILED'}`);
    console.log(`Part 2 (Select All across logout/login): ${part2Pass ? 'PASSED' : 'FAILED'}`);
    console.log(`Part 3 (Select None across logout/login): ${part3Pass ? 'PASSED' : 'FAILED'}`);
    console.log(`Part 4 (Organization isolation):         ${part4Pass ? 'PASSED' : 'FAILED'}`);
    console.log(`Security (Auth tokens cleared):          ${tokenAfterLogout === null && userAfterLogout === null ? 'PASSED' : 'FAILED'}`);
    console.log('====================================');

    const allPassed =
      step4Pass &&
      step5Pass &&
      step6Pass &&
      step8Pass &&
      step11Pass &&
      part2Pass &&
      part3Pass &&
      part4Pass &&
      tokenAfterLogout === null;

    if (allPassed) {
      console.log('ALL TESTS PASSED SUCCESSFULLY!');
      process.exit(0);
    } else {
      console.error('SOME TESTS FAILED!');
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution failed with error:', err);
    process.exit(1);
  } finally {
    if (ws) ws.close();
    chromeProc.kill();
  }
}

main();
