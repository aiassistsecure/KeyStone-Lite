# HANDOFF — 2026-07-10 22:26 UTC
Features: cockpit chat UI · terminal retarget · preview intelligence · project-path restore

Audience: AI agents / developers picking up work on **Keystone Lite** (`keystone-lite/`), the Electron desktop AI coding studio inside the AiAssist workspace.

---

## 1. Project context

- **App**: Keystone Lite — Electron app. Renderer: React + TypeScript + Vite + Tailwind v4 + framer-motion + lucide-react.
- **Branch**: all work lands on `living`. HEAD at handoff: `2662bf30a`.
- **Build**: the user builds locally on his Mac with `npm run dist`. Electron is NOT installed in this Replit workspace — you cannot run the app here.
- **Verification here**: renderer typecheck only, run FROM WORKSPACE ROOT (fails if run inside `keystone-lite/`):
  ```bash
  node_modules/.bin/tsc -p /tmp/tsconfig.renderer-check.json
  ```
  If `/tmp/tsconfig.renderer-check.json` is missing, recreate it:
  ```json
  {
    "extends": "/home/runner/workspace/keystone-lite/tsconfig.json",
    "compilerOptions": { "noEmit": true },
    "include": ["/home/runner/workspace/keystone-lite/src/renderer/**/*"],
    "references": []
  }
  ```
- A `Keystone Lite` workflow runs Vite on port 5173 (browser-bridge dev mode); full Electron behavior is not reproducible there.
- **User's stale-build gotcha**: if the user reports "nothing changed," his Mac build is behind. Fix: `git checkout living && git pull origin living && npm run dist`.

## 2. Features shipped this session (newest first)

### 2.1 Cockpit chat UI (`7ffb33ffd`, `2662bf30a`)
- File: `src/renderer/components/ChatPanel.tsx` (~2130 lines — styling AND the full agent tool loop live here; be surgical).
- Restyled from soft cyan/purple gradient "toy" look to jet-cockpit HUD:
  - Sharp corners everywhere (`rounded-none`), mono uppercase micro-labels (11px, wide tracking), grid + scanline overlays (pointer-events-none), corner brackets.
  - Color language: **cyan = assistant/HUD**, **emerald = user/pilot input**, **amber = command approvals (caution)**, **red = abort**.
  - Header: pulsing LED + `AI LINK`, `CTX NN` context counter, angular Debug/Focus/Keystone mode toggles.
  - Thinking indicator: rotating Crosshair icon, `PROCESSING DIRECTIVE ▮` blinking-cursor phrases (THINKING_PHRASES no longer has an `emoji` field), telemetry line with active file/tool.
  - Empty state: spinning crosshair, `SYSTEMS NOMINAL / AWAITING DIRECTIVE`.
  - Input: console box, `> ENTER DIRECTIVE` placeholder, solid cyan square send button.
- Copy changes shipped with the theme: "2 files" → `CTX 02`, "Command approval" → `Command Auth`.
- **Style-only** — zero logic/handler/data-testid changes. Architect-reviewed: PASS.

### 2.2 Terminal retarget on project switch (`d03e2f70f`)
- Files: `src/renderer/lib/terminal-sessions.ts`, `src/renderer/pages/MainLayout.tsx`.
- `terminals.retarget(newCwd)`: idle terminal sessions get their cwd updated + a gray buffer note (`workspace changed · cwd → …`); busy sessions are intentionally skipped.
- MainLayout effect calls `retarget` on every local (non-`/env/`) projectPath change. Idempotent, guard-free by design.
- Exit path already resets all terminals (`terminals.reset()`, commit `bd389a2e2`).

### 2.3 Preview intelligence (`c95b644c6`)
- New file: `src/renderer/lib/project-discovery.ts` — detects next/nuxt/astro/angular/sveltekit/vite/CRA/remix/node-server/django/flask/fastapi from `package.json` / `manage.py` / `requirements.txt`; returns `{id, label, defaultPort, buildCommand(port)}`.
- `PreviewPanel.tsx`: seeds live servers from `terminals.getActiveServers()` (catches `server_detected` events fired while unmounted); shows "X detected · port input · Start dev server" bar (hidden when a live server is showing or workspace is remote `/env/`); 30s start timeout; empty state prints `Scanned for package.json · manage.py · requirements.txt — no project type detected` (`data-testid="text-scan-result"`).
- `MainLayout.tsx`: auto-switches center view to `preview` on `server_detected`.

### 2.4 Project-path restore fix (`dcebb91ce`, `28796dcba`)
- `ChatPanel` takes a `projectPath` prop; prop wins over `store.get` at 3 call sites.
- MainLayout workspace effect syncs `store.set('projectPath')`, gated by `!path.startsWith('/env/')` (remote env paths must never be persisted as local project paths).
- User-confirmed working.

## 3. Invariants — do not break

1. `/env/` prefix means **remote workspace**: never persist it to the store, never retarget terminals to it, never show local dev-server UI for it.
2. `ChatPanel.tsx` contains the agent tool loop, approval flow, and session persistence — style edits must not touch handlers, state, or `data-testid` attributes.
3. Busy terminals keep their cwd on project switch; only idle ones retarget.
4. All commits go to branch `living`.
5. Typecheck from workspace root after every edit batch (command in §1).

## 4. Known issues / next candidates

- Mode-button labels were bumped 10px → 11px on user request; further readability tweaks only if the user asks.
- `Kudos/artifacts/api-server` workflow failure in this workspace is pre-existing and unrelated to Keystone Lite.
- Chat context-compression behaves correctly per user (model visibly narrows sed ranges) — not a bug.
- Possible future work: theming the rest of the panels (Preview, Terminal, file tree) to match the cockpit language; ModelSelector still has the old styling.
