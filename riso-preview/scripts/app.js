/* ── app.js ── Riso Preview entry point ───────────────────────── */

import { RISO_COLORS, DEFAULT_LAYER1, DEFAULT_LAYER2, DEFAULT_LAYER3 } from './colors.js';
import { applyRisoColor, blendAllLayers } from './engine.js';
import { showToast } from './ui.js';

/* ── State ────────────────────────────────────────────────────── */
let sourceImageData = null;
let sourceWidth = 0;
let sourceHeight = 0;

const layers = [
  { color: RISO_COLORS.find(c => c.name === DEFAULT_LAYER1), enabled: true },
  { color: RISO_COLORS.find(c => c.name === DEFAULT_LAYER2), enabled: true },
  { color: RISO_COLORS.find(c => c.name === DEFAULT_LAYER3), enabled: true },
];

// Masks: one Uint8Array per layer, null = no mask (full image)
let masks = [null, null, null];
let maskingEnabled = false;
let maskLayerIdx = 0;   // which layer to paint for
let brushSize = 20;
let activeTool = 'brush'; // 'brush', 'eraser', 'magic'
let painting = false;
let magicTolerance = 32;
let magicContiguous = true;
let showColorLayers = [false, false, false]; // per-layer color preview toggle

/* ── DOM refs ─────────────────────────────────────────────────── */
const uploadZone   = document.getElementById('upload-zone');
const uploadPrompt = document.getElementById('upload-prompt');
const fileInput    = document.getElementById('file-input');
const sourceCanvas = document.getElementById('source-canvas');
const maskOverlay  = document.getElementById('mask-overlay');
const canvases     = [
  document.getElementById('canvas-1'),
  document.getElementById('canvas-2'),
  document.getElementById('canvas-3'),
];
const canvasOut    = document.getElementById('canvas-out');
const controls     = document.getElementById('controls');
const preview      = document.getElementById('preview-section');
const actions      = document.getElementById('actions');
const maskSection  = document.getElementById('mask-section');
const maskControls = document.getElementById('mask-controls');
const maskToggle   = document.getElementById('mask-toggle');
const maskLayerSel = document.getElementById('mask-layer');
const brushSizeEl  = document.getElementById('brush-size');
const brushSizeVal = document.getElementById('brush-size-val');
const brushSizeField = document.getElementById('brush-size-field');
const toolBrushBtn  = document.getElementById('tool-brush');
const toolEraserBtn = document.getElementById('tool-eraser');
const toolMagicBtn  = document.getElementById('tool-magic');
const toleranceEl   = document.getElementById('magic-tolerance');
const toleranceVal  = document.getElementById('tolerance-val');
const toleranceField = document.getElementById('tolerance-field');
const contiguousEl  = document.getElementById('magic-contiguous');
const contiguousField = document.getElementById('contiguous-field');
const maskClearBtn = document.getElementById('mask-clear-btn');
const viewBar      = document.getElementById('view-bar');
const colorLayerChecks = document.querySelectorAll('.color-layer-check');
const maskHint     = document.getElementById('mask-hint');
const swatchEls    = [
  document.getElementById('swatches-1'),
  document.getElementById('swatches-2'),
  document.getElementById('swatches-3'),
];
const layerToggles = [
  null, // layer 1 has no toggle (always enabled)
  document.getElementById('layer2-toggle'),
  document.getElementById('layer3-toggle'),
];
const btnDownloads = [
  document.getElementById('btn-download-1'),
  document.getElementById('btn-download-2'),
  document.getElementById('btn-download-3'),
];
const btnPlates = [
  document.getElementById('btn-plate-1'),
  document.getElementById('btn-plate-2'),
  document.getElementById('btn-plate-3'),
];
const btnDownload  = document.getElementById('btn-download');
const btnClear     = document.getElementById('btn-clear');

const MAX_DIM = 1200;

