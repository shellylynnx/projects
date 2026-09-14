// app.js — Main entry point and initialization

import { buildGrid, getImages, restoreFromStorage, clearAll } from './grid.js';
import { renderCanvas, DPI } from './canvas.js';
import { setPngDpi } from './png-dpi.js';
import { clearAllData } from './storage.js';
import { showToast } from './ui.js';

// Build the grid
buildGrid();

// Restore any previously saved images
restoreFromStorage();

// ─── Download PDF ─────────────────────────────────────────────────────────────

document.getElementById('downloadBtn').addEventListener('click', () => {
  try {
    const showGridLines = document.getElementById('gridLinesCheckbox').checked;
    const canvas = renderCanvas(getImages(), { showGridLines });
    const pngDataUrl = setPngDpi(canvas.toDataURL('image/png'), DPI);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'in', format: [11, 8.5] });
    pdf.addImage(pngDataUrl, 'PNG', 0, 0, 11, 8.5);
    pdf.save('zine.pdf');
  } catch (err) {
    showToast('Failed to generate PDF. Please try again.', 'error');
  }
});

// ─── Download Image ───────────────────────────────────────────────────────────

document.getElementById('downloadImgBtn').addEventListener('click', () => {
  try {
    const showGridLines = document.getElementById('gridLinesCheckbox').checked;
    const canvas = renderCanvas(getImages(), { showGridLines });
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
