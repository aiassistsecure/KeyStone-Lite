import { useSyncExternalStore } from 'react';
import { Database, LogOut, Play, KeyRound, Globe, HardDrive, ArrowDownToLine, ArrowUpFromLine, Loader2 } from 'lucide-react';
import { getMetrics, subscribeMetrics } from '../lib/metrics';
import type { SessionInfo, WorkspaceInfo } from '../types/electron';

interface StatusBarProps {
  mode: 'demo' | 'api';
  session?: SessionInfo | null;
  workspace?: WorkspaceInfo | null;
  onExit?: () => void;
  onPull?: () => void;
  onPush?: () => void;
  syncBusy?: boolean;
  syncMessage?: string;
}

const STATUS_DOT: Record<string, string> = {
  idle: 'bg-gray-500',
  thinking: 'bg-yellow-400 animate-pulse',
  working: 'bg-cyan-400 animate-pulse',
  waiting: 'bg-purple-400 animate-pulse',
  error: 'bg-red-500',
  done: 'bg-green-400',
};

export function StatusBar({ mode, session, workspace, onExit, onPull, onPush, syncBusy, syncMessage }: StatusBarProps) {
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

      {session?.envMode && (
        <span
          className={`flex items-center gap-1 font-semibold ${
            session.envMode === 'remote' ? 'text-emerald-400' : 'text-cyan-300'
          }`}
          title={
            session.envMode === 'remote'
              ? 'Working live on the Keystone environment over the API'
              : 'Working on a local checkout of the Keystone environment'
          }
          data-testid="badge-env-mode"
        >
          {session.envMode === 'remote' ? <Globe className="w-3 h-3" /> : <HardDrive className="w-3 h-3" />}
          {session.envMode === 'remote' ? 'REMOTE ENV' : 'LOCAL ENV'}
          {session.environmentName && (
            <span className="text-gray-500 font-normal truncate max-w-[140px]">· {session.environmentName}</span>
          )}
        </span>
      )}

      {session?.envMode === 'local' && (onPull || onPush) && (
        <span className="flex items-center gap-1">
          {syncBusy ? (
            <span className="flex items-center gap-1 text-cyan-300">
              <Loader2 className="w-3 h-3 animate-spin" /> syncing
            </span>
          ) : (
            <>
              {onPull && (
                <button
                  onClick={onPull}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-white/10 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors"
                  title="Pull latest changes from the environment"
                  data-testid="button-env-pull"
                >
                  <ArrowDownToLine className="w-3 h-3" /> Pull
                </button>
              )}
              {onPush && (
                <button
                  onClick={onPush}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-white/10 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors"
                  title="Push your local changes to the environment"
                  data-testid="button-env-push"
                >
                  <ArrowUpFromLine className="w-3 h-3" /> Push
                </button>
              )}
            </>
          )}
          {syncMessage && (
            <span className="text-gray-500 hidden lg:inline truncate max-w-[220px]" data-testid="text-sync-message">
              {syncMessage}
            </span>
          )}
        </span>
      )}

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