/* ── Build swatch grids ──────────────────────────────────────── */
function buildSwatches(container, selectedName, onSelect) {
  container.innerHTML = '';
  for (const color of RISO_COLORS) {
    const el = document.createElement('button');
    el.className = 'swatch' + (color.name === selectedName ? ' active' : '');
    el.style.background = `rgb(${color.rgb.join(',')})`;
    el.title = color.name;
    el.setAttribute('role', 'radio');
    el.setAttribute('aria-checked', color.name === selectedName ? 'true' : 'false');
    el.setAttribute('aria-label', color.name);
    el.addEventListener('click', () => {
      container.querySelectorAll('.swatch').forEach(s => {
        s.classList.remove('active');
        s.setAttribute('aria-checked', 'false');
      });
      el.classList.add('active');
      el.setAttribute('aria-checked', 'true');
      onSelect(color);
    });
    container.appendChild(el);
  }
}

const defaults = [DEFAULT_LAYER1, DEFAULT_LAYER2, DEFAULT_LAYER3];
for (let i = 0; i < 3; i++) {
  buildSwatches(swatchEls[i], defaults[i], color => {
    layers[i].color = color;
    updateSourcePreview();
    drawMaskOverlay();
    render();
  });
}

/* ── Image upload ─────────────────────────────────────────────── */
function handleFile(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/gif'].includes(file.type)) {
    showToast('Only JPEG, PNG, or GIF images are supported.', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('Image must be under 10 MB.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > MAX_DIM || h > MAX_DIM) {
        const scale = MAX_DIM / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      sourceWidth = w;
      sourceHeight = h;

      sourceCanvas.width = w;
      sourceCanvas.height = h;
      const ctx = sourceCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      sourceImageData = ctx.getImageData(0, 0, w, h);

      sourceCanvas.style.display = 'block';
      uploadPrompt.style.display = 'none';
      uploadZone.classList.add('has-image');

      // Size mask overlay to match source canvas
      maskOverlay.width = w;
      maskOverlay.height = h;
      maskOverlay.style.display = 'block';

      // Size preview canvases
      for (const c of canvases) { c.width = w; c.height = h; }
      canvasOut.width = w; canvasOut.height = h;

      // Reset masks
      masks = [null, null, null];

      // Show UI
      viewBar.classList.remove('hidden');
      controls.classList.remove('hidden');
      preview.classList.remove('hidden');
      actions.classList.remove('hidden');
      maskSection.classList.remove('hidden');

      render();

      // Position overlay after layout settles
      requestAnimationFrame(syncOverlayPosition);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

uploadZone.addEventListener('click', e => {
  if (maskingEnabled) return; // don't trigger file picker when masking
  if (!uploadZone.classList.contains('has-image')) fileInput.click();
});
uploadZone.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && !uploadZone.classList.contains('has-image')) {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

window.addEventListener('resize', () => { if (sourceImageData) syncOverlayPosition(); });

/* ── Mask painting ───────────────────────────────────────────── */
function ensureMask(idx) {
  if (!masks[idx]) {
    masks[idx] = new Uint8Array(sourceWidth * sourceHeight);
    masks[idx].fill(255); // start fully visible; eraser/magic remove, brush restores
  }
}

function canvasCoords(e) {
  const rect = sourceCanvas.getBoundingClientRect();
  const scaleX = sourceWidth / rect.width;
  const scaleY = sourceHeight / rect.height;
  return {
    x: Math.round((e.clientX - rect.left) * scaleX),
    y: Math.round((e.clientY - rect.top) * scaleY),
  };
}

function syncOverlayPosition() {
  // CSS handles sizing (100% x 100% of upload-zone).
  // No additional JS positioning needed since both canvases fill the zone.
}

function paintAt(x, y) {
  ensureMask(maskLayerIdx);
  const mask = masks[maskLayerIdx];
  const r = brushSize;
  const val = activeTool === 'eraser' ? 0 : 255;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || px >= sourceWidth || py < 0 || py >= sourceHeight) continue;
      mask[py * sourceWidth + px] = val;
    }
  }
}

