import { useSyncExternalStore } from 'react';
import { Database, LogOut, Play, KeyRound } from 'lucide-react';
import { getMetrics, subscribeMetrics } from '../lib/metrics';
import type { SessionInfo, WorkspaceInfo } from '../types/electron';

interface StatusBarProps {
  mode: 'demo' | 'api';
  session?: SessionInfo | null;
  workspace?: WorkspaceInfo | null;
  onExit?: () => void;
}

const STATUS_DOT: Record<string, string> = {
  idle: 'bg-gray-500',
  thinking: 'bg-yellow-400 animate-pulse',
  working: 'bg-cyan-400 animate-pulse',
  waiting: 'bg-purple-400 animate-pulse',
  error: 'bg-red-500',
  done: 'bg-green-400',
};

export function StatusBar({ mode, session, workspace, onExit }: StatusBarProps) {
  const metrics = useSyncExternalStore(subscribeMetrics, getMetrics);
  const est = metrics.estimated ? '~' : '';

  return (
    <div className="flex items-center gap-3 h-6 px-3 bg-black/60 border-t border-white/10 text-[11px] text-gray-500 flex-shrink-0 select-none">
      <span
        className={`flex items-center gap-1 font-semibold ${
          mode === 'demo' ? 'text-purple-400' : 'text-cyan-400'
        }`}
        data-testid="badge-mode"
      >
        {mode === 'demo' ? <Play className="w-3 h-3" /> : <KeyRound className="w-3 h-3" />}
        {mode === 'demo' ? 'DEMO' : 'API'}
      </span>

      {workspace && (
        <span className="font-mono truncate max-w-[240px]" title={workspace.path} data-testid="text-status-workspace">
          {workspace.name}
        </span>
      )}
      {session && (
        <span className="truncate max-w-[200px] text-gray-600" data-testid="text-status-session">
          {session.name}
        </span>
      )}

      <span className="flex items-center gap-1.5 ml-auto" data-testid="text-status-agent">
        <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[metrics.status] || 'bg-gray-500'}`} />
        {metrics.status}
        {metrics.statusDetail && <span className="text-gray-600 hidden md:inline">· {metrics.statusDetail}</span>}
      </span>

      <span className="font-mono" data-testid="text-status-tokens">
        {est}
        {(metrics.promptTokens + metrics.completionTokens).toLocaleString()} tok · $
        {metrics.estCostUsd.toFixed(4)}
      </span>

      <span className="flex items-center gap-1 text-gray-600" title="Session memory: NEDB ENGINE">
        <Database className="w-3 h-3" /> NEDB
      </span>

      {onExit && (
        <button
          onClick={onExit}
          className="flex items-center gap-1 text-gray-500 hover:text-red-400 transition-colors"
          title="End session and return to start"
          data-testid="button-exit-session"
        >
          <LogOut className="w-3 h-3" /> Exit
        </button>
      )}
    </div>
  );
}
