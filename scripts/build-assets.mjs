#!/usr/bin/env node
// Asset pipeline: raw/ (ChatGPT or placeholder art) → web/public/assets/ + web/src/officeAssets.ts
// The team comes from card.generated.json — never a hardcoded list.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "raw");
const OUT = path.join(ROOT, "web", "public", "assets");
const card = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "src", "card.generated.json"), "utf8"));
const KERNEL = card.pixelArt ? "nearest" : "lanczos3";
const POSES = ["front", "side", "back"];

// ---------- 0. everything present? ----------
const missing = [];
for (const m of card.team) for (const f of [...POSES, "portrait"]) if (!fs.existsSync(path.join(RAW, m.name, `${f}.png`))) missing.push(`raw/${m.name}/${f}.png`);
if (!fs.existsSync(path.join(RAW, "office.png"))) missing.push("raw/office.png");
if (missing.length) {
  console.error(`\n✖ Missing ${missing.length} file(s) — nothing was built:\n  ${missing.join("\n  ")}\n\n(Make them with the ChatGPT prompts, or run: npm run placeholder-art)\n`);
  process.exit(1);
}

// ---------- helpers ----------
async function load(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
const fromRaw = (img) => sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } });

/** If there is no real transparency, flood-fill the background from the edges (handles white and painted checkerboards). */
function removeBackground(img, tol = 28) {
  const { data, w, h } = img;
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) transparent++;
  if (transparent > w * h * 0.02) return { img, removed: false };
  // background palette: the most common colours along the border (white + checker grey, or a flat fill)
  const counts = new Map();
  const key = (i) => `${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`;
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  for (const p of border) { const k = key(p * 4); counts.set(k, (counts.get(k) || 0) + 1); }
  const palette = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, c]) => c > border.length * 0.05)
    .map(([k]) => k.split(",").map((v) => (Number(v) << 3) + 4));
  const isBg = (i) => palette.some(([r, g, b]) => Math.abs(data[i] - r) <= tol && Math.abs(data[i + 1] - g) <= tol && Math.abs(data[i + 2] - b) <= tol);
  const seen = new Uint8Array(w * h);
  const stack = border.filter((p) => isBg(p * 4));
  for (const p of stack) seen[p] = 1;
  while (stack.length) {
    const p = stack.pop();
    data[p * 4 + 3] = 0;
    const x = p % w, y = (p / w) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (!seen[q] && isBg(q * 4)) { seen[q] = 1; stack.push(q); }
    }
  }
  return { img, removed: true };
}

function bbox(img) {
  const { data, w, h } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) throw new Error("image is fully transparent");
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

async function trimmed(file) {
  const { img, removed } = removeBackground(await load(file));
  const b = bbox(img);
  const buf = await fromRaw(img).extract({ left: b.x, top: b.y, width: b.w, height: b.h }).png().toBuffer();
  return { buf, w: b.w, h: b.h, removed };
}

/** Place on a square transparent canvas with ONE shared scale; bottom-aligned so the feet share a baseline. */
async function placeSquare(t, scale, size, margin) {
  const w = Math.max(1, Math.round(t.w * scale)), h = Math.max(1, Math.round(t.h * scale));
  const resized = await sharp(t.buf).resize(w, h, { kernel: KERNEL, fit: "fill" }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, left: Math.round((size - w) / 2), top: size - margin - h }]).png();
}

