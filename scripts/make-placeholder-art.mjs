#!/usr/bin/env node
// Placeholder art, so the office works before you have ChatGPT art.
// Draws an original chibi pixel sprite (front / side-facing-LEFT / back / portrait) for every member on the card,
// using the colours and features named in each member's "character" description, plus a top-down office map
// and the matching web/src/office-coordinates.json (rooms, seats, doors, corridor graph).
//
// Writes into raw/ exactly like the ChatGPT step would. Replace any file in raw/ with real art and re-run
// `npm run assets`. If you replace raw/office.png, re-click the map in the picker (web/picker.html).
//
// Usage: node scripts/make-placeholder-art.mjs [--force]   (--force overwrites existing raw/ files)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "raw");
const FORCE = process.argv.includes("--force");
const card = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "src", "card.generated.json"), "utf8"));

// ---------------------------------------------------------------- colours from words
const COLOURS = {
  silver: "#c8ccd6", grey: "#8b919c", gray: "#8b919c", white: "#eef1f5", black: "#2a2d36", charcoal: "#3a3f4b",
  pink: "#f472b6", red: "#e04848", crimson: "#c0283c", orange: "#f08a3c", amber: "#f5a524", gold: "#e8b830",
  yellow: "#f7d23e", blonde: "#f0d070", green: "#34c06a", lime: "#9ad040", teal: "#2bb3a3", cyan: "#3cc8e8",
  blue: "#3b82f6", navy: "#2a3c78", indigo: "#5b5bd6", purple: "#9b5de5", violet: "#8b5cf6", lavender: "#c4b5fd",
  brown: "#8a5a3c", auburn: "#a0482c", ginger: "#d0703c",
};
const FALLBACK_OUTFIT = ["#7c5ce0", "#e0609a", "#3f78e0", "#2fae68", "#e8a628", "#d84a4a", "#9a86e8", "#2bb3a3"];
const COLOUR_RE = Object.keys(COLOURS).join("|");
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const shade = (h, f) => "#" + hex(h).map((v) => Math.max(0, Math.min(255, Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1))))).map((v) => v.toString(16).padStart(2, "0")).join("");

function lookFor(m, i) {
  const d = `${m.character} ${m.details || ""}`.toLowerCase();
  const near = (nouns) => (d.match(new RegExp(`\\b(${COLOUR_RE})\\b(?:[\\s-]+[a-z-]+){0,2}?[\\s-]+(?:${nouns})`)) || [])[1];
  const hairCol = near("hair|bob|twin-?tails|ponytail|braids?|buns?|mohawk|curls");
  const outfitCol = near("hoodie|turtleneck|jacket|lab coat|coat|shirt|sweater|suit|dress|cloak|robe|vest|uniform");
  const has = (re) => re.test(d);
  const hair = COLOURS[hairCol] || ["#4a3428", "#2a2d36", "#6a4a30", "#3a2a4a"][i % 4];
  const dist = (a, b) => Math.hypot(...hex(a).map((v, k) => v - hex(b)[k]));
  let fb = FALLBACK_OUTFIT[i % FALLBACK_OUTFIT.length];
  for (let k = 0; k < FALLBACK_OUTFIT.length && dist(fb, hair) < 110; k++) fb = FALLBACK_OUTFIT[(i + k + 1) % FALLBACK_OUTFIT.length];
  return {
    hair,
    hairStyle: has(/twin-?tails|pigtails/) ? "twintails" : has(/\bbob\b/) ? "bob" : has(/long[\s-]+(?:[a-z]+\s+)?hair|ponytail/) ? "long" : has(/spiky|spikes|mohawk/) ? "spiky" : "short",
    outfit: has(/lab coat/) ? COLOURS.white : COLOURS[outfitCol] || fb,
    inner: has(/lab coat/) ? FALLBACK_OUTFIT[(i + 2) % FALLBACK_OUTFIT.length] : null,
    coat: has(/lab coat|\bcoat\b|cloak|robe/),
    hoodie: has(/hoodie/),
    turtleneck: has(/turtleneck/),
    headset: has(/headset|headphones/),
    notebook: has(/notebook|book|clipboard/),
    glasses: has(/glasses|goggles|sharp-eyed|monocle/),
  };
}

