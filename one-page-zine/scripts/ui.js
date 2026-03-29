// ui.js — Toast notifications and UI state updates

const TOTAL = 8;
let toastTimeout = null;

/**
 * Show a toast notification that auto-dismisses.
 */
export function showToast(message, type = 'error', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }

  // Remove any existing toast
  const existing = container.querySelector('.toast');
  if (existing) existing.remove();
  if (toastTimeout) clearTimeout(toastTimeout);

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'alert');
  toast.textContent = message;
  container.appendChild(toast);

  // Trigger reflow for animation
  toast.offsetHeight; // eslint-disable-line no-unused-expressions
  toast.classList.add('toast-visible');

  toastTimeout = setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Update the page count text and button disabled states.
 */
export function updateUI(images) {
  const countEl = document.getElementById('count');
  const downloadBtn = document.getElementById('downloadBtn');
  const downloadImgBtn = document.getElementById('downloadImgBtn');

  const filled = images.filter(Boolean).length;
  countEl.textContent = `${filled} / ${TOTAL} pages uploaded`;
  const ready = filled >= TOTAL;
  downloadBtn.disabled = !ready;
  downloadImgBtn.disabled = !ready;
}