function computeMagicSelection(x, y) {
  if (x < 0 || x >= sourceWidth || y < 0 || y >= sourceHeight) return null;
  const src = sourceImageData.data;
  const w = sourceWidth;
  const h = sourceHeight;
  const tol = magicTolerance;
  const selection = new Uint8Array(w * h);

  const idx0 = (y * w + x) * 4;
  const tr = src[idx0], tg = src[idx0 + 1], tb = src[idx0 + 2];

  function colorMatch(i) {
    const dr = src[i] - tr;
    const dg = src[i + 1] - tg;
    const db = src[i + 2] - tb;
    return Math.sqrt(dr * dr + dg * dg + db * db) <= tol * 2.55;
  }

  if (magicContiguous) {
    const visited = new Uint8Array(w * h);
    const stack = [x + y * w];
    visited[x + y * w] = 1;
    while (stack.length > 0) {
      const p = stack.pop();
      const px = p % w;
      const py = (p - px) / w;
      if (colorMatch(p * 4)) {
        selection[p] = 1;
        if (px > 0     && !visited[p - 1]) { visited[p - 1] = 1; stack.push(p - 1); }
        if (px < w - 1 && !visited[p + 1]) { visited[p + 1] = 1; stack.push(p + 1); }
        if (py > 0     && !visited[p - w]) { visited[p - w] = 1; stack.push(p - w); }
        if (py < h - 1 && !visited[p + w]) { visited[p + w] = 1; stack.push(p + w); }
      }
    }
  } else {
    for (let p = 0; p < w * h; p++) {
      if (colorMatch(p * 4)) selection[p] = 1;
    }
  }
  return selection;
}

function magicWandAt(x, y) {
  const selection = computeMagicSelection(x, y);
  if (!selection) return;
  ensureMask(maskLayerIdx);
  const mask = masks[maskLayerIdx];
  for (let p = 0; p < selection.length; p++) {
    if (selection[p]) mask[p] = 0;
  }
}

let magicPreview = null; // current hover preview selection
let magicPreviewTimer = null;

function drawMagicPreview() {
  if (!magicPreview) return;
  const ctx = maskOverlay.getContext('2d');
  // Draw on top of existing mask overlay
  drawMaskOverlay();
  const imgData = ctx.getImageData(0, 0, sourceWidth, sourceHeight);
  const d = imgData.data;
  for (let p = 0; p < magicPreview.length; p++) {
    if (!magicPreview[p]) continue;
    const idx = p * 4;
    // Red highlight for area that will be erased
    d[idx]     = Math.min(255, d[idx] + 200);
    d[idx + 1] = Math.max(0, d[idx + 1] - 50);
    d[idx + 2] = Math.max(0, d[idx + 2] - 50);
    d[idx + 3] = Math.max(d[idx + 3], 120);
  }
  ctx.putImageData(imgData, 0, 0);
}

function clearMagicPreview() {
  if (magicPreview) {
    magicPreview = null;
    drawMaskOverlay();
  }
}

function updateSourcePreview() {
  if (!sourceImageData) return;
  const ctx = sourceCanvas.getContext('2d');
  const activeViews = showColorLayers
    .map((on, i) => on ? i : -1)
    .filter(i => i >= 0);

  if (activeViews.length === 0) {
    ctx.putImageData(sourceImageData, 0, 0);
    return;
  }

  const layerDatas = activeViews.map(i => {
    const mask = maskingEnabled ? masks[i] : null;
    return applyRisoColor(sourceImageData, layers[i].color.rgb, mask);
  });

  const composite = blendAllLayers(layerDatas);
  ctx.putImageData(composite, 0, 0);
}

function drawMaskOverlay() {
  const ctx = maskOverlay.getContext('2d');
  ctx.clearRect(0, 0, sourceWidth, sourceHeight);
  if (!maskingEnabled) return;

  const imgData = ctx.createImageData(sourceWidth, sourceHeight);
  const d = imgData.data;

  // Only show the currently selected layer's mask
  const mask = masks[maskLayerIdx];
  if (!mask) { ctx.putImageData(imgData, 0, 0); return; }
  const [r, g, b] = layers[maskLayerIdx].color.rgb;
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] === 0) continue;
    const idx = p * 4;
    d[idx]     = Math.round(r * 0.4);
    d[idx + 1] = Math.round(g * 0.4);
    d[idx + 2] = Math.round(b * 0.4);
    d[idx + 3] = 100;
  }

  ctx.putImageData(imgData, 0, 0);
}