// ---------- accent colours ----------
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToHex(h, s, l) {
  const f = (n) => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return "#" + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
async function mainColour(file) {
  const img = await load(file);
  const bins = new Map();
  for (let i = 0; i < img.data.length; i += 4) {
    const [r, g, b, a] = [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
    if (a < 200) continue;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 60 || mn > 215 || mx - mn < 40) continue; // near-black outline, near-white, grey
    const [h, s] = rgbToHsl(r, g, b);
    if (s < 0.25) continue;
    const l = (mx + mn) / 510;
    if (h >= 10 && h <= 42 && l > 0.55 && s < 0.85) continue; // skin tones are never the character colour
    const k = Math.round(h / 12) % 30;
    const e = bins.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b; bins.set(k, e);
  }
  const best = [...bins.values()].sort((a, b) => b.n - a.n)[0];
  if (!best) return "#8b5cf6";
  return "#" + [best.r, best.g, best.b].map((v) => Math.round(v / best.n).toString(16).padStart(2, "0")).join("");
}
function hueDist(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
function makeDistinct(colours) {
  const out = {}, taken = [];
  for (const [name, hex] of Object.entries(colours)) {
    let [h, s, l] = rgbToHsl(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
    s = Math.max(s, 0.55); l = Math.min(Math.max(l, 0.5), 0.68); // readable on a dark UI
    let tries = 0;
    while (taken.some((t) => hueDist(t, h) < 22) && tries++ < 16) h = (h + 23) % 360;
    taken.push(h);
    out[name] = { colour: hslToHex(h, s, l), nudged: tries > 0, from: hex };
  }
  return out;
}

// ---------- go ----------
fs.mkdirSync(path.join(OUT, "office"), { recursive: true });
const report = [];
const raws = {};
for (const m of card.team) {
  const dir = path.join(OUT, "characters", m.name);
  fs.mkdirSync(dir, { recursive: true });
  const poses = {};
  for (const p of POSES) poses[p] = await trimmed(path.join(RAW, m.name, `${p}.png`));
  const maxH = Math.max(...POSES.map((p) => poses[p].h)), maxW = Math.max(...POSES.map((p) => poses[p].w));
  for (const [size, margin] of [[256, 6], [48, 1]]) {
    const scale = Math.min((size - margin * 2) / maxH, (size - margin * 2) / maxW); // ONE scale per character, from its tallest pose
    for (const p of POSES) await (await placeSquare(poses[p], scale, size, margin)).toFile(path.join(dir, `${p}_${size}.png`));
  }
  const por = await trimmed(path.join(RAW, m.name, "portrait.png"));
  const side = Math.max(por.w, por.h);
  const padded = await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: por.buf, left: Math.round((side - por.w) / 2), top: side - por.h }]).png().toBuffer();
  for (const s of [512, 128]) await sharp(padded).resize(s, s, { kernel: KERNEL }).toFile(path.join(dir, `portrait_${s}.png`));
  raws[m.name] = await mainColour(path.join(dir, "front_256.png"));
  report.push(`${m.name}: poses ${POSES.map((p) => `${poses[p].w}x${poses[p].h}${poses[p].removed ? " (bg removed)" : ""}`).join(", ")}`);
}
await sharp(path.join(RAW, "office.png")).resize(1448, 1086, { fit: "fill", kernel: KERNEL }).png().toFile(path.join(OUT, "office", "office_full_map.png"));
if (fs.existsSync(path.join(RAW, "icon.png"))) {
  await sharp(path.join(RAW, "icon.png")).resize(256, 256, { kernel: KERNEL }).toFile(path.join(OUT, "icon.png"));
  await sharp(path.join(RAW, "icon.png")).resize(64, 64, { kernel: "lanczos3" }).toFile(path.join(OUT, "icon_64.png"));
  // Windows .ico for the desktop shortcut: PNG-compressed entries (supported since Windows Vista)
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = await Promise.all(sizes.map((s) => sharp(path.join(RAW, "icon.png")).resize(s, s, { kernel: s >= 128 ? KERNEL : "lanczos3" }).png().toBuffer()));
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const dir = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(s >= 256 ? 0 : s, 0); e.writeUInt8(s >= 256 ? 0 : s, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12);
    offset += pngs[i].length; return e;
  });
  fs.writeFileSync(path.join(OUT, "icon.ico"), Buffer.concat([header, ...dir, ...pngs]));
}
const accents = makeDistinct(raws);

const SPRITES = Object.fromEntries(card.team.map((m) => [m.name, {
  front: `/assets/characters/${m.name}/front_256.png`, side: `/assets/characters/${m.name}/side_256.png`, back: `/assets/characters/${m.name}/back_256.png`,
  front48: `/assets/characters/${m.name}/front_48.png`, side48: `/assets/characters/${m.name}/side_48.png`, back48: `/assets/characters/${m.name}/back_48.png`,
  portrait: `/assets/characters/${m.name}/portrait_128.png`, portraitLarge: `/assets/characters/${m.name}/portrait_512.png`,
  colour: accents[m.name].colour,
}]));

