// Node-only helper for looking at sprites while developing: writes PixelBuffers to a PNG file. Not imported by the app.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { PixelBuffer, type Rgba } from '../types.ts';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc(bytes: Uint8Array) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); out.set(data, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Saves `buf` enlarged `scale` times (whole pixels) over `background`. */
export function savePng(path: string, buf: PixelBuffer, scale = 4, background: Rgba = 0x2a2a31ff) {
  const w = buf.w * scale, h = buf.h * scale, bytes = buf.toBytes();
  const raw = Buffer.alloc((w * 4 + 1) * h);
  const bg = [background >>> 24, (background >>> 16) & 255, (background >>> 8) & 255];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (Math.floor(y / scale) * buf.w + Math.floor(x / scale)) * 4, d = y * (w * 4 + 1) + 1 + x * 4, a = bytes[s + 3]! / 255;
    for (let k = 0; k < 3; k++) raw[d + k] = Math.round(bytes[s + k]! * a + bg[k]! * (1 - a));
    raw[d + 3] = 255;
  }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head.set([8, 6, 0, 0, 0], 8);
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]));
}

/** Lays buffers out in a grid with `gap` pixels between them, for contact sheets. */
export function sheet(items: PixelBuffer[], columns: number, gap = 2): PixelBuffer {
  const cw = Math.max(...items.map(b => b.w)), ch = Math.max(...items.map(b => b.h)), rows = Math.ceil(items.length / columns);
  const out = new PixelBuffer(columns * (cw + gap) + gap, rows * (ch + gap) + gap);
  items.forEach((b, i) => out.blit(b, gap + (i % columns) * (cw + gap), gap + Math.floor(i / columns) * (ch + gap) + (ch - b.h)));
  return out;
}
