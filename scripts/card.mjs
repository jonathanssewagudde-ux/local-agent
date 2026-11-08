#!/usr/bin/env node
// Parses mission.card.md → web/src/card.generated.json and validates it.
// mission.card.md is the single source of truth: never hardcode names, roles, labels or the app name elsewhere.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARD = path.join(ROOT, "mission.card.md");
const OUT = path.join(ROOT, "web", "src", "card.generated.json");
const ROOM_KEYS = ["briefing", "meeting", "approval", "workspace", "command", "server", "pantry", "lounge"];
const WORKS_IN = ["command", "workspace", "server"];

export function parseCard(text) {
  const errors = [];
  const start = text.indexOf("=== MISSION CARD ===");
  const end = text.indexOf("=== END CARD ===");
  if (start < 0 || end < 0 || end < start) throw new Error("mission.card.md: missing '=== MISSION CARD ===' / '=== END CARD ===' markers");
  const lines = text.slice(start, end).split(/\r?\n/);

  const field = (k) => {
    const l = lines.find((x) => x.startsWith(k + ":"));
    return l ? l.slice(k.length + 1).trim() : "";
  };
  const appName = field("APP_NAME");
  const uiAccentRaw = field("UI_ACCENT");
  const hex = (uiAccentRaw.match(/#[0-9a-fA-F]{6}\b/) || [])[0];
  if (!appName) errors.push("APP_NAME is empty");
  if (!hex) errors.push(`UI_ACCENT must contain a #rrggbb colour (got "${uiAccentRaw}")`);

  const team = [];
  let inTable = false;
  for (const l of lines) {
    const t = l.trim();
    if (/^\|\s*name\s*\|/i.test(t)) { inTable = true; continue; }
    if (!inTable) continue;
    if (/^\|[-\s|]+\|$/.test(t)) continue;
    if (!t.startsWith("|")) { if (team.length) inTable = false; continue; }
    const cells = t.slice(1, t.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim());
    const [name = "", role = "", worksIn = "", character = "", details = "-"] = cells;
    team.push({ name, role, worksIn, character, ...(details && details !== "-" ? { details } : {}) });
  }

  const rooms = {};
  for (const l of lines) {
    const m = l.match(/^\s*([a-z]+)\s*=\s*(.+?)\s*$/);
    if (m && ROOM_KEYS.includes(m[1])) rooms[m[1]] = m[2];
  }
  for (const k of ROOM_KEYS) if (!rooms[k]) errors.push(`ROOM LABELS: missing "${k} = <label>"`);

  if (team.length < 2 || team.length > 8) errors.push(`TEAM must have 2–8 members (found ${team.length})`);
  const leads = team.filter((m) => m.role.toLowerCase() === "lead");
  if (leads.length !== 1) errors.push(`exactly one member must have role "lead" (found ${leads.length}: ${leads.map((m) => m.name).join(", ") || "none"})`);
  else if (team[0] !== leads[0]) errors.push(`the lead ("${leads[0].name}") must be the FIRST row of the team table`);
  const seen = new Set();
  team.forEach((m, i) => {
    const where = `team row ${i + 1}${m.name ? ` ("${m.name}")` : ""}`;
    if (!/^[a-z][a-z0-9]*$/.test(m.name)) errors.push(`${where}: name must be one lowercase word (letters/digits), got "${m.name}"`);
    if (seen.has(m.name)) errors.push(`${where}: duplicate name "${m.name}"`);
    seen.add(m.name);
    if (!m.role) errors.push(`${where}: role is empty`);
    if (!WORKS_IN.includes(m.worksIn)) errors.push(`${where}: "works in" must be one of ${WORKS_IN.join(", ")}, got "${m.worksIn}"`);
    if (!m.character) errors.push(`${where}: character description is empty`);
  });

  if (errors.length) {
    const e = new Error("mission.card.md is invalid:\n  - " + errors.join("\n  - "));
    e.cardErrors = errors;
    throw e;
  }
  const artStyle = field("ART_STYLE");
  // pixel art → nearest-neighbour scaling and image-rendering: pixelated
  const pixelArt = /pixel/i.test(artStyle) && !/not pixel art/i.test(artStyle);
  return { appName, uiAccent: hex.toLowerCase(), team, rooms, artStyle, pixelArt };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const card = parseCard(fs.readFileSync(CARD, "utf8"));
    const json = JSON.stringify(card, null, 2) + "\n";
    const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : null;
    if (prev !== json) {
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      const tmp = `${OUT}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, json, "utf8");
      fs.renameSync(tmp, OUT);
    }
    console.log(`card ok: "${card.appName}", ${card.team.length} members (${card.team.map((m) => m.name).join(", ")})`);
  } catch (e) {
    console.error("\n✖ " + e.message + "\n");
    process.exit(1);
  }
}
