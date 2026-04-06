/* ── engine.js ── Riso color processing & overprint simulation ── */

/**
 * Convert an image to a single riso ink color layer.
 * Process: convert to grayscale, then map luminance to ink density.
 * Dark areas = more ink, light areas = less ink (paper shows through).
 *
 * @param {ImageData} sourceData - Original image pixel data
 * @param {number[]} inkRGB - [r, g, b] of the riso ink color
 * @param {Uint8Array|null} mask - Optional mask (0–255 per pixel). null = full image.
 * @returns {ImageData} - Tinted single-color layer
 */
export function applyRisoColor(sourceData, inkRGB, mask = null) {
  const { width, height } = sourceData;
  const src = sourceData.data;
  const out = new ImageData(width, height);
  const dst = out.data;
  const [ir, ig, ib] = inkRGB;

  for (let i = 0; i < src.length; i += 4) {
    const lum = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    let density = 1 - lum / 255;
    if (mask) {
      density *= mask[i >> 2] / 255;
    }
    dst[i]     = Math.round(255 - density * (255 - ir));
    dst[i + 1] = Math.round(255 - density * (255 - ig));
    dst[i + 2] = Math.round(255 - density * (255 - ib));
    dst[i + 3] = src[i + 3];
  }
  return out;
}

/**
 * Multiply-blend an array of riso layers together.
 *
 * @param {(ImageData|null)[]} layers - Array of layers (nulls are skipped)
 * @returns {ImageData} - Composited result
 */
export function blendAllLayers(layers) {
  const active = layers.filter(Boolean);
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];

  const { width, height } = active[0];
  const out = new ImageData(width, height);
  const dst = out.data;

  // Start with first layer
  dst.set(active[0].data);

  // Multiply-blend each subsequent layer
  for (let l = 1; l < active.length; l++) {
    const src = active[l].data;
    for (let i = 0; i < dst.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        dst[i + c] = Math.round(dst[i + c] / 255 * src[i + c]);
      }
      dst[i + 3] = Math.max(dst[i + 3], src[i + 3]);
    }
  }
  return out;
}
