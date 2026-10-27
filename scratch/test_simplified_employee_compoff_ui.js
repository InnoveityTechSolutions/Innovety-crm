const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../backend/node_modules/ws');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const prisma = new PrismaClient();
const JWT_SECRET = 'enterprise_internship_crm_super_secret_jwt_key_123!';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_PROFILE = path.join(process.env.TEMP || 'C:\\Temp', 'chrome-employee-ui-profile-' + Date.now());

let chromeProc = null;

function sendCdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
    const handler = (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.id === id) {
          ws.removeListener('message', handler);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        }
      } catch (err) {}
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function evaluate(ws, expression) {
  return sendCdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    .then(r => {
      if (r?.exceptionDetails) {
        console.error('CDP evaluation exception:', r.exceptionDetails.text, r.exceptionDetails.exception?.description);
      }
      return r?.result?.value;
    });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ PASS: ${message}`);
}

async function runSimplifiedUIAudit() {
  console.log('\n========================================================================');
  console.log('  InnovEity CRM — Simplified Employee Comp-Off UI & Permissions Audit');
  console.log('========================================================================\n');

  // Find Admin and Employee in the same organization
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    include: { organization: true }
  });
  if (!admin) throw new Error('No admin found in database.');

  let employee = await prisma.user.findFirst({
    where: { role: 'EMPLOYEE', organizationId: admin.organizationId },
    include: { organization: true }
  });

  if (!employee) {
    // If no employee in admin's org, create a temporary test employee or find any employee
    employee = await prisma.user.create({
      data: {
        email: `temp_emp_${Date.now()}@test.com`,
        password: 'dummy_password_hash',
        name: 'UI Audit Employee',
        role: 'EMPLOYEE',
        organizationId: admin.organizationId,
        employeeId: `EMP-${Date.now().toString().slice(-4)}`,
        status: 'ACTIVE'
      },
      include: { organization: true }
    });
  }

  console.log(`Admin:    ${admin.name} (${admin.email}) - Org: ${admin.organization.name}`);
  console.log(`Employee: ${employee.name} (${employee.email}) - Org: ${employee.organization.name}`);

  const employeeToken = jwt.sign(
    {
      id: employee.id,
      email: employee.email,
      role: employee.role,
      organizationId: employee.organizationId
    },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  const adminToken = jwt.sign(
    {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      organizationId: admin.organizationId
    },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  // Seed sample permission requests and credits for employee so history table has both pending and completed entries
  let perm1 = null, perm2 = null, session2 = null, credit2 = null;
  try {
    perm1 = await prisma.compOffPermissionRequest.create({
      data: {
        organizationId: admin.organizationId,
        userId: employee.id,
        workDate: new Date('2026-11-08T00:00:00.000Z'),
        holidayType: 'WEEKLY_OFF',
        reason: 'Urgent weekend client server deployment',
        status: 'PENDING'
      }
    });

    perm2 = await prisma.compOffPermissionRequest.create({
      data: {
        organizationId: admin.organizationId,
        userId: employee.id,
        workDate: new Date('2026-10-18T00:00:00.000Z'),
        holidayType: 'WEEKLY_OFF',
        reason: 'Database performance indexing maintenance',
        status: 'APPROVED',
        approvedById: admin.id,
        approvedAt: new Date('2026-10-17T10:00:00.000Z'),
        adminRemarks: 'Approved for Sunday maintenance window'
      }
    });

    session2 = await prisma.compOffSession.create({
      data: {
        organizationId: admin.organizationId,
        userId: employee.id,
        permissionRequestId: perm2.id,
        workDate: new Date('2026-10-18T00:00:00.000Z'),
        loginTime: new Date('2026-10-18T09:00:00.000Z'),
        clockOutTime: new Date('2026-10-18T17:30:00.000Z'),
        durationHours: 8.5,
        status: 'COMPLETED',
        approvalStatus: 'APPROVED',
        adminApprovedById: admin.id,
        adminApprovedAt: new Date('2026-10-19T09:00:00.000Z'),
        adminRemarks: 'Full day work verified'
      }
    });

    credit2 = await prisma.compOffCredit.create({
      data: {
        organizationId: admin.organizationId,
        userId: employee.id,
        creditDays: 1.0,
        availableDays: 1.0,
        usedDays: 0,
        workDate: new Date('2026-10-18T00:00:00.000Z'),
        earnedAt: new Date('2026-10-19T09:00:00.000Z'),
        expiresAt: new Date('2026-12-31T23:59:59.000Z'),
        reason: 'WEEKLY_OFF',
        status: 'APPROVED',
        claimedByRole: 'EMPLOYEE',
        claimedById: employee.id,
        adminRemarks: 'Full day credit granted for 8.5h work',
        adminApprovedById: admin.id,
        adminApprovedAt: new Date('2026-10-19T09:00:00.000Z')
      }
    });
    console.log('  ✓ Seeded sample Comp-Off records (Pending & Approved/Credited)');
  } catch (err) {
    console.warn('Warning: Could not seed test data:', err.message);
  }

  const debugPort = 9260;
  console.log(`Launching Chrome headless on debug port ${debugPort}...`);
  chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${TEMP_PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    let pageTarget = null;
    for (let i = 0; i < 25; i++) {
      await sleep(400);
      try {
        const res = await fetch(`http://127.0.0.1:${debugPort}/json`);
        const targets = await res.json();
        pageTarget = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
        if (pageTarget) break;
      } catch (e) {}
    }

    if (!pageTarget) throw new Error('Could not find Chrome page target.');

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise(res => ws.on('open', res));

    await sendCdp(ws, 'Page.enable');
    await sendCdp(ws, 'Runtime.enable');
    await sendCdp(ws, 'DOM.enable');

    console.log('Navigating to http://localhost:5173...');
    await sendCdp(ws, 'Page.navigate', { url: 'http://localhost:5173' });
    await sleep(2000);

    // =========================================================================
    // PART 1: EMPLOYEE VIEW AUDIT
    // =========================================================================
    console.log('\n=============================================================');
    console.log('  TEST GROUP 1: EMPLOYEE SIMPLIFIED COMP-OFF VIEW');
    console.log('=============================================================\n');

    await evaluate(ws, `
      localStorage.setItem('token', ${JSON.stringify(employeeToken)});
      localStorage.setItem('user', ${JSON.stringify(JSON.stringify({ ...employee, welcomePopupSeen: true }))});
      localStorage.setItem('company_welcome_dismissed_' + ${JSON.stringify(employee.id)}, 'true');
    `);

    console.log('Navigating to http://localhost:5173/leaves as EMPLOYEE...');
    await sendCdp(ws, 'Page.navigate', { url: 'http://localhost:5173/leaves' });
    await sleep(3000);

    // Set Desktop Viewport (1440x900)
    await sendCdp(ws, 'Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await sleep(1000);

    // Click Comp-Off Tab
    const compOffTabClicked = await evaluate(ws, `
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b => b.textContent && b.textContent.includes('Comp-Off'));
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()
    `);
    assert(compOffTabClicked, 'Employee navigated to Comp-Off section');
    await sleep(2000);

    // Audit Employee UI Elements
    const empUiCheck = await evaluate(ws, `
      (() => {
        const bodyText = document.body.innerText;
        const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());

        // Check that admin tabs are NOT present
        const hasLedgerTab = buttons.some(b => b.includes('Credit Ledger & Audit'));
        const hasSessionsTab = buttons.some(b => b.includes('Off-Day Sessions'));
        const hasVerifyTab = buttons.some(b => b.includes('Verify & Credit'));
        const hasQueueTab = buttons.some(b => b.includes('Admin Queue'));

        // Check that Employee elements ARE present
        const hasApplyBtn = buttons.some(b => b.includes('Apply for Comp-Off'));
        const hasHistoryHeader = bodyText.includes('Comp-Off History');

        // Check history table headers
        const headers = Array.from(document.querySelectorAll('th')).map(th => th.textContent.trim());
        const hasWorkDateCol = headers.some(h => h.includes('Work Date'));
        const hasReasonCol = headers.some(h => h.includes('Request Reason'));
        const hasStatusCol = headers.some(h => h.includes('Approval Status'));
        const hasDurationCol = headers.some(h => h.includes('Actual Work Duration'));
        const hasCreditCol = headers.some(h => h.includes('Credit Status'));

        // Check row counts and data presence
        const rows = Array.from(document.querySelectorAll('tbody tr'));
        const hasPendingRow = bodyText.includes('Urgent weekend client server deployment');
        const hasCompletedRow = bodyText.includes('Database performance indexing maintenance');
        const has85Hours = bodyText.includes('8.5 hrs') || bodyText.includes('8.5h') || bodyText.includes('8.50h');

        return {
          hasLedgerTab,
          hasSessionsTab,
          hasVerifyTab,
          hasQueueTab,
          hasApplyBtn,
          hasHistoryHeader,
          headers,
          hasWorkDateCol,
          hasReasonCol,
          hasStatusCol,
          hasDurationCol,
          hasCreditCol,
          rowCount: rows.length,
          hasPendingRow,
          hasCompletedRow,
          has85Hours
        };
      })()
    `);

    assert(!empUiCheck.hasLedgerTab, 'Credit Ledger & Audit tab is hidden from Employee');
    assert(!empUiCheck.hasSessionsTab, 'Off-Day Sessions tab is hidden from Employee');
    assert(!empUiCheck.hasVerifyTab, 'Verify & Credit tab is hidden from Employee');
    assert(!empUiCheck.hasQueueTab, 'Admin Queue tab is hidden from Employee');

    assert(empUiCheck.hasApplyBtn, 'Apply for Comp-Off button is clearly displayed');
    assert(empUiCheck.hasHistoryHeader, 'Comp-Off History section is displayed');
    assert(empUiCheck.hasWorkDateCol, 'Work Date column is present in history table');
    assert(empUiCheck.hasReasonCol, 'Request Reason column is present in history table');
    assert(empUiCheck.hasStatusCol, 'Approval Status column is present in history table');
    assert(empUiCheck.hasDurationCol, 'Actual Work Duration column is present in history table');
    assert(empUiCheck.hasCreditCol, 'Credit Status column is present in history table');

    assert(empUiCheck.hasPendingRow, 'Pending Comp-Off request is rendered with full details');
    assert(empUiCheck.hasCompletedRow, 'Approved Comp-Off request is rendered with duration & credit');
    assert(empUiCheck.has85Hours, 'Actual work duration (8.5h) is accurately displayed');

    // Capture Employee Desktop Screenshot
    const empDesktopScreenshot = await sendCdp(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, 'employee_compoff_simplified_desktop.png'), Buffer.from(empDesktopScreenshot.data, 'base64'));
    console.log('  ✓ Employee desktop screenshot captured: employee_compoff_simplified_desktop.png');

    // Audit Mobile Viewport (375x812)
    console.log('\n--- Checking Mobile Viewport for Employee (375x812) ---');
    await sendCdp(ws, 'Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true
    });
    await sleep(1000);

    const empMobileScreenshot = await sendCdp(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, 'employee_compoff_simplified_mobile.png'), Buffer.from(empMobileScreenshot.data, 'base64'));
    console.log('  ✓ Employee mobile screenshot captured: employee_compoff_simplified_mobile.png');

    // Switch back to desktop for modal testing
    await sendCdp(ws, 'Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await sleep(500);

    // Test clicking "Apply for Comp-Off" button
    console.log('\n--- Testing Apply for Comp-Off Modal Integration ---');
    const openApplyClicked = await evaluate(ws, `
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b => b.textContent && b.textContent.includes('Apply for Comp-Off'));
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()
    `);
    assert(openApplyClicked, 'Apply for Comp-Off button clicked, modal opens');
    await sleep(2000);

    // Verify modal has CompOffCalendarPicker
    const modalCheck = await evaluate(ws, `
      (() => {
        const modal = document.querySelector('.fixed.inset-0');
        if (!modal) return { hasModal: false };
        const gridCols = Array.from(modal.querySelectorAll('div')).filter(d => d.className && d.className.includes('grid-cols-7'));
        const reasonInput = modal.querySelector('textarea');
        const submitBtn = modal.querySelector('button[type="submit"]');

        return {
          hasModal: true,
          hasGrid: gridCols.length >= 2,
          hasReasonInput: Boolean(reasonInput),
          submitDisabled: submitBtn ? submitBtn.disabled : true
        };
      })()
    `);

    assert(modalCheck.hasModal, 'Advance Permission modal opened successfully');
    assert(modalCheck.hasGrid, 'CompOffCalendarPicker monthly grid is rendered inside modal');
    assert(modalCheck.hasReasonInput, 'Business justification reason textarea is rendered');
    assert(modalCheck.submitDisabled, 'Submit button is disabled initially before date selection');

    // Close modal
    await evaluate(ws, `
      (() => {
        const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Cancel');
        if (cancelBtn) cancelBtn.click();
      })()
    `);
    await sleep(1000);

    // =========================================================================
    // PART 2: ADMIN VIEW AUDIT (RETAINING MANAGEMENT TABS)
    // =========================================================================
    console.log('\n=============================================================');
    console.log('  TEST GROUP 2: ADMIN MANAGEMENT & AUDIT VIEW RETENTION');
    console.log('=============================================================\n');

    await evaluate(ws, `
      localStorage.setItem('token', ${JSON.stringify(adminToken)});
      localStorage.setItem('user', ${JSON.stringify(JSON.stringify({ ...admin, welcomePopupSeen: true }))});
      localStorage.setItem('company_welcome_dismissed_' + ${JSON.stringify(admin.id)}, 'true');
    `);

    console.log('Navigating to http://localhost:5173/leaves as ADMIN...');
    await sendCdp(ws, 'Page.navigate', { url: 'http://localhost:5173/leaves' });
    await sleep(3000);

    // Click Comp-Off Tab as Admin
    await evaluate(ws, `
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b => b.textContent && b.textContent.includes('Comp-Off'));
        if (btn) btn.click();
      })()
    `);
    await sleep(2000);

    const adminUiCheck = await evaluate(ws, `
      (() => {
        const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
        const bodyText = document.body.innerText;

        const hasLedgerTab = buttons.some(b => b.includes('Credit Ledger & Audit'));
        const hasAdvanceTab = buttons.some(b => b.includes('Advance Permissions'));
        const hasSessionsTab = buttons.some(b => b.includes('Off-Day Sessions'));
        const hasKpiCards = bodyText.includes('Total Authorized') || bodyText.toLowerCase().includes('total authorized');

        return {
          hasLedgerTab,
          hasAdvanceTab,
          hasSessionsTab,
          hasKpiCards,
          bodySnippet: bodyText.slice(0, 800)
        };
      })()
    `);
    console.log('Admin Page Snippet:\n', adminUiCheck.bodySnippet);

    assert(adminUiCheck.hasLedgerTab, 'Admin retains "Credit Ledger & Audit" tab');
    assert(adminUiCheck.hasAdvanceTab, 'Admin retains "Advance Permissions" tab');
    assert(adminUiCheck.hasSessionsTab, 'Admin retains "Off-Day Sessions" tab');
    assert(adminUiCheck.hasKpiCards, 'Admin retains KPI overview cards');

    // Capture Admin View Screenshot
    const adminDesktopScreenshot = await sendCdp(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, 'admin_compoff_management_desktop.png'), Buffer.from(adminDesktopScreenshot.data, 'base64'));
    console.log('  ✓ Admin management desktop screenshot captured: admin_compoff_management_desktop.png');

    console.log('\n========================================================================');
    console.log('  ALL SIMPLIFIED EMPLOYEE COMP-OFF UI AUDIT CHECKS PASSED (100%)');
    console.log('========================================================================\n');

  } finally {
    if (chromeProc) {
      chromeProc.kill('SIGKILL');
    }
    try {
      fs.rmSync(TEMP_PROFILE, { recursive: true, force: true });
    } catch (e) {}
    try {
      if (credit2?.id) await prisma.compOffCredit.delete({ where: { id: credit2.id } });
      if (session2?.id) await prisma.compOffSession.delete({ where: { id: session2.id } });
      if (perm2?.id) await prisma.compOffPermissionRequest.delete({ where: { id: perm2.id } });
      if (perm1?.id) await prisma.compOffPermissionRequest.delete({ where: { id: perm1.id } });
    } catch (e) {}
    await prisma.$disconnect();
  }
}

runSimplifiedUIAudit().catch((err) => {
  console.error('\nSimplified UI Audit Error:', err);
  if (chromeProc) chromeProc.kill('SIGKILL');
  process.exit(1);
});
