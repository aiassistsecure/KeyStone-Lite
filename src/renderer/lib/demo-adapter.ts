import { publish, subscribe } from './agent-events';
import { DEMO_ROOT } from './browser-bridge';
import { terminals } from './terminal-sessions';

// Scripted demo session: the "agent" upgrades the Aurora landing page.
// Everything flows through the same event bus + bridge APIs the real agent
// uses, so every surface (chat, terminal, preview, metrics) lights up.

const NEW_STYLES = `:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: 'Inter', system-ui, sans-serif;
  background: radial-gradient(ellipse at top, #131327 0%, #0b0b12 55%);
  color: #e6e6f0;
  overflow-x: hidden;
}
.hero {
  min-height: 100vh;
  display: grid;
  place-content: center;
  text-align: center;
  position: relative;
  padding: 2rem;
}
.hero::before {
  content: '';
  position: absolute;
  inset: 20% 25%;
  background: conic-gradient(from 180deg, #22d3ee33, #a78bfa33, #22d3ee33);
  filter: blur(80px);
  z-index: -1;
  animation: drift 9s ease-in-out infinite alternate;
}
@keyframes drift {
  from { transform: translateY(-4%) rotate(0deg); }
  to { transform: translateY(4%) rotate(12deg); }
}
.badge {
  display: inline-block;
  margin: 0 auto 1.25rem;
  padding: 0.35rem 0.9rem;
  border: 1px solid #22d3ee55;
  border-radius: 999px;
  color: #67e8f9;
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
h1 {
  font-size: clamp(3rem, 8vw, 5.5rem);
  margin: 0 0 1rem;
  background: linear-gradient(90deg, #67e8f9, #a78bfa);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.sub {
  color: #9ca3bf;
  font-size: 1.15rem;
  max-width: 34rem;
  margin: 0 auto 2.25rem;
  line-height: 1.6;
}
.cta {
  display: inline-block;
  padding: 0.9rem 2.2rem;
  border-radius: 12px;
  background: linear-gradient(90deg, #06b6d4, #6366f1);
  color: white;
  font-weight: 600;
  text-decoration: none;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.cta:hover { transform: translateY(-2px); box-shadow: 0 10px 30px #06b6d455; }
.features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  max-width: 60rem;
  margin: 0 auto;
  padding: 0 2rem 5rem;
}
.card {
  background: #ffffff08;
  border: 1px solid #ffffff14;
  border-radius: 16px;
  padding: 1.5rem;
  text-align: left;
}
.card h3 { margin: 0 0 0.5rem; color: #c7d2fe; font-size: 1rem; }
.card p { margin: 0; color: #8b93b0; font-size: 0.9rem; line-height: 1.5; }
`;

const NEW_INDEX = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Aurora — Ship at the speed of light</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="hero">
    <span class="badge">Now in public beta</span>
    <h1>Aurora</h1>
    <p class="sub">The deployment platform that turns your ideas into
    production apps before your coffee gets cold.</p>
    <a class="cta" href="#" id="cta">Start building free</a>
  </main>
  <section class="features">
    <div class="card"><h3>Instant deploys</h3><p>Push to main and your app is live in seconds — no pipelines to babysit.</p></div>
    <div class="card"><h3>Edge everywhere</h3><p>Your code runs in 34 regions, automatically routed to the closest user.</p></div>
    <div class="card"><h3>Zero-config scaling</h3><p>From one user to one million without touching a dashboard.</p></div>
  </section>
  <script src="app.js"></script>
