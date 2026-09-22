'use strict';

/**
 * Generates solid brand-color placeholder PNG images (pure Node, no dependencies)
 * for every image path referenced by the app manifest that does not exist yet.
 * Replace these placeholders with real artwork before publishing.
 *
 * Usage: node scripts/generate-images.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BRAND_COLOR = [0x00, 0x91, 0xd8]; // #0091D8

// Required image paths and their exact Homey-required dimensions
const IMAGES = [
  { file: 'assets/images/small.png', width: 250, height: 175 },
  { file: 'assets/images/large.png', width: 500, height: 350 },
  { file: 'assets/images/xlarge.png', width: 1000, height: 700 },
  { file: 'drivers/temperature-sensor/assets/images/small.png', width: 75, height: 75 },
  { file: 'drivers/temperature-sensor/assets/images/large.png', width: 500, height: 500 },
  { file: 'drivers/motion-sensor/assets/images/small.png', width: 75, height: 75 },
  { file: 'drivers/motion-sensor/assets/images/large.png', width: 500, height: 500 },
  { file: 'drivers/switch/assets/images/small.png', width: 75, height: 75 },
  { file: 'drivers/switch/assets/images/large.png', width: 500, height: 500 },
  { file: 'drivers/dimmer/assets/images/small.png', width: 75, height: 75 },
  { file: 'drivers/dimmer/assets/images/large.png', width: 500, height: 500 },
  { file: 'drivers/contact-sensor/assets/images/small.png', width: 75, height: 75 },
  { file: 'drivers/contact-sensor/assets/images/large.png', width: 500, height: 500 },
  { file: 'drivers/binary-sensor/assets/images/small.png', width: 75, height: 75 },
  { file: 'drivers/binary-sensor/assets/images/large.png', width: 500, height: 500 },
  { file: 'drivers/window-covering/assets/images/small.png', width: 75, height: 75 },
  { file: 'drivers/window-covering/assets/images/large.png', width: 500, height: 500 },
  { file: 'drivers/garage-door/assets/images/small.png', width: 75, height: 75 },
  { file: 'drivers/garage-door/assets/images/large.png', width: 500, height: 500 },
  { file: 'drivers/lock/assets/images/small.png', width: 75, height: 75 },
  { file: 'drivers/lock/assets/images/large.png', width: 500, height: 500 },
  { file: 'drivers/button/assets/images/small.png', width: 75, height: 75 },
  { file: 'drivers/button/assets/images/large.png', width: 500, height: 500 },
  { file: 'drivers/light-sensor/assets/images/small.png', width: 75, height: 75 },
  { file: 'drivers/light-sensor/assets/images/large.png', width: 500, height: 500 },
  { file: 'drivers/humidity-sensor/assets/images/small.png', width: 75, height: 75 },
  { file: 'drivers/humidity-sensor/assets/images/large.png', width: 500, height: 500 },
];

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function createSolidPng(width, height, [r, g, b]) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Each scanline: filter byte (0) + width * 3 RGB bytes
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const root = path.join(__dirname, '..');
let created = 0;

for (const { file, width, height } of IMAGES) {
  const filePath = path.join(root, file);
  if (fs.existsSync(filePath)) {
    console.log(`= exists, skipping: ${file}`);
    continue;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, createSolidPng(width, height, BRAND_COLOR));
  console.log(`+ created ${file} (${width}x${height})`);
  created += 1;
}

console.log(created > 0 ? `\n${created} placeholder image(s) created.` : '\nAll images already exist.');
