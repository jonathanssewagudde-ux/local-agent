// B3b + B8 proof: seat overlay; DEMO walk — no walking through walls, no overlap, side pose faces travel direction.
const { chromium } = require("playwright");
const W = 1448, H = 1086;
// walkable areas of the placeholder map (rooms + corridors), in map pixels
const RECTS = [[24,24,480,300],[480,24,960,300],[960,24,1424,300],[24,370,640,720],[720,370,1424,720],[24,790,440,1062],[440,790,1000,1062],[1000,720,1424,1062],
  [24,300,1424,370],[640,300,720,790],[24,720,1000,790]];
const inside = (x, y) => RECTS.some(([a, b, c, d]) => x >= a - 2 && x <= c + 2 && y >= b - 2 && y <= d + 2);
(async () => {
  const out = process.argv[2] || ".";
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  await p.goto("http://localhost:4316/?overlay=1");
  await p.evaluate(() => localStorage.setItem("mc-dock", "closed"));
  await p.reload();
  await p.waitForSelector("[data-agent]");
  await p.waitForTimeout(800);
  await p.locator("[data-testid=office]").screenshot({ path: `${out}/b3b-overlay.png` });
  await p.goto("http://localhost:4316/");
  await p.waitForSelector("[data-agent]");
  await p.check("[data-testid=demo]");
  const office = await p.locator("[data-testid=office]").boundingBox();
  let wallHits = [], facingErrors = [], samples = 0, midShot = false;
  const prev = {};
  for (let i = 0; i < 160; i++) {
    const st = await p.$$eval("[data-agent]", (els) => els.map((e) => { const r = e.getBoundingClientRect(); const img = e.querySelector("img"); const o = e.parentElement.getBoundingClientRect(); return { n: e.dataset.agent, x: r.left + r.width / 2, y: r.bottom, facing: e.dataset.facing, moving: e.dataset.moving, flip: img.style.transform, tx: o.left + (parseFloat(e.style.left) / 100) * o.width, ty: o.top + (parseFloat(e.style.top) / 100) * o.height }; }));
    for (const s of st) {
      const mx = ((s.x - office.x) / office.width) * W, my = ((s.y - office.y) / office.height) * H - 0; // feet
      samples++;
      if (!inside(mx, my)) wallHits.push(`${s.n} at (${mx | 0},${my | 0})`);
      if (s.moving === "1") {
        const dx = s.tx - s.x, dy = s.ty - s.y; // direction of the CURRENT leg: where it is heading minus where it is
        if (Math.abs(dx) > 3 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          const wantRight = dx > 0;
          if (s.facing === "side-right" !== wantRight || (s.facing === "side-right") !== s.flip.includes("scaleX(-1)")) facingErrors.push(`${s.n} moving ${wantRight ? "right" : "left"} shows ${s.facing}`);
        }
      }
      prev[s.n] = s;
    }
    if (!midShot && st.filter((s) => s.moving === "1").length >= 2) { await p.locator("[data-testid=office]").screenshot({ path: `${out}/b8-demo-midwalk.png` }); midShot = true; }
    await p.waitForTimeout(100);
  }
  await p.uncheck("[data-testid=demo]");
  await p.check("[data-testid=demo]");
  await p.waitForTimeout(6500);
  // wait for everyone to stop
  for (let i = 0; i < 40 && (await p.$$eval("[data-agent][data-moving='1']", (e) => e.length)); i++) await p.waitForTimeout(150);
  const fin = await p.$$eval("[data-agent]", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { n: e.dataset.agent, room: e.dataset.room, x: r.left + r.width / 2, y: r.bottom }; }));
  const overlaps = [];
  for (let i = 0; i < fin.length; i++) for (let j = i + 1; j < fin.length; j++) if (Math.hypot(fin[i].x - fin[j].x, fin[i].y - fin[j].y) < 12) overlaps.push(`${fin[i].n}/${fin[j].n}`);
  await p.locator("[data-testid=office]").screenshot({ path: `${out}/b8-demo-arrived.png` });
  console.log(`position samples: ${samples}; outside walkable floor: ${wallHits.length}${wallHits.length ? " → " + wallHits.slice(0, 5).join("; ") : ""}`);
  console.log(`facing errors (side pose vs travel direction): ${facingErrors.length}${facingErrors.length ? " → " + [...new Set(facingErrors)].slice(0, 5).join("; ") : ""}`);
  console.log(`overlapping characters after arrival: ${overlaps.length ? overlaps.join(", ") : "none"}`);
  console.log("rooms after arrival:", fin.map((f) => `${f.n}@${f.room}`).join(" "));
  await b.close();
})();
