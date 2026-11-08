#!/usr/bin/env node
// OPTIONAL: also register the telemetry hooks in your USER-level ~/.claude/settings.json, so a Claude session
// started inside ANY of your registered project folders shows up in the office (not only sessions started here).
// The user-level copy runs with --user: it stays silent for folders that aren't registered projects,
// and for this folder (the project-level hooks already cover it).
//
//   node scripts/install-user-hooks.mjs            install (idempotent; backs up settings.json first)
//   node scripts/install-user-hooks.mjs --remove   uninstall
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "hooks", "telemetry.mjs");
const file = path.join(os.homedir(), ".claude", "settings.json");
const remove = process.argv.includes("--remove");
const EVENTS = [["SessionStart", null, "session_start"], ["SessionEnd", null, "session_end"], ["UserPromptSubmit", null, "prompt"],
  ["PreToolUse", "Task|Agent", "spawn"], ["PostToolUse", "Edit|Write|NotebookEdit", "file_touch"], ["PostToolUse", "Bash", "command"],
  ["SubagentStop", null, "done"], ["Stop", null, "idle"]];
const MARK = "hooks/telemetry.mjs";
const isOurs = (h) => typeof h?.command === "string" && h.command.replace(/\\/g, "/").includes(MARK) && h.command.includes("--user");

let settings = {};
if (fs.existsSync(file)) {
  try { settings = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { console.error(`✖ ${file} is not valid JSON — fix it first; nothing was changed.`); process.exit(1); }
  fs.copyFileSync(file, `${file}.bak-${Date.now()}`);
}
settings.hooks ||= {};
// remove our previous entries (keeps everything else untouched)
for (const [ev, groups] of Object.entries(settings.hooks)) {
  settings.hooks[ev] = groups.map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) })).filter((g) => g.hooks.length);
  if (!settings.hooks[ev].length) delete settings.hooks[ev];
}
if (!remove) {
  const cmd = (t) => `node "${SCRIPT.replace(/\\/g, "/")}" ${t} --user`;
  for (const [ev, matcher, t] of EVENTS) (settings.hooks[ev] ||= []).push({ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: cmd(t), timeout: 15 }] });
}
if (!Object.keys(settings.hooks).length) delete settings.hooks;
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(`${file}.tmp`, JSON.stringify(settings, null, 2) + "\n", "utf8");
fs.renameSync(`${file}.tmp`, file);
console.log(remove ? `Removed the user-level Mission Control hooks from ${file}.` : `Registered user-level Mission Control hooks in ${file}.\nRestart any running Claude Code sessions — hooks only load at startup.`);
