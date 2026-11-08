import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { lockedUpdateJson, readJson, redact } from "../src/lib.js";

test("200 concurrent lockedUpdateJson increments → exactly 200, file always parses", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-lock-"));
  const file = path.join(dir, "counter.json");
  fs.writeFileSync(file, JSON.stringify({ n: 0 }));
  let reads = 0, torn = 0, stop = false;
  const reader = (async () => {
    while (!stop) {
      try { JSON.parse(fs.readFileSync(file, "utf8")); reads++; } catch (e: any) { if (e.code !== "ENOENT") torn++; }
      await new Promise((r) => setImmediate(r));
    }
  })();
  await Promise.all(Array.from({ length: 200 }, () => lockedUpdateJson(file, { n: 0 }, (c) => { c.n++; })));
  stop = true; await reader;
  const final = await readJson(file, { n: -1 });
  console.log(`final n=${final.n}, reader parsed the file ${reads} times, torn reads=${torn}`);
  assert.equal(final.n, 200);
  assert.equal(torn, 0);
});

test("hook process and server share the lock: 100 + 100 increments from two processes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-lock2-"));
  const file = path.join(dir, "counter.json");
  fs.writeFileSync(file, JSON.stringify({ n: 0 }));
  const hookLib = path.resolve(import.meta.dirname, "..", "..", "hooks", "telemetry.mjs");
  const child = fork(hookLib, ["__lock-selftest", file, "100"], { stdio: "inherit" });
  await Promise.all(Array.from({ length: 100 }, () => lockedUpdateJson(file, { n: 0 }, (c) => { c.n++; })));
  await new Promise((r) => child.on("exit", r));
  assert.equal((await readJson(file, { n: -1 })).n, 200);
});

test("redaction", () => {
  const s = redact("key sk-ant-api03-abcdefghijklmnopqrstuvwxyz ghp_abcdefghijklmnopqrstuvwxyz0123 Authorization: Bearer abc.def.ghijklmnopqrstu password=hunter2 path /home/user/projects/my-app/src/components/Button.tsx");
  assert.ok(!/sk-ant|ghp_|hunter2|abc\.def/.test(s), s);
  assert.ok(s.includes("/home/user/projects/my-app/src/components/Button.tsx"), "file paths survive");
});
