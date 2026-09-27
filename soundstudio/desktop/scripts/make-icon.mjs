// Draws app-icon.png (1024x1024): the app's amber on dark, with five sound bars.
// `npm run icons` (tauri icon) turns it into every platform's icon sizes.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const S = 1024, px = Buffer.alloc(S * S * 4);
const bg = [0x12, 0x1c, 0x1f], amber = [0xf0, 0xa2, 0x38];
const inRound = (x, y, x0, y0, x1, y1, r) => {
  if(x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x1 - r, x)), cy = Math.max(y0 + r, Math.min(y1 - r, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const bars = [260, 470, 640, 470, 330].map((h, i) => ({ x0: 232 + i * 124, x1: 232 + i * 124 + 76, h }));
for(let y = 0; y < S; y++) for(let x = 0; x < S; x++){
  const o = (y * S + x) * 4; let c = null;
  if(inRound(x, y, 64, 64, 960, 960, 200)) c = bg;
  for(const b of bars) if(inRound(x, y, b.x0, 512 - b.h / 2, b.x1, 512 + b.h / 2, 38)) c = amber;
  if(c){ px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255; }
}
const raw = Buffer.alloc(S * (S * 4 + 1));
for(let y = 0; y < S; y++){ raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for(const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(new URL('../app-icon.png', import.meta.url), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('app-icon.png written');
