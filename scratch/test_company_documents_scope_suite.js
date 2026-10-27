const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const prisma = new PrismaClient();
const JWT_SECRET = 'enterprise_internship_crm_super_secret_jwt_key_123!';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_PROFILE = path.join(process.env.TEMP || 'C:\\Temp', 'chrome-doc-scope-profile-' + Date.now());

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
  console.log('COMPANY DOCUMENTS COMPANY SWITCHING & ISOLATION SUITE');
  console.log('====================================================\n');

  // 1. Fetch test organizations
  const orgA = await prisma.organization.findFirst({ where: { slug: 'innoveity' } });
  const orgB = await prisma.organization.findFirst({ where: { slug: 'innoveity-globs-private-limited' } });

  if (!orgA || !orgB) {
    throw new Error('Test organizations not found in database');
  }

  console.log(`Company A: "${orgA.name}" (ID: ${orgA.id}, Code: ${orgA.companyCode})`);
  console.log(`Company B: "${orgB.name}" (ID: ${orgB.id}, Code: ${orgB.companyCode})`);

  // 2. Authenticate via login API
  const axios = require('../backend/node_modules/axios');
  const superAdminLoginRes = await axios.post('http://localhost:5000/api/auth/login', {
    userId: 'superadmin@enterprise-crm.com',
    password: 'Admin123!'
  });
  const superAdminToken = superAdminLoginRes.data.token;
  const superAdmin = superAdminLoginRes.data.user;

  const adminB = await prisma.user.findFirst({ where: { organizationId: orgB.id, role: 'ADMIN' } });
  const adminBToken = jwt.sign(
    { id: adminB.id, email: adminB.email, role: adminB.role, organizationId: adminB.organizationId },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  // 3. Launch Chrome Headless
  chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9235',
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
      const res = await fetch('http://localhost:9235/json');
      const targets = await res.json();
      pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (pageTarget) break;
    } catch (e) {}
  }

  if (!pageTarget) throw new Error('Chrome debugger target not found');

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

  // Navigate to app and authenticate as Super Admin
  await sendCdp(ws, 'Page.navigate', { url: 'http://localhost:5173' });
  await sleep(1500);

  // Explicitly set company A in localStorage initially
  await evaluate(ws, `
    localStorage.setItem('token', ${JSON.stringify(superAdminToken)});
    localStorage.setItem('user', ${JSON.stringify(JSON.stringify(superAdmin))});
    localStorage.setItem('mrf_selected_company_id', ${JSON.stringify(orgA.id)});
  `);

  await sendCdp(ws, 'Page.navigate', { url: 'http://localhost:5173/company-documents' });
  await sleep(2500);

  // =======================================================
  // TEST 1: Verify CompanyScopeSelector renders for Super Admin
  // =======================================================
  console.log('\n--- TEST 1: CompanyScopeSelector Visibility for Super Admin ---');
  const selectorInfo = await evaluate(ws, `
    (() => {
      const selector = document.querySelector('#global-company-scope-selector');
      const container = selector?.closest('div');
      const selectedVal = selector?.value;
      const options = selector ? Array.from(selector.options).map(o => ({ value: o.value, text: o.text })) : [];
      return {
        exists: !!selector,
        selectedValue: selectedVal,
        optionsCount: options.length,
        options
      };
    })()
  `);
  console.log('CompanyScopeSelector check:', selectorInfo);
  if (!selectorInfo.exists || selectorInfo.selectedValue !== orgA.id) {
    throw new Error(`Selector failed to initialize with Company A (${orgA.id})`);
  }
  console.log('✓ TEST 1 PASSED: CompanyScopeSelector is visible and selected on Company A.');

  // =======================================================
  // TEST 2: Switch to Company B via Dropdown
  // =======================================================
  console.log('\n--- TEST 2: Switch to Company B via Dropdown ---');
  await evaluate(ws, `
    (() => {
      const selector = document.querySelector('#global-company-scope-selector');
      const proto = Object.getPrototypeOf(selector);
      const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
      set.call(selector, ${JSON.stringify(orgB.id)});
      selector.dispatchEvent(new Event('change', { bubbles: true }));
    })()
  `);
  await sleep(1500);

  const afterSwitchB = await evaluate(ws, `
    (() => {
      const selector = document.querySelector('#global-company-scope-selector');
      const stored = localStorage.getItem('mrf_selected_company_id');
      const tableRows = document.querySelectorAll('tbody tr');
      const emptyState = document.querySelector('tbody')?.innerText.includes('No company documents found');
      return {
        currentValue: selector?.value,
        storedInLocalStorage: stored,
        rowCount: tableRows.length,
        isEmptyState: emptyState
      };
    })()
  `);
  console.log('State after switching to Company B:', afterSwitchB);
  if (afterSwitchB.currentValue !== orgB.id || afterSwitchB.storedInLocalStorage !== orgB.id) {
    throw new Error('Company switch to B did not persist in context / localStorage');
  }
  console.log('✓ TEST 2 PASSED: Successfully switched to Company B. Stored in localStorage.');

  // =======================================================
  // TEST 3: Upload a Document under Company B
  // =======================================================
  console.log('\n--- TEST 3: Upload Document under Company B ---');
  // Open upload modal
  await evaluate(ws, `
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Upload Document'));
      btn.click();
    })()
  `);
  await sleep(600);

  const uploadDocName = 'Company B Legal Charter - Automated Test ' + Date.now();
  const fillAndSubmit = await evaluate(ws, `
    (() => {
      const modal = document.querySelector('.bg-card.max-w-lg');
      if (!modal) return { error: 'Upload modal not found' };

      const nameInput = modal.querySelector('input[placeholder*="Certificate"]');
      const catSelect = modal.querySelector('select');
      const descInput = modal.querySelector('textarea');
      const fileInput = modal.querySelector('input[type="file"]');
      const submitBtn = modal.querySelector('button[type="submit"]');

      const setNativeValue = (element, value) => {
        const proto = Object.getPrototypeOf(element);
        const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
        set.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };

      setNativeValue(nameInput, ${JSON.stringify(uploadDocName)});
      setNativeValue(catSelect, 'Legal Documents');
      setNativeValue(descInput, 'Company B specific test document');

      const blob = new Blob(['Sample PDF content for Company B'], { type: 'application/pdf' });
      const file = new File([blob], 'company_b_charter.pdf', { type: 'application/pdf' });
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));

      const form = modal.querySelector('form');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      return {
        success: true,
        val: nameInput.value,
        cat: catSelect.value,
        files: fileInput.files.length
      };
    })()
  `);
  console.log('Form submission result:', fillAndSubmit);
  await sleep(2500); // Wait for upload API & re-fetch

  const modalError = await evaluate(ws, `
    (() => {
      const err = document.querySelector('.bg-card.max-w-lg .text-rose-600, .bg-card.max-w-lg .text-rose-400');
      return err?.innerText || null;
    })()
  `);
  if (modalError) console.log('Modal reported error:', modalError);

  // Verify in database that the newly created document belongs to orgB
  const createdDocB = await prisma.companyDocument.findFirst({
    where: { documentName: uploadDocName }
  });
  console.log('Database record for uploaded doc:', createdDocB ? {
    id: createdDocB.id,
    name: createdDocB.documentName,
    organizationId: createdDocB.organizationId,
    matchesOrgB: createdDocB.organizationId === orgB.id
  } : null);

  if (!createdDocB || createdDocB.organizationId !== orgB.id) {
    throw new Error('Document was not uploaded to Company B! Got org: ' + createdDocB?.organizationId);
  }

  // Check document in UI while on Company B
  const uiDocVisibleB = await evaluate(ws, `
    (() => {
      const tbody = document.querySelector('tbody');
      return tbody ? tbody.innerText.includes(${JSON.stringify(uploadDocName)}) : false;
    })()
  `);
  console.log('Doc visible in UI table under Company B:', uiDocVisibleB);
  if (!uiDocVisibleB) {
    throw new Error('Uploaded doc not visible in Company B UI table');
  }
  console.log('✓ TEST 3 PASSED: Document uploaded under Company B and appears in UI table.');

  // =======================================================
  // TEST 4: Switch Back to Company A — Cross-Company Isolation
  // =======================================================
  console.log('\n--- TEST 4: Switch Back to Company A & Verify Cross-Company Isolation ---');
  await evaluate(ws, `
    (() => {
      const selector = document.querySelector('#global-company-scope-selector');
      const proto = Object.getPrototypeOf(selector);
      const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
      set.call(selector, ${JSON.stringify(orgA.id)});
      selector.dispatchEvent(new Event('change', { bubbles: true }));
    })()
  `);
  await sleep(2000);

  const stateInCompanyA = await evaluate(ws, `
    (() => {
      const selector = document.querySelector('#global-company-scope-selector');
      const stored = localStorage.getItem('mrf_selected_company_id');
      const tbody = document.querySelector('tbody');
      const docInTable = tbody ? tbody.innerText.includes(${JSON.stringify(uploadDocName)}) : false;
      const rows = Array.from(document.querySelectorAll('tbody tr')).map(r => r.innerText.trim());
      return {
        selectorValue: selector?.value,
        stored,
        docInTable,
        rows
      };
    })()
  `);
  console.log('State in Company A after switch:', stateInCompanyA);

  if (stateInCompanyA.docInTable) {
    throw new Error('CROSS-TENANT LEAK: Company B document appeared in Company A document table!');
  }
  console.log('✓ TEST 4 PASSED: Company B document does NOT appear in Company A document table.');

  // =======================================================
  // TEST 5: Switch Back to Company B — Document Reappears
  // =======================================================
  console.log('\n--- TEST 5: Switch Back to Company B & Verify Document Reappears ---');
  await evaluate(ws, `
    (() => {
      const selector = document.querySelector('#global-company-scope-selector');
      const proto = Object.getPrototypeOf(selector);
      const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
      set.call(selector, ${JSON.stringify(orgB.id)});
      selector.dispatchEvent(new Event('change', { bubbles: true }));
    })()
  `);
  await sleep(2000);

  const uiDocVisibleBReappear = await evaluate(ws, `
    (() => {
      const tbody = document.querySelector('tbody');
      return tbody ? tbody.innerText.includes(${JSON.stringify(uploadDocName)}) : false;
    })()
  `);
  console.log('Company B document visible again under Company B:', uiDocVisibleBReappear);
  if (!uiDocVisibleBReappear) {
    throw new Error('Document did not reappear when switching back to Company B');
  }
  console.log('✓ TEST 5 PASSED: Company B document cleanly reappeared.');

  // =======================================================
  // TEST 6: Search & Filter within Selected Company
  // =======================================================
  console.log('\n--- TEST 6: Search & Filter within Selected Company ---');
  // Search for the uploaded document
  await evaluate(ws, `
    (() => {
      const searchInput = document.querySelector('input[placeholder*="Search documents"]');
      searchInput.value = 'Automated Test';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    })()
  `);
  await sleep(1500);

  const searchResult = await evaluate(ws, `
    (() => {
      const tbody = document.querySelector('tbody');
      return tbody ? tbody.innerText.includes(${JSON.stringify(uploadDocName)}) : false;
    })()
  `);
  console.log('Search match in Company B table:', searchResult);
  if (!searchResult) {
    throw new Error('Search failed to find document in Company B table');
  }

  // Clear search using the X button
  await evaluate(ws, `
    (() => {
      const clearBtn = document.querySelector('form button');
      clearBtn?.click();
    })()
  `);
  await sleep(1500);
  console.log('✓ TEST 6 PASSED: Search and filter within selected company work properly.');

  // =======================================================
  // TEST 7: Page Refresh Preserves Selected Company
  // =======================================================
  console.log('\n--- TEST 7: Page Refresh Preserves Selected Company ---');
  await sendCdp(ws, 'Page.reload');
  await sleep(2500);

  const refreshState = await evaluate(ws, `
    (() => {
      const selector = document.querySelector('#global-company-scope-selector');
      const tbody = document.querySelector('tbody');
      const docVisible = tbody ? tbody.innerText.includes(${JSON.stringify(uploadDocName)}) : false;
      return {
        selectedVal: selector?.value,
        docVisible
      };
    })()
  `);
  console.log('State after page reload:', refreshState);
  if (refreshState.selectedVal !== orgB.id || !refreshState.docVisible) {
    throw new Error('Page reload failed to preserve Company B scope');
  }
  console.log('✓ TEST 7 PASSED: Page reload preserves Company B and displays Company B documents.');

  // =======================================================
  // TEST 8: Non-Super Admin Security Verification
  // =======================================================
  console.log('\n--- TEST 8: Non-Super Admin Isolation Check ---');
  // Log in as Company B Admin
  await evaluate(ws, `
    localStorage.setItem('token', ${JSON.stringify(adminBToken)});
    localStorage.setItem('user', ${JSON.stringify(JSON.stringify(adminB))});
    localStorage.removeItem('mrf_selected_company_id');
  `);
  await sendCdp(ws, 'Page.navigate', { url: 'http://localhost:5173/company-documents' });
  await sleep(2500);

  const nonSuperAdminView = await evaluate(ws, `
    (() => {
      const selector = document.querySelector('#global-company-scope-selector');
      const tbody = document.querySelector('tbody');
      const docVisible = tbody ? tbody.innerText.includes(${JSON.stringify(uploadDocName)}) : false;
      return {
        selectorExists: !!selector,
        docVisible
      };
    })()
  `);
  console.log('Non-Super Admin view check:', nonSuperAdminView);
  if (nonSuperAdminView.selectorExists) {
    throw new Error('SECURITY VIOLATION: CompanyScopeSelector rendered for non-Super Admin!');
  }
  if (!nonSuperAdminView.docVisible) {
    throw new Error('Admin B failed to see their own organization document');
  }
  console.log('✓ TEST 8 PASSED: Non-Super Admin does not see CompanyScopeSelector, strictly locked to their organization.');

  // Clean up test document
  if (createdDocB) {
    await prisma.companyDocument.delete({ where: { id: createdDocB.id } });
    console.log('\nCleaned up test document from database:', createdDocB.id);
  }

  ws.close();
  chromeProc.kill();
  await prisma.$disconnect();

  console.log('\n====================================================');
  console.log('ALL COMPANY SWITCHING & ISOLATION TESTS PASSED!');
  console.log('====================================================\n');
}

run().catch((err) => {
  console.error('Test suite failed:', err);
  if (chromeProc) chromeProc.kill();
  prisma.$disconnect();
  process.exit(1);
});
