# Keystone Lite — How the Platform Works Today

A plain-language walkthrough of everything in the app as it exists right now. No roadmap, no plans — just what the code does today.

---

## 1. What Keystone Lite Is

Keystone Lite is a desktop app (Mac/Windows/Linux, built on Electron) that gives you an AI coding studio with a hard rule at its core: **the AI asks before it acts**. It connects to the AiAssist (AiAS) platform with your `aai_` API key, works on your real files or your Keystone cloud environments, and shows you every move it makes.

There are two modes:

- **Demo mode** — a fully scripted simulation. Nothing touches your real files; the whole workspace lives in memory. It exists to show the workflow: Read → Ask → Build → Show.
- **API (production) mode** — the real thing. Your API key, your files, your environments, real AI calls.

---

## 2. Starting Up: The Setup Flow

When you open the app you walk through up to three steps:

**Step 1 — The Door.** Two choices: watch the demo (no key needed) or continue with your API key.

**Step 2 — The Key.** Enter your `aai_...` key. The app checks it against the AiAS API (`api.aiassist.net`) before letting you through. If you tick "Remember this key," it's saved locally on your machine so you skip this step next time.

**Step 3 — Pick your workspace.** Four ways in:

| Option | What it does |
|---|---|
| **Keystone environment (Remote)** | Work live on a cloud environment. Files stay in the cloud; every read/write goes over the API. |
| **Keystone environment (Local)** | Check the environment out to a folder on your machine. You work locally and sync with Pull/Push. |
| **Restore a session** | Pick up one of your last 8 sessions exactly where you left it. |
| **Open a local folder** | Point at any folder on your disk and start working. |

---

## 3. The Main Workspace

Once inside, the layout is:

- **Left** — file tree for your workspace. Click to open files.
- **Center** — Monaco editor (same editor as VS Code) with tabs, or the **Preview** tab.
- **Bottom dock** — Terminal and Metrics tabs.
- **Right** — the AI chat panel.
- **Bottom edge** — the status bar: mode badge (DEMO purple / API cyan), environment badge (REMOTE ENV / LOCAL ENV), Pull/Push buttons (local env only), agent status, token/cost counter, and the Exit button (a glowing "Exit Demo" pill in demo mode).

---

## 4. The AI Chat (How the Agent Works)

- Chat calls the **AiAS API** with your key. Responses stream in word by word.
- You can **attach files as context** — the agent also gets a tree of your project so it knows what exists.
- While working, the agent shows a status line ("Reading...", "Writing code in...") so you always know what it's doing.
- **Edits are surgical.** Instead of rewriting whole files, the agent proposes targeted changes (insert/replace/delete specific parts). When an edit is applied, it's written to your workspace — local disk, or the cloud environment if you're in remote mode.

### The Approval System (the core promise)

Any time the agent wants to *run* something — a terminal command, opening a terminal, starting an app — it must ask:

1. An **approval card** appears in the chat with the exact command.
2. The agent is frozen until you click **Run** or **Deny**.
3. Deny means the command simply never runs. No retry, no workaround.

There's an **auto-approve toggle** if you want to let a session run hands-free — your choice, per session.

---

## 5. Terminals — Always Local

The terminal at the bottom is a real terminal running **on your machine, always**. This is a hard rule: even when your files are in a remote cloud environment, there is no remote shell. The terminal bridge is deliberately never proxied.

So what about running things in the cloud? That's the next section.

---

## 6. Remote Environment Mode

When you enter a Keystone environment in **Remote** mode:

- **Files**: every read, write, and directory listing goes over the AiAS API to the cloud environment. Nothing is stored on your disk.
- **The agent gets exactly three remote tools**, all gated behind approval cards:
  - `start_app` — start your app in the cloud (only allowlisted commands: npm, node, python)
  - `stop_app` — stop it
  - `get_logs` — fetch the last 500 lines of output
- **No remote terminal exists.** Those three tools are the entire remote execution surface.
- Folder/file pickers are disabled (there's no local folder to pick from).

---

## 7. Local Environment Mode + Pull/Push Sync

When you enter an environment in **Local** mode, the app checks the files out to a folder you choose. From then on you work at full local speed, and sync manually:

- **Pull** — bring down changes from the cloud environment.
- **Push** — send your local changes up.

Sync is conflict-aware. The app keeps a manifest of file fingerprints (SHA-256 hashes) from the last sync. If a file changed in *both* places since then, it's a conflict:

- Conflicted files are **skipped, never silently overwritten**.
- You're told which files conflicted and asked if you want to force-overwrite. Only if you confirm does the overwrite happen.

---

## 8. Preview Tab

For web projects, the Preview tab renders your `index.html` right inside the app. It inlines your local CSS and JS so it displays correctly, and **auto-refreshes whenever a file is written** — including when the agent writes one. Build, glance, adjust.

---

## 9. Metrics Tab (The Receipts)

Everything the agent does is measured:

- Elapsed time for the session
- Tokens used (input and output) and **estimated cost in dollars**
- Total tool calls
- Every file read and every file written

The live token/cost counter also sits permanently in the status bar.

---

## 10. Sessions & Memory

- Sessions and workspaces are stored by the **NEDB engine** (an embedded, versioned database — the "NEDB" badge in the status bar).
- Memory is kept in two places at once:
  - a **global index** in the app's data folder (drives the "restore session" list), and
  - a **per-workspace copy** in `{your workspace}/.keystone/memory` — so a project's history travels with the folder, even through Git.
- Your API key and preferences are stored separately in the app's local settings store.

---

## 11. Templates

The app ships with project starter templates. Picking one copies the full template into a new workspace folder, ready to run.

---

## 12. Security Model (Summary)

| Guarantee | How it's enforced |
|---|---|
| AI can't run commands without you | Approval cards; agent code blocks until you decide |
| No remote shell, ever | Terminal bridge is never proxied; remote mode has only 3 allowlisted app tools |
| App can't touch files outside your workspace | Every file operation is path-validated against the open project folder |
| Renderer is sandboxed | Electron context isolation on, node integration off |
| Your key stays yours | Stored locally on your machine only; sent only to the AiAS API |
| Demo is harmless | Entire demo filesystem lives in memory; restored on exit |

---

## 13. The Loop, In One Line

**Read. Ask. Build. Show.** The agent reads before it writes, asks before it runs, builds in the open, and shows you the receipts.
