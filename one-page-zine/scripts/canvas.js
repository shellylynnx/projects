// canvas.js — Canvas rendering and coverCrop logic

const DPI = 150;
const PAGE_W = Math.round(11 * DPI);   // 1650
const PAGE_H = Math.round(8.5 * DPI);  // 1275
const COLS = 4;
const ROWS = 2;

/**
 * Returns source crop coords so the image fills (w x h) without distortion.
 */
export function coverCrop(imgW, imgH, targetW, targetH) {
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

/**
 * Renders all images onto the hidden canvas and returns it.
 */
export function renderCanvas(images) {
  const canvas = document.getElementById('canvas');
  canvas.width = PAGE_W;
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

export { PAGE_W, PAGE_H, COLS, ROWS, DPI };
