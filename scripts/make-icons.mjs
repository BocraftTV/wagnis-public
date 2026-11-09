// Draws the app icons (a plain "W" on parchment) without any image library: the glyph is rasterized from a few
// line segments with 4x4 supersampling and written as PNG (node:zlib only). Colors come from styles/colors.css.
//   node scripts/make-icons.mjs           writes apps/client/public/icons/*.png
//   node scripts/make-icons.mjs --check   checks the committed files (signature, size, colors); no byte comparison
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const path = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const outDir = path("apps/client/public/icons");
const FILES = [
  { name: "apple-touch-icon.png", size: 180 },
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
];

const css = readFileSync(path("apps/client/src/styles/colors.css"), "utf8");
function color(name) {
  const m = css.match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`));
  if (!m) throw new Error(`colors.css has no --${name}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const paper = color("map-paper");
const ink = color("map-ink");
const frame = color("map-frame");

// Unit square coordinates; the glyph stays inside the middle ~60 %.
const W = [
  [0.22, 0.3],
  [0.36, 0.72],
  [0.5, 0.44],
  [0.64, 0.72],
  [0.78, 0.3],
];
const HALF_STROKE = 0.04;
const FRAME_INSET = 0.05;
const FRAME_WIDTH = 0.02;

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const inGlyph = (x, y) => W.slice(1).some((p, i) => segDist(x, y, W[i], p) <= HALF_STROKE);
const inFrame = (x, y) => {
  const edge = Math.min(x, y, 1 - x, 1 - y);
  return edge >= FRAME_INSET && edge <= FRAME_INSET + FRAME_WIDTH;
};

function raster(size) {
  const N = 4;
  const raw = Buffer.alloc((size * 4 + 1) * size); // filter byte 0 per row, RGBA
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const u = (x + (sx + 0.5) / N) / size;
          const v = (y + (sy + 0.5) / N) / size;
          const c = inGlyph(u, v) ? ink : inFrame(u, v) ? frame : paper;
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = Math.round(r / (N * N));
      raw[o + 1] = Math.round(g / (N * N));
      raw[o + 2] = Math.round(b / (N * N));
      raw[o + 3] = 255; // fully opaque: iOS fills transparency with black
    }
  }
  return raw;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bit, RGBA, deflate, no filter method change, no interlace
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raster(size), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function check() {
  let bad = 0;
  const fail = (msg) => {
    console.error(`FAIL ${msg}`);
    bad++;
  };
  for (const { name, size } of FILES) {
    const file = `${outDir}/${name}`;
    if (!existsSync(file)) {
      fail(`${name} missing`);
      continue;
    }
    const buf = readFileSync(file);
    if (!buf.subarray(0, 8).equals(SIGNATURE)) {
      fail(`${name} is not a PNG`);
      continue;
    }
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    if (w !== size || h !== size) fail(`${name} is ${w}x${h}, expected ${size}x${size}`);
    // Decode the IDAT chunks (filter 0 only, as written above) and compare corner and glyph pixel colors.
    const parts = [];
    for (let o = 8; o < buf.length;) {
      const len = buf.readUInt32BE(o);
      if (buf.toString("ascii", o + 4, o + 8) === "IDAT")
        parts.push(buf.subarray(o + 8, o + 8 + len));
      o += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(parts));
    const stride = size * 4 + 1;
    const at = (x, y) => [...raw.subarray(y * stride + 1 + x * 4, y * stride + 1 + x * 4 + 4)];
    const same = (px, c) => px[0] === c[0] && px[1] === c[1] && px[2] === c[2] && px[3] === 255;
    const gx = Math.round(W[0][0] * size);
    const gy = Math.round(W[0][1] * size);
    if (!same(at(0, 0), paper)) fail(`${name}: corner is not the parchment color (or not opaque)`);
    if (!same(at(gx, gy), ink)) fail(`${name}: glyph is not the ink color`);
    console.log(`${name}: ${w}x${h}, ${buf.length} bytes`);
  }
  if (bad) process.exit(1);
  console.log("icons ok");
}

if (process.argv.includes("--check")) {
  check();
} else {
  mkdirSync(outDir, { recursive: true });
  for (const { name, size } of FILES) {
    writeFileSync(`${outDir}/${name}`, png(size));
    console.log(`wrote ${name}`);
  }
}