</body>
</html>
`;

const NEW_APP_JS = `const cta = document.getElementById('cta');
if (cta) {
  cta.addEventListener('click', (e) => {
    e.preventDefault();
    cta.textContent = 'You are in! 🚀'.replace(' 🚀', ' *');
  });
}
console.log('Aurora landing ready');
`;

let activeStop: (() => void) | null = null;

function sleep(ms: number, cancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (cancelled()) {
      clearTimeout(t);
      resolve();
    }
  });
}

async function streamChat(msgId: string, text: string, cancelled: () => boolean): Promise<void> {
  const words = text.split(/(?<=\s)/);
  for (const w of words) {
    if (cancelled()) return;
    publish({ type: 'chat_delta', msgId, delta: w });
    await sleep(18 + Math.random() * 30, cancelled);
  }
  publish({ type: 'chat_done', msgId });
  const completion = Math.round(text.length / 4);
  publish({ type: 'tokens', prompt: Math.round(completion * 1.6), completion, estimated: true });
}

function waitForApproval(approvalId: string, cancelled: () => boolean): Promise<'run' | 'deny'> {
  return new Promise((resolve) => {
    const unsub = subscribe((e) => {
      if (e.type === 'approval_resolved' && e.approvalId === approvalId) {
        unsub();
        resolve(e.decision);
      }
    });
    const check = setInterval(() => {
      if (cancelled()) {
        clearInterval(check);
        unsub();
        resolve('deny');
      }
    }, 500);
  });
}

async function writeDemoFile(path: string, content: string): Promise<void> {
  await window.electron.fs.writeFile(path, content);
  publish({ type: 'file_write', path, bytes: content.length });
  publish({ type: 'preview_refresh', path: `${DEMO_ROOT}/index.html` });
}

export function isDemoRunning(): boolean {
  return activeStop !== null;
}

export function stopDemo(): void {
  activeStop?.();
  activeStop = null;
}

export function startDemo(): () => void {
  stopDemo();
  let stopped = false;
  const cancelled = () => stopped;
  activeStop = () => {
    stopped = true;
  };

  (async () => {
    // ── ACT I · The blank page ─────────────────────────────────────────────
    publish({ type: 'session', action: 'start', mode: 'demo' });
    publish({ type: 'status', status: 'thinking', detail: 'Act I — The blank page' });

    await sleep(1200, cancelled);
    if (stopped) return;

    await streamChat(
      'demo_m1',
      'Every product you have ever loved started exactly like this: a folder, three small files, ' +
        'and someone willing to begin.\n\n' +
        'This is a live simulation. This whole workspace exists only in memory — nothing here ' +
        'touches your real files. But everything you are about to see is exactly how I work on ' +
        'real projects: same tools, same rules, same moves.\n\nLet me read what we have.',
      cancelled
    );
    if (stopped) return;

    publish({ type: 'status', status: 'working', detail: 'Reading the workspace' });
    publish({ type: 'tool_call', tool: 'read_file', phase: 'start', detail: 'index.html' });
    publish({ type: 'file_read', path: `${DEMO_ROOT}/index.html` });
    await sleep(900, cancelled);
    publish({ type: 'tool_call', tool: 'read_file', phase: 'end', ok: true });
    publish({ type: 'tool_call', tool: 'read_file', phase: 'start', detail: 'styles.css' });
    publish({ type: 'file_read', path: `${DEMO_ROOT}/styles.css` });
    await sleep(700, cancelled);
    publish({ type: 'tool_call', tool: 'read_file', phase: 'end', ok: true });
    if (stopped) return;

    await streamChat(
      'demo_m2',
      'A bare page. A heading, one paragraph, no soul.\n\n' +
        'I always read before I write — an agent that edits code it has not read is just guessing. ' +
        'That is lesson one.',
      cancelled
    );
    if (stopped) return;

    // ── ACT II · Trust ─────────────────────────────────────────────────────
    await sleep(900, cancelled);
    publish({ type: 'status', status: 'thinking', detail: 'Act II — Trust' });

    await streamChat(
      'demo_m3',
      'Now I want to look around from a terminal. Watch what happens next, because this is the ' +
        'most important thing about this whole platform:\n\n' +
        'I cannot run a single command until you say yes.\n\n' +
        'Not this command. Not any command. Ever. You are about to see an approval card — ' +
        'that card is the line between an assistant and a liability.',
      cancelled
    );
    if (stopped) return;

    const term = terminals.create('agent', DEMO_ROOT, 'agent');
    publish({ type: 'tool_call', tool: 'open_terminal', phase: 'start', detail: term.name });
    publish({ type: 'tool_call', tool: 'open_terminal', phase: 'end', ok: true });
    publish({ type: 'status', status: 'waiting', detail: 'Waiting for your decision…' });

    const approvalId = `demo_ap_${Date.now().toString(36)}`;
    const decisionPromise = waitForApproval(approvalId, cancelled);
    publish({ type: 'approval_request', approvalId, command: 'ls', terminal: term.name, source: 'demo' });
    const decision = await decisionPromise;
    if (stopped) return;

    if (decision === 'run') {
      await terminals.run(term.id, 'ls', 'agent');
      await sleep(600, cancelled);
      await streamChat(
        'demo_m4',
        'Command ran, output captured, and it is all logged in the terminal below. ' +
          'That is the whole trust model: I ask, you decide, everything is visible.\n\n' +
          'Three files confirmed. Time to build.',
        cancelled
      );
    } else {
      await streamChat(
        'demo_m4',
        'Denied — and that is a perfect demonstration too. The command simply never ran. ' +
          'No workaround, no retry behind your back.\n\n' +
          'I can still see the files through my read tools, so the show goes on.',
        cancelled
      );
    }
    if (stopped) return;

    // ── ACT III · The transformation ──────────────────────────────────────
    await sleep(900, cancelled);
    publish({ type: 'status', status: 'working', detail: 'Act III — The transformation' });

    await streamChat(
      'demo_m5',
      'Here is my plan, in plain words:\n\n' +
        '1. A new design system — deep space background, aurora glow, gradient headline.\n' +
        '2. A real hero section — badge, headline, call to action.\n' +
        '3. A feature grid — three glass cards that explain the product.\n\n' +
        'Three files. Watch the file activity and then check the Preview tab.',
      cancelled
    );
    if (stopped) return;

    publish({ type: 'tool_call', tool: 'write_file', phase: 'start', detail: 'styles.css' });
    await sleep(1400, cancelled);
    await writeDemoFile(`${DEMO_ROOT}/styles.css`, NEW_STYLES);
    publish({ type: 'tool_call', tool: 'write_file', phase: 'end', ok: true });
    if (stopped) return;

    await streamChat(
      'demo_m6',
      'styles.css rewritten — 120 lines of design system in one pass: animated aurora backdrop, ' +
        'glass cards, a gradient headline that sells the product before a single word is read.',
      cancelled
    );
    if (stopped) return;

    publish({ type: 'tool_call', tool: 'write_file', phase: 'start', detail: 'index.html' });
    await sleep(1100, cancelled);
    await writeDemoFile(`${DEMO_ROOT}/index.html`, NEW_INDEX);
    publish({ type: 'tool_call', tool: 'write_file', phase: 'end', ok: true });

    publish({ type: 'tool_call', tool: 'write_file', phase: 'start', detail: 'app.js' });
    await sleep(800, cancelled);
    await writeDemoFile(`${DEMO_ROOT}/app.js`, NEW_APP_JS);
    publish({ type: 'tool_call', tool: 'write_file', phase: 'end', ok: true });
    if (stopped) return;

    // ── ACT IV · The takeaway ─────────────────────────────────────────────
    await sleep(1000, cancelled);
    publish({ type: 'status', status: 'thinking', detail: 'Act IV — The takeaway' });

    await streamChat(
      'demo_m7',
      'Look at the Preview tab. From blank page to landing page — and you watched every step.\n\n' +
        'That was the entire loop, and it never changes:\n\n' +
        'Read. Ask. Build. Show.\n\n' +
        'I read before touching anything. I asked before running anything. I built in the open. ' +
        'And the Metrics tab has the receipts — every token, every tool call, every file.\n\n' +
        'This was a simulation. The real thing works on your folders, with your AiAS key, ' +
        'and remembers every session. When you are ready, the door is on the exit button below.',
      cancelled
    );

    publish({ type: 'status', status: 'done', detail: 'Demo complete — Read. Ask. Build. Show.' });
    publish({ type: 'session', action: 'end', mode: 'demo' });
    activeStop = null;
  })().catch((e) => {
    console.error('[Demo] script error:', e);
    publish({ type: 'status', status: 'error', detail: 'Demo hit an unexpected error' });
    activeStop = null;
  });

  return stopDemo;
}
