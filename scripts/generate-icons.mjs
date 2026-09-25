import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const outputDir = path.resolve('assets');
fs.mkdirSync(outputDir, { recursive: true });

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function roundedRectDistance(x, y, left, top, right, bottom, radius) {
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  return Math.hypot(x - cx, y - cy) - radius;
}

function render(size) {
  const scale = 4;
  const large = size * scale;
  const pixels = Buffer.alloc(size * size * 4);
  const samples = scale * scale;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let red = 0, green = 0, blue = 0, alpha = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const x = px * scale + sx + 0.5;
          const y = py * scale + sy + 0.5;
          const pad = large * 0.07;
          const inside = roundedRectDistance(x, y, pad, pad, large - pad, large - pad, large * 0.22) <= 0;
          if (!inside) continue;

          const blend = (x + y) / (large * 2);
          let r = 169 + (93 - 169) * blend;
          let g = 244 + (205 - 244) * blend;
          let b = 219 + (170 - 219) * blend;
          const inTop = x >= large * 0.28 && x <= large * 0.72 && y >= large * 0.29 && y <= large * 0.38;
          const inStem = x >= large * 0.455 && x <= large * 0.545 && y >= large * 0.31 && y <= large * 0.72;
          const inBase = x >= large * 0.35 && x <= large * 0.65 && y >= large * 0.64 && y <= large * 0.73;
          if (inTop || inStem || inBase) { r = 15; g = 38; b = 30; }

          red += r; green += g; blue += b; alpha += 255;
        }
      }
      const pixel = (py * size + px) * 4;
      if (alpha) {
        pixels[pixel] = Math.round(red / (alpha / 255));
        pixels[pixel + 1] = Math.round(green / (alpha / 255));
        pixels[pixel + 2] = Math.round(blue / (alpha / 255));
        pixels[pixel + 3] = Math.round(alpha / samples);
      }
    }
  }

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    pixels.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((size) => ({ size, png: render(size) }));
for (const { size, png } of images) fs.writeFileSync(path.join(outputDir, `icon-${size}.png`), png);
fs.writeFileSync(path.join(outputDir, 'tray-icon.png'), images.find(({ size }) => size === 32).png);

const header = Buffer.alloc(6 + images.length * 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach(({ size, png }, index) => {
  const entry = 6 + index * 16;
  header[entry] = size === 256 ? 0 : size;
  header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
fs.writeFileSync(path.join(outputDir, 'icon.ico'), Buffer.concat([header, ...images.map(({ png }) => png)]));

