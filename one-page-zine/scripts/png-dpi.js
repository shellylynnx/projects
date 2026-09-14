// png-dpi.js — Embed a physical DPI (pHYs chunk) into a canvas-exported PNG.
//
// canvas.toDataURL('image/png') never writes pixel-density metadata, so image
// viewers, Photoshop, and print software fall back to assuming 72 DPI no matter
// how many pixels the file actually has. This inserts the missing pHYs chunk
// so the exported file reports its real DPI.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUInt32BE(value, target, offset) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

/**
 * Returns a new PNG data URL with a pHYs chunk set for the given DPI.
 */
export function setPngDpi(dataUrl, dpi) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const pixelsPerMeter = Math.round(dpi / 0.0254);

  const typeAndData = new Uint8Array(4 + 9);
  typeAndData.set([0x70, 0x48, 0x59, 0x73], 0); // 'pHYs'
  writeUInt32BE(pixelsPerMeter, typeAndData, 4);
  writeUInt32BE(pixelsPerMeter, typeAndData, 8);
  typeAndData[12] = 1; // unit specifier: 1 = meter

  const crc = crc32(typeAndData);

  const chunk = new Uint8Array(4 + typeAndData.length + 4);
  writeUInt32BE(9, chunk, 0); // data length (excludes type)
  chunk.set(typeAndData, 4);
  writeUInt32BE(crc, chunk, 4 + typeAndData.length);

  // IHDR is always the first chunk: 8-byte signature + 4(len) + 4(type) + 13(data) + 4(crc) = 33 bytes.
  const insertAt = 33;
  const result = new Uint8Array(bytes.length + chunk.length);
  result.set(bytes.subarray(0, insertAt), 0);
  result.set(chunk, insertAt);
  result.set(bytes.subarray(insertAt), insertAt + chunk.length);

  let resultBinary = '';
  for (let i = 0; i < result.length; i++) resultBinary += String.fromCharCode(result[i]);
  return 'data:image/png;base64,' + btoa(resultBinary);
}
