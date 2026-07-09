import { useEffect, useState, useSyncExternalStore } from 'react';
import { Activity, Coins, FileEdit, FileSearch, Hammer, TerminalSquare, Timer } from 'lucide-react';
import { getMetrics, subscribeMetrics } from '../lib/metrics';

const STATUS_COLORS: Record<string, string> = {
  idle: 'bg-gray-500',
  thinking: 'bg-yellow-400',
  working: 'bg-cyan-400',
  waiting: 'bg-purple-400',
  error: 'bg-red-500',
  done: 'bg-green-400',
};

function fmtElapsed(startedAt: number | null, now: number): string {
  if (!startedAt) return '—';
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export function MetricsPanel() {
  const metrics = useSyncExternalStore(subscribeMetrics, getMetrics);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const est = metrics.estimated ? '~' : '';

  const cards = [
    {
      icon: Timer,
      label: 'Session time',
      value: fmtElapsed(metrics.startedAt, now),
      testid: 'stat-elapsed',
    },
    {
      icon: Coins,
      label: 'Tokens (in / out)',
      value: `${est}${metrics.promptTokens.toLocaleString()} / ${est}${metrics.completionTokens.toLocaleString()}`,
      sub: `est. cost $${metrics.estCostUsd.toFixed(4)}`,
      testid: 'stat-tokens',
    },
    {
      icon: Hammer,
      label: 'Tool calls',
      value: String(metrics.toolCalls),
      testid: 'stat-tool-calls',
    },
    {
      icon: TerminalSquare,
      label: 'Commands run',
      value: String(metrics.commandsRun),
      testid: 'stat-commands',
    },
  ];

  return (
    <div className="h-full overflow-y-auto bg-[#07070c] p-3">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-4 h-4 text-cyan-400" />
        <span className="text-gray-300 text-xs font-semibold">Agent metrics</span>
        <span className="flex items-center gap-1.5 ml-auto text-xs text-gray-400" data-testid="stat-status">
          <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[metrics.status] || 'bg-gray-500'} ${metrics.status === 'working' || metrics.status === 'thinking' ? 'animate-pulse' : ''}`} />
          {metrics.status}
          {metrics.statusDetail && <span className="text-gray-600">· {metrics.statusDetail}</span>}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-white/5 border border-white/10 rounded-lg p-3" data-testid={c.testid}>
            <div className="flex items-center gap-1.5 text-gray-500 text-[10px] uppercase tracking-wide mb-1">
              <c.icon className="w-3 h-3" /> {c.label}
            </div>
            <div className="text-white text-sm font-semibold font-mono">{c.value}</div>
            {c.sub && <div className="text-gray-500 text-[10px] mt-0.5">{c.sub}</div>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-gray-500 text-[10px] uppercase tracking-wide mb-2">
            <FileEdit className="w-3 h-3" /> Files written ({metrics.filesTouched.length})
          </div>
          {metrics.filesTouched.length === 0 ? (
            <div className="text-gray-600 text-xs">none yet</div>
          ) : (
            <div className="space-y-1">
              {metrics.filesTouched.slice(-8).map((f) => (
                <div key={f} className="text-cyan-300/80 text-xs font-mono truncate" data-testid={`text-file-touched-${f}`}>
                  {f}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-gray-500 text-[10px] uppercase tracking-wide mb-2">
            <FileSearch className="w-3 h-3" /> Files read ({metrics.filesRead.length})
          </div>
          {metrics.filesRead.length === 0 ? (
            <div className="text-gray-600 text-xs">none yet</div>
          ) : (
            <div className="space-y-1">
              {metrics.filesRead.slice(-8).map((f) => (
                <div key={f} className="text-purple-300/80 text-xs font-mono truncate">
                  {f}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
