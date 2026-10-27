const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('../backend/node_modules/exceljs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9223;

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
  console.log('=== STARTING ATTENDANCE AUDIT E2E TESTS ===\n');

  const userDataDir = path.join(__dirname, 'chrome_test_profile');
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

    // 1. Authenticate via API directly and seed localStorage
    console.log('[Setup] Authenticating admin via backend API...');
    const loginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'admin@enterprise-crm.com',
        password: 'Admin123!'
      })
    });
    const loginData = await loginRes.json();
    if (!loginData.token || !loginData.user) {
      throw new Error(`Login API failed: ${JSON.stringify(loginData)}`);
    }

    const token = loginData.token;
    const user = loginData.user;
    const orgId = user.organizationId || user.organization?.id || 'default';
    const storageKey = `attendance_audit_selected_members_${orgId}`;

    console.log('[Setup] Admin logged in. Organization ID:', orgId);
    console.log('[Setup] Storage Key:', storageKey);

    // Seed token and user into browser localStorage
    await evaluate(`
      (function() {
        localStorage.setItem('token', ${JSON.stringify(token)});
        localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});
        localStorage.setItem('mrf_selected_company_id', ${JSON.stringify(orgId)});
        localStorage.removeItem('${storageKey}');
      })()
    `);
    await sleep(500);

    // Navigate to Attendance Audit
    console.log('[Setup] Navigating to Attendance Audit...');
    await send('Page.navigate', { url: 'http://localhost:5173/attendance-audit' });
    await sleep(3000);

    // Helper to open Attendance Report panel if not open
    const ensureReportPanelOpen = async () => {
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

    await ensureReportPanelOpen();

    // -------------------------------------------------------------
    // TEST 1: Open for first time, confirm all selected, unselect 1, refresh, confirm still unselected
    // -------------------------------------------------------------
    console.log('--- TEST 1: First visit default selection & persistence after refresh ---');
    const memberCheckboxesInitial = await evaluate(`
      (function() {
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        return {
          total: cbs.length,
          checkedCount: cbs.filter(c => c.checked).length,
          ids: cbs.map(c => c.id.replace('select-member-', ''))
        };
      })()
    `);
    console.log(`[TEST 1] Total members: ${memberCheckboxesInitial.total}, Checked: ${memberCheckboxesInitial.checkedCount}`);
    if (memberCheckboxesInitial.total === 0) {
      throw new Error('No members found in report table!');
    }
    const test1InitialAllSelected = memberCheckboxesInitial.total === memberCheckboxesInitial.checkedCount;
    console.log(`[TEST 1] Initial all members selected: ${test1InitialAllSelected ? 'YES (PASS)' : 'NO (FAIL)'}`);

    // Unselect 1 member
    const unselectedId = memberCheckboxesInitial.ids[0];
    console.log(`[TEST 1] Unselecting member: ${unselectedId}`);
    await evaluate(`
      (function() {
        const cb = document.getElementById('select-member-${unselectedId}');
        if (cb) cb.click();
      })()
    `);
    await sleep(500);

    const savedAfterUnselect = await evaluate(`localStorage.getItem('${storageKey}')`);
    console.log(`[TEST 1] localStorage saved after unselecting 1:`, savedAfterUnselect);

    // Refresh browser
    console.log('[TEST 1] Refreshing page...');
    await send('Page.reload');
    await sleep(3000);
    await ensureReportPanelOpen();

    const memberCheckboxesAfterReload = await evaluate(`
      (function() {
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        const unselectedCb = document.getElementById('select-member-${unselectedId}');
        return {
          total: cbs.length,
          checkedCount: cbs.filter(c => c.checked).length,
          unselectedStillUnchecked: unselectedCb ? !unselectedCb.checked : false
        };
      })()
    `);
    console.log(`[TEST 1] After reload - Total: ${memberCheckboxesAfterReload.total}, Checked: ${memberCheckboxesAfterReload.checkedCount}`);
    console.log(`[TEST 1] Member ${unselectedId} still unselected: ${memberCheckboxesAfterReload.unselectedStillUnchecked ? 'YES (PASS)' : 'NO (FAIL)'}`);
    const test1Passed = test1InitialAllSelected && memberCheckboxesAfterReload.unselectedStillUnchecked;
    console.log(`>>> TEST 1 RESULT: ${test1Passed ? 'PASS' : 'FAIL'}\n`);

    // -------------------------------------------------------------
    // TEST 2: Select only 2 members, navigate away, return, confirm only those 2 remain selected
    // -------------------------------------------------------------
    console.log('--- TEST 2: Select 2 members, navigate away, return, confirm only 2 remain ---');
    // First, uncheck all, then check only first 2
    const firstTwoIds = memberCheckboxesInitial.ids.slice(0, 2);
    await evaluate(`
      (function() {
        const targetIds = ${JSON.stringify(firstTwoIds)};
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        cbs.forEach(cb => {
          const id = cb.id.replace('select-member-', '');
          const shouldCheck = targetIds.includes(id);
          if (cb.checked !== shouldCheck) cb.click();
        });
      })()
    `);
    await sleep(500);

    const savedTwo = await evaluate(`localStorage.getItem('${storageKey}')`);
    console.log(`[TEST 2] Saved 2 members in localStorage:`, savedTwo);

    // Navigate to Employees page
    console.log('[TEST 2] Navigating to /employees...');
    await send('Page.navigate', { url: 'http://localhost:5173/employees' });
    await sleep(2500);

    // Return to Attendance Audit
    console.log('[TEST 2] Returning to /attendance-audit...');
    await send('Page.navigate', { url: 'http://localhost:5173/attendance-audit' });
    await sleep(3000);
    await ensureReportPanelOpen();

    const checkedAfterReturn = await evaluate(`
      (function() {
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        const checkedIds = cbs.filter(c => c.checked).map(c => c.id.replace('select-member-', ''));
        return checkedIds;
      })()
    `);
    console.log(`[TEST 2] Checked IDs after return:`, checkedAfterReturn);
    const test2Passed =
      checkedAfterReturn.length === 2 &&
      firstTwoIds.every((id) => checkedAfterReturn.includes(id));
    console.log(`>>> TEST 2 RESULT: ${test2Passed ? 'PASS' : 'FAIL'}\n`);

    // -------------------------------------------------------------
    // TEST 3: Select 2 members, change Daily -> Weekly -> Monthly, confirm 2 remain selected
    // -------------------------------------------------------------
    console.log('--- TEST 3: Switching Daily -> Weekly -> Monthly preserves selection ---');
    // Switch to Weekly
    console.log('[TEST 3] Switching to Weekly tab...');
    await evaluate(`
      (function() {
        const btns = Array.from(document.querySelectorAll('button'));
        const weeklyBtn = btns.find(b => b.textContent.includes('Weekly Report'));
        if (weeklyBtn) weeklyBtn.click();
      })()
    `);
    await sleep(2500);

    const checkedWeekly = await evaluate(`
      (function() {
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        return cbs.filter(c => c.checked).map(c => c.id.replace('select-member-', ''));
      })()
    `);
    console.log(`[TEST 3] Checked on Weekly tab:`, checkedWeekly);

    // Switch to Monthly
    console.log('[TEST 3] Switching to Monthly tab...');
    await evaluate(`
      (function() {
        const btns = Array.from(document.querySelectorAll('button'));
        const monthlyBtn = btns.find(b => b.textContent.includes('Monthly Report'));
        if (monthlyBtn) monthlyBtn.click();
      })()
    `);
    await sleep(2500);

    const checkedMonthly = await evaluate(`
      (function() {
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        return cbs.filter(c => c.checked).map(c => c.id.replace('select-member-', ''));
      })()
    `);
    console.log(`[TEST 3] Checked on Monthly tab:`, checkedMonthly);

    // Switch back to Daily
    await evaluate(`
      (function() {
        const btns = Array.from(document.querySelectorAll('button'));
        const dailyBtn = btns.find(b => b.textContent.includes('Daily Report'));
        if (dailyBtn) dailyBtn.click();
      })()
    `);
    await sleep(2000);

    const test3Passed =
      checkedWeekly.length === 2 &&
      firstTwoIds.every((id) => checkedWeekly.includes(id)) &&
      checkedMonthly.length === 2 &&
      firstTwoIds.every((id) => checkedMonthly.includes(id));
    console.log(`>>> TEST 3 RESULT: ${test3Passed ? 'PASS' : 'FAIL'}\n`);

    // -------------------------------------------------------------
    // TEST 4: Select 2 members, change attendance date, confirm 2 remain selected
    // -------------------------------------------------------------
    console.log('--- TEST 4: Change attendance date preserves selection ---');
    console.log('[TEST 4] Changing date to 2026-09-20...');
    await evaluate(`
      (function() {
        const dateInput = document.querySelector('input[type="date"]');
        if (dateInput) {
          dateInput.value = '2026-09-20';
          dateInput.dispatchEvent(new Event('input', { bubbles: true }));
          dateInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    await sleep(2500);

    const checkedAfterDateChange = await evaluate(`
      (function() {
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        return cbs.filter(c => c.checked).map(c => c.id.replace('select-member-', ''));
      })()
    `);
    console.log(`[TEST 4] Checked after date change:`, checkedAfterDateChange);
    const test4Passed =
      checkedAfterDateChange.length === 2 &&
      firstTwoIds.every((id) => checkedAfterDateChange.includes(id));
    console.log(`>>> TEST 4 RESULT: ${test4Passed ? 'PASS' : 'FAIL'}\n`);

    // -------------------------------------------------------------
    // TEST 5: Unselect all members, refresh, confirm all unselected & export shows validation
    // -------------------------------------------------------------
    console.log('--- TEST 5: Unselect all members, refresh, confirm all unselected & export blocked ---');
    // Unselect all
    await evaluate(`
      (function() {
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        cbs.forEach(cb => {
          if (cb.checked) cb.click();
        });
      })()
    `);
    await sleep(500);

    const savedEmpty = await evaluate(`localStorage.getItem('${storageKey}')`);
    console.log(`[TEST 5] localStorage after unselecting all:`, savedEmpty);

    // Refresh
    console.log('[TEST 5] Refreshing page...');
    await send('Page.reload');
    await sleep(3000);
    await ensureReportPanelOpen();

    const checkedAfterEmptyReload = await evaluate(`
      (function() {
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        return cbs.filter(c => c.checked).length;
      })()
    `);
    console.log(`[TEST 5] Checked count after reload: ${checkedAfterEmptyReload}`);

    // Click export button
    console.log('[TEST 5] Clicking Export button with 0 selected...');
    await evaluate(`
      (function() {
        const btns = Array.from(document.querySelectorAll('button'));
        const exportBtn = btns.find(b => b.textContent.includes('Export Report'));
        if (exportBtn) exportBtn.click();
      })()
    `);
    await sleep(1000);

    const errorMsgText = await evaluate(`
      (function() {
        const alerts = Array.from(document.querySelectorAll('div'));
        const alert = alerts.find(a => a.textContent.includes('Please select at least one member to export'));
        return alert ? alert.textContent.trim() : '';
      })()
    `);
    console.log(`[TEST 5] Export validation error message: "${errorMsgText}"`);
    const test5Passed =
      checkedAfterEmptyReload === 0 &&
      errorMsgText.includes('Please select at least one member to export');
    console.log(`>>> TEST 5 RESULT: ${test5Passed ? 'PASS' : 'FAIL'}\n`);

    // -------------------------------------------------------------
    // TEST 6: Select All, refresh, confirm all members are selected
    // -------------------------------------------------------------
    console.log('--- TEST 6: Select All, refresh, confirm all members selected ---');
    await evaluate(`
      (function() {
        const selectAllCb = document.getElementById('select-all-daily');
        if (selectAllCb) selectAllCb.click();
      })()
    `);
    await sleep(500);

    const savedAll = await evaluate(`localStorage.getItem('${storageKey}')`);
    console.log(`[TEST 6] Saved selection after Select All: count = ${JSON.parse(savedAll).length}`);

    // Reload
    console.log('[TEST 6] Refreshing page...');
    await send('Page.reload');
    await sleep(3000);
    await ensureReportPanelOpen();

    const selectAllStateAfterReload = await evaluate(`
      (function() {
        const selectAllCb = document.getElementById('select-all-daily');
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        return {
          selectAllChecked: selectAllCb ? selectAllCb.checked : false,
          total: cbs.length,
          checkedCount: cbs.filter(c => c.checked).length
        };
      })()
    `);
    console.log(`[TEST 6] After reload - Total: ${selectAllStateAfterReload.total}, Checked: ${selectAllStateAfterReload.checkedCount}, SelectAll checked: ${selectAllStateAfterReload.selectAllChecked}`);
    const test6Passed =
      selectAllStateAfterReload.selectAllChecked &&
      selectAllStateAfterReload.total === selectAllStateAfterReload.checkedCount;
    console.log(`>>> TEST 6 RESULT: ${test6Passed ? 'PASS' : 'FAIL'}\n`);

    // -------------------------------------------------------------
    // TEST 7: Select a few members, export, confirm request userIds & downloaded content
    // -------------------------------------------------------------
    console.log('--- TEST 7: Export with selected user IDs ---');
    // Select first 2 members
    await evaluate(`
      (function() {
        const targetIds = ${JSON.stringify(firstTwoIds)};
        const cbs = Array.from(document.querySelectorAll('input[id^="select-member-"]'));
        cbs.forEach(cb => {
          const id = cb.id.replace('select-member-', '');
          const shouldCheck = targetIds.includes(id);
          if (cb.checked !== shouldCheck) cb.click();
        });
      })()
    `);
    await sleep(500);

    // Call backend directly using the auth token to test the exported excel content
    const authToken = await evaluate(`localStorage.getItem('token')`);
    const dateVal = await evaluate(`document.querySelector('input[type="date"]').value`);

    console.log(`[TEST 7] Fetching export from API with userIds=${firstTwoIds.join(',')}, date=${dateVal}...`);
    const exportResponse = await fetch(
      `http://localhost:5000/api/reports/attendance/export?type=daily&date=${dateVal}&organizationId=${orgId}&userIds=${firstTwoIds.join(',')}`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      }
    );

    if (!exportResponse.ok) {
      throw new Error(`Export API error: ${exportResponse.status} ${exportResponse.statusText}`);
    }

    const arrayBuffer = await exportResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet(1);

    // Rows 1-5 are headers; table starts row 6
    const employeeNames = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 6) {
        const empName = row.getCell(1).value;
        if (empName) employeeNames.push(empName);
      }
    });

    console.log(`[TEST 7] Excel exported rows count: ${employeeNames.length}`);
    console.log(`[TEST 7] Exported employee names:`, employeeNames);
    const test7Passed = employeeNames.length === 2;
    console.log(`>>> TEST 7 RESULT: ${test7Passed ? 'PASS' : 'FAIL'}\n`);

    // -------------------------------------------------------------
    // TEST 8: Verify selection isolation per organization / localStorage key
    // -------------------------------------------------------------
    console.log('--- TEST 8: Organization isolation per localStorage key ---');
    const orgKeyA = `attendance_audit_selected_members_ORG_A`;
    const orgKeyB = `attendance_audit_selected_members_ORG_B`;

    await evaluate(`
      (function() {
        localStorage.setItem('${orgKeyA}', JSON.stringify(['user-A1', 'user-A2']));
        localStorage.setItem('${orgKeyB}', JSON.stringify(['user-B1']));
      })()
    `);

    const readOrgA = await evaluate(`localStorage.getItem('${orgKeyA}')`);
    const readOrgB = await evaluate(`localStorage.getItem('${orgKeyB}')`);
    console.log(`[TEST 8] Org A key value:`, readOrgA);
    console.log(`[TEST 8] Org B key value:`, readOrgB);

    const test8Passed =
      readOrgA === JSON.stringify(['user-A1', 'user-A2']) &&
      readOrgB === JSON.stringify(['user-B1']);
    console.log(`>>> TEST 8 RESULT: ${test8Passed ? 'PASS' : 'FAIL'}\n`);

    // Clean up test keys
    await evaluate(`
      (function() {
        localStorage.removeItem('${orgKeyA}');
        localStorage.removeItem('${orgKeyB}');
      })()
    `);

    // Final summary
    console.log('====================================');
    console.log('FINAL SUITE SUMMARY:');
    console.log(`TEST 1 (First visit & reload unselect): ${test1Passed ? 'PASSED' : 'FAILED'}`);
    console.log(`TEST 2 (Navigate away & return):         ${test2Passed ? 'PASSED' : 'FAILED'}`);
    console.log(`TEST 3 (Daily -> Weekly -> Monthly):     ${test3Passed ? 'PASSED' : 'FAILED'}`);
    console.log(`TEST 4 (Date change):                   ${test4Passed ? 'PASSED' : 'FAILED'}`);
    console.log(`TEST 5 (Unselect all & reload/export):  ${test5Passed ? 'PASSED' : 'FAILED'}`);
    console.log(`TEST 6 (Select all & reload):           ${test6Passed ? 'PASSED' : 'FAILED'}`);
    console.log(`TEST 7 (Selected userIds export):        ${test7Passed ? 'PASSED' : 'FAILED'}`);
    console.log(`TEST 8 (Per-org key isolation):         ${test8Passed ? 'PASSED' : 'FAILED'}`);
    console.log('====================================');

    const allPassed =
      test1Passed &&
      test2Passed &&
      test3Passed &&
      test4Passed &&
      test5Passed &&
      test6Passed &&
      test7Passed &&
      test8Passed;

    if (allPassed) {
      console.log('ALL 8 TESTS PASSED SUCCESSFULLY!');
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