// ---------------------------------------------------------------- pixel sprite (26 x 34 grid)
const GW = 26, GH = 34;
const SKIN = "#f2c9a0", PANTS = "#353a48", SHOE = "#1d2029", EYE = "#1b1d26", OUTLINE = "#14161c", MOUTH = "#b0605a";

function grid() { return Array.from({ length: GH }, () => Array(GW).fill(null)); }
function rect(g, x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (y >= 0 && y < GH && x >= 0 && x < GW) g[y][x] = c; }
function px(g, x, y, c) { if (y >= 0 && y < GH && x >= 0 && x < GW) g[y][x] = c; }

function headShape(g, x0, x1, y0, y1, c) {
  for (let y = y0; y <= y1; y++) {
    const inset = y === y0 || y === y1 ? 2 : y === y0 + 1 || y === y1 - 1 ? 1 : 0;
    rect(g, x0 + inset, y, x1 - inset, y, c);
  }
}

function drawBody(g, L, view) {
  const narrow = view === "side";
  const bx0 = narrow ? 9 : 7, bx1 = narrow ? 16 : 18;
  const bottom = L.coat ? 26 : 24;
  // legs + shoes
  if (view === "side") { rect(g, 10, 25, 14, 30, PANTS); rect(g, 8, 31, 14, 32, SHOE); }
  else { rect(g, 8, 25, 11, 30, PANTS); rect(g, 14, 25, 17, 30, PANTS); rect(g, 8, 31, 11, 32, SHOE); rect(g, 14, 31, 17, 32, SHOE); }
  // torso
  rect(g, bx0, 15, bx1, bottom, L.outfit);
  if (L.inner && view === "front") rect(g, 11, 15, 14, 22, L.inner);
  if (L.coat && view === "front") rect(g, 12, 23, 13, bottom, shade(L.outfit, 0.82));
  if (L.turtleneck) rect(g, narrow ? 10 : 9, 14, narrow ? 15 : 16, 15, shade(L.outfit, 0.8));
  if (L.hoodie && view === "front") { rect(g, 9, 21, 16, 22, shade(L.outfit, 0.82)); px(g, 11, 16, "#e8e8e8"); px(g, 14, 16, "#e8e8e8"); px(g, 11, 17, "#e8e8e8"); px(g, 14, 17, "#e8e8e8"); }
  if (L.hoodie && view === "back") rect(g, 8, 14, 17, 16, shade(L.outfit, 0.85));
  // arms + hands
  if (view === "side") { rect(g, 11, 16, 13, 22, shade(L.outfit, 0.9)); rect(g, 11, 23, 13, 24, SKIN); }
  else { rect(g, 5, 16, 6, 22, L.outfit); rect(g, 19, 16, 20, 22, L.outfit); rect(g, 5, 23, 6, 24, SKIN); rect(g, 19, 23, 20, 24, SKIN); }
  if (L.notebook && view === "front") rect(g, 2, 19, 5, 24, "#7a4e9c"), rect(g, 3, 20, 4, 23, "#efe6d0");
  if (L.notebook && view === "side") rect(g, 8, 19, 10, 23, "#7a4e9c");
  // neck
  rect(g, 11, 14, 14, 14, view === "back" ? shade(SKIN, 0.85) : SKIN);
}

function drawHairExtras(g, L, view) {
  const H = L.hair, Hd = shade(H, 0.8);
  if (L.hairStyle === "long") {
    if (view === "back") rect(g, 5, 6, 20, 22, H);
    else if (view === "side") rect(g, 12, 6, 19, 20, H);
    else { rect(g, 4, 6, 6, 20, H); rect(g, 19, 6, 21, 20, H); }
  }
  if (L.hairStyle === "twintails") {
    if (view === "side") rect(g, 18, 5, 21, 17, H);
    else { rect(g, 1, 4, 4, 17, H); rect(g, 21, 4, 24, 17, H); rect(g, 0, 6, 1, 14, Hd); rect(g, 24, 6, 25, 14, Hd); }
  }
}

