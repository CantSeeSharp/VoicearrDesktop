/**
 * Generates a 16x16 red circle badge PNG for the Windows taskbar overlay icon.
 * Uses only Node.js built-in modules (zlib, fs, path).
 * Run: node scripts/create-badge.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length, 0);
  const crcVal = crc32(Buffer.concat([typeBytes, data]));
  const crcBytes = Buffer.allocUnsafe(4);
  crcBytes.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeBytes, data, crcBytes]);
}

const SIZE = 16;
const cx = (SIZE - 1) / 2;
const radius = (SIZE / 2) - 0.5;

// Build RGBA pixel data
const pixels = new Uint8Array(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = x - cx;
    const dy = y - cx;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const i = (y * SIZE + x) * 4;
    if (dist <= radius) {
      pixels[i]     = 220; // R
      pixels[i + 1] = 38;  // G
      pixels[i + 2] = 38;  // B
      pixels[i + 3] = 255; // A
    }
    // else: transparent (already zero)
  }
}

// Build raw PNG image data (filter byte 0x00 per row + RGBA pixels)
const rowLen = 1 + SIZE * 4;
const raw = Buffer.alloc(SIZE * rowLen);
for (let y = 0; y < SIZE; y++) {
  raw[y * rowLen] = 0; // None filter
  for (let x = 0; x < SIZE; x++) {
    const src = (y * SIZE + x) * 4;
    const dst = y * rowLen + 1 + x * 4;
    raw[dst]     = pixels[src];
    raw[dst + 1] = pixels[src + 1];
    raw[dst + 2] = pixels[src + 2];
    raw[dst + 3] = pixels[src + 3];
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);  // width
ihdr.writeUInt32BE(SIZE, 4);  // height
ihdr[8]  = 8; // bit depth
ihdr[9]  = 6; // color type: RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const compressed = zlib.deflateSync(raw);

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', compressed),
  pngChunk('IEND', Buffer.alloc(0)),
]);

const outPath = path.join(__dirname, '..', 'resources', 'badge.png');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, png);
console.log('Badge icon created:', outPath);
