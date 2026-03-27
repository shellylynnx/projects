// One Page Zine — script.js
// 11" × 8.5" landscape at 150 DPI = 1650 × 1275 px
const DPI = 150;
const PAGE_W = Math.round(11  * DPI);  // 1650
const PAGE_H = Math.round(8.5 * DPI);  // 1275
const COLS = 4;
const ROWS = 2;
const TOTAL = COLS * ROWS; // 8

const images = new Array(TOTAL).fill(null); // stores HTMLImageElements

// ─── Build upload grid ────────────────────────────────────────────────────────

const grid = document.getElementById('grid');
const LABELS = ['Page 6', 'Page 5', 'Page 4', 'Page 3', 'Back Cover', 'Front Cover', 'Page 1', 'Page 2'];

for (let i = 0; i < TOTAL; i++) {
  const slot = document.createElement('div');
  slot.className = 'slot';
  slot.dataset.index = i;

  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = LABELS[i];

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = 'Click or drag image';

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/gif';
  input.addEventListener('change', (e) => handleFile(i, e.target.files[0]));

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove image';
  removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeImage(i); });

  slot.appendChild(num);
  slot.appendChild(label);
  slot.appendChild(input);
  slot.appendChild(removeBtn);

  // Drag-and-drop
  slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('dragover'); });
  slot.addEventListener('dragleave', () => slot.classList.remove('dragover'));
  slot.addEventListener('drop', (e) => {
    e.preventDefault();
    slot.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && ['image/jpeg', 'image/png', 'image/gif'].includes(file.type)) handleFile(i, file);
  });

  grid.appendChild(slot);
}

// ─── File handling ────────────────────────────────────────────────────────────

function handleFile(index, file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      images[index] = img;
      renderSlot(index, e.target.result);
      updateUI();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function renderSlot(index, src) {
  const slot = grid.children[index];
  // Remove existing preview img if any
  const existing = slot.querySelector('img');
  if (existing) existing.remove();

  const preview = document.createElement('img');
  preview.src = src;
  slot.insertBefore(preview, slot.querySelector('.remove'));
  slot.classList.add('filled');
}

function removeImage(index) {
  images[index] = null;
  const slot = grid.children[index];
  const img = slot.querySelector('img');
  if (img) img.remove();
  slot.classList.remove('filled');

  // Reset file input so the same file can be re-selected
  const input = slot.querySelector('input[type="file"]');
  input.value = '';

  updateUI();
}

// ─── UI state ─────────────────────────────────────────────────────────────────

const countEl = document.getElementById('count');
const downloadBtn = document.getElementById('downloadBtn');
const downloadImgBtn = document.getElementById('downloadImgBtn');

function updateUI() {
  const filled = images.filter(Boolean).length;
  countEl.textContent = `${filled} / ${TOTAL} pages uploaded`;
  const ready = filled >= TOTAL;
  downloadBtn.disabled = !ready;
  downloadImgBtn.disabled = !ready;
}

// ─── Shared canvas renderer ───────────────────────────────────────────────────

function renderCanvas() {
  const canvas = document.getElementById('canvas');
  canvas.width  = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  const cellW = PAGE_W / COLS;
  const cellH = PAGE_H / ROWS;

  images.forEach((img, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = col * cellW;
    const y = row * cellH;

    if (img) {
      const { sx, sy, sw, sh } = coverCrop(img.naturalWidth, img.naturalHeight, cellW, cellH);
      if (i < 4) {
        ctx.save();
        ctx.translate(x + cellW / 2, y + cellH / 2);
        ctx.rotate(Math.PI);
        ctx.drawImage(img, sx, sy, sw, sh, -cellW / 2, -cellH / 2, cellW, cellH);
        ctx.restore();
      } else {
        ctx.drawImage(img, sx, sy, sw, sh, x, y, cellW, cellH);
      }
    } else {
      ctx.fillStyle = '#eeeeee';
      ctx.fillRect(x, y, cellW, cellH);
    }
  });

  // Thin grid lines
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath(); ctx.moveTo(c * cellW, 0); ctx.lineTo(c * cellW, PAGE_H); ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * cellH); ctx.lineTo(PAGE_W, r * cellH); ctx.stroke();
  }

  return canvas;
}

// ─── Download PDF ─────────────────────────────────────────────────────────────

downloadBtn.addEventListener('click', () => {
  const canvas = renderCanvas();
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'in', format: [11, 8.5] });
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 11, 8.5);
  pdf.save('zine.pdf');
});

// ─── Download Image (offline) ─────────────────────────────────────────────────

downloadImgBtn.addEventListener('click', () => {
  const canvas = renderCanvas();
  const link = document.createElement('a');
  link.download = 'zine.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// Returns source crop coords so the image fills (w × h) without distortion
function coverCrop(imgW, imgH, targetW, targetH) {
  const imgRatio = imgW / imgH;
  const targetRatio = targetW / targetH;
  let sw, sh, sx, sy;

  if (imgRatio > targetRatio) {
    // Image is wider — crop sides
    sh = imgH;
    sw = imgH * targetRatio;
    sx = (imgW - sw) / 2;
    sy = 0;
  } else {
    // Image is taller — crop top/bottom
    sw = imgW;
    sh = imgW / targetRatio;
    sx = 0;
    sy = (imgH - sh) / 2;
  }

  return { sx, sy, sw, sh };
}