function drawHead(g, L, view) {
  const H = L.hair;
  // face / head
  headShape(g, 5, 20, 1, 13, view === "back" ? H : SKIN);
  // hair cap
  if (view === "back") headShape(g, 5, 20, 1, 13, H);
  else if (view === "side") {
    headShape(g, 5, 20, 1, 7, H);
    rect(g, 11, 1, 20, 12, H);           // back of the head is hair (faces LEFT)
    rect(g, 5, 6, 6, 7, H);
  } else {
    headShape(g, 5, 20, 1, 7, H);
    rect(g, 5, 6, 6, 11, H); rect(g, 19, 6, 20, 11, H);
    if (L.hairStyle === "bob") { rect(g, 4, 5, 6, 13, H); rect(g, 19, 5, 21, 13, H); rect(g, 7, 6, 18, 6, H); }
  }
  if (L.hairStyle === "bob" && view !== "front") { if (view === "back") rect(g, 4, 5, 21, 13, H); else rect(g, 10, 5, 21, 13, H); }
  if (L.hairStyle === "spiky") {
    for (const x of [6, 9, 12, 15, 18]) { px(g, x, 0, H); px(g, x + 1, 0, H); }
    if (view === "side") for (const y of [3, 6, 9]) { px(g, 21, y, H); px(g, 21, y + 1, H); }
    else { px(g, 4, 4, H); px(g, 21, 4, H); }
  }
  // face features
  if (view === "front") {
    rect(g, 8, 9, 9, 10, EYE); rect(g, 16, 9, 17, 10, EYE); px(g, 8, 9, "#ffffff"); px(g, 16, 9, "#ffffff");
    rect(g, 12, 12, 13, 12, MOUTH);
    if (L.glasses) { rect(g, 7, 8, 10, 8, "#9aa4b8"); rect(g, 15, 8, 18, 8, "#9aa4b8"); rect(g, 11, 9, 14, 9, "#9aa4b8"); }
  } else if (view === "side") {
    rect(g, 6, 9, 7, 10, EYE); px(g, 6, 9, "#ffffff"); px(g, 4, 10, SKIN); px(g, 7, 12, MOUTH);
    if (L.glasses) rect(g, 5, 8, 9, 8, "#9aa4b8");
  }
  if (L.headset) {
    const band = "#2c2f3a", cup = "#4a5060";
    if (view === "side") { rect(g, 13, 0, 14, 7, band); rect(g, 12, 7, 15, 11, cup); rect(g, 7, 12, 12, 12, band); px(g, 6, 12, "#e04848"); }
    else { rect(g, 6, 0, 19, 0, band); rect(g, 3, 7, 5, 11, cup); rect(g, 20, 7, 22, 11, cup); if (view === "front") { rect(g, 6, 12, 9, 12, band); px(g, 10, 12, "#e04848"); } }
  }
}

function sprite(L, view) {
  const extras = grid(), body = grid(), head = grid();
  drawHairExtras(extras, L, view);
  drawBody(body, L, view);
  drawHead(head, L, view);
  // front/side: long hair and tails sit BEHIND the body; back view: hair falls over the back
  const order = view === "back" ? [head, extras, body] : [head, body, extras];
  const out = grid();
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) out[y][x] = order[0][y][x] || order[1][y][x] || order[2][y][x];
  return out;
}

/** Shade (light from top-left) and add a 1-pixel dark outline. */
function finish(g) {
  const out = g.map((r) => r.slice());
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const c = g[y][x]; if (!c) continue;
    const r = x + 1 < GW ? g[y][x + 1] : null, b = y + 1 < GH ? g[y + 1][x] : null;
    if (r !== c || b !== c) out[y][x] = shade(c, 0.78);
    const l = x > 0 ? g[y][x - 1] : null, t = y > 0 ? g[y - 1][x] : null;
    if ((l !== c || t !== c) && r === c && b === c) out[y][x] = shade(c, 1.12);
  }
  const fin = out.map((r) => r.slice());
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    if (out[y][x]) continue;
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => out[y + dy]?.[x + dx]);
    if (n) fin[y][x] = OUTLINE;
  }
  return fin;
}

