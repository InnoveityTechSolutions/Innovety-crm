const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const prisma = new PrismaClient();
const JWT_SECRET = 'enterprise_internship_crm_super_secret_jwt_key_123!';
const BASE_URL = 'http://localhost:5000/api';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_PROFILE = path.join(process.env.TEMP || 'C:\\Temp', 'chrome-doc-profile-' + Date.now());

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
  console.log('COMPANY DOCUMENT MANAGEMENT VERIFICATION SUITE');
  console.log('====================================================\n');

  const results = {};

  // 1. Query test users for all roles and organizations
  console.log('--- 1. Querying Test Users for Role Security ---');
  const superAdmin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
    include: { organization: true }
  });
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    include: { organization: true }
  });
  let tempTlCreated = false;
  let teamLeader = await prisma.user.findFirst({
    where: { role: 'TEAM_LEADER', status: 'ACTIVE' },
    include: { organization: true }
  });
  if (!teamLeader) {
    teamLeader = await prisma.user.create({
      data: {
        name: 'Test Team Leader',
        email: 'test_tl_' + Date.now() + '@enterprise-crm.com',
        employeeId: 'EMP-TL-' + Date.now(),
        password: 'Password123!',
        role: 'TEAM_LEADER',
        status: 'ACTIVE',
        organizationId: admin.organizationId
      },
      include: { organization: true }
    });
    tempTlCreated = true;
    console.log('Created temporary Team Leader for testing:', teamLeader.email);
  }
  const employee = await prisma.user.findFirst({
    where: { role: 'EMPLOYEE', status: 'ACTIVE' },
    include: { organization: true }
  });
  const intern = await prisma.user.findFirst({
    where: { role: 'INTERN', status: 'ACTIVE' },
    include: { organization: true }
  });

  // Query a second organization to test cross-organization tenant isolation
  let secondOrg = await prisma.organization.findFirst({
    where: { id: { not: admin.organizationId } }
  });

  let secondOrgAdmin = null;
  if (secondOrg) {
    secondOrgAdmin = await prisma.user.findFirst({
      where: { organizationId: secondOrg.id, role: 'ADMIN', status: 'ACTIVE' }
    });
  }

  const makeToken = (u) =>
    jwt.sign(
      { id: u.id, email: u.email, role: u.role, organizationId: u.organizationId },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

  const superAdminToken = makeToken(superAdmin);
  const adminToken = makeToken(admin);
  const tlToken = makeToken(teamLeader);
  const employeeToken = makeToken(employee);
  const internToken = makeToken(intern);

  console.log('Super Admin:', superAdmin?.email);
  console.log('Admin:', admin?.email, 'Org:', admin?.organizationId);
  console.log('Team Leader:', teamLeader?.email);
  console.log('Employee:', employee?.email);
  console.log('Intern:', intern?.email);

  // 2. Test Role Permissions
  console.log('\n--- 2. Testing Role Permissions (403 Enforcement) ---');

  // Employee should receive 403 on GET /api/company-documents
  const empRes = await fetch(`${BASE_URL}/company-documents`, {
    headers: { Authorization: `Bearer ${employeeToken}` }
  });
  console.log('Employee GET /company-documents status:', empRes.status);
  results['Employee receives 403'] = empRes.status === 403;

  // Intern should receive 403 on GET /api/company-documents
  const intRes = await fetch(`${BASE_URL}/company-documents`, {
    headers: { Authorization: `Bearer ${internToken}` }
  });
  console.log('Intern GET /company-documents status:', intRes.status);
  results['Intern receives 403'] = intRes.status === 403;

  // Team Leader should be allowed to GET
  const tlGetRes = await fetch(`${BASE_URL}/company-documents`, {
    headers: { Authorization: `Bearer ${tlToken}` }
  });
  console.log('Team Leader GET /company-documents status:', tlGetRes.status);
  results['Team Leader can view documents'] = tlGetRes.status === 200;

  // Team Leader should NOT be allowed to POST (upload)
  const tlPostRes = await fetch(`${BASE_URL}/company-documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tlToken}` }
  });
  console.log('Team Leader POST /company-documents status:', tlPostRes.status);
  results['Team Leader cannot upload (403)'] = tlPostRes.status === 403;

  // 3. Test File Validation (Missing file, Invalid type, Missing fields)
  console.log('\n--- 3. Testing File Upload Validation ---');

  // Missing file
  const noFileForm = new FormData();
  noFileForm.append('documentName', 'Test Document');
  noFileForm.append('category', 'Company Documents');
  const noFileRes = await fetch(`${BASE_URL}/company-documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: noFileForm
  });
  console.log('Missing file status:', noFileRes.status);
  results['Missing file rejected'] = noFileRes.status === 400;

  // Missing required name
  const noNameForm = new FormData();
  noNameForm.append('category', 'Company Documents');
  noNameForm.append('file', new Blob(['test dummy content'], { type: 'application/pdf' }), 'test.pdf');
  const noNameRes = await fetch(`${BASE_URL}/company-documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: noNameForm
  });
  console.log('Missing document name status:', noNameRes.status);
  results['Missing document name rejected'] = noNameRes.status === 400;

  // Invalid file extension (.exe)
  const invalidExtForm = new FormData();
  invalidExtForm.append('documentName', 'Malicious Script');
  invalidExtForm.append('category', 'Other');
  invalidExtForm.append('file', new Blob(['echo bad'], { type: 'application/octet-stream' }), 'bad.exe');
  const invalidExtRes = await fetch(`${BASE_URL}/company-documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: invalidExtForm
  });
  console.log('Invalid file type status:', invalidExtRes.status);
  results['Invalid file extension rejected'] = invalidExtRes.status === 400;

  // 4. Test Uploading Supported File Types
  console.log('\n--- 4. Testing Upload of Supported File Types ---');

  const createdDocIds = [];

  // 4a. PDF document
  const pdfForm = new FormData();
  pdfForm.append('documentName', 'Corporate Governance Policy');
  pdfForm.append('category', 'Policies');
  pdfForm.append('description', 'Official corporate governance code');
  pdfForm.append('file', new Blob(['%PDF-1.4 test corporate policy content'], { type: 'application/pdf' }), 'policy.pdf');
  const pdfRes = await fetch(`${BASE_URL}/company-documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: pdfForm
  });
  const pdfData = await pdfRes.json();
  console.log('PDF upload status:', pdfRes.status, 'ID:', pdfData.document?.id);
  results['PDF upload works'] = pdfRes.status === 201 && pdfData.document?.fileType === 'PDF';
  if (pdfData.document?.id) createdDocIds.push(pdfData.document.id);

  // 4b. DOCX document
  const docxForm = new FormData();
  docxForm.append('documentName', 'Master Service Agreement 2026');
  docxForm.append('category', 'Agreements');
  docxForm.append('file', new Blob(['PK fake docx content'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'msa.docx');
  const docxRes = await fetch(`${BASE_URL}/company-documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: docxForm
  });
  const docxData = await docxRes.json();
  console.log('DOCX upload status:', docxRes.status, 'ID:', docxData.document?.id);
  results['DOC/DOCX upload works'] = docxRes.status === 201 && docxData.document?.fileType === 'DOCX';
  if (docxData.document?.id) createdDocIds.push(docxData.document.id);

  // 4c. XLSX document
  const xlsxForm = new FormData();
  xlsxForm.append('documentName', 'Annual Financial Audit 2025');
  xlsxForm.append('category', 'Financial Documents');
  xlsxForm.append('file', new Blob(['PK fake xlsx content'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'audit.xlsx');
  const xlsxRes = await fetch(`${BASE_URL}/company-documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: xlsxForm
  });
  const xlsxData = await xlsxRes.json();
  console.log('XLSX upload status:', xlsxRes.status, 'ID:', xlsxData.document?.id);
  results['XLS/XLSX upload works'] = xlsxRes.status === 201 && xlsxData.document?.fileType === 'XLSX';
  if (xlsxData.document?.id) createdDocIds.push(xlsxData.document.id);

  // 4d. Image (PNG)
  const imgForm = new FormData();
  imgForm.append('documentName', 'ISO 9001 Certificate Seal');
  imgForm.append('category', 'Licenses & Certificates');
  imgForm.append('file', new Blob(['\x89PNG\r\n\x1a\n fake image content'], { type: 'image/png' }), 'certificate.png');
  const imgRes = await fetch(`${BASE_URL}/company-documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: imgForm
  });
  const imgData = await imgRes.json();
  console.log('Image upload status:', imgRes.status, 'ID:', imgData.document?.id);
  results['Image upload works'] = imgRes.status === 201 && imgData.document?.fileType === 'PNG';
  if (imgData.document?.id) createdDocIds.push(imgData.document.id);

  // 5. Test Expiry Statuses
  console.log('\n--- 5. Testing Expiry Status Calculations ---');

  // 5a. Expiring Soon (10 days from now)
  const dateSoon = new Date();
  dateSoon.setDate(dateSoon.getDate() + 10);
  const soonStr = dateSoon.toISOString().split('T')[0];

  const soonForm = new FormData();
  soonForm.append('documentName', 'Trade License Renewal');
  soonForm.append('category', 'Legal Documents');
  soonForm.append('expiryDate', soonStr);
  soonForm.append('file', new Blob(['trade license content'], { type: 'application/pdf' }), 'trade_license.pdf');
  const soonRes = await fetch(`${BASE_URL}/company-documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: soonForm
  });
  const soonData = await soonRes.json();
  console.log('Expiring soon upload status:', soonRes.status);
  if (soonData.document?.id) createdDocIds.push(soonData.document.id);

  // 5b. Expired (20 days ago)
  const dateExpired = new Date();
  dateExpired.setDate(dateExpired.getDate() - 20);
  const expStr = dateExpired.toISOString().split('T')[0];

  const expDocForm = new FormData();
  expDocForm.append('documentName', 'Old Office Lease 2024');
  expDocForm.append('category', 'Agreements');
  expDocForm.append('expiryDate', expStr);
  expDocForm.append('file', new Blob(['lease expired content'], { type: 'application/pdf' }), 'lease_2024.pdf');
  const expDocRes = await fetch(`${BASE_URL}/company-documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: expDocForm
  });
  const expDocData = await expDocRes.json();
  console.log('Expired upload status:', expDocRes.status);
  if (expDocData.document?.id) createdDocIds.push(expDocData.document.id);

  // 6. Test Search and Category Filter
  console.log('\n--- 6. Testing Search & Category Filter ---');

  // Search by name "Governance"
  const searchRes = await fetch(`${BASE_URL}/company-documents?search=Governance`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const searchData = await searchRes.json();
  const searchMatched = searchData.documents.every((d) =>
    d.documentName.toLowerCase().includes('governance') || (d.description && d.description.toLowerCase().includes('governance'))
  );
  console.log('Search "Governance" results count:', searchData.documents.length);
  results['Search works'] = searchMatched && searchData.documents.length >= 1;

  // Filter by category "Agreements"
  const catRes = await fetch(`${BASE_URL}/company-documents?category=Agreements`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const catData = await catRes.json();
  const catMatched = catData.documents.every((d) => d.category === 'Agreements');
  console.log('Category filter "Agreements" results count:', catData.documents.length);
  results['Category filter works'] = catMatched && catData.documents.length >= 2;

  // Search + Filter together
  const combinedRes = await fetch(`${BASE_URL}/company-documents?category=Agreements&search=Lease`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const combinedData = await combinedRes.json();
  const combinedMatched = combinedData.documents.every(
    (d) => d.category === 'Agreements' && d.documentName.includes('Lease')
  );
  console.log('Combined search & filter count:', combinedData.documents.length);
  results['Search and Category work together'] = combinedMatched && combinedData.documents.length === 1;

  // 7. Test View & Download Endpoints
  console.log('\n--- 7. Testing View & Download Endpoints ---');

  const testPdfId = pdfData.document.id;

  // View (streamDocumentPreview)
  const viewRes = await fetch(`${BASE_URL}/company-documents/${testPdfId}/view`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const viewContentType = viewRes.headers.get('content-type');
  const viewDisposition = viewRes.headers.get('content-disposition');
  console.log('View status:', viewRes.status, 'Content-Type:', viewContentType, 'Disposition:', viewDisposition);
  results['View inline works'] = viewRes.status === 200 && viewContentType.includes('pdf') && viewDisposition.includes('inline');

  // Download
  const dlRes = await fetch(`${BASE_URL}/company-documents/${testPdfId}/download`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const dlDisposition = dlRes.headers.get('content-disposition');
  console.log('Download status:', dlRes.status, 'Disposition:', dlDisposition);
  results['Download works'] = dlRes.status === 200 && dlDisposition.includes('attachment');

  // Team Leader download allowed
  const tlDlRes = await fetch(`${BASE_URL}/company-documents/${testPdfId}/download`, {
    headers: { Authorization: `Bearer ${tlToken}` }
  });
  console.log('Team Leader download status:', tlDlRes.status);
  results['Team Leader can download'] = tlDlRes.status === 200;

  // 8. Test Delete (Role Restrictions + Physical and DB Deletion)
  console.log('\n--- 8. Testing Delete Functionality ---');

  // Team leader cannot delete
  const tlDeleteRes = await fetch(`${BASE_URL}/company-documents/${testPdfId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tlToken}` }
  });
  console.log('Team Leader DELETE status:', tlDeleteRes.status);
  results['Team Leader cannot delete (403)'] = tlDeleteRes.status === 403;

  // Admin delete document
  const docToDelete = await prisma.companyDocument.findUnique({ where: { id: testPdfId } });
  const physicalPath = path.join(__dirname, '../backend/uploads/company-documents', docToDelete.filePath);
  const fileExistedBefore = fs.existsSync(physicalPath);

  const adminDeleteRes = await fetch(`${BASE_URL}/company-documents/${testPdfId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  console.log('Admin DELETE status:', adminDeleteRes.status);

  const docInDbAfter = await prisma.companyDocument.findUnique({ where: { id: testPdfId } });
  const fileExistsAfter = fs.existsSync(physicalPath);

  console.log('File existed before:', fileExistedBefore, '| File exists after delete:', fileExistsAfter);
  console.log('Doc in DB after delete:', docInDbAfter);

  results['Delete removes DB record'] = adminDeleteRes.status === 200 && docInDbAfter === null;
  results['Delete removes stored file'] = fileExistedBefore && !fileExistsAfter;

  // Remove testPdfId from createdDocIds since it is deleted
  const idx = createdDocIds.indexOf(testPdfId);
  if (idx !== -1) createdDocIds.splice(idx, 1);

  // 9. Test Organization Isolation
  console.log('\n--- 9. Testing Organization Isolation ---');
  if (secondOrgAdmin) {
    const secondOrgAdminToken = makeToken(secondOrgAdmin);
    const targetDocId = createdDocIds[0];

    // Org B admin tries to view Org A doc
    const crossViewRes = await fetch(`${BASE_URL}/company-documents/${targetDocId}`, {
      headers: { Authorization: `Bearer ${secondOrgAdminToken}` }
    });
    console.log('Cross-org GET /:id status:', crossViewRes.status);

    // Org B admin tries to download Org A doc
    const crossDlRes = await fetch(`${BASE_URL}/company-documents/${targetDocId}/download`, {
      headers: { Authorization: `Bearer ${secondOrgAdminToken}` }
    });
    console.log('Cross-org GET /:id/download status:', crossDlRes.status);

    // Org B admin tries to delete Org A doc
    const crossDelRes = await fetch(`${BASE_URL}/company-documents/${targetDocId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${secondOrgAdminToken}` }
    });
    console.log('Cross-org DELETE /:id status:', crossDelRes.status);

    results['Organization isolation enforced'] =
      crossViewRes.status === 403 && crossDlRes.status === 403 && crossDelRes.status === 403;
  } else {
    console.log('Second organization admin not found; testing isolation logic via simulated token');
    const fakeOrgAdminToken = jwt.sign(
      { id: 'fake-user-id', email: 'other@org.com', role: 'ADMIN', organizationId: 'other-org-id' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );
    const targetDocId = createdDocIds[0];
    const crossViewRes = await fetch(`${BASE_URL}/company-documents/${targetDocId}`, {
      headers: { Authorization: `Bearer ${fakeOrgAdminToken}` }
    });
    results['Organization isolation enforced'] = crossViewRes.status === 403;
  }

  // 10. Headless Chrome UI Verification
  console.log('\n--- 10. Testing Headless Chrome UI Verification ---');
  chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9224',
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
      const res = await fetch('http://localhost:9224/json');
      const targets = await res.json();
      pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
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

  // Set Auth in localStorage
  await evaluate(ws, `
    localStorage.setItem('token', ${JSON.stringify(adminToken)});
    localStorage.setItem('user', ${JSON.stringify(JSON.stringify(admin))});
  `);

  console.log('Navigating to /company-documents...');
  await sendCdp(ws, 'Page.navigate', { url: 'http://localhost:5173/company-documents' });
  await sleep(3000);

  // 10a. Verify page elements
  const pageCheck = await evaluate(ws, `
    (() => {
      const heading = document.querySelector('h1')?.textContent;
      const uploadBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Upload Document'));
      const searchInput = document.querySelector('input[placeholder*="Search documents"]');
      const catSelect = document.querySelector('select');
      const rows = Array.from(document.querySelectorAll('tbody tr')).length;
      return {
        heading,
        hasUploadBtn: Boolean(uploadBtn),
        hasSearchInput: Boolean(searchInput),
        hasCatSelect: Boolean(catSelect),
        rowsCount: rows
      };
    })()
  `);
  console.log('UI Page inspection:', pageCheck);
  results['Company Documents page opens in UI'] = pageCheck.heading?.includes('Company Documents');
  results['Upload Document button present'] = pageCheck.hasUploadBtn;
  results['Search input present'] = pageCheck.hasSearchInput;
  results['Category filter present'] = pageCheck.hasCatSelect;
  results['Documents appear in UI table'] = pageCheck.rowsCount >= 1;

  // 10b. Click Upload Document button to test Modal opening
  console.log('Opening Upload Modal...');
  await evaluate(ws, `
    const uploadBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Upload Document'));
    if (uploadBtn) uploadBtn.click();
  `);
  await sleep(600);

  const modalCheck = await evaluate(ws, `
    (() => {
      const modalHeader = Array.from(document.querySelectorAll('h3')).find(h => h.textContent.includes('Upload Company Document'));
      const nameInput = document.querySelector('input[placeholder*="Certificate of Incorporation"]');
      const catSelect = document.querySelector('form select');
      const fileInput = document.querySelector('#doc-file-input');
      const expiryInput = document.querySelector('input[type="date"]');
      return {
        modalFound: Boolean(modalHeader),
        hasNameInput: Boolean(nameInput),
        hasCatSelect: Boolean(catSelect),
        hasFileInput: Boolean(fileInput),
        hasExpiryInput: Boolean(expiryInput)
      };
    })()
  `);
  console.log('Upload Modal inspection:', modalCheck);
  results['Upload modal opens with all required fields'] =
    modalCheck.modalFound && modalCheck.hasNameInput && modalCheck.hasCatSelect && modalCheck.hasFileInput;

  // Close Upload Modal
  await evaluate(ws, `
    const closeBtn = document.querySelector('form button[type="button"]');
    if (closeBtn) closeBtn.click();
  `);
  await sleep(500);

  // 10c. Verify Status Badges in UI
  const badgesCheck = await evaluate(ws, `
    (() => {
      const badges = Array.from(document.querySelectorAll('tbody span')).map(s => s.textContent.trim());
      return {
        hasNoExpiry: badges.some(b => b === 'No Expiry'),
        hasExpiringSoon: badges.some(b => b === 'EXPIRING SOON'),
        hasExpired: badges.some(b => b === 'EXPIRED')
      };
    })()
  `);
  console.log('Status Badges inspection:', badgesCheck);
  results['No Expiry badge rendered'] = badgesCheck.hasNoExpiry;
  results['Expiring Soon badge rendered'] = badgesCheck.hasExpiringSoon;
  results['Expired badge rendered'] = badgesCheck.hasExpired;

  // Cleanup created test documents
  console.log('\n--- 11. Cleaning up Test Documents ---');
  for (const id of createdDocIds) {
    const doc = await prisma.companyDocument.findUnique({ where: { id } });
    if (doc) {
      const p = path.join(__dirname, '../backend/uploads/company-documents', doc.filePath);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (e) {}
      }
      await prisma.companyDocument.delete({ where: { id } });
    }
  }
  console.log('Cleaned up', createdDocIds.length, 'test documents.');

  if (tempTlCreated && teamLeader?.id) {
    await prisma.user.delete({ where: { id: teamLeader.id } });
    console.log('Cleaned up temporary Team Leader user.');
  }

  ws.close();
  if (chromeProc) chromeProc.kill();
  await prisma.$disconnect();

  console.log('\n====================================================');
  console.log('SUMMARY OF ALL VERIFICATION TESTS:');
  console.log('====================================================');
  let allPassed = true;
  for (const [testName, passed] of Object.entries(results)) {
    console.log(`${passed ? '✓ PASS' : '✗ FAIL'}: ${testName}`);
    if (!passed) allPassed = false;
  }
  console.log(`Console Errors: ${consoleErrors.length} (${consoleErrors.length === 0 ? 'PASS' : 'FAIL'})`);
  console.log('====================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Test run failed:', err);
  if (chromeProc) chromeProc.kill();
  prisma.$disconnect();
  process.exit(1);
});
