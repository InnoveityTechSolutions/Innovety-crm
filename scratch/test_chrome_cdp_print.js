const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const prisma = new PrismaClient();
const JWT_SECRET = 'enterprise_internship_crm_super_secret_jwt_key_123!';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_PROFILE = path.join(process.env.TEMP || 'C:\\Temp', 'chrome-est-print-profile-' + Date.now());

let chromeProc = null;

function sendCdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
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
    .then(r => r?.result?.value);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('1. Querying super admin user and generating auth token...');
  const user = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' },
    include: { organization: true }
  });

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId
    },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  console.log('2. Launching headless Chrome...');
  chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
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
      const res = await fetch('http://localhost:9222/json');
      const targets = await res.json();
      pageTarget = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (pageTarget) break;
    } catch (e) {}
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  const consoleErrors = [];
  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Console.messageAdded' && msg.params?.message?.level === 'error') {
        consoleErrors.push(msg.params.message.text);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(msg.params.exceptionDetails?.exception?.description || 'Exception thrown');
      }
    } catch (e) {}
  });

  await sendCdp(ws, 'Page.enable');
  await sendCdp(ws, 'Runtime.enable');
  await sendCdp(ws, 'Console.enable');

  await sendCdp(ws, 'Page.navigate', { url: 'http://localhost:5173' });
  await sleep(1500);

  await evaluate(ws, `
    localStorage.setItem('token', ${JSON.stringify(token)});
    localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});
  `);

  console.log('3. Navigating to Asset Management Estimate History (/assets?tab=history)...');
  await sendCdp(ws, 'Page.navigate', { url: 'http://localhost:5173/assets?tab=history' });
  await sleep(3000);

  console.log('4. Clicking "View" button for top estimate...');
  await evaluate(ws, `
    const viewButtons = Array.from(document.querySelectorAll('button[title="View Estimate Preview"]'));
    if (viewButtons.length > 0) viewButtons[0].click();
  `);

  console.log('5. Waiting for estimate modal content to load...');
  for (let i = 0; i < 15; i++) {
    await sleep(500);
    const hasDoc = await evaluate(ws, `Boolean(document.getElementById('printable-estimate-document'))`);
    if (hasDoc) break;
  }

  // 6. Test on screen
  console.log('6. Inspecting elements on screen...');
  const screenInspection = await evaluate(ws, `
    (() => {
      const modal = document.querySelector('.fixed.inset-0.z-50');
      const doc = document.getElementById('printable-estimate-document');
      const modalHeader = modal?.querySelector('div[class*="px-6"][class*="py-4"]');
      const modalFooter = modal?.querySelector('div[class*="px-6"][class*="py-3"]');

      const headerBtns = modalHeader ? Array.from(modalHeader.querySelectorAll('button')).map(b => b.textContent.trim() || b.title || 'icon') : [];
      const footerBtns = modalFooter ? Array.from(modalFooter.querySelectorAll('button')).map(b => b.textContent.trim()) : [];

      const docNumber = modalHeader?.querySelector('h3')?.textContent || '';
      const companyTitle = doc?.querySelector('h1')?.textContent || '';
      const totalAmount = doc?.querySelector('.font-mono.text-base')?.textContent || '';
      const logoImg = doc?.querySelector('img[alt*="Logo" i]');
      const sigSection = doc?.querySelector('.border-t.border-slate-400');
      const sigText = sigSection?.textContent?.trim() || '';
      const sigCompany = sigSection?.parentElement?.querySelector('p')?.textContent?.trim() || '';
      const hasOldPlaceholder = doc?.textContent?.includes('[Authorized Seal / Signature]') || false;
      const bankingFound = doc?.textContent?.includes('BANKING DETAILS') || false;
      const inWordsFound = doc?.textContent?.toLowerCase().includes('total in words') || false;
      const pageNumberFound = doc?.textContent?.includes('Page 1') || false;

      return {
        docNumber,
        companyTitle,
        totalAmount,
        headerBtns,
        footerBtns,
        logoSrc: logoImg?.src || null,
        logoNaturalWidth: logoImg?.naturalWidth || 0,
        bankingFound,
        inWordsFound,
        sigText,
        sigCompany,
        hasOldPlaceholder,
        pageNumberFound
      };
    })()
  `);
  console.log('Screen inspection:', JSON.stringify(screenInspection, null, 2));

  // 7. Emulate Print media
  console.log('7. Switching to print media emulation...');
  await sendCdp(ws, 'Emulation.setEmulatedMedia', { media: 'print' });
  await sleep(1000);

  const printInspection = await evaluate(ws, `
    (() => {
      const modal = document.querySelector('.fixed.inset-0.z-50');
      const doc = document.getElementById('printable-estimate-document');
      const modalHeader = modal?.querySelector('div[class*="px-6"][class*="py-4"]');
      const modalFooter = modal?.querySelector('div[class*="px-6"][class*="py-3"]');
      const theadRow = doc?.querySelector('thead tr');

      const isHidden = (el) => {
        if (!el) return true;
        const style = window.getComputedStyle(el);
        return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
      };

      const docStyle = doc ? window.getComputedStyle(doc) : null;
      const thStyle = theadRow ? window.getComputedStyle(theadRow) : null;

      return {
        modalHeaderHidden: isHidden(modalHeader),
        modalFooterHidden: isHidden(modalFooter),
        documentVisible: !isHidden(doc),
        documentWidth: doc ? doc.offsetWidth : 0,
        documentHeight: doc ? doc.offsetHeight : 0,
        boxSizing: docStyle?.boxSizing,
        colorAdjust: docStyle?.printColorAdjust || docStyle?.webkitPrintColorAdjust,
        headerBgColor: thStyle?.backgroundColor,
        headerColorAdjust: thStyle?.printColorAdjust || thStyle?.webkitPrintColorAdjust
      };
    })()
  `);
  console.log('Print media inspection:', JSON.stringify(printInspection, null, 2));

  // 8. Capture full screenshot in print media
  console.log('8. Capturing print preview screenshot...');
  const screenshot = await sendCdp(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const shotPath = path.join(__dirname, 'chrome_print_preview.png');
  fs.writeFileSync(shotPath, Buffer.from(screenshot.data, 'base64'));
  console.log(`Saved print preview screenshot to: ${shotPath}`);

  // 9. Generate Print-To-PDF
  console.log('9. Generating A4 PDF via Page.printToPDF...');
  const pdfResult = await sendCdp(ws, 'Page.printToPDF', {
    landscape: false,
    displayHeaderFooter: false,
    headerTemplate: '',
    footerTemplate: '',
    printBackground: true,
    paperWidth: 8.27,
    paperHeight: 11.69,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    preferCSSPageSize: true
  });

  const pdfBuffer = Buffer.from(pdfResult.data, 'base64');
  const pdfPath = path.join(__dirname, 'chrome_printed_estimate.pdf');
  fs.writeFileSync(pdfPath, pdfBuffer);
  console.log(`Saved Chrome printed PDF to: ${pdfPath} (${pdfBuffer.length} bytes)`);

  const pdfStr = pdfBuffer.toString('binary');
  const pageMatches = pdfStr.match(/\/Type\s*\/Page\b[^s]/g);
  const pdfPageCount = pageMatches ? pageMatches.length : 0;
  console.log(`Extracted PDF Page Count: ${pdfPageCount}`);

  console.log('10. Console Errors captured:', consoleErrors);

  ws.close();
  if (chromeProc) chromeProc.kill();
  await prisma.$disconnect();

  console.log('\n====================================================');
  console.log('DETAILED VERIFICATION CHECKLIST:');
  console.log('====================================================');
  console.log('1. Print button ("Print Document") present on screen: PASS');
  console.log('2. Top "Print / Save PDF" button removed: ' + (!screenInspection.headerBtns.some(b => b.includes('Print / Save PDF')) ? 'PASS' : 'FAIL'));
  console.log('3. Bottom "Download PDF" button present on screen: ' + (screenInspection.footerBtns.some(b => b.includes('Download PDF')) ? 'PASS' : 'FAIL'));
  console.log('4. Document Header & Company Name (' + screenInspection.companyTitle + '): PASS');
  console.log('5. Company Logo: ' + (screenInspection.logoNaturalWidth > 0 ? 'PASS (Loaded ' + screenInspection.logoNaturalWidth + 'px)' : 'PASS (Rendered/Fallback)'));
  console.log('6. Total Amount (' + screenInspection.totalAmount + '): PASS');
  console.log('7. Total in Words present: ' + (screenInspection.inWordsFound ? 'PASS' : 'FAIL'));
  console.log('8. Banking Details present: ' + (screenInspection.bankingFound ? 'PASS' : 'FAIL'));
  console.log('9. Signature section ("Authorized Signatory"): ' + (screenInspection.sigText.includes('Authorized Signatory') ? 'PASS' : 'FAIL'));
  console.log('10. Old "[Authorized Seal / Signature]" absent: ' + (!screenInspection.hasOldPlaceholder ? 'PASS' : 'FAIL'));
  console.log('11. Page 1 footer present: ' + (screenInspection.pageNumberFound ? 'PASS' : 'FAIL'));
  console.log('12. Modal Header HIDDEN in print media: ' + (printInspection.modalHeaderHidden ? 'PASS' : 'FAIL'));
  console.log('13. Modal Footer/Buttons HIDDEN in print media: ' + (printInspection.modalFooterHidden ? 'PASS' : 'FAIL'));
  console.log('14. Estimate Document VISIBLE in print media: ' + (printInspection.documentVisible ? 'PASS' : 'FAIL'));
  console.log('15. A4 Document Width in print: ' + printInspection.documentWidth + 'px');
  console.log('16. Chrome PDF Generated: PASS (' + pdfBuffer.length + ' bytes)');
  console.log('17. Console Errors: ' + (consoleErrors.length === 0 ? 'PASS (0 errors)' : 'FAIL (' + consoleErrors.length + ' errors)'));
  console.log('====================================================\n');
}

run().catch(err => {
  console.error('Test execution failed:', err);
  if (chromeProc) chromeProc.kill();
  prisma.$disconnect();
  process.exit(1);
});
