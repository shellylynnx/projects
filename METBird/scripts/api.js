/* ── api.js ── MET API calls, caching, retry logic ────────────── */

import { showToast } from './ui.js';

export const fetchObj = async (id, retries = 3) => {
  // Plate entries: fetch parent object, then overlay plate-specific data
  const plate = window.BIRD_PLATES?.[id];
  if (plate) {
    const parent = await fetchObj(plate.parentId, retries);
    if (!parent) return null;
    const obj = Object.assign({}, parent);
    obj.objectID = id;
    obj._plateParentId = plate.parentId;
    obj.primaryImage = plate.imageUrl;
    obj.primaryImageSmall = plate.imageUrl;
    // Keep parent title; plate caption shown separately
    obj._plateCaption = plate.caption;
    obj.objectURL = `https://www.metmuseum.org/art/collection/search/${plate.parentId}`;
    return obj;
  }
  const cacheKey = `met_${id}`;
  try { const c = sessionStorage.getItem(cacheKey); if (c) return JSON.parse(c); } catch {}
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const r = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (r.status === 429) {
        showToast('Rate limited by MET API. Retrying shortly...', 'warning');
        if (i < retries) { await new Promise(ok => setTimeout(ok, 2000 * (i + 1))); continue; }
        showToast('MET API rate limit exceeded. Some artworks may not load.', 'error');
        return null;
      }
      if (!r.ok) {
        if (i < retries) { await new Promise(ok => setTimeout(ok, 800 * (i + 1))); continue; }
        showToast(`Failed to load artwork #${id} (HTTP ${r.status}).`, 'error');
        return null;
      }
      const data = await r.json();
      if (data && data.objectID) {
        try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch {}
        return data;
      }
      if (i < retries) { await new Promise(ok => setTimeout(ok, 800 * (i + 1))); continue; }
      return null;
    } catch (err) {
      if (err.name === 'AbortError') {
        showToast(`Request timed out for artwork #${id}.`, 'warning');
      } else if (i === retries) {
        showToast(`Network error loading artwork #${id}. Check your connection.`, 'error');
      }
      if (i === retries) return null;
      await new Promise(ok => setTimeout(ok, 800 * (i + 1)));
    }
  }
  return null;
};
