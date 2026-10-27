import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/**
 * Computes official filename for Estimate PDF
 * Target formats:
 *   Active:    EST-001005.pdf
 *   Cancelled: EST-001005-CANCELLED.pdf
 *
 * @param {Object} estimate - Estimate snapshot object
 * @returns {string} Sanitized filename
 */
export const getEstimatePdfFilename = (estimate) => {
  const rawNumber = estimate?.estimateNumber || 'Estimate';
  // Sanitize for file system (remove invalid characters : / \ ? * < > | ")
  const cleanNumber = String(rawNumber).replace(/[/\\?%*:|"<>]/g, '-').trim() || 'Estimate';
  const isCancelled = estimate?.status === 'CANCELLED';
  return isCancelled ? `${cleanNumber}-CANCELLED.pdf` : `${cleanNumber}.pdf`;
};

/**
 * Helper to ensure all images inside target element are loaded before rendering
 */
const waitForImages = async (element) => {
  const images = Array.from(element.querySelectorAll('img'));
  if (images.length === 0) return;

  const promises = images.map((img) => {
    if (img.complete && img.naturalWidth !== 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const cleanup = () => {
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        resolve();
      };
      const onLoad = () => cleanup();
      const onError = () => cleanup();
      img.addEventListener('load', onLoad, { once: true });
      img.addEventListener('error', onError, { once: true });
      // Safety timeout in case network request hangs
      setTimeout(() => cleanup(), 2500);
    });
  });

  await Promise.all(promises);
};

/**
 * Generates and downloads an A4 PDF from the Estimate DOM element
 * @param {string|HTMLElement} target - Element ID or HTMLElement instance
 * @param {string} filename - Target filename (e.g. EST-001005.pdf)
 * @returns {Promise<boolean>}
 */
export const generateEstimatePdf = async (target, filename = 'Estimate.pdf') => {
  const element = typeof target === 'string' ? document.getElementById(target) : target;
  if (!element) {
    throw new Error('Estimate document element not found');
  }

  // 1. Wait for any logo or signature images to finish loading
  await waitForImages(element);

  // 2. Render to high-resolution canvas using html2canvas
  const canvas = await html2canvas(element, {
    scale: 2, // 2x resolution for crisp high-DPI text and graphics
    useCORS: true, // Allow cross-origin images (e.g. backend /uploads)
    allowTaint: false,
    backgroundColor: '#ffffff',
    logging: false,
    windowWidth: 1200,
    onclone: (clonedDoc) => {
      const targetId = typeof target === 'string' ? target : 'printable-estimate-document';
      const clonedEl = clonedDoc.getElementById(targetId) || clonedDoc.querySelector('.estimate-document');

      if (clonedEl) {
        // Remove drop-shadow and modal border for clean document PDF
        clonedEl.style.boxShadow = 'none';
        clonedEl.style.border = 'none';
        clonedEl.style.margin = '0 auto';
        clonedEl.style.width = '800px';
        clonedEl.style.maxWidth = '800px';
      }
    }
  });

  const imgData = canvas.toDataURL('image/png');

  // 3. Create standard portrait A4 PDF
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true
  });

  const pageWidth = pdf.internal.pageSize.getWidth(); // 210 mm
  const pageHeight = pdf.internal.pageSize.getHeight(); // 297 mm

  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * pageWidth) / canvas.width;

  if (imgHeight <= pageHeight) {
    pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight, undefined, 'FAST');
  } else {
    // Proportional fit to single A4 page
    const scale = pageHeight / imgHeight;
    const fittedWidth = imgWidth * scale;
    const fittedHeight = pageHeight;
    const offsetX = (pageWidth - fittedWidth) / 2;
    pdf.addImage(imgData, 'PNG', offsetX, 0, fittedWidth, fittedHeight, undefined, 'FAST');
  }

  // 4. Trigger direct client-side file download (does NOT open browser print dialog)
  pdf.save(filename);
  return true;
};
