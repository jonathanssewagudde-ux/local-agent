import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("timeline paging: two events with the identical timestamp on a page boundary are never lost", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-tl-"));
  process.env.SATORU_DIR = dir;
  fs.mkdirSync(path.join(dir, "events"));
  const { timeline, eventFiles } = await import("../src/state.js");
  const { localDate } = await import("../src/lib.js");
  const today = new Date(), yesterday = new Date(Date.now() - 864e5);
  const ev = (ts: string, i: number) => JSON.stringify({ ts, agent: "grim", type: "note", project: "p", payload: { i } });
  // yesterday: 3 events; today: 4 events, two of them with the SAME timestamp
  const y = localDate(yesterday), t = localDate(today);
  const base = new Date(today); base.setHours(10, 0, 0, 0);
  const same = new Date(base.getTime() + 2000).toISOString();
  fs.writeFileSync(path.join(dir, "events", `${y}.ndjson`), [0, 1, 2].map((i) => ev(new Date(yesterday.setHours(9, 0, i)).toISOString(), i)).join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "events", `${t}.ndjson`), [ev(new Date(base.getTime()).toISOString(), 3), ev(new Date(base.getTime() + 1000).toISOString(), 4), ev(same, 5), ev(same, 6)].join("\n") + "\n");
  assert.equal(eventFiles().length, 2);
  // newest first: 6,5 share a timestamp. limit=1 puts the boundary right between them.
  const seen: number[] = [];
  let before: string | undefined, pages = 0;
  do {
    const r = await timeline({ before, limit: 1 });
    seen.push(...r.events.map((e) => (e.payload as any).i));
    before = r.next ?? undefined; pages++;
  } while (before && pages < 50);
  console.log(`pages: ${pages}, order: ${seen.join(", ")}`);
  assert.deepEqual(seen.slice().sort(), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(seen).size, 7);
  assert.deepEqual(seen.slice(0, 2).sort(), [5, 6]);
  // also with limit 2 and 3
  for (const limit of [2, 3]) {
    const got: number[] = []; let b: string | undefined;
    do { const r = await timeline({ before: b, limit }); got.push(...r.events.map((e) => (e.payload as any).i)); b = r.next ?? undefined; } while (b);
    assert.equal(new Set(got).size, 7, `limit ${limit}`);
  }
});