const ts = `// GENERATED by scripts/build-assets.mjs — do not edit by hand. Re-run \`npm run assets\`.
import card from "./card.generated.json";
import coords from "./office-coordinates.json";

export const OFFICE_MAP = "/assets/office/office_full_map.png";
export const OFFICE_ASPECT = 1448 / 1086;
export const PIXEL_ART = ${card.pixelArt ? "true" : "false"};

export type Sprite = { front: string; side: string; back: string; front48: string; side48: string; back48: string; portrait: string; portraitLarge: string; colour: string };
export const SPRITES: Record<string, Sprite> = ${JSON.stringify(SPRITES, null, 2)};

// ---------- office coordinates (percent of the map's width/height), from web/src/office-coordinates.json ----------
export type Pt = { x: number; y: number };
export type RoomKey = "briefing" | "meeting" | "approval" | "workspace" | "command" | "server" | "pantry" | "lounge";
type Coords = {
  rooms: Record<string, { x: number; y: number; w: number; h: number }>;
  seats: { id: string; room: string; x: number; y: number; work?: boolean }[];
  doors: { id: string; room: string; x: number; y: number }[];
  nodes: { id: string; x: number; y: number }[];
  edges: [string, string][];
};
const C = coords as unknown as Coords;

export const ROOM_REGIONS = C.rooms as Record<RoomKey, { x: number; y: number; w: number; h: number }>;
export const ROOM_SEATS: Record<string, (Pt & { id: string; work?: boolean })[]> = {};
for (const s of C.seats) (ROOM_SEATS[s.room] ||= []).push({ id: s.id, x: s.x, y: s.y, work: s.work });
export const ROOM_DOORS: Record<string, Pt & { id: string }> = {};
for (const d of C.doors) if (!ROOM_DOORS[d.room]) ROOM_DOORS[d.room] = { id: d.id, x: d.x, y: d.y };
export const NODES: Record<string, Pt> = {};
for (const n of C.nodes) NODES[n.id] = { x: n.x, y: n.y };
for (const d of C.doors) NODES[d.id] = { x: d.x, y: d.y };
export const EDGES: [string, string][] = C.edges;
export const ROOM_NODE: Record<string, string> = Object.fromEntries(Object.entries(ROOM_DOORS).map(([room, d]) => [room, d.id]));

/** Every member gets their OWN seat in the room their "works in" column names. The lead gets the first seat of its room. */
function workHome(): { home: Record<string, Pt & { id: string; room: string }>; problems: string[] } {
  const home: Record<string, Pt & { id: string; room: string }> = {};
  const problems: string[] = [];
  const byRoom: Record<string, string[]> = {};
  for (const m of card.team) (byRoom[m.worksIn] ||= []).push(m.name); // lead is first in the team, so first in its room
  for (const [room, names] of Object.entries(byRoom)) {
    const all = ROOM_SEATS[room] || [];
    const seats = [...all.filter((s) => s.work), ...all.filter((s) => !s.work)];
    if (seats.length < names.length) problems.push(\`\${room} has \${seats.length} seat(s) for \${names.length} member(s) (\${names.join(", ")}) — add seats in the picker\`);
    names.forEach((n, i) => { if (seats[i]) home[n] = { ...seats[i], room }; });
  }
  return { home, problems };
}
const WH = workHome();
export const WORK_HOME = WH.home;
export const SEAT_PROBLEMS = WH.problems;
`;
fs.writeFileSync(path.join(ROOT, "web", "src", "officeAssets.ts"), ts, "utf8");

// seat check (B3b): stop loudly if a room lacks seats
const coords = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "src", "office-coordinates.json"), "utf8"));
const seatProblems = ["command", "workspace", "server"].map((room) => {
  const need = card.team.filter((m) => m.worksIn === room).length;
  const have = coords.seats.filter((s) => s.room === room).length;
  return have < need ? `${room}: ${have} seat(s) for ${need} member(s)` : null;
}).filter(Boolean);

// ---------- contact sheet ----------
const cell = 200, rows = card.team.length;
const sheet = [];
const label = (txt, x, y, size = 18, fill = "#d6d9e0") => `<text x="${x}" y="${y}" font-family="monospace" font-size="${size}" fill="${fill}">${txt}</text>`;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cell * 4 + 40}" height="${rows * (cell + 30) + 20}"><rect width="100%" height="100%" fill="#1b1e26"/>`;
card.team.forEach((m, r) => {
  const y = 10 + r * (cell + 30);
  svg += label(`${m.name} · ${m.role}`, 14, y + 20, 18) + `<rect x="${cell * 3 + 40}" y="${y + 40}" width="60" height="60" rx="8" fill="${accents[m.name].colour}"/>` + label(accents[m.name].colour + (accents[m.name].nudged ? " (nudged)" : ""), cell * 3 + 30, y + 130, 14);
  svg += `<line x1="10" x2="${cell * 3 + 10}" y1="${y + 30 + cell - 4}" y2="${y + 30 + cell - 4}" stroke="#e04848" stroke-width="1" stroke-dasharray="4 3"/>`;
  POSES.forEach((p, c) => sheet.push({ input: path.join(OUT, "characters", m.name, `${p}_256.png`), left: 10 + c * cell, top: y + 30, resize: cell - 4 }));
});
svg += "</svg>";
const comps = await Promise.all(sheet.map(async (s) => ({ input: await sharp(s.input).resize(s.resize, s.resize, { kernel: KERNEL }).toBuffer(), left: s.left, top: s.top })));
await sharp(Buffer.from(svg)).composite(comps).png().toFile(path.join(OUT, "contact-sheet.png"));

// ---------- report ----------
console.log(report.join("\n"));
const list = [];
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : list.push(p); } };
walk(OUT);
for (const f of list.filter((f) => f.endsWith(".png")).sort()) {
  const meta = await sharp(f).metadata();
  console.log(`  ${path.relative(ROOT, f)}  ${meta.width}x${meta.height}`);
}
console.log("accent colours:", Object.entries(accents).map(([n, a]) => `${n} ${a.colour}${a.nudged ? ` (nudged from ${a.from})` : ""}`).join(", "));
console.log(`contact sheet: web/public/assets/contact-sheet.png · kernel: ${KERNEL}`);
if (seatProblems.length) { console.error(`\n✖ Not enough seats — add them in the picker (web/picker.html):\n  ${seatProblems.join("\n  ")}\n`); process.exit(1); }
