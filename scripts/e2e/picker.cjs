// B3 proof: open the picker, place one room, one seat and one door by simulated clicks, export, print the JSON.
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const out = process.argv[2] || ".";
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await p.goto("http://localhost:4316/picker.html");
  await p.waitForSelector("[data-testid=map] img");
  await p.screenshot({ path: `${out}/b3-picker-loaded.png` });
  await p.getByText("Clear all").click();
  const box = await p.locator("[data-testid=map]").boundingBox();
  const at = (px, py) => ({ x: box.x + (px / 100) * box.width, y: box.y + (py / 100) * box.height });
  // ROOM: drag a rectangle over the briefing room
  await p.selectOption("[data-testid=room-key]", "briefing");
  let a = at(2, 2), c = at(33, 27.6);
  await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(c.x, c.y, { steps: 5 }); await p.mouse.up();
  // SEAT
  await p.getByRole("button", { name: "Seat", exact: true }).click();
  a = at(10, 15); await p.mouse.click(a.x, a.y);
  // DOOR
  await p.getByRole("button", { name: "Door", exact: true }).click();
  await p.selectOption("[data-testid=room-key]", "briefing");
  a = at(17.3, 27.6); await p.mouse.click(a.x, a.y);
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("[data-testid=export]")]);
  const file = `${out}/picker-export.json`; await dl.saveAs(file);
  console.log(fs.readFileSync(file, "utf8"));
  console.log("checklist:", (await p.locator("[data-testid=checklist] li").allInnerTexts()).slice(0, 3).join(" | "), "…");
  await p.screenshot({ path: `${out}/b3-picker-clicked.png` });
  await b.close();
})();
