// storage.js — localStorage persistence

import { showToast } from './ui.js';

const STORAGE_KEY = 'one-page-zine-images';
const TOTAL = 8;

/**
 * Save an image data URL to localStorage at a given index.
 */
export function saveImage(index, dataUrl) {
  try {
    const data = loadAllData();
    data[index] = dataUrl;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      showToast('Storage full. Image saved in memory only.', 'error');
    }
  }
}

/**
 * Remove an image from localStorage at a given index.
 */
export function removeStoredImage(index) {
  try {
    const data = loadAllData();
    data[index] = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // Silently ignore storage errors on removal
  }
}

/**
 * Load all stored data URLs from localStorage.
 * Returns an array of length TOTAL (null for empty slots).
 */
export function loadAllData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Array(TOTAL).fill(null);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== TOTAL) {
      return new Array(TOTAL).fill(null);
    }
    return parsed;
  } catch (e) {
    return new Array(TOTAL).fill(null);
  }
}

/**
 * Clear all stored image data.
 */
export function clearAllData() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // Silently ignore
  }
}