maskOverlay.addEventListener('pointerdown', e => {
  if (!maskingEnabled || !sourceImageData) return;
  const { x, y } = canvasCoords(e);

  if (activeTool === 'magic') {
    clearMagicPreview();
    magicWandAt(x, y);
    drawMaskOverlay();
    updateSourcePreview();
    render();
    return;
  }

  painting = true;
  maskOverlay.setPointerCapture(e.pointerId);
  paintAt(x, y);
  drawMaskOverlay();
});

maskOverlay.addEventListener('pointermove', e => {
  if (!maskingEnabled || !sourceImageData) return;

  if (activeTool === 'magic' && !painting) {
    // Debounced hover preview for magic wand
    clearTimeout(magicPreviewTimer);
    magicPreviewTimer = setTimeout(() => {
      const { x, y } = canvasCoords(e);
      magicPreview = computeMagicSelection(x, y);
      drawMagicPreview();
    }, 60);
    return;
  }

  if (!painting) return;
  const { x, y } = canvasCoords(e);
  paintAt(x, y);
  drawMaskOverlay();
});

maskOverlay.addEventListener('pointerup', () => {
  if (painting) {
    painting = false;
    updateSourcePreview();
    render();
  }
});

maskOverlay.addEventListener('pointercancel', () => {
  painting = false;
});

maskOverlay.addEventListener('pointerleave', () => {
  clearMagicPreview();
});

/* ── Mask controls ───────────────────────────────────────────── */
maskToggle.addEventListener('change', () => {
  maskingEnabled = maskToggle.checked;
  maskControls.classList.toggle('hidden', !maskingEnabled);
  uploadZone.classList.toggle('mask-active', maskingEnabled);
  drawMaskOverlay();
  updateSourcePreview();
  render();
  requestAnimationFrame(syncOverlayPosition);
});

maskLayerSel.addEventListener('change', () => {
  maskLayerIdx = parseInt(maskLayerSel.value, 10);
  drawMaskOverlay();
  updateSourcePreview();
});

colorLayerChecks.forEach(cb => {
  cb.addEventListener('change', () => {
    const idx = parseInt(cb.value, 10);
    showColorLayers[idx] = cb.checked;
    updateSourcePreview();
  });
});

brushSizeEl.addEventListener('input', () => {
  brushSize = parseInt(brushSizeEl.value, 10);
  brushSizeVal.textContent = brushSize;
});

function setTool(tool) {
  activeTool = tool;
  toolBrushBtn.classList.toggle('active', tool === 'brush');
  toolEraserBtn.classList.toggle('active', tool === 'eraser');
  toolMagicBtn.classList.toggle('active', tool === 'magic');
  brushSizeField.style.display = tool === 'magic' ? 'none' : '';
  toleranceField.style.display = tool === 'magic' ? '' : 'none';
  contiguousField.style.display = tool === 'magic' ? '' : 'none';
}

toolBrushBtn.addEventListener('click', () => setTool('brush'));
toolEraserBtn.addEventListener('click', () => setTool('eraser'));
toolMagicBtn.addEventListener('click', () => setTool('magic'));

toleranceEl.addEventListener('input', () => {
  magicTolerance = parseInt(toleranceEl.value, 10);
  toleranceVal.textContent = magicTolerance;
});

contiguousEl.addEventListener('change', () => {
  magicContiguous = contiguousEl.checked;
});

maskClearBtn.addEventListener('click', () => {
  masks = [null, null, null];
  drawMaskOverlay();
  render();
  showToast('Masks cleared.', 'info');
});

/* ── Render pipeline ─────────────────────────────────────────── */
function hasMasks() {
  return maskingEnabled && masks.some(m => m !== null);
}

function disabledMsg(ctx, w, h, label) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ccc';
  ctx.font = '14px Georgia';
  ctx.textAlign = 'center';
  ctx.fillText(`${label} disabled`, w / 2, h / 2);
}

