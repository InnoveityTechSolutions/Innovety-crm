const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../backend/node_modules/ws');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const prisma = new PrismaClient();
const JWT_SECRET = 'enterprise_internship_crm_super_secret_jwt_key_123!';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_PROFILE = path.join(process.env.TEMP || 'C:\\Temp', 'chrome-calendar-profile-' + Date.now());

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

async function runCalendarPickerUITest() {
  console.log('\n========================================================================');
  console.log('  InnovEity CRM — Comp-Off Mini Calendar Picker E2E & UI Audit');
  console.log('========================================================================\n');

  // 1. Locate Employee user
  const employee = await prisma.user.findFirst({
    where: { role: 'EMPLOYEE' },
    include: { organization: true }
  });

  if (!employee) throw new Error('No employee found in database.');

  console.log(`Testing with Employee: ${employee.name} (${employee.email}) - Org: ${employee.organization.name}`);

  const token = jwt.sign(
    {
      id: employee.id,
      email: employee.email,
      role: employee.role,
      organizationId: employee.organizationId
    },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  const debugPort = 9248;
  console.log(`Launching Chrome headless with debug port ${debugPort}...`);
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

    if (!pageTarget) throw new Error('Could not find page target in Chrome.');

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise(res => ws.on('open', res));

    await sendCdp(ws, 'Page.enable');
    await sendCdp(ws, 'Runtime.enable');
    await sendCdp(ws, 'DOM.enable');

    console.log('Navigating to http://localhost:5173...');
    await sendCdp(ws, 'Page.navigate', { url: 'http://localhost:5173' });
    await sleep(2000);

    // Inject Employee Auth Token in localStorage
    await evaluate(ws, `
      localStorage.setItem('token', ${JSON.stringify(token)});
      localStorage.setItem('user', ${JSON.stringify(JSON.stringify({ ...employee, welcomePopupSeen: true }))});
      localStorage.setItem('company_welcome_dismissed_' + ${JSON.stringify(employee.id)}, 'true');
    `);

    // Navigate to /leaves
    console.log('Navigating to http://localhost:5173/leaves...');
    await sendCdp(ws, 'Page.navigate', { url: 'http://localhost:5173/leaves' });
    await sleep(3000);

    // Set Desktop viewport (1440x900)
    await sendCdp(ws, 'Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await sleep(1000);

    // Switch to Comp-Off tab
    const tabClicked = await evaluate(ws, `
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b => b.textContent && b.textContent.includes('Comp-Off Ledger'));
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()
    `);
    assert(tabClicked, 'Comp-Off Ledger & Claims tab clicked');
    await sleep(2000);

    // Switch to Tab 2: "Advance Permissions"
    const advTabClicked = await evaluate(ws, `
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b => b.textContent && b.textContent.includes('Advance Permissions'));
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()
    `);
    assert(advTabClicked, 'Advance Permissions tab clicked');
    await sleep(2000);

    // Click "Request Advance Permission" button to open modal
    const openModalClicked = await evaluate(ws, `
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b => b.textContent && b.textContent.includes('Request Advance Permission'));
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()
    `);
    assert(openModalClicked, 'Request Advance Permission button clicked, opening modal');
    await sleep(2000);

    // -------------------------------------------------------------
    // Audit Item 1: Verify Modal & Calendar Picker Elements
    // -------------------------------------------------------------
    console.log('\n--- Checking Calendar Picker DOM Elements ---');
    const calendarCheck = await evaluate(ws, `
      (() => {
        try {
          const modal = document.querySelector('.fixed.inset-0');
          if (!modal) return { hasModal: false };

          const gridCols = Array.from(modal.querySelectorAll('div')).filter(d => d.className && d.className.includes('grid-cols-7'));
          const weekdayHeaders = gridCols[0] ? Array.from(gridCols[0].children).map(c => c.textContent.trim()) : [];

          const buttons = Array.from(modal.querySelectorAll('button'));
          const prevBtn = buttons.find(b => b.getAttribute('title')?.includes('month') || b.getAttribute('title')?.includes('past'));
          const nextBtn = buttons.find(b => b.getAttribute('title')?.includes('Next') || b.getAttribute('title')?.includes('60-day'));

          const dateButtons = gridCols[1] ? Array.from(gridCols[1].querySelectorAll('button')) : [];
          const selectableCells = dateButtons.filter(b => !b.disabled).length;
          const disabledCells = dateButtons.filter(b => b.disabled).length;

          // Check if old <select> dropdown exists (must NOT exist)
          const selectDropdown = modal.querySelector('select');

          return {
            hasModal: true,
            weekdayHeaders,
            hasPrevBtn: Boolean(prevBtn),
            hasNextBtn: Boolean(nextBtn),
            prevDisabled: prevBtn?.disabled,
            selectableCells,
            disabledCells,
            hasOldSelectDropdown: Boolean(selectDropdown)
          };
        } catch (e) {
          return { hasModal: false, evalError: e.message };
        }
      })()
    `);

    assert(calendarCheck.hasModal, 'Advance Permission Modal is rendered');
    assert(!calendarCheck.hasOldSelectDropdown, 'Old <select> dropdown is removed and replaced');
    assert(
      JSON.stringify(calendarCheck.weekdayHeaders) === JSON.stringify(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']),
      `7-column weekday headers Sun-Sat rendered correctly: ${calendarCheck.weekdayHeaders.join(', ')}`
    );
    assert(calendarCheck.hasPrevBtn && calendarCheck.hasNextBtn, 'Month navigation buttons are present');
    assert(calendarCheck.prevDisabled === true, 'Previous month button is cleanly disabled at current month boundary');
    assert(calendarCheck.selectableCells > 0, `Eligible off-days are highlighted and selectable (${calendarCheck.selectableCells} found)`);
    assert(calendarCheck.disabledCells > 0, `Regular working days / past dates are properly disabled (${calendarCheck.disabledCells} found)`);

    // Capture Desktop Screenshot
    const desktopScreenshot = await sendCdp(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, 'calendar_picker_desktop_1440.png'), Buffer.from(desktopScreenshot.data, 'base64'));
    console.log('  ✓ Desktop screenshot captured: calendar_picker_desktop_1440.png');

    // -------------------------------------------------------------
    // Audit Item 2: Test Date Selection & Confirmation Banner
    // -------------------------------------------------------------
    console.log('\n--- Testing Date Selection & Confirmation Banner ---');
    const selectDateResult = await evaluate(ws, `
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const dateBtn = buttons.find(b => b.title && (b.title.includes('Weekly Off') || b.title.includes('Holiday')) && !b.disabled);
        if (dateBtn) {
          dateBtn.click();
          return { selected: true, title: dateBtn.title };
        }
        return { selected: false };
      })()
    `);
    assert(selectDateResult.selected, `First selectable eligible date clicked (${selectDateResult.title})`);
    await sleep(500);

    const bannerCheck = await evaluate(ws, `
      (() => {
        const divs = Array.from(document.querySelectorAll('div'));
        const banner = divs.find(d => d.textContent && d.textContent.includes('Selected') && d.className && d.className.includes('bg-primary/10'));
        const submitBtn = document.querySelector('button[type="submit"]');

        return {
          hasBanner: Boolean(banner),
          submitDisabled: submitBtn?.disabled
        };
      })()
    `);

    assert(bannerCheck.hasBanner, 'Selected Date Confirmation Banner displayed prominently');
    assert(!bannerCheck.submitDisabled, 'Submit Request button is enabled once eligible date is chosen');

    // -------------------------------------------------------------
    // Audit Item 3: Mobile Viewport Responsiveness (375x812)
    // -------------------------------------------------------------
    console.log('\n--- Testing Mobile Viewport (375 x 812) ---');
    await sendCdp(ws, 'Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true
    });
    await sleep(1000);

    const mobileCheck = await evaluate(ws, `
      (() => {
        const modal = document.querySelector('.fixed.inset-0 > div');
        if (!modal) return { ok: false };
        const rect = modal.getBoundingClientRect();
        const fitsInViewport = rect.width <= 375;
        const hasScroll = modal.scrollHeight > modal.clientHeight;

        return {
          ok: true,
          modalWidth: rect.width,
          fitsInViewport,
          hasScroll
        };
      })()
    `);

    assert(mobileCheck.fitsInViewport, `Modal fits smoothly within 375px mobile viewport (width: ${mobileCheck.modalWidth}px)`);

    // Capture Mobile Screenshot
    const mobileScreenshot = await sendCdp(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, 'calendar_picker_mobile_375.png'), Buffer.from(mobileScreenshot.data, 'base64'));
    console.log('  ✓ Mobile screenshot captured: calendar_picker_mobile_375.png');

    // -------------------------------------------------------------
    // Audit Item 4: 60-Day Window Navigation Limits
    // -------------------------------------------------------------
    console.log('\n--- Testing 60-Day Advance Booking Navigation Boundary ---');
    let clicks = 0;
    let isNowDisabled = false;
    let boundaryTooltip = '';

    for (let c = 0; c < 5; c++) {
      const clickRes = await evaluate(ws, `
        (() => {
          const nextBtn = document.querySelector('button[title*="Next month"], button[title*="Reached 60-day"]');
          if (nextBtn && !nextBtn.disabled) {
            nextBtn.click();
            return { clicked: true };
          }
          return {
            clicked: false,
            isNowDisabled: nextBtn ? nextBtn.disabled : false,
            tooltip: nextBtn ? nextBtn.getAttribute('title') : ''
          };
        })()
      `);
      if (clickRes?.clicked) {
        clicks++;
        await sleep(600);
      } else {
        isNowDisabled = clickRes?.isNowDisabled;
        boundaryTooltip = clickRes?.tooltip;
        break;
      }
    }

    // Verify after loop whether it's disabled
    if (!isNowDisabled) {
      const finalCheck = await evaluate(ws, `
        (() => {
          const nextBtn = document.querySelector('button[title*="Next month"], button[title*="Reached 60-day"]');
          return { isNowDisabled: nextBtn ? nextBtn.disabled : false, tooltip: nextBtn ? nextBtn.getAttribute('title') : '' };
        })()
      `);
      isNowDisabled = finalCheck?.isNowDisabled;
      boundaryTooltip = finalCheck?.tooltip;
    }

    assert(isNowDisabled, `Next Month button is cleanly disabled at the 60-day limit (reached in ${clicks} clicks)`);
    console.log(`  ✓ Tooltip at boundary: "${boundaryTooltip}"`);

    console.log('\n========================================================================');
    console.log('  ALL MINI CALENDAR PICKER UI AUDIT CHECKS PASSED (100%)');
    console.log('========================================================================\n');

  } finally {
    if (chromeProc) {
      chromeProc.kill('SIGKILL');
    }
    try {
      fs.rmSync(TEMP_PROFILE, { recursive: true, force: true });
    } catch (e) {}
    await prisma.$disconnect();
  }
}

runCalendarPickerUITest().catch((err) => {
  console.error('\nCalendar Picker UI Test Error:', err);
  if (chromeProc) chromeProc.kill('SIGKILL');
  process.exit(1);
});
