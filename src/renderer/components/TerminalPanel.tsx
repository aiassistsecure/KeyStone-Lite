import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { AlertTriangle, Bot, Cloud, Loader2, Plus, Square, TerminalSquare, X } from 'lucide-react';
import { terminals, type TerminalSession } from '../lib/terminal-sessions';
import { getKeystoneBaseUrl } from '../lib/keystone-api';
import {
  RuntimeApiError,
  RuntimeClient,
  runRemoteTerminalCommand,
} from '../lib/runtime-api';

interface TerminalPanelProps {
  cwd: string;
  envMode?: 'local' | 'remote';
  environmentId?: string;
  environmentName?: string;
  apiKey: string;
}

function toCRLF(chunk: string): string {
  return chunk.replace(/\r?\n/g, '\r\n');
}

function useCommandHistory() {
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

  const remember = (cmd: string) => {
    setHistory((prev) => [...prev.filter((h) => h !== cmd), cmd].slice(-50));
    setHistIdx(-1);
  };

  const onHistoryKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1);
      if (history[idx] !== undefined) {
        setHistIdx(idx);
        setCommand(history[idx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx < 0) return;
      const idx = histIdx + 1;
      if (idx >= history.length) {
        setHistIdx(-1);
        setCommand('');
      } else {
        setHistIdx(idx);
        setCommand(history[idx]);
      }
    }
  };

  return { command, setCommand, remember, onHistoryKeyDown };
}

