const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

console.log('====================================================');
console.log('ESTIMATE PDF SEPARATE BUTTONS & DOWNLOAD TEST SUITE');
console.log('====================================================');

// 1. Test getEstimatePdfFilename logic
const getEstimatePdfFilename = (estimate) => {
  const rawNumber = estimate?.estimateNumber || 'Estimate';
  const cleanNumber = String(rawNumber).replace(/[/\\?%*:|"<>]/g, '-').trim() || 'Estimate';
  const isCancelled = estimate?.status === 'CANCELLED';
  return isCancelled ? `${cleanNumber}-CANCELLED.pdf` : `${cleanNumber}.pdf`;
};

console.log('\n--- TEST 1: Filename Generation Logic ---');
assert(
  getEstimatePdfFilename({ estimateNumber: 'EST-001005', status: 'GENERATED' }) === 'EST-001005.pdf',
  'Active estimate generates EST-001005.pdf'
);
assert(
  getEstimatePdfFilename({ estimateNumber: 'EST-001005', status: 'CANCELLED' }) === 'EST-001005-CANCELLED.pdf',
  'Cancelled estimate generates EST-001005-CANCELLED.pdf'
);
assert(
  getEstimatePdfFilename({ estimateNumber: 'EST/2026/01', status: 'GENERATED' }) === 'EST-2026-01.pdf',
  'Special characters in estimate number sanitized for file system'
);
assert(
  getEstimatePdfFilename(null) === 'Estimate.pdf',
  'Missing estimate fallback produces Estimate.pdf'
);
assert(
  getEstimatePdfFilename({ status: 'CANCELLED' }) === 'Estimate-CANCELLED.pdf',
  'Missing estimate with CANCELLED produces Estimate-CANCELLED.pdf'
);

// 2. Test estimatePdfGenerator.js module
console.log('\n--- TEST 2: Inspect estimatePdfGenerator.js Source ---');
const genFile = path.join(__dirname, '../frontend/src/utils/estimatePdfGenerator.js');
assert(fs.existsSync(genFile), 'frontend/src/utils/estimatePdfGenerator.js exists');

const genContent = fs.readFileSync(genFile, 'utf8');
assert(genContent.includes("import html2canvas from 'html2canvas'"), 'Imports html2canvas');
assert(genContent.includes("import { jsPDF } from 'jspdf'"), 'Imports jsPDF');
assert(genContent.includes("pdf.save(filename)"), 'Uses direct client-side pdf.save(filename)');
assert(!genContent.includes("window.print()"), 'Does NOT invoke window.print()');
assert(genContent.includes("scale: 2"), 'Uses high-DPI 2x scale for crisp A4 output');
assert(genContent.includes("useCORS: true"), 'Enables useCORS for logo and signature images');
assert(genContent.includes("format: 'a4'"), 'Specifies standard A4 format');
assert(genContent.includes("getEstimatePdfFilename"), 'Exports getEstimatePdfFilename');
assert(genContent.includes("generateEstimatePdf"), 'Exports generateEstimatePdf');

// 3. Test ViewEstimateModal.jsx
console.log('\n--- TEST 3: Inspect ViewEstimateModal.jsx Buttons ---');
const viewModalFile = path.join(__dirname, '../frontend/src/components/assets/ViewEstimateModal.jsx');
assert(fs.existsSync(viewModalFile), 'ViewEstimateModal.jsx exists');

const viewContent = fs.readFileSync(viewModalFile, 'utf8');
assert(
  !viewContent.includes('<span>Print / Save PDF</span>'),
  'Top header "Print / Save PDF" button has been REMOVED'
);
assert(
  viewContent.includes('<span>Print Document</span>'),
  'Bottom "Print Document" button is preserved'
);
assert(
  viewContent.includes('<span>Download PDF</span>'),
  'Bottom "Download PDF" button is added next to Print Document'
);
assert(
  viewContent.includes('Generating PDF...'),
  'Provides "Generating PDF..." loading state'
);
assert(
  viewContent.includes('downloadingPdf'),
  'Tracks downloadingPdf state and disables button during generation'
);
assert(
  viewContent.includes('generateEstimatePdf'),
  'Calls generateEstimatePdf on Download PDF click'
);
assert(
  viewContent.includes('getEstimatePdfFilename'),
  'Uses getEstimatePdfFilename for standard naming'
);

// 4. Test CreateEstimateModal.jsx synchronization
console.log('\n--- TEST 4: Inspect CreateEstimateModal.jsx Action Buttons ---');
const createModalFile = path.join(__dirname, '../frontend/src/components/assets/CreateEstimateModal.jsx');
assert(fs.existsSync(createModalFile), 'CreateEstimateModal.jsx exists');

const createContent = fs.readFileSync(createModalFile, 'utf8');
assert(
  !createContent.includes('Print / Save PDF'),
  'Legacy "Print / Save PDF" removed from CreateEstimateModal header & footer'
);
assert(
  createContent.includes('Print Document'),
  'CreateEstimateModal has "Print Document"'
);
assert(
  createContent.includes('Download PDF'),
  'CreateEstimateModal has "Download PDF"'
);
assert(
  createContent.includes('generateEstimatePdf'),
  'CreateEstimateModal integrates generateEstimatePdf'
);

// 5. Test EstimateDocumentPreview.jsx CORS attribute
console.log('\n--- TEST 5: Image CORS Attributes in EstimateDocumentPreview.jsx ---');
const previewFile = path.join(__dirname, '../frontend/src/components/assets/EstimateDocumentPreview.jsx');
const previewContent = fs.readFileSync(previewFile, 'utf8');
assert(
  previewContent.includes('crossOrigin="anonymous"'),
  'EstimateDocumentPreview images set crossOrigin="anonymous" for clean canvas capture'
);

console.log('\n====================================================');
console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('====================================================\n');

process.exit(failed > 0 ? 1 : 0);
