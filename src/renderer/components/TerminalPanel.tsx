import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Plus, X, Square, TerminalSquare, Bot } from 'lucide-react';
import { terminals, type TerminalSession } from '../lib/terminal-sessions';

interface TerminalPanelProps {
  cwd: string;
}

function toCRLF(chunk: string): string {
  return chunk.replace(/\r?\n/g, '\r\n');
}

export function TerminalPanel({ cwd }: TerminalPanelProps) {
  const sessions = useSyncExternalStore(
    (cb) => terminals.subscribe(cb),
    () => terminals.list()
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
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
    term.open(hostRef.current);
    try {
      fit.fit();
    } catch {
      // host not measurable yet
    }
    term.write(toCRLF(terminals.getBuffer(active.id)));
    termRef.current = term;

    const unsub = terminals.onOutput((sessionId, chunk) => {
      if (sessionId === active.id) term.write(toCRLF(chunk));
    });
    const onResize = () => {
      try {
        fit.fit();
      } catch {
        // ignore
      }
    };
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(hostRef.current);

    return () => {
      unsub();
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [active?.id]);

  const runCommand = async () => {
    const cmd = command.trim();
    if (!cmd || !active) return;
    setCommand('');
    setHistory((prev) => [...prev.filter((h) => h !== cmd), cmd].slice(-50));
    setHistIdx(-1);
    await terminals.run(active.id, cmd, 'user');
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      runCommand();
    } else if (e.key === 'ArrowUp') {
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

  const busy = active ? terminals.isBusy(active.id) : false;

  return (
    <div className="h-full flex flex-col bg-[#07070c]">
      <div className="flex items-center border-b border-white/10 bg-black/40 overflow-x-auto flex-shrink-0">
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
            {s.createdBy === 'agent' ? (
              <Bot className="w-3 h-3 text-purple-400" />
            ) : (
              <TerminalSquare className="w-3 h-3" />
            )}
            <span className="whitespace-nowrap">{s.name}</span>
            {s.status === 'running' && (
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            )}
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
          title="New terminal"
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
          onKeyDown={onKeyDown}
          placeholder={busy ? 'command running…' : 'type a command and press Enter'}
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
