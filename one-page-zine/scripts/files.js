// files.js — File handling, validation, and client-side image compression

import { showToast } from './ui.js';
import { PAGE_W, PAGE_H, COLS, ROWS } from './canvas.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif'];

// Maximum pixel dimensions needed per cell at 150 DPI
const MAX_CELL_W = PAGE_W / COLS;
const MAX_CELL_H = PAGE_H / ROWS;

/**
 * Validate a file before processing.
 * Returns an error string or null if valid.
 */
export function validateFile(file) {
  if (!file) return 'No file selected.';
  if (!ALLOWED_TYPES.includes(file.type)) {
    return `Invalid file type "${file.type || 'unknown'}". Please use JPEG, PNG, or GIF.`;
  }
  if (file.size > MAX_FILE_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return `File is too large (${sizeMB} MB). Maximum size is 10 MB.`;
  }
  return null;
}

/**
 * Downscale an image if it exceeds the needed cell resolution.
 * Returns a Promise that resolves with a (possibly smaller) data URL.
 */
function compressImage(img, dataUrl) {
  // Only downscale if image is significantly larger than needed (2x threshold)
  if (img.naturalWidth <= MAX_CELL_W * 2 && img.naturalHeight <= MAX_CELL_H * 2) {
    return Promise.resolve(dataUrl);
  }

  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const scale = Math.min(
      (MAX_CELL_W * 2) / img.naturalWidth,
      (MAX_CELL_H * 2) / img.naturalHeight
    );
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);

    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Use JPEG for compression unless original was PNG with transparency
    resolve(canvas.toDataURL('image/jpeg', 0.85));
  });
}

/**
 * Read and process a file. Returns a Promise resolving to { img, dataUrl }.
 */
export function processFile(file) {
  return new Promise((resolve, reject) => {
    const error = validateFile(file);
    if (error) {
      reject(new Error(error));
      return;
    }

    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error('Failed to read the file. It may be corrupted.'));
    };

    reader.onload = (e) => {
      const dataUrl = e.target.result;
      const img = new Image();

      img.onerror = () => {
        reject(new Error('Failed to load image. The file may be corrupted or not a valid image.'));
      };

      img.onload = () => {
        compressImage(img, dataUrl)
          .then((compressedDataUrl) => {
            if (compressedDataUrl !== dataUrl) {
              // Re-create image from compressed data
              const compImg = new Image();
              compImg.onload = () => resolve({ img: compImg, dataUrl: compressedDataUrl });
              compImg.onerror = () => resolve({ img, dataUrl }); // fallback to original
              compImg.src = compressedDataUrl;
            } else {
              resolve({ img, dataUrl });
            }
          })
          .catch(() => resolve({ img, dataUrl })); // fallback on compression error
      };

      img.src = dataUrl;
    };

    reader.readAsDataURL(file);
  });
}

export { ALLOWED_TYPES, MAX_FILE_SIZE };
