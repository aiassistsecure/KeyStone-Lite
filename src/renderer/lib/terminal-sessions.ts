import { publish } from './agent-events';

export interface TerminalSession {
  id: string;
  name: string;
  cwd: string;
  status: 'idle' | 'running' | 'exited';
  createdBy: 'user' | 'agent';
}

type TermListener = () => void;
type OutputListener = (sessionId: string, chunk: string) => void;

interface RunningExec {
  sessionId: string;
  captured: string;
  resolve: (result: { output: string; code: number | null }) => void;
}

const MAX_CAPTURE = 16_000;

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const LOCAL_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/gi;
const LISTEN_RE = /listening\s+(?:on\s+)?(?:port\s+)?:?\s*(\d{2,5})/gi;
const ON_PORT_RE = /on\s+port\s+:?\s*(\d{2,5})/gi;

class TerminalManager {
  private sessions: TerminalSession[] = [];
  private listeners = new Set<TermListener>();
  private outputListeners = new Set<OutputListener>();
  private buffers = new Map<string, string>();
  private running = new Map<string, RunningExec>();
  private counter = 0;
  private wired = false;
  private unsubs: Array<() => void> = [];
  private scanTails = new Map<string, string>();
  private detectedServers = new Map<string, Set<string>>();
  private activeServerUrls = new Set<string>();

  private wireBridge(): void {
    if (this.wired) return;
    const term = window.electron.terminal;
    if (!term) return;
    this.wired = true;
    this.unsubs.push(
      term.onData((execId, chunk) => {
        const exec = this.running.get(execId);
        if (!exec) return;
        exec.captured = (exec.captured + chunk).slice(-MAX_CAPTURE);
        this.appendOutput(exec.sessionId, chunk);
        this.detectServers(execId, chunk);
      }),
      term.onExit((execId, code) => {
        const exec = this.running.get(execId);
        if (!exec) return;
        this.running.delete(execId);
        this.releaseServers(execId);
        this.setStatus(exec.sessionId, 'idle');
        if (code !== null && code !== 0) {
          this.appendOutput(exec.sessionId, `\r\n\x1b[31m✗ exited with code ${code}\x1b[0m\r\n`);
        }
        exec.resolve({ output: exec.captured, code });
      })
    );
  }

  rewireBridge(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.wired = false;
    this.wireBridge();
  }

  list(): TerminalSession[] {
    return this.sessions;
  }

  get(id: string): TerminalSession | undefined {
    return this.sessions.find((s) => s.id === id);
  }

  getByName(name: string): TerminalSession | undefined {
    const n = name.trim().toLowerCase();
    return this.sessions.find((s) => s.name.toLowerCase() === n || s.id === name);
  }

  getBuffer(id: string): string {
    return this.buffers.get(id) || '';
  }

  create(name: string, cwd: string, createdBy: 'user' | 'agent' = 'user'): TerminalSession {
    const existing = this.getByName(name);
    if (existing) return existing;
    this.counter += 1;
    const session: TerminalSession = {
      id: `term_${this.counter}_${Date.now().toString(36)}`,
      name: name || `Terminal ${this.counter}`,
      cwd,
      status: 'idle',
      createdBy,
    };
    this.sessions = [...this.sessions, session];
    this.buffers.set(session.id, '');
    this.appendOutput(
      session.id,
      `\x1b[90m${createdBy === 'agent' ? 'agent opened' : 'session'} · ${session.name} · ${cwd}\x1b[0m\r\n`
    );
    this.notify();
    return session;
  }

  close(id: string): void {
    const term = window.electron.terminal;
    for (const [execId, exec] of this.running) {
      if (exec.sessionId === id) {
        term?.kill(execId);
        this.running.delete(execId);
        this.releaseServers(execId);
        exec.resolve({ output: exec.captured, code: null });
      }
    }
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.buffers.delete(id);
    this.notify();
  }

  ensureDefault(cwd: string): TerminalSession {
    if (this.sessions.length === 0) return this.create('main', cwd, 'user');
    return this.sessions[0];
  }

  appendOutput(sessionId: string, chunk: string): void {
    const prev = this.buffers.get(sessionId) || '';
    this.buffers.set(sessionId, (prev + chunk).slice(-200_000));
    for (const cb of this.outputListeners) cb(sessionId, chunk);
  }

