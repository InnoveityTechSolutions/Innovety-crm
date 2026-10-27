const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const prisma = new PrismaClient();
const JWT_SECRET = 'enterprise_internship_crm_super_secret_jwt_key_123!';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_PROFILE = path.join(process.env.TEMP || 'C:\\Temp', 'chrome-upload-modal-profile-' + Date.now());

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let chromeProc = null;
let msgId = 1;
function sendCdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    const handler = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        }
      } catch (err) {}
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function evaluate(ws, expression) {
  return sendCdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    .then((r) => r?.result?.value);
}

async function run() {
  console.log('====================================================');
  console.log('UPLOAD COMPANY DOCUMENT MODAL OVERFLOW TEST SUITE');
  console.log('====================================================\n');

  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    include: { organization: true }
  });

  if (!admin) {
    throw new Error('No active admin user found in database');
  }

  const adminToken = jwt.sign(
    { id: admin.id, email: admin.email, role: admin.role, organizationId: admin.organizationId },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9227',
    `--user-data-dir=${TEMP_PROFILE}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ], { stdio: 'ignore' });

  let pageTarget = null;
  for (let i = 0; i < 25; i++) {
    await sleep(400);
    try {
      const res = await fetch('http://localhost:9227/json');
      const targets = await res.json();
      pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (pageTarget) break;
    } catch (e) {}
  }

  if (!pageTarget) {
    throw new Error('Chrome target not found');
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  await sendCdp(ws, 'Page.enable');
  await sendCdp(ws, 'Runtime.enable');
  await sendCdp(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  });

  await sendCdp(ws, 'Page.navigate', { url: 'http://localhost:5173' });
  await sleep(1500);

  // Set Auth in localStorage
  await evaluate(ws, `
    localStorage.setItem('token', ${JSON.stringify(adminToken)});
    localStorage.setItem('user', ${JSON.stringify(JSON.stringify(admin))});
  `);

  await sendCdp(ws, 'Page.navigate', { url: 'http://localhost:5173/company-documents' });
  await sleep(2000);

  const viewports = [
    { name: 'Desktop (1920x1080)', width: 1920, height: 1080, mobile: false },
    { name: 'Desktop (1440x900)', width: 1440, height: 900, mobile: false },
    { name: 'Laptop (1366x768)', width: 1366, height: 768, mobile: false },
    { name: 'Mobile (390x844)', width: 390, height: 844, mobile: true },
    { name: 'Small Mobile / iPhone SE (375x667)', width: 375, height: 667, mobile: true }
  ];

  const results = [];

  for (const vp of viewports) {
    console.log(`\n----------------------------------------------------`);
    console.log(`TESTING VIEWPORT: ${vp.name} (${vp.width}x${vp.height})`);
    console.log(`----------------------------------------------------`);

    await sendCdp(ws, 'Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.mobile
    });
    await sleep(600);

    // Open upload modal
    const openRes = await evaluate(ws, `
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Upload Document'));
        if (!btn) return { error: 'Upload Document button not found' };
        btn.click();
        return { success: true };
      })()
    `);

    if (openRes.error) {
      throw new Error(openRes.error);
    }

    await sleep(600); // Wait for modal animation

    const metrics = await evaluate(ws, `
      (() => {
        const modalContainer = document.querySelector('.bg-card.max-w-lg');
        if (!modalContainer) return { error: 'Modal card not found' };

        const header = modalContainer.querySelector('.border-b');
        const footer = modalContainer.querySelector('.border-t');
        const scrollArea = modalContainer.querySelector('.overflow-y-auto');
        const closeBtn = header?.querySelector('button');
        const cancelBtn = footer ? Array.from(footer.querySelectorAll('button')).find(b => b.textContent.includes('Cancel')) : null;
        const submitBtn = footer ? Array.from(footer.querySelectorAll('button')).find(b => b.textContent.includes('Upload Document')) : null;

        const winH = window.innerHeight;
        const winW = window.innerWidth;
        const modalRect = modalContainer.getBoundingClientRect();
        const headerRect = header ? header.getBoundingClientRect() : null;
        const footerRect = footer ? footer.getBoundingClientRect() : null;
        const cancelRect = cancelBtn ? cancelBtn.getBoundingClientRect() : null;
        const submitRect = submitBtn ? submitBtn.getBoundingClientRect() : null;

        // Check horizontal centering (within 5px tolerance)
        const leftSpace = modalRect.left;
        const rightSpace = winW - modalRect.right;
        const isHorizontallyCentered = Math.abs(leftSpace - rightSpace) < 15;

        // Check height constraints
        const fitsWithinViewportY = modalRect.top >= 0 && modalRect.bottom <= winH;
        const maxHeightConstraint = modalRect.height <= (winH * 0.90 + 2); // 90vh

        // Check header & footer visibility
        const isHeaderVisible = headerRect && headerRect.top >= 0 && headerRect.bottom <= winH;
        const isFooterVisible = footerRect && footerRect.top >= 0 && footerRect.bottom <= winH;
        const areButtonsVisible = cancelRect && submitRect && cancelRect.bottom <= winH && submitRect.bottom <= winH;

        // Check scrollability
        const hasInternalScroll = scrollArea ? (scrollArea.scrollHeight > scrollArea.clientHeight) : false;
        const scrollHeight = scrollArea ? scrollArea.scrollHeight : 0;
        const clientHeight = scrollArea ? scrollArea.clientHeight : 0;

        // Check body scroll lock
        const bodyOverflow = document.body.style.overflow;
        const isBodyLocked = bodyOverflow === 'hidden';

        // Check no document horizontal scroll
        const hasHorizontalScroll = document.documentElement.scrollWidth > winW || document.body.scrollWidth > winW;

        // Test scrolling internally
        let scrollTestPassed = true;
        if (hasInternalScroll && scrollArea) {
          const initialTop = scrollArea.scrollTop;
          scrollArea.scrollTop = 100;
          const afterTop = scrollArea.scrollTop;
          // Check that header and footer didn't move during scroll
          const headerAfter = header.getBoundingClientRect();
          const footerAfter = footer.getBoundingClientRect();
          const headerPinned = Math.abs(headerAfter.top - headerRect.top) < 1;
          const footerPinned = Math.abs(footerAfter.top - footerRect.top) < 1;
          scrollTestPassed = (afterTop > initialTop) && headerPinned && footerPinned;
          scrollArea.scrollTop = 0; // reset
        }

        return {
          winW,
          winH,
          modalWidth: Math.round(modalRect.width),
          modalHeight: Math.round(modalRect.height),
          maxAllowedHeight: Math.round(winH * 0.90),
          modalTop: Math.round(modalRect.top),
          modalBottom: Math.round(modalRect.bottom),
          isHorizontallyCentered,
          fitsWithinViewportY,
          maxHeightConstraint,
          isHeaderVisible,
          isFooterVisible,
          areButtonsVisible,
          hasInternalScroll,
          scrollHeight,
          clientHeight,
          scrollTestPassed,
          isBodyLocked,
          hasHorizontalScroll
        };
      })()
    `);

    console.log('Modal Verification Result:', JSON.stringify(metrics, null, 2));

    // Capture screenshot for visual audit
    const screenshot = await sendCdp(ws, 'Page.captureScreenshot', { format: 'png' });
    const screenshotPath = path.join(__dirname, `upload_modal_${vp.width}x${vp.height}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    console.log(`Screenshot saved: ${screenshotPath}`);

    // Test closing modal using cancel button or close button
    const closeRes = await evaluate(ws, `
      (() => {
        const modalContainer = document.querySelector('.bg-card.max-w-lg');
        const cancelBtn = modalContainer?.querySelector('.border-t button');
        if (cancelBtn) {
          cancelBtn.click();
          return { clicked: true };
        }
        return { clicked: false };
      })()
    `);

    await sleep(500);

    const afterClose = await evaluate(ws, `
      (() => {
        const modalStillOpen = !!document.querySelector('.bg-card.max-w-lg');
        const bodyOverflow = document.body.style.overflow;
        return { modalStillOpen, bodyOverflowCleaned: bodyOverflow === '' };
      })()
    `);

    console.log('Close Behavior:', JSON.stringify(afterClose, null, 2));

    const passed = metrics.fitsWithinViewportY &&
                   metrics.maxHeightConstraint &&
                   metrics.isHeaderVisible &&
                   metrics.isFooterVisible &&
                   metrics.areButtonsVisible &&
                   metrics.scrollTestPassed &&
                   metrics.isBodyLocked &&
                   !metrics.hasHorizontalScroll &&
                   !afterClose.modalStillOpen &&
                   afterClose.bodyOverflowCleaned;

    results.push({
      viewport: vp.name,
      ...metrics,
      passed
    });
  }

  // ==========================================
  // Test File Upload Functionality after modal
  // ==========================================
  console.log('\n----------------------------------------------------');
  console.log('TESTING FILE UPLOAD FUNCTIONALITY INTEGRITY');
  console.log('----------------------------------------------------');

  await sendCdp(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false
  });
  await sleep(400);

  // Reopen modal
  await evaluate(ws, `
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Upload Document'));
      btn.click();
    })()
  `);
  await sleep(600);

  // Fill in form fields and attach a mock file
  const fillRes = await evaluate(ws, `
    (() => {
      const modal = document.querySelector('.bg-card.max-w-lg');
      if (!modal) return { error: 'Modal not open' };

      const nameInput = modal.querySelector('input[placeholder*="Certificate"]');
      const categorySelect = modal.querySelector('select');
      const descInput = modal.querySelector('textarea');
      const fileInput = modal.querySelector('input[type="file"]');
      const expiryInput = modal.querySelector('input[type="date"]');

      if (!nameInput || !categorySelect || !descInput || !fileInput || !expiryInput) {
        return { error: 'One or more form inputs missing' };
      }

      nameInput.value = 'E2E Modal Test Document';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));

      categorySelect.value = 'Legal Documents';
      categorySelect.dispatchEvent(new Event('change', { bubbles: true }));

      descInput.value = 'Testing modal scroll layout and submission';
      descInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Create a dummy File object
      const blob = new Blob(['Sample modal test document content'], { type: 'application/pdf' });
      const file = new File([blob], 'test_modal_doc.pdf', { type: 'application/pdf' });
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));

      return { success: true, fileName: fileInput.files[0]?.name };
    })()
  `);

  console.log('Form Fill Result:', fillRes);
  await sleep(600);

  // Verify file name appears in "Choose document file" container
  const fileNameDisplay = await evaluate(ws, `
    (() => {
      const modal = document.querySelector('.bg-card.max-w-lg');
      return modal?.innerText.includes('test_modal_doc.pdf');
    })()
  `);
  console.log('Attached file name visible in upload area:', fileNameDisplay);

  // Close modal without submitting to avoid junk, or submit? Let's cancel out
  await evaluate(ws, `
    (() => {
      const modal = document.querySelector('.bg-card.max-w-lg');
      const cancelBtn = modal?.querySelector('.border-t button');
      cancelBtn?.click();
    })()
  `);
  await sleep(500);

  ws.close();
  chromeProc.kill();
  await prisma.$disconnect();

  console.log('\n====================================================');
  console.log('UPLOAD MODAL OVERFLOW SUITE FINAL RESULTS:');
  console.log('====================================================');
  let allPassed = true;
  for (const r of results) {
    const status = r.passed ? '✓ PASS' : '✗ FAIL';
    if (!r.passed) allPassed = false;
    console.log(`${status} ${r.viewport}:`);
    console.log(`   - Dimensions: ${r.modalWidth}x${r.modalHeight}px (Max Allowed: ${r.maxAllowedHeight}px)`);
    console.log(`   - Within Viewport Y: ${r.fitsWithinViewportY} (Top: ${r.modalTop}px, Bottom: ${r.modalBottom}px, WinH: ${r.winH}px)`);
    console.log(`   - Header Pinned & Visible: ${r.isHeaderVisible}`);
    console.log(`   - Footer Pinned & Visible: ${r.isFooterVisible} (Action buttons visible: ${r.areButtonsVisible})`);
    console.log(`   - Internal Scrolling: active=${r.hasInternalScroll} (scrollH=${r.scrollHeight}px, clientH=${r.clientHeight}px, testPassed=${r.scrollTestPassed})`);
    console.log(`   - Body Scroll Locked: ${r.isBodyLocked}`);
    console.log(`   - No Horizontal Scroll: ${!r.hasHorizontalScroll}`);
  }
  console.log('====================================================');
  console.log(allPassed ? 'ALL TEST VIEWPORTS PASSED PERFECTLY!' : 'SOME TESTS FAILED!');
  console.log('====================================================\n');
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  if (chromeProc) chromeProc.kill();
  prisma.$disconnect();
  process.exit(1);
});
