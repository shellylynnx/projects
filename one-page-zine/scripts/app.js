// app.js — Main entry point and initialization

import { buildGrid, getImages, restoreFromStorage, clearAll, setPageSize } from './grid.js';
import { renderCanvas, getPageSize, DPI } from './canvas.js';
import { setPngDpi } from './png-dpi.js';
import { clearAllData } from './storage.js';
import { showToast } from './ui.js';

// Build the grid
buildGrid();

// Page size option (the browser may restore the checkbox state on reload)
const tabloidCheckbox = document.getElementById('tabloidCheckbox');
const getSize = () => (tabloidCheckbox.checked ? 'tabloid' : 'letter');
setPageSize(getSize());
tabloidCheckbox.addEventListener('change', () => setPageSize(getSize()));

// Restore any previously saved images
restoreFromStorage();

// ─── Download PDF ─────────────────────────────────────────────────────────────

document.getElementById('downloadBtn').addEventListener('click', () => {
  try {
    const showGridLines = document.getElementById('gridLinesCheckbox').checked;
    const size = getSize();
    const { widthIn, heightIn } = getPageSize(size);
    const canvas = renderCanvas(getImages(), { showGridLines, size });
    const pngDataUrl = setPngDpi(canvas.toDataURL('image/png'), DPI);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'in', format: [widthIn, heightIn] });
    pdf.addImage(pngDataUrl, 'PNG', 0, 0, widthIn, heightIn);
    pdf.save('zine.pdf');
  } catch (err) {
    showToast('Failed to generate PDF. Please try again.', 'error');
  }
});

// ─── Download Image ───────────────────────────────────────────────────────────

document.getElementById('downloadImgBtn').addEventListener('click', () => {
  try {
    const showGridLines = document.getElementById('gridLinesCheckbox').checked;
    const canvas = renderCanvas(getImages(), { showGridLines, size: getSize() });
    const link = document.createElement('a');
    link.download = 'zine.png';
    link.href = setPngDpi(canvas.toDataURL('image/png'), DPI);
    link.click();
  } catch (err) {
    showToast('Failed to generate image. Please try again.', 'error');
  }
});

// ─── Clear All ────────────────────────────────────────────────────────────────

document.getElementById('clearAllBtn').addEventListener('click', () => {
  clearAllData();
  clearAll();
  showToast('All images cleared.', 'info', 2000);
});