  // Watch terminal output for local dev-server URLs ("Local: http://localhost:5173")
  // or "listening on port 3000" style lines, and announce them so the preview
  // panel can switch to a live view.
  private detectServers(execId: string, chunk: string): void {
    const clean = chunk.replace(ANSI_RE, '');
    const tail = ((this.scanTails.get(execId) || '') + clean).slice(-2000);
    this.scanTails.set(execId, tail);

    const ports = new Set<number>();
    for (const re of [LOCAL_URL_RE, LISTEN_RE, ON_PORT_RE]) {
      for (const m of tail.matchAll(re)) {
        const port = parseInt(m[1], 10);
        if (port > 0 && port <= 65535) ports.add(port);
      }
    }

    for (const port of ports) {
      const url = `http://localhost:${port}/`;
      if (this.activeServerUrls.has(url)) continue;
      this.activeServerUrls.add(url);
      let set = this.detectedServers.get(execId);
      if (!set) {
        set = new Set();
        this.detectedServers.set(execId, set);
      }
      set.add(url);
      publish({ type: 'server_detected', url, port });
    }
  }

  // Servers detected from still-running commands. Lets the preview panel
  // catch up on mount — it may not have existed when server_detected fired.
  getActiveServers(): string[] {
    return [...this.activeServerUrls];
  }

  private releaseServers(execId: string): void {
    this.scanTails.delete(execId);
    const urls = this.detectedServers.get(execId);
    if (!urls) return;
    this.detectedServers.delete(execId);
    for (const url of urls) {
      this.activeServerUrls.delete(url);
      publish({ type: 'server_lost', url });
    }
  }

  private setStatus(id: string, status: TerminalSession['status']): void {
    this.sessions = this.sessions.map((s) => (s.id === id ? { ...s, status } : s));
    this.notify();
  }

  async run(sessionId: string, command: string, source: 'user' | 'agent' = 'user'): Promise<{ output: string; code: number | null }> {
    this.wireBridge();
    const session = this.get(sessionId);
    if (!session) return { output: 'Terminal session not found.', code: 1 };
    const term = window.electron.terminal;
    if (!term) {
      const msg = 'Terminal backend unavailable (update the desktop app).';
      this.appendOutput(sessionId, `\x1b[31m${msg}\x1b[0m\r\n`);
      return { output: msg, code: 1 };
    }

    const trimmed = command.trim();
    const prompt = source === 'agent' ? '\x1b[35m❯ agent\x1b[0m' : '\x1b[36m❯\x1b[0m';
    this.appendOutput(sessionId, `${prompt} \x1b[97m${trimmed}\x1b[0m\r\n`);
    publish({ type: 'terminal', line: trimmed, stream: 'cmd' });

    const cdMatch = trimmed.match(/^cd\s+(.+)$/);
    if (cdMatch) {
      const target = cdMatch[1].replace(/["']/g, '');
      const next = target.startsWith('/')
        ? target
        : `${session.cwd}/${target}`.replace(/\/+/g, '/').replace(/\/\.$/, '');
      this.sessions = this.sessions.map((s) => (s.id === sessionId ? { ...s, cwd: next } : s));
      this.notify();
      return { output: '', code: 0 };
    }

    const execId = `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    this.setStatus(sessionId, 'running');

    const done = new Promise<{ output: string; code: number | null }>((resolve) => {
      this.running.set(execId, { sessionId, captured: '', resolve });
    });

    const res = await term.exec(execId, trimmed, session.cwd);
    if (res.error) {
      this.running.delete(execId);
      this.setStatus(sessionId, 'idle');
      this.appendOutput(sessionId, `\x1b[31m${res.error}\x1b[0m\r\n`);
      return { output: res.error, code: 1 };
    }
    return done;
  }

  stop(sessionId: string): void {
    const term = window.electron.terminal;
    for (const [execId, exec] of this.running) {
      if (exec.sessionId === sessionId) {
        term?.kill(execId);
      }
    }
  }

  isBusy(sessionId: string): boolean {
    for (const exec of this.running.values()) {
      if (exec.sessionId === sessionId) return true;
    }
    return false;
  }

  reset(): void {
    for (const s of this.sessions) this.close(s.id);
    this.sessions = [];
    this.buffers.clear();
    this.counter = 0;
    this.notify();
  }

  subscribe(cb: TermListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onOutput(cb: OutputListener): () => void {
    this.outputListeners.add(cb);
    return () => this.outputListeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }
}

export const terminals = new TerminalManager();
