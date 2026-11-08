# Mission Control

A live pixel-art office for your Claude Code agent team. Every character is a real Claude Code agent. When one starts working it walks to its desk. When it finishes it says what it did and heads to the lounge. Nothing is simulated: the office mirrors what Claude Code is actually doing, captured by Claude Code hooks.

Built by following the prompts in the [Office Prompt Kit](https://noobster97.github.io/youtube-video-local-agent-mission-control-ui-dashboard/) (steps B0–B13, verified with C1), using the kit's example team:

| | name | role | works in |
|---|---|---|---|
| lead | **nova** | orchestrator (the main Claude session) | Command Center |
| | **pip** | product manager | Command Center |
| | **rook** | architect | Workspace |
| | **grim** | backend engineer | Server Room |
| | **lumi** | frontend engineer | Workspace |
| | **bug** | QA tester | Workspace |
| | **quill** | docs writer | Workspace |

The team, app name, room labels and accent colour all come from **`mission.card.md`**. Nothing else hardcodes them.

## What you need

- **Node.js LTS** (20 or 22) — https://nodejs.org
- **Git**
- **Claude Code**, installed and logged in — https://claude.com/claude-code

## Start it (Windows)

```bash
git clone <this repo> mission-control
```

Then open the folder and **double-click `start.cmd`**. On the first run it:

1. installs the dependencies (one to three minutes),
2. opens two small windows, one for the daemon (port 4317) and one for the web app (port 4316),
3. opens **http://localhost:4316** in your browser,
4. creates a **Mission Control** shortcut on your desktop. Use that from now on.

Running it again while it's already up is harmless: it only starts whatever half is down. **`stop.cmd`** shuts both down and frees the ports.

macOS: double-click `start.command`. Linux: `./start.sh`, and `./stop.sh` to stop.

## Use it

1. In the terminal at the bottom of the page, click **Launch Claude**. The first time, Claude Code asks whether you trust this folder: choose **Yes**. The office lights come on.
2. Open **Projects** → **+ New project** (it creates a folder in `%USERPROFILE%\projects`, which you can change there) or **+ Add existing folder**.
3. Give nova a real task in the terminal, for example *"add a slugify helper with tests; grim owns the code, bug the tests"*.
4. nova writes a plan and stops. The **Needs-You bar** lights up. Open the plan, then **Approve & start**, **Request changes** or **Reject**. Your decision is typed into the Claude terminal for you.
5. Watch the team walk to their desks, see real lines in their speech bubbles, and follow the ticker. Click any character for details.
6. When nova needs a sign-off it raises a 🔔 approval, which you decide in the same bar.

Always start Claude **from this folder**, or from the terminal inside the app. That's where the office is listening. To also see sessions you start inside your registered project folders, run this once:

```bash
node scripts/install-user-hooks.mjs
```

It adds the hooks to your user-level `~/.claude/settings.json`, backs that file up first, and doesn't touch your other hooks. `--remove` undoes it.

**Fewer permission prompts:** nova updates the board with `node scripts/board.mjs …`. The first time Claude asks, choose *"Yes, and don't ask again"*.

## Tabs

- **Office:** the live floor, the roster, and a ticker of real events. A clearly labelled **DEMO** switch moves people randomly, and it's the only simulated thing in the app.
- **Projects:** the git branch and clean/dirty status for each project. Load, create or add a project.
- **Tasks:** a board with planned, in progress, review, blocked and done columns. Done tasks show ✓ verified or ⚠ unverified.
- **Decisions:** everything waiting for you, plus the history of plan and approval decisions.
- **Brief:** a one-page summary you can edit, plus a phase chip (executing, validation or ready) worked out from the tasks.
- **Timeline:** "what did the team do while I was away?" Covers the last 14 days, grouped by day, with filters and "Load older".

## The art is a placeholder — make it yours

This build came with **generated placeholder art**: original pixel sprites drawn from each member's description on the card, plus an office map. To use real art, follow steps 2–3 of the [kit](https://noobster97.github.io/youtube-video-local-agent-mission-control-ui-dashboard/), which have ChatGPT prompts for every character and the office:

1. Save the images as `raw/<name>/front.png`, `side.png` (**facing LEFT**), `back.png` and `portrait.png`, plus `raw/office.png` and optionally `raw/icon.png`. On a fresh clone `raw/` is empty, so run `npm run placeholder-art` first to fill it, then overwrite only the files you replace.
2. Run `npm run assets`. It removes white or checkerboard backgrounds, lines up the feet, picks each accent colour and writes a contact sheet to `web/public/assets/contact-sheet.png`.
3. **If you replaced the office map**, open **http://localhost:4316/picker.html** and click out the rooms, seats, doors and corridor junctions. Click **Export JSON**, save the file as `web/src/office-coordinates.json`, and run `npm run assets` again. Open `http://localhost:4316/?overlay=1` to check the seats and paths.

## Change the team

Edit `mission.card.md` (2–8 members, lead first, names in one lowercase word). Then use the kit's **"After editing the card"** prompts. One goes to Claude, to update the agents, assets and labels. The other goes to ChatGPT, to redraw what changed. `node scripts/card.mjs` checks the card and tells you exactly what's wrong.

## How it works

```
Claude Code ──hooks──▶ hooks/telemetry.mjs ──▶ .satoru/ (events/*.ndjson, projects/<slug>/*.json)
                                                   │ chokidar
browser ◀── SSE "what changed" ── server/ (4317) ◀─┘      + PTY terminal over WebSocket
   └── web/ (Vite + React, 4316) re-fetches the changed piece and moves the characters
```

- `hooks/telemetry.mjs` is pure Node, so it works on Windows. It never fails a Claude session: it always exits 0 and never prints anything.
- Every JSON write is atomic (a temp file, then a rename) and goes through a shared `<file>.lock`. The server and the hooks never tear each other's writes.
- The server only accepts browser requests from `http://localhost:4316`, so other websites can't drive your terminal.
- Secrets are redacted before anything touches disk.
- The terminal session lives on the server, so refreshing the page never kills your Claude session.

## Troubleshooting

The kit's **step 5** has a fix prompt for every common problem: the office stays dark, people walk through walls, the wrong member lights up, and more. Paste the matching one into Claude. Quick checks:

- **Office stays dark:** start Claude from this folder or the embedded terminal, then restart Claude after any hook change. Errors from the hook land in `.satoru/hook-errors.log`.
- **`npm install` fails on node-pty:** use a Node **LTS** release. Prebuilt Windows binaries ship for LTS, so no compiler is needed.

## Develop

```bash
npm test
```

```bash
npm run build
```

`npm test` runs the server tests: 200 concurrent locked writes, the hook and server sharing the lock, redaction, and timeline paging. `npm run build` runs the card check, typecheck and web build. Browser checks live in `scripts/e2e/` and need the app running.
