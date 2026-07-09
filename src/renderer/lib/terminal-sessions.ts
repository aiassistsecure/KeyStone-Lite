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

class TerminalManager {
  private sessions: TerminalSession[] = [];
  private listeners = new Set<TermListener>();
  private outputListeners = new Set<OutputListener>();
  private buffers = new Map<string, string>();
  private running = new Map<string, RunningExec>();
  private counter = 0;
  private wired = false;
  private unsubs: Array<() => void> = [];

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
      }),
      term.onExit((execId, code) => {
        const exec = this.running.get(execId);
        if (!exec) return;
        this.running.delete(execId);
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
