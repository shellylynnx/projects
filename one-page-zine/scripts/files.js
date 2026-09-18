// files.js — File handling, validation, and client-side image compression

import { showToast } from './ui.js';
import { getCellSize } from './canvas.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif'];

// Pixels needed per panel at 300 DPI on the largest supported page size
const MAX_CELL = getCellSize('tabloid');

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
 * Whether an image has fewer pixels than a panel needs to print crisply at
 * 300 DPI on the given page size. It will still be used if the caller allows
 * it — this only flags the risk of a blurry result from upscaling.
 */
export function isLowRes(img, size = 'letter') {
  const cell = getCellSize(size);
  return img.naturalWidth < cell.width || img.naturalHeight < cell.height;
}

/**
 * Downscale an image that is far larger than a panel needs, keeping enough
 * pixels to cover the largest panel (tabloid) in both dimensions.
 * Returns a Promise that resolves with a (possibly smaller) data URL.
 */
function compressImage(img, dataUrl) {
  // Scale at which the image exactly covers a tabloid panel (cover-fit needs both dimensions)
  const scale = Math.max(
    MAX_CELL.width / img.naturalWidth,
    MAX_CELL.height / img.naturalHeight
  );

  // Only downscale if the image is significantly larger than needed (2x threshold)
  if (scale * 2 >= 1) {
    return Promise.resolve(dataUrl);
  }

  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
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
