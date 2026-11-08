# Mission Control — rules for every session

We are building "Mission Control": a local, browser-based visual office for my Claude Code agent team.

## THE CARD
- `mission.card.md` is the single source of truth for the app name, the team (names, roles, who each character is, where each works), the room labels and the UI accent. NEVER hardcode any of those anywhere else.
- `scripts/card.mjs` parses `mission.card.md` into `web/src/card.generated.json` `{appName, uiAccent, team:[{name, role, worksIn, character, details}], rooms:{key: label}}` (details is optional; "-" means none) and validates it: exactly one member has role "lead" and it is the first; every other role is free text (any short job title, duplicates allowed); worksIn in {command, workspace, server}; names are unique lowercase single words; 2–8 members. It fails loudly with a clear message on any problem. It runs before every build and dev start.

## WHAT IT IS
- A dashboard that MIRRORS what Claude Code really does. Claude Code is the engine; the dashboard never runs agent work itself.
- Characters move because of REAL events captured by Claude Code hooks — never simulated. Honest silence beats fake activity. A clearly labelled "Demo" toggle is the only exception.

## ARCHITECTURE (fixed — ask me before changing)
- `web/` : Vite + React + TypeScript + Tailwind v4, port 4316, proxies /api and /pty to the daemon.
- `server/` : Node + Express + ws + node-pty + chokidar, port 4317. Owns the embedded terminal, reads and writes state, pushes changes to the browser over SSE.
- `.satoru/` : the state folder — the ONLY place the app writes at runtime.
- Not Next.js: a long-running PTY / WebSocket / file-watch daemon is the wrong shape for it.

## FIXED CONTRACT (the app depends on it)
- A top-down 4:3 office map with 8 room keys: briefing, meeting, approval, workspace, command, server, pantry, lounge.
- Each character has front, side and back poses; the side pose faces LEFT.

## RULES
- Every JSON write is atomic: write a temp file, then rename it over the target.
- Timestamps are ISO 8601 and are parsed with Date.parse before comparing — never compare timestamp strings.
- Never write secrets into state files or event logs — redact them first.
- The server only accepts browser requests from http://localhost:4316 (pinned CORS, never "*").
- After every change, run the build or typecheck and say how you verified it. "Done" without proof is not done.

## How nova runs the team
nova (the lead) is the main Claude session. The other members are subagents in `.claude/agents/`.

- **Plan first:** for any real task, write a plan draft (e.g. `.satoru/plan-draft.json`) with the Write tool, then publish it with
  `node scripts/board.mjs plan .satoru/plan-draft.json` — it validates owners against the card, refuses file conflicts and writes `.satoru/projects/<slug>/plan.json` safely with status `"awaiting-approval"`. Then STOP until I approve it in the dashboard. Draft shape:
  `{"title":"...","scope":"...","risks":["..."],"tasks":[{"id":"T1","title":"...","owner":"<member>","files":["..."]}]}`
  The active project is `activeProject` in `.satoru/config.json` (board.mjs uses it automatically).
- After approval, delegate each task to its owner with the Agent tool; independent tasks run in parallel. When I approve, the dashboard copies the plan's tasks into `tasks.json`. Keep each task's status up to date with
  `node scripts/board.mjs task <id> <planned|in-progress|review|blocked|done> [verified]` — add `verified` once it has really been checked. Never hand-edit tasks.json or plan.json (board.mjs takes the lock and writes atomically).
- **Stage directives** — when the team moves, write a line on its own like:
  🎬 <name> → <room key> · "<a short, real sentence about what they are doing>"
  Room keys: briefing, meeting, approval, workspace, command, server, pantry, lounge, done. Real work only — never invent activity.
- **Approval requests** — when you need my sign-off, write a line on its own like:
  🔔 approval: <title> | risk:<low|med|high> | <a one-line reason>
- Always start Claude Code from this folder (or from the embedded terminal) — that is where the office is listening.