function toPng(g, cell, size, offX, offY, mirror = false) {
  const buf = Buffer.alloc(size * size * 4);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const c = g[gy][mirror ? GW - 1 - gx : gx]; if (!c) continue;
    const [r, gg, b] = hex(c);
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const X = offX + gx * cell + x, Y = offY + gy * cell + y;
      if (X < 0 || Y < 0 || X >= size || Y >= size) continue;
      const i = (Y * size + X) * 4; buf[i] = r; buf[i + 1] = gg; buf[i + 2] = b; buf[i + 3] = 255;
    }
  }
  return sharp(buf, { raw: { width: size, height: size, channels: 4 } }).png();
}

async function writeIf(file, pngPromiseFactory) {
  if (fs.existsSync(file) && !FORCE) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await (await pngPromiseFactory()).toFile(file);
  return true;
}

// ---------------------------------------------------------------- office map
const W = 1448, H = 1086, WALL = 16;
const ROOMS = {
  briefing: [24, 24, 480, 300], meeting: [480, 24, 960, 300], approval: [960, 24, 1424, 300],
  workspace: [24, 370, 640, 720], command: [720, 370, 1424, 720],
  lounge: [24, 790, 440, 1062], pantry: [440, 790, 1000, 1062], server: [1000, 720, 1424, 1062],
};
// door: [room, x, y, wall orientation 'h' (gap in a horizontal wall) or 'v']
const DOORS = [
  ["briefing", 250, 300, "h"], ["meeting", 680, 300, "h"], ["approval", 1190, 300, "h"],
  ["workspace", 640, 545, "v"], ["command", 720, 545, "v"], ["pantry", 600, 790, "h"],
  ["lounge", 440, 930, "v"], ["server", 1210, 720, "h"],
];
const NODES = [
  ["j_top_left", 250, 335], ["j_top_mid", 680, 335], ["j_top_right", 1190, 335], ["j_mid", 680, 545],
  ["j_bottom", 680, 755], ["j_bottom_pantry", 600, 755], ["n_pantry", 600, 930], ["n_command", 1210, 640],
];
const EDGES = [
  ["d_briefing", "j_top_left"], ["j_top_left", "j_top_mid"], ["d_meeting", "j_top_mid"], ["j_top_mid", "j_top_right"],
  ["j_top_right", "d_approval"], ["j_top_mid", "j_mid"], ["j_mid", "d_workspace"], ["j_mid", "d_command"], ["j_mid", "j_bottom"],
  ["j_bottom", "j_bottom_pantry"], ["j_bottom_pantry", "d_pantry"], ["d_pantry", "n_pantry"], ["n_pantry", "d_lounge"],
  ["d_command", "n_command"], ["n_command", "d_server"],
];

function gridSpots(n, [x0, y0, x1, y1], pad = 40) {
  const cols = Math.min(n, n <= 4 ? 2 : 3), rows = Math.ceil(n / cols);
  const cw = (x1 - x0 - 2 * pad) / cols, ch = (y1 - y0 - 2 * pad) / rows;
  return Array.from({ length: n }, (_, i) => [x0 + pad + cw * ((i % cols) + 0.5), y0 + pad + ch * (Math.floor(i / cols) + 0.5), cw, ch]);
}

