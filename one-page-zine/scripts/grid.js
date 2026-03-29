// grid.js — Grid building and slot management

import { processFile, ALLOWED_TYPES } from './files.js';
import { showToast, updateUI } from './ui.js';
import { saveImage, removeStoredImage, loadAllData } from './storage.js';

const TOTAL = 8;
const LABELS = ['Page 6', 'Page 5', 'Page 4', 'Page 3', 'Back Cover', 'Front Cover', 'Page 1', 'Page 2'];

let images = new Array(TOTAL).fill(null);

export function getImages() {
  return images;
}

/**
 * Build the upload grid with accessible slots.
 */
export function buildGrid() {
  const grid = document.getElementById('grid');
  grid.setAttribute('role', 'list');
  grid.setAttribute('aria-label', 'Zine page upload slots');

  for (let i = 0; i < TOTAL; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.index = i;
    slot.setAttribute('role', 'listitem');
    slot.setAttribute('tabindex', '0');
    slot.setAttribute('aria-label', `${LABELS[i]} — click or drag to upload image`);

    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = LABELS[i];
    num.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'Click or drag image';
    label.setAttribute('aria-hidden', 'true');

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif';
    input.setAttribute('aria-label', `Upload image for ${LABELS[i]}`);
    input.addEventListener('change', (e) => handleFile(i, e.target.files[0]));

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove';
    removeBtn.textContent = '\u00d7';
    removeBtn.title = 'Remove image';
    removeBtn.setAttribute('aria-label', `Remove image from ${LABELS[i]}`);
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeImage(i); });

    slot.appendChild(num);
    slot.appendChild(label);
    slot.appendChild(input);
    slot.appendChild(removeBtn);

    // Keyboard activation: Enter or Space triggers file input
    slot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (images[i]) {
          // If filled, remove and let them re-upload
          removeImage(i);
        } else {
          input.click();
        }
      }
    });

    // Drag-and-drop
    slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('dragover'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('dragover'));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) handleFile(i, file);
    });

    grid.appendChild(slot);
  }
}

/**
 * Handle a file upload for a given slot index.
 */
function handleFile(index, file) {
  if (!file) return;

  processFile(file)
    .then(({ img, dataUrl }) => {
      images[index] = img;
      renderSlot(index, dataUrl);
      saveImage(index, dataUrl);
      updateUI(images);
    })
    .catch((err) => {
      showToast(err.message, 'error');
    });
}

/**
 * Render a preview image in a slot.
 */
function renderSlot(index, src) {
  const grid = document.getElementById('grid');
  const slot = grid.children[index];
  const existing = slot.querySelector('img');
  if (existing) existing.remove();

  const preview = document.createElement('img');
  preview.src = src;
  preview.alt = `Preview for ${LABELS[index]}`;
  slot.insertBefore(preview, slot.querySelector('.remove'));
  slot.classList.add('filled');
  slot.setAttribute('aria-label', `${LABELS[index]} — image uploaded. Press Enter to remove.`);
}

/**
 * Remove an image from a slot.
 */
function removeImage(index) {
  images[index] = null;
  const grid = document.getElementById('grid');
  const slot = grid.children[index];
  const img = slot.querySelector('img');
  if (img) img.remove();
  slot.classList.remove('filled');
  slot.setAttribute('aria-label', `${LABELS[index]} — click or drag to upload image`);

  const input = slot.querySelector('input[type="file"]');
  input.value = '';

  removeStoredImage(index);
  updateUI(images);
}

/**
 * Restore images from localStorage on page load.
 */
export function restoreFromStorage() {
  const stored = loadAllData();
  let restoredCount = 0;

  stored.forEach((dataUrl, index) => {
    if (!dataUrl) return;

    const img = new Image();
    img.onload = () => {
      images[index] = img;
      renderSlot(index, dataUrl);
      updateUI(images);
      restoredCount++;
    };
    img.onerror = () => {
      // Corrupted storage entry — clean it up
      removeStoredImage(index);
    };
    img.src = dataUrl;
  });
}

/**
 * Clear all images and reset the grid.
 */
export function clearAll() {
  const grid = document.getElementById('grid');
  for (let i = 0; i < TOTAL; i++) {
    images[i] = null;
    const slot = grid.children[i];
    const img = slot.querySelector('img');
    if (img) img.remove();
    slot.classList.remove('filled');
    slot.setAttribute('aria-label', `${LABELS[i]} — click or drag to upload image`);
    const input = slot.querySelector('input[type="file"]');
    input.value = '';
  }
  updateUI(images);
}