function createTerminal(host: HTMLDivElement): {
  term: Terminal;
  fit: FitAddon;
  cleanup: () => void;
} {
  const term = new Terminal({
    fontSize: 12,
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    cursorBlink: false,
    disableStdin: true,
    convertEol: false,
    theme: {
      background: '#07070c',
      foreground: '#d4d4e4',
      black: '#1e1e2e',
      cyan: '#22d3ee',
      magenta: '#a78bfa',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#facc15',
      selectionBackground: '#22d3ee33',
    },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  try {
    fit.fit();
  } catch {
    // host not measurable yet
  }
  const onResize = () => {
    try {
      fit.fit();
    } catch {
      // ignore
    }
  };
  window.addEventListener('resize', onResize);
  const ro = new ResizeObserver(onResize);
  ro.observe(host);
  return {
    term,
    fit,
    cleanup: () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      term.dispose();
    },
  };
}

function LocalTerminalPanel({ cwd }: { cwd: string }) {
  const sessions = useSyncExternalStore(
    (cb) => terminals.subscribe(cb),
    () => terminals.list()
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const { command, setCommand, remember, onHistoryKeyDown } = useCommandHistory();
  const hostRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const active = sessions.find((s) => s.id === activeId) || sessions[0] || null;

  useEffect(() => {
    if (sessions.length === 0) {
      terminals.ensureDefault(cwd);
    } else if (!sessions.some((s) => s.id === activeId)) {
      setActiveId(sessions[sessions.length - 1].id);
    }
  }, [sessions, activeId, cwd]);

  useEffect(() => {
    if (!active || !hostRef.current) return;
    const surface = createTerminal(hostRef.current);
    surface.term.write(toCRLF(terminals.getBuffer(active.id)));
    const unsub = terminals.onOutput((sessionId, chunk) => {
      if (sessionId === active.id) surface.term.write(toCRLF(chunk));
    });
    return () => {
      unsub();
      surface.cleanup();
    };
  }, [active?.id]);

  const runCommand = async () => {
    const cmd = command.trim();
    if (!cmd || !active) return;
    setCommand('');
    remember(cmd);
    await terminals.run(active.id, cmd, 'user');
    inputRef.current?.focus();
  };

  const busy = active ? terminals.isBusy(active.id) : false;

  return (
    <div className="h-full flex flex-col bg-[#07070c]">
      <div className="flex items-center border-b border-white/10 bg-black/40 overflow-x-auto flex-shrink-0">
        <span className="px-2 py-1 font-mono text-[10px] tracking-[0.14em] text-emerald-300 border-r border-white/10 bg-emerald-500/10">
          LOCAL
        </span>
        {sessions.map((s: TerminalSession) => (
          <div
            key={s.id}
            className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-r border-white/5 transition-colors ${
              active?.id === s.id
                ? 'bg-white/10 text-cyan-300'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            }`}
            onClick={() => setActiveId(s.id)}
            data-testid={`tab-terminal-${s.id}`}
          >
            {s.createdBy === 'agent' ? <Bot className="w-3 h-3 text-purple-400" /> : <TerminalSquare className="w-3 h-3" />}
            <span className="whitespace-nowrap">{s.name}</span>
            {s.status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
            <button
              onClick={(e) => {
                e.stopPropagation();
                terminals.close(s.id);
              }}
              className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
              data-testid={`button-close-terminal-${s.id}`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <button
          onClick={() => {
            const t = terminals.create(`term ${terminals.list().length + 1}`, cwd, 'user');
            setActiveId(t.id);
          }}
          className="px-2 py-1.5 text-gray-500 hover:text-cyan-400 transition-colors"
          title="New local terminal"
          data-testid="button-new-terminal"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 px-2 py-1" ref={hostRef} data-testid="terminal-output" />

      <div className="flex items-center gap-2 border-t border-white/10 bg-black/40 px-3 py-1.5 flex-shrink-0">
        <span className="text-cyan-400 text-xs font-mono flex-shrink-0">
          {active ? active.cwd.split('/').pop() || '/' : '—'} ❯
        </span>
        <input
          ref={inputRef}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') runCommand();
            else onHistoryKeyDown(e);
          }}
          placeholder={busy ? 'command running…' : 'type a local command and press Enter'}
          disabled={!active}
          className="flex-1 bg-transparent text-gray-200 text-xs font-mono placeholder:text-gray-600 focus:outline-none"
          data-testid="input-terminal-command"
        />
        {busy && active && (
          <button
            onClick={() => terminals.stop(active.id)}
            className="flex items-center gap-1 text-red-400 hover:text-red-300 text-xs transition-colors"
            data-testid="button-stop-command"
          >
            <Square className="w-3 h-3" /> Stop
          </button>
        )}
      </div>
    </div>
  );
}

function RemoteTerminalPanel({
  apiKey,
  environmentId,
  environmentName,
}: {
  apiKey: string;
  environmentId: string;
  environmentName?: string;
}) {
  const { command, setCommand, remember, onHistoryKeyDown } = useCommandHistory();
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const [statusMessage, setStatusMessage] = useState('Connecting to remote runtime…');
  const [busy, setBusy] = useState(false);
  const [remoteCwd, setRemoteCwd] = useState('.');
  const hostRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const bufferRef = useRef('');
  const clientRef = useRef<RuntimeClient | null>(null);
  const runtimeSessionRef = useRef<string | null>(null);

  const write = (chunk: string) => {
    const rendered = toCRLF(chunk);
    bufferRef.current += rendered;
    termRef.current?.write(rendered);
  };

  useEffect(() => {
    if (!hostRef.current) return;
    const surface = createTerminal(hostRef.current);
    termRef.current = surface.term;
    if (bufferRef.current) surface.term.write(bufferRef.current);
    return () => {
      termRef.current = null;
      surface.cleanup();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let createdSessionId: string | null = null;
    let connectionClient: RuntimeClient | null = null;
    bufferRef.current = '';
    termRef.current?.reset();
    setStatus('connecting');
    setStatusMessage('Connecting to remote runtime…');
    setRemoteCwd('.');
    write(`KEYSTONE REMOTE TERMINAL\nENVIRONMENT: ${environmentName || environmentId}\n`);

    const connect = async () => {
      try {
        const client = new RuntimeClient(apiKey, await getKeystoneBaseUrl());
        connectionClient = client;
        const created = await client.createSession(environmentId);
        createdSessionId = created.session_id;
        await client.syncWorkspace(created.session_id, environmentId);
        if (cancelled) {
          await client.destroySession(created.session_id).catch(() => undefined);
          return;
        }
        clientRef.current = client;
        runtimeSessionRef.current = created.session_id;
        setStatus('ready');
        setStatusMessage('Remote runtime connected');
        write('CONNECTED: /workspace\nType a command below. Execution is isolated from this computer.\n\n');
        inputRef.current?.focus();
      } catch (error) {
        if (cancelled) return;
        if (connectionClient && createdSessionId) {
          await connectionClient.destroySession(createdSessionId).catch(() => undefined);
          createdSessionId = null;
        }
        const message = error instanceof RuntimeApiError ? error.friendly : error instanceof Error ? error.message : String(error);
        setStatus('error');
        setStatusMessage(message);
        write(`REMOTE CONNECTION FAILED: ${message}\n`);
      }
    };

    connect();
    return () => {
      cancelled = true;
      const client = connectionClient || clientRef.current;
      const sessionId = createdSessionId || runtimeSessionRef.current;
      clientRef.current = null;
      runtimeSessionRef.current = null;
      if (client && sessionId) client.destroySession(sessionId).catch(() => undefined);
    };
  }, [apiKey, environmentId, environmentName]);

  const runCommand = async () => {
    const cmd = command.trim();
    const client = clientRef.current;
    const sessionId = runtimeSessionRef.current;
    if (!cmd || busy || status !== 'ready' || !client || !sessionId) return;

    setCommand('');
    remember(cmd);
    if (cmd === 'clear') {
      bufferRef.current = '';
      termRef.current?.clear();
      inputRef.current?.focus();
      return;
    }

    setBusy(true);
    write(`remote:${remoteCwd === '.' ? '/workspace' : `/workspace/${remoteCwd}`} ❯ ${cmd}\n`);
    try {
      const result = await runRemoteTerminalCommand(client, sessionId, cmd, remoteCwd);
      if (result.stdout) write(`${result.stdout}${result.stdout.endsWith('\n') ? '' : '\n'}`);
      if (result.stderr) write(`\x1b[31m${result.stderr}${result.stderr.endsWith('\n') ? '' : '\n'}\x1b[0m`);
      setRemoteCwd(result.cwd);
      if (result.exit_code !== 0) write(`\x1b[33m[exit ${result.exit_code}]\x1b[0m\n`);
    } catch (error) {
      const message = error instanceof RuntimeApiError ? error.friendly : error instanceof Error ? error.message : String(error);
      write(`\x1b[31mREMOTE ERROR: ${message}\x1b[0m\n`);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const displayCwd = remoteCwd === '.' ? '/workspace' : `/workspace/${remoteCwd}`;

  return (
    <div className="h-full flex flex-col bg-[#07070c]">
      <div className="flex items-center justify-between border-b border-cyan-500/20 bg-cyan-500/[0.04] px-3 py-1.5 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Cloud className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
          <span className="font-mono text-[10px] tracking-[0.16em] text-cyan-300">REMOTE</span>
          <span className="font-mono text-xs text-gray-400 truncate">{environmentName || environmentId}</span>
        </div>
        <div className={`flex items-center gap-1.5 font-mono text-[10px] ${
          status === 'ready' ? 'text-emerald-400' : status === 'error' ? 'text-red-400' : 'text-amber-400'
        }`} title={statusMessage}>
          {status === 'connecting' && <Loader2 className="w-3 h-3 animate-spin" />}
          {status === 'error' && <AlertTriangle className="w-3 h-3" />}
          {status === 'ready' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
          {status.toUpperCase()}
        </div>
      </div>

      <div className="flex-1 min-h-0 px-2 py-1" ref={hostRef} data-testid="terminal-output-remote" />

      <div className="flex items-center gap-2 border-t border-cyan-500/20 bg-black/40 px-3 py-1.5 flex-shrink-0">
        <span className="text-cyan-400 text-xs font-mono flex-shrink-0 truncate max-w-[40%]" title={displayCwd}>
          {displayCwd} ❯
        </span>
        <input
          ref={inputRef}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') runCommand();
            else onHistoryKeyDown(e);
          }}
          placeholder={
            status === 'connecting' ? 'connecting to remote runtime…' :
            status === 'error' ? statusMessage :
            busy ? 'remote command running…' :
            'type a remote command and press Enter'
          }
          disabled={status !== 'ready' || busy}
          className="flex-1 bg-transparent text-gray-200 text-xs font-mono placeholder:text-gray-600 focus:outline-none disabled:cursor-not-allowed"
          data-testid="input-terminal-command-remote"
        />
        {busy && <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />}
      </div>
    </div>
  );
}

export function TerminalPanel({
  cwd,
  envMode = 'local',
  environmentId,
  environmentName,
  apiKey,
}: TerminalPanelProps) {
  if (envMode === 'remote') {
    if (!environmentId) {
      return (
        <div className="h-full flex items-center justify-center bg-[#07070c] text-red-300 font-mono text-xs px-6 text-center">
          REMOTE TERMINAL UNAVAILABLE: this session has no environment binding.
        </div>
      );
    }
    return (
      <RemoteTerminalPanel
        apiKey={apiKey}
        environmentId={environmentId}
        environmentName={environmentName}
      />
    );
  }
  return <LocalTerminalPanel cwd={cwd} />;
}
