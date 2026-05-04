'use strict';

// PDF.js worker — set before first use
function initPdfWorker() {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
}

/**
 * Get page count + first-page thumbnail for any supported file.
 * Returns { pageCount: number, thumbnail: string|null }
 */
async function getFileInfo(file) {
  if (isPdf(file)) {
    return getPdfInfo(file);
  }
  return {
    pageCount: 1,
    thumbnail: await readFileAsDataUrl(file),
  };
}

/**
 * Open a PDF and return a pdf.js document object.
 * Caller is responsible for calling doc.destroy() when done.
 */
async function loadPdfDoc(file) {
  const arrayBuffer = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
}

/**
 * Render a single PDF page to a JPEG data URL.
 * @param {PDFDocumentProxy} pdfDoc
 * @param {number} pageNum  1-based
 * @param {number} targetWidth  canvas width in px
 */
async function renderPdfPage(pdfDoc, pageNum, targetWidth = 900) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const scale = targetWidth / viewport.width;
  const scaled = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(scaled.width);
  canvas.height = Math.round(scaled.height);

  await page.render({
    canvasContext: canvas.getContext('2d'),
    viewport: scaled,
  }).promise;

  page.cleanup();
  return canvas.toDataURL('image/jpeg', 0.88);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function isPdf(file) {
  return (
    file.type === 'application/pdf' ||
    file.name.toLowerCase().endsWith('.pdf')
  );
}

async function getPdfInfo(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageCount = pdf.numPages;

  let thumbnail = null;
  try {
    thumbnail = await renderPdfPage(pdf, 1, 120);
  } catch (_) { /* thumbnail optional */ }

  pdf.destroy();
  return { pageCount, thumbnail };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Resize an image file to a thumbnail data URL
async function imageFileThumbnail(file, maxWidth = 120) {
  const dataUrl = await readFileAsDataUrl(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