function office() {
  const count = (k) => card.team.filter((m) => m.worksIn === k).length;
  const s = [];
  const seats = []; // {room, x, y}
  const R = (x, y, w, h, fill, extra = "") => s.push(`<rect x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(w)}" height="${Math.round(h)}" fill="${fill}" ${extra}/>`);
  const glow = (x, y, r, c) => { for (const [k, o] of [[1, 0.06], [0.7, 0.08], [0.45, 0.12]]) s.push(`<circle cx="${x}" cy="${y}" r="${r * k}" fill="${c}" opacity="${o}"/>`); };
  const chair = (x, y, c = "#3b4252") => { R(x - 13, y - 13, 26, 26, "#1a1d24"); R(x - 11, y - 11, 22, 22, c); R(x - 11, y - 11, 22, 6, shade(c, 1.2)); };
  const monitor = (x, y, w = 44) => { R(x - w / 2 - 2, y - 2, w + 4, 16, "#0f1116"); R(x - w / 2, y, w, 12, "#3d8bfd"); R(x - w / 2, y, w, 4, "#8cc4ff"); glow(x, y + 6, 46, "#3d8bfd"); };
  const desk = (x, y, w = 120, h = 46, c = "#5a4636") => { R(x - w / 2 - 3, y - h / 2 - 3, w + 6, h + 6, "#1a1d24"); R(x - w / 2, y - h / 2, w, h, c); R(x - w / 2, y - h / 2, w, 6, shade(c, 1.25)); };
  const plant = (x, y) => { R(x - 12, y - 4, 24, 20, "#6b4a32"); for (const [dx, dy] of [[-10, -14], [6, -16], [-2, -24], [10, -6], [-14, -4]]) R(x + dx - 8, y + dy, 16, 14, "#2f9a50"); R(x - 4, y - 22, 8, 8, "#5cc878"); };
  const lamp = (x, y) => { glow(x, y + 30, 90, "#f5a524"); R(x - 8, y - 4, 16, 10, "#f5c060"); };

  // floor
  s.push(`<defs><pattern id="tile" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#2c3038"/><rect width="16" height="16" fill="#30343d"/><rect x="16" y="16" width="16" height="16" fill="#30343d"/><rect width="32" height="1" fill="#262a31"/><rect width="1" height="32" fill="#262a31"/></pattern>
  <pattern id="wood" width="48" height="16" patternUnits="userSpaceOnUse"><rect width="48" height="16" fill="#4a3a30"/><rect width="48" height="1" fill="#3a2c24"/><rect x="20" width="1" height="16" fill="#3a2c24"/></pattern>
  <pattern id="corr" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#24272e"/><rect width="32" height="1" fill="#1f2228"/><rect width="1" height="32" fill="#1f2228"/></pattern>
  <pattern id="rack" width="20" height="12" patternUnits="userSpaceOnUse"><rect width="20" height="12" fill="#22262e"/><rect x="2" y="2" width="16" height="2" fill="#11131a"/><rect x="3" y="7" width="2" height="2" fill="#3ddc84"/><rect x="8" y="7" width="2" height="2" fill="#3d8bfd"/></pattern></defs>`);
  R(0, 0, W, H, "#111318");
  R(24, 300, 1400, 70, "url(#corr)"); R(640, 300, 80, 490, "url(#corr)"); R(24, 720, 976, 70, "url(#corr)");
  for (const [k, [x0, y0, x1, y1]] of Object.entries(ROOMS)) R(x0, y0, x1 - x0, y1 - y0, k === "lounge" || k === "pantry" ? "url(#wood)" : "url(#tile)");
  // walls
  for (const [, [x0, y0, x1, y1]] of Object.entries(ROOMS)) {
    R(x0 - WALL / 2, y0 - WALL / 2, x1 - x0 + WALL, WALL, "#0c0d11"); R(x0 - WALL / 2, y1 - WALL / 2, x1 - x0 + WALL, WALL, "#0c0d11");
    R(x0 - WALL / 2, y0 - WALL / 2, WALL, y1 - y0 + WALL, "#0c0d11"); R(x1 - WALL / 2, y0 - WALL / 2, WALL, y1 - y0 + WALL, "#0c0d11");
  }
  for (const [x0, y0, x1, y1] of Object.values(ROOMS)) R(x0 + WALL / 2, y0 + WALL / 2, x1 - x0 - WALL, 4, "#3a3f4b"); // top-lit wall edge
  // doorway gaps
  for (const [room, x, y, o] of DOORS) {
    const fill = room === "lounge" ? "url(#wood)" : room === "server" ? "url(#tile)" : "url(#corr)";
    if (o === "h") { R(x - 34, y - WALL / 2 - 1, 68, WALL + 2, fill); R(x - 36, y - WALL / 2 - 1, 3, WALL + 2, "#5a6070"); R(x + 33, y - WALL / 2 - 1, 3, WALL + 2, "#5a6070"); }
    else { R(x - WALL / 2 - 1, y - 34, WALL + 2, 68, fill); R(x - WALL / 2 - 1, y - 36, WALL + 2, 3, "#5a6070"); R(x - WALL / 2 - 1, y + 33, WALL + 2, 3, "#5a6070"); }
  }

  // ---- briefing: screen on top wall, 2 rows of 4 chairs
  { const [x0, y0, x1] = ROOMS.briefing; const cx = (x0 + x1) / 2;
    R(cx - 120, y0 + 14, 240, 18, "#0f1116"); R(cx - 114, y0 + 17, 228, 12, "#5aa0ff"); glow(cx, y0 + 30, 140, "#5aa0ff");
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) { const x = x0 + 90 + c * 92, y = y0 + 120 + r * 90; chair(x, y); seats.push({ room: "briefing", x, y: y + 36 }); }
    lamp(x0 + 30, y0 + 20); plant(x1 - 34, y0 + 50); }
  // ---- meeting: long table, ~10 chairs, wall board
  { const [x0, y0, x1, y1] = ROOMS.meeting; const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + 14;
    R(cx - 90, y0 + 14, 180, 14, "#e8e8e8"); R(cx - 86, y0 + 17, 60, 3, "#3d8bfd"); R(cx - 20, y0 + 20, 70, 3, "#e04848");
    desk(cx, cy, 300, 70, "#5a4636");
    for (let i = 0; i < 5; i++) { const x = cx - 120 + i * 60; chair(x, cy - 58); chair(x, cy + 58); }
    chair(cx - 178, cy); chair(cx + 178, cy);
    for (let i = 0; i < 4; i++) seats.push({ room: "meeting", x: cx - 90 + i * 60, y: cy + 98 });
    for (let i = 0; i < 4; i++) seats.push({ room: "meeting", x: cx - 90 + i * 60, y: cy - 92 });
    lamp(x1 - 30, y0 + 20); plant(x0 + 34, y1 - 40); }
  // ---- approval: one important desk + lamp + 2 visitor chairs
  { const [x0, y0, x1, y1] = ROOMS.approval; const cx = (x0 + x1) / 2;
    chair(cx, y0 + 60, "#6a3a3a"); desk(cx, y0 + 108, 170, 56, "#6b4a2f"); monitor(cx - 40, y0 + 88, 40); R(cx + 40, y0 + 92, 16, 16, "#f5c060"); glow(cx + 48, y0 + 100, 60, "#f5a524");
    chair(cx - 45, y0 + 170); chair(cx + 45, y0 + 170);
    seats.push({ room: "approval", x: cx - 45, y: y0 + 210 }, { room: "approval", x: cx + 45, y: y0 + 210 }, { room: "approval", x: cx + 140, y: y0 + 200 });
    plant(x1 - 36, y1 - 40); plant(x0 + 36, y0 + 50); }
  // ---- workspace: one desk per workspace member, shelves on one wall
  { const box = ROOMS.workspace; const n = Math.max(count("workspace"), 2);
    R(box[0] + 14, box[1] + 14, 18, box[3] - box[1] - 28, "#3a2e26"); for (let y = box[1] + 24; y < box[3] - 30; y += 34) R(box[0] + 16, y, 14, 22, ["#e04848", "#3d8bfd", "#f7d23e", "#34c06a"][(y / 34 | 0) % 4]);
    for (const [x, y] of gridSpots(n, [box[0] + 40, box[1] + 10, box[2] - 10, box[3] - 30])) {
      desk(x, y - 26, 130, 44); monitor(x - 24, y - 44, 38); monitor(x + 24, y - 44, 38); chair(x, y + 12);
      seats.push({ room: "workspace", x, y: y + 44, work: true });
    }
    lamp(box[2] - 30, box[1] + 20); plant(box[2] - 34, box[3] - 40); }
  // ---- command: huge wall display + one console per command member
  { const [x0, y0, x1, y1] = ROOMS.command; const n = Math.max(count("command"), 1);
    R(x0 + 60, y0 + 14, x1 - x0 - 120, 54, "#0f1116"); R(x0 + 66, y0 + 18, x1 - x0 - 132, 46, "#123a5a");
    for (let i = 0; i < 6; i++) R(x0 + 80 + i * 92, y0 + 26, 70, 30, i % 2 ? "#1e6fb8" : "#2b9a8a");
    for (let i = 0; i < 6; i++) R(x0 + 86 + i * 92, y0 + 44 - (i * 7) % 14, 8, 10, "#9ef0c0");
    glow((x0 + x1) / 2, y0 + 60, 260, "#3d8bfd");
    const span = x1 - x0 - 160;
    for (let i = 0; i < n; i++) {
      const x = x0 + 80 + span * ((i + 0.5) / n), y = y0 + 150;
      desk(x, y, Math.min(170, span / n - 30), 44, "#3a4252"); monitor(x - 30, y - 18, 40); monitor(x + 30, y - 18, 40); chair(x, y + 44);
      seats.push({ room: "command", x, y: y + 82, work: true });
    }
    for (let i = 0; i < 3; i++) seats.push({ room: "command", x: x0 + 160 + i * 140, y: y1 - 70 });
    plant(x0 + 36, y1 - 40); lamp(x1 - 30, y1 - 30); }
  // ---- lounge: sofa, armchairs, low table on a rug
  { const [x0, y0, x1, y1] = ROOMS.lounge; const cx = (x0 + x1) / 2 - 10, cy = (y0 + y1) / 2;
    R(cx - 130, cy - 80, 260, 160, "#5a2f4a"); R(cx - 122, cy - 72, 244, 144, "#6e3a5a");
    R(cx - 120, cy - 120, 240, 40, "#2f4a6e"); R(cx - 120, cy - 120, 240, 10, "#4a6a96");
    R(cx - 160, cy - 40, 40, 70, "#2f4a6e"); R(cx + 120, cy - 40, 40, 70, "#2f4a6e");
    desk(cx, cy + 4, 120, 50, "#6b4a2f");
    lamp(x0 + 30, y0 + 30); lamp(x1 - 40, y1 - 30); plant(x0 + 34, y1 - 36);
    for (const [dx, dy] of [[-80, -60], [0, -60], [80, -60], [-110, 60], [110, 60]]) seats.push({ room: "lounge", x: cx + dx, y: cy + dy + 20 }); }
  // ---- pantry: counter + sink, drinks machine, fridge, small table + stools
  { const [x0, y0, x1, y1] = ROOMS.pantry;
    R(x0 + 20, y1 - 70, x1 - x0 - 40, 50, "#5a6070"); R(x0 + 20, y1 - 70, x1 - x0 - 40, 8, "#8a92a4"); R(x0 + 160, y1 - 60, 60, 30, "#9ad0f0");
    R(x1 - 80, y0 + 30, 56, 80, "#d8dce4"); R(x1 - 76, y0 + 34, 48, 34, "#eef1f5"); R(x1 - 150, y0 + 30, 56, 70, "#c0283c"); R(x1 - 142, y0 + 40, 40, 20, "#ffd36a");
    const tx = x0 + 300, ty = y0 + 130; R(tx - 50, ty - 30, 100, 60, "#1a1d24"); R(tx - 46, ty - 26, 92, 52, "#8a6a4a");
    for (const [dx, dy] of [[-70, 0], [70, 0], [0, -56], [0, 56]]) { R(tx + dx - 12, ty + dy - 12, 24, 24, "#1a1d24"); R(tx + dx - 10, ty + dy - 10, 20, 20, "#c8a060"); }
    lamp(x0 + 40, y0 + 30);
    for (const [dx, dy] of [[-70, 36], [70, 36], [0, 96]]) seats.push({ room: "pantry", x: tx + dx, y: ty + dy });
    seats.push({ room: "pantry", x: x1 - 120, y: y0 + 150 }, { room: "pantry", x: x0 + 120, y: y0 + 100 }); }
  // ---- server: racks with blinking lights + a small desk per server member
  { const [x0, y0, x1, y1] = ROOMS.server; const n = Math.max(count("server"), 1);
    for (let i = 0; i < 4; i++) { R(x0 + 30 + i * 96, y0 + 40, 60, 150, "#0c0d11"); R(x0 + 34 + i * 96, y0 + 44, 52, 142, "url(#rack)"); }
    glow((x0 + x1) / 2, y0 + 110, 200, "#3ddc84");
    for (let i = 0; i < n; i++) { const x = x0 + 90 + (x1 - x0 - 180) * ((i + 0.5) / n), y = y1 - 100; desk(x, y, 110, 40, "#3a4252"); monitor(x, y - 16, 40); chair(x, y + 36); seats.push({ room: "server", x, y: y + 72, work: true }); }
    seats.push({ room: "server", x: x1 - 60, y: y0 + 230 }); }

  for (const [x, y] of [[620, 330], [1405, 330], [44, 750]]) plant(x, y);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">${s.join("")}</svg>`;
  return { svg, seats };
}