function render() {
  if (!sourceImageData) return;

  const useMasks = hasMasks();
  const layerDatas = [];

  for (let i = 0; i < 3; i++) {
    const canvas = canvases[i];
    const card = canvas.closest('.preview-card');

    if (!layers[i].enabled) {
      disabledMsg(canvas.getContext('2d'), canvas.width, canvas.height, `Layer ${i + 1}`);
      card.style.opacity = '0.5';
      layerDatas.push(null);
      continue;
    }

    card.style.opacity = '1';
    const mask = useMasks ? masks[i] : null;
    const data = applyRisoColor(sourceImageData, layers[i].color.rgb, mask);
    canvas.getContext('2d').putImageData(data, 0, 0);
    layerDatas.push(data);
  }

  // Overprint composite
  const composite = blendAllLayers(layerDatas);
  if (composite) {
    canvasOut.getContext('2d').putImageData(composite, 0, 0);
  }
}

/* ── Layer toggles ───────────────────────────────────────────── */
for (let i = 1; i < 3; i++) {
  layerToggles[i].addEventListener('change', () => {
    layers[i].enabled = layerToggles[i].checked;
    render();
  });
}

/* ── Downloads ───────────────────────────────────────────────── */
function downloadCanvas(canvas, filename) {
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast('PNG downloaded!', 'info');
  }, 'image/png');
}

function colorSlug(color) {
  return color.name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

for (let i = 0; i < 3; i++) {
  btnDownloads[i].addEventListener('click', () => {
    if (!sourceImageData) return;
    if (!layers[i].enabled) {
      showToast(`Layer ${i + 1} is disabled.`, 'error');
      return;
    }
    downloadCanvas(canvases[i], `riso-layer${i + 1}-${colorSlug(layers[i].color)}.png`);
  });
}

function generatePlate(layerIdx) {
  const { width, height } = sourceImageData;
  const src = sourceImageData.data;
  const mask = (maskingEnabled && masks[layerIdx]) ? masks[layerIdx] : null;
  const out = new ImageData(width, height);
  const dst = out.data;

  for (let i = 0; i < src.length; i += 4) {
    const lum = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    let density = 1 - lum / 255; // dark = more ink
    if (mask) {
      density *= mask[i >> 2] / 255;
    }
    // Black = ink, White = no ink
    const val = Math.round(255 - density * 255);
    dst[i] = val;
    dst[i + 1] = val;
    dst[i + 2] = val;
    dst[i + 3] = 255;
  }
  return out;
}

for (let i = 0; i < 3; i++) {
  btnPlates[i].addEventListener('click', () => {
    if (!sourceImageData) return;
    if (!layers[i].enabled) {
      showToast(`Layer ${i + 1} is disabled.`, 'error');
      return;
    }
    const plate = generatePlate(i);
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = sourceWidth;
    tmpCanvas.height = sourceHeight;
    tmpCanvas.getContext('2d').putImageData(plate, 0, 0);
    downloadCanvas(tmpCanvas, `riso-plate-layer${i + 1}-${colorSlug(layers[i].color)}.png`);
  });
}

btnDownload.addEventListener('click', () => {
  if (!sourceImageData) return;
  const names = layers.filter(l => l.enabled).map(l => colorSlug(l.color)).join('-');
  downloadCanvas(canvasOut, `riso-overprint-${names}.png`);
});

btnClear.addEventListener('click', () => {
  sourceImageData = null;
  sourceCanvas.style.display = 'none';
  maskOverlay.style.display = 'none';
  uploadPrompt.style.display = '';
  uploadZone.classList.remove('has-image');
  uploadZone.classList.remove('mask-active');
  viewBar.classList.add('hidden');
  controls.classList.add('hidden');
  preview.classList.add('hidden');
  actions.classList.add('hidden');
  maskSection.classList.add('hidden');
  masks = [null, null, null];
  maskingEnabled = false;
  maskToggle.checked = false;
  maskControls.classList.add('hidden');
  showColorLayers = [false, false, false];
  colorLayerChecks.forEach(cb => { cb.checked = false; });
  fileInput.value = '';
});
