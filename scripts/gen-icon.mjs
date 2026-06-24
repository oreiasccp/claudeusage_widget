// Generates icons/source.png — a 512px rounded-square app icon:
// warm near-black field, a 3/4 clay-orange ring, a clay center dot.
// Pure Node (zlib), no deps. Feed it to `npx tauri icon icons/source.png`.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIZE = 512;
const out = join(__dirname, "..", "icons");
mkdirSync(out, { recursive: true });

// ---- palette ----
const BG = [0x16, 0x10, 0x0e]; // near-black warm
const CLAY = [0xd9, 0x77, 0x57];
const CLAY_HI = [0xe8, 0x91, 0x6f];

const buf = Buffer.alloc(SIZE * SIZE * 4); // RGBA

const cx = SIZE / 2;
const cy = SIZE / 2;
const cornerR = 112; // rounded-square radius
const ringMid = 168; // ring center radius
const ringHalf = 26; // ring thickness / 2

// Rounded-square coverage (1 inside, 0 outside) with AA.
function squareAlpha(x, y) {
  const m = 16; // margin
  const lo = m, hi = SIZE - m;
  // distance "outside" the rounded rect
  const dx = Math.max(lo + cornerR - x, 0, x - (hi - cornerR));
  const dy = Math.max(lo + cornerR - y, 0, y - (hi - cornerR));
  // straight edges
  const ex = Math.max(lo - x, 0, x - hi);
  const ey = Math.max(lo - y, 0, y - hi);
  if (ex > 0 || ey > 0) {
    const d = Math.hypot(ex, ey);
    return clamp01(1 - d);
  }
  const dCorner = Math.hypot(dx, dy);
  if (dx > 0 && dy > 0) return clamp01(1 - (dCorner - cornerR));
  return 1;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    const sa = squareAlpha(x + 0.5, y + 0.5);
    if (sa <= 0) {
      buf[i + 3] = 0;
      continue;
    }
    // base field with subtle top-light gradient
    const grad = clamp01((y / SIZE) * 0.5);
    let col = mix([0x24, 0x1c, 0x17], BG, grad);

    // ring: arc from -135deg sweeping 270deg (3/4)
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    const r = Math.hypot(dx, dy);
    const band = ringHalf - Math.abs(r - ringMid); // >0 inside band
    if (band > -1.5) {
      let ang = Math.atan2(dy, dx); // -PI..PI
      // rotate so the gap sits at bottom; sweep 270deg
      let a = (ang + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2); // 0..2PI from top, clockwise-ish
      const sweep = Math.PI * 1.5; // 270deg
      const inArc = a <= sweep;
      const edgeAA = clamp01(band + 1); // anti-alias band edges
      if (inArc && edgeAA > 0) {
        const t = a / sweep; // 0..1 along arc
        const ringCol = mix(CLAY, CLAY_HI, t);
        col = mix(col, ringCol, edgeAA);
      }
    }

    // center dot
    const dr = 30 - r;
    if (dr > -1.5) {
      col = mix(col, CLAY_HI, clamp01(dr + 1));
    }

    buf[i] = Math.round(col[0]);
    buf[i + 1] = Math.round(col[1]);
    buf[i + 2] = Math.round(col[2]);
    buf[i + 3] = Math.round(sa * 255);
  }
}

writeFileSync(join(out, "source.png"), encodePNG(buf, SIZE, SIZE));
console.log("wrote icons/source.png (" + SIZE + "x" + SIZE + ")");

// ---- minimal PNG encoder (RGBA, color type 6) ----
function encodePNG(rgba, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // raw scanlines, filter byte 0 per row
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}