const pct = (v, total) => Math.round((v / total) * 1000) / 10;
function coordinates(seats) {
  const rooms = Object.fromEntries(Object.entries(ROOMS).map(([k, [x0, y0, x1, y1]]) => [k, { x: pct(x0, W), y: pct(y0, H), w: pct(x1 - x0, W), h: pct(y1 - y0, H) }]));
  return {
    image: { width: W, height: H },
    rooms,
    seats: seats.map((s, i) => ({ id: `s${i + 1}`, room: s.room, x: pct(s.x, W), y: pct(s.y, H), ...(s.work ? { work: true } : {}) })),
    doors: DOORS.map(([room, x, y]) => ({ id: `d_${room}`, room, x: pct(x, W), y: pct(y, H) })),
    nodes: NODES.map(([id, x, y]) => ({ id, x: pct(x, W), y: pct(y, H) })),
    edges: EDGES.map(([a, b]) => [a, b]),
  };
}

// ---------------------------------------------------------------- go
let wrote = 0;
for (const [i, m] of card.team.entries()) {
  const L = lookFor(m, i);
  const cell = 24, size = 1024, offX = Math.round((size - GW * cell) / 2), offY = size - GH * cell - 70;
  const views = { front: finish(sprite(L, "front")), side: finish(sprite(L, "side")), back: finish(sprite(L, "back")) };
  for (const v of ["front", "side", "back"]) if (await writeIf(path.join(RAW, m.name, `${v}.png`), () => toPng(views[v], cell, size, offX, offY))) wrote++;
  // portrait: head + shoulders of the front view, larger, turned slightly (we mirror nothing; it's a placeholder)
  const bust = views.front.slice(0, 21).map((r) => r.slice());
  const pg = grid(); for (let y = 0; y < bust.length; y++) pg[y + 6] = bust[y];
  if (await writeIf(path.join(RAW, m.name, "portrait.png"), () => toPng(pg, 34, 1024, Math.round((1024 - GW * 34) / 2), -120))) wrote++;
  console.log(`  ${m.name.padEnd(8)} hair ${L.hairStyle.padEnd(9)} ${L.hair}  outfit ${L.outfit}${L.headset ? " +headset" : ""}${L.coat ? " +coat" : ""}${L.notebook ? " +notebook" : ""}`);
}
const { svg, seats } = office();
if (await writeIf(path.join(RAW, "office.png"), () => sharp(Buffer.from(svg)).png())) wrote++;
const coordsFile = path.join(ROOT, "web", "src", "office-coordinates.json");
if (!fs.existsSync(coordsFile) || FORCE) { fs.writeFileSync(coordsFile, JSON.stringify(coordinates(seats), null, 2) + "\n", "utf8"); console.log("  wrote web/src/office-coordinates.json (matches the placeholder map)"); }
// app icon: the lead's face on a rounded square
{
  const L = lookFor(card.team[0], 0); const head = finish(sprite(L, "front")).slice(0, 16);
  const g = grid(); for (let y = 0; y < head.length; y++) g[y + 9] = head[y];
  const face = await toPng(g, 30, 1024, Math.round((1024 - GW * 30) / 2), -150).toBuffer();
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="40" y="40" width="944" height="944" rx="200" fill="#151821" stroke="${card.uiAccent}" stroke-width="40"/><circle cx="512" cy="540" r="380" fill="${card.uiAccent}" opacity="0.18"/></svg>`);
  if (await writeIf(path.join(RAW, "icon.png"), async () => sharp(bg).composite([{ input: face }]).png())) wrote++;
}
console.log(`placeholder art: ${wrote} file(s) written to raw/${wrote ? "" : " (all existed — use --force to overwrite)"}`);
