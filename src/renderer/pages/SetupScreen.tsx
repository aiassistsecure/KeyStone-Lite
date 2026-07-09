import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Key,
  ExternalLink,
  Loader2,
  CheckCircle,
  AlertCircle,
  Sparkles,
  TerminalSquare,
  Eye,
  Database,
  ArrowLeft,
  FolderOpen,
  Folder,
  History,
  Plus,
  Play,
} from 'lucide-react';
import type { SessionInfo, WorkspaceInfo } from '../types/electron';
import { createWorkspace, listSessions, listWorkspaces } from '../lib/sessions';

export interface LaunchIntent {
  mode: 'demo' | 'api';
  apiKey: string | null;
  workspace?: WorkspaceInfo;
  session?: SessionInfo;
}

interface SetupScreenProps {
  onComplete: (intent: LaunchIntent) => void;
  initialApiKey?: string;
}

type Step = 'door' | 'key' | 'pick';

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const FEATURES = [
  {
    icon: Sparkles,
    title: 'Your key, your models',
    text: 'Bring your AiAS API key and chat with an agent that reads, edits, and writes real files in your workspace.',
  },
  {
    icon: TerminalSquare,
    title: 'Agent-driven terminals',
    text: 'The agent can open terminal tabs and run commands — every command shows an approval card before it executes.',
  },
  {
    icon: Eye,
    title: 'Live preview',
    text: 'Watch HTML come alive as the agent works, right inside the editor.',
  },
  {
    icon: Database,
    title: 'NEDB ENGINE memory',
    text: 'Sessions, chats, and workspaces persist locally in a content-addressed embedded database — and travel with each workspace folder.',
  },
];

export function SetupScreen({ onComplete, initialApiKey }: SetupScreenProps) {
  const [step, setStep] = useState<Step>('door');
  const [apiKey, setApiKey] = useState(initialApiKey || '');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState('');
  const [rememberKey, setRememberKey] = useState(true);

  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [pickBusy, setPickBusy] = useState(false);

  useEffect(() => {
    if (step !== 'pick') return;
    (async () => {
      const [ws, sess] = await Promise.all([listWorkspaces(), listSessions()]);
      setWorkspaces(ws);
      setSessions(sess.filter((s) => s.mode === 'api').slice(0, 8));
    })();
  }, [step]);

  const validateKey = async () => {
    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }
    if (!apiKey.startsWith('aai_')) {
      setError('Invalid API key format. Keys should start with "aai_"');
      return;
    }
    setIsValidating(true);
    setError('');
    try {
      const response = await fetch('https://api.aiassist.net/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) throw new Error('Invalid API key');
      if (rememberKey) {
        await window.electron.store.set('apiKey', apiKey);
      }
      setStep('pick');
    } catch {
      setError('Could not validate API key. Please check and try again.');
    } finally {
      setIsValidating(false);
    }
  };

  const openFolderAsWorkspace = async () => {
    setPickBusy(true);
    try {
      const folder = await window.electron.dialog.openFolder();
      if (folder) {
        const ws = await createWorkspace('', folder);
        onComplete({ mode: 'api', apiKey, workspace: ws });
      }
    } finally {
      setPickBusy(false);
    }
  };

  const workspaceName = (id: string) => workspaces.find((w) => w.id === id)?.name || 'workspace';

  return (
    <motion.div
      className="h-screen flex items-center justify-center bg-[#0a0a0f] relative overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-purple-500/5" />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 bg-cyan-400/30 rounded-full"
            style={{ left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%` }}
            animate={{ opacity: [0.2, 0.8, 0.2], scale: [1, 1.5, 1] }}
            transition={{ duration: 2 + Math.random() * 2, repeat: Infinity, delay: Math.random() * 2 }}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {step === 'door' && (
          <motion.div
            key="door"
            className="relative z-10 w-full max-w-3xl mx-4"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
          >
            <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 md:p-10">
              <div className="text-center mb-8">
                <motion.div
                  className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 mb-4"
                  animate={{ boxShadow: ['0 0 20px rgba(0,212,255,0.3)', '0 0 40px rgba(0,212,255,0.1)', '0 0 20px rgba(0,212,255,0.3)'] }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  <Sparkles className="w-8 h-8 text-cyan-400" />
                </motion.div>
                <h1 className="text-3xl font-bold text-white mb-2" data-testid="text-app-title">Keystone Lite</h1>
                <p className="text-gray-400 text-sm max-w-lg mx-auto">
                  A local-first AI coding studio. An agent that edits your files, runs commands in
                  real terminals with your approval, and remembers every session.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
                {FEATURES.map((f) => (
                  <div key={f.title} className="flex gap-3 bg-black/30 border border-white/10 rounded-xl p-4">
                    <f.icon className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-white text-sm font-semibold">{f.title}</div>
                      <div className="text-gray-400 text-xs leading-relaxed mt-1">{f.text}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  onClick={() => onComplete({ mode: 'demo', apiKey: null })}
                  className="group relative py-4 rounded-xl border border-purple-500/40 bg-purple-500/10 hover:bg-purple-500/20 transition-all text-left px-5"
                  data-testid="button-try-demo"
                >
                  <div className="flex items-center gap-2 text-purple-300 font-semibold">
                    <Play className="w-4 h-4" />
                    Try the Demo
                  </div>
                  <div className="text-gray-400 text-xs mt-1">
                    No API key needed. Watch the agent build a landing page — file edits, terminal
                    approvals, live preview.
                  </div>
                </button>
                <button
                  onClick={() => setStep('key')}
                  className="group relative py-4 rounded-xl border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 transition-all text-left px-5"
                  data-testid="button-use-api-key"
                >
                  <div className="flex items-center gap-2 text-cyan-300 font-semibold">
                    <Key className="w-4 h-4" />
                    Use my API key
                  </div>
                  <div className="text-gray-400 text-xs mt-1">
                    Sign in with your AiAS key, pick a workspace, or restore a previous session from
                    memory.
                  </div>
                </button>
              </div>
            </div>
            <p className="text-center text-gray-600 text-xs mt-4">
              Powered by AiAS • Multi-model AI orchestration • Memory by NEDB ENGINE
            </p>
          </motion.div>
        )}

        {step === 'key' && (
          <motion.div
            key="key"
            className="relative z-10 w-full max-w-md mx-4"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
          >
            <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8">
              <button
                onClick={() => setStep('door')}
                className="flex items-center gap-1 text-gray-500 hover:text-gray-300 text-xs mb-6 transition-colors"
                data-testid="button-back-door"
              >
                <ArrowLeft className="w-3 h-3" /> Back
              </button>
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 mb-4">
                  <Key className="w-7 h-7 text-cyan-400" />
                </div>
                <h1 className="text-xl font-bold text-white mb-2">Connect your AiAS key</h1>
                <p className="text-gray-400 text-sm">Your key stays on this machine.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">API Key</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="aai_xxxxxxxxxxxxxxxx"
                    className="w-full px-4 py-3 bg-black/50 border border-white/20 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 font-mono text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && validateKey()}
                    data-testid="input-api-key"
                  />
                </div>

                {error && (
                  <motion.div
                    className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    data-testid="text-key-error"
                  >
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {error}
                  </motion.div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="remember"
                    checked={rememberKey}
                    onChange={(e) => setRememberKey(e.target.checked)}
                    className="w-4 h-4 rounded border-white/20 bg-black/50 text-cyan-500 focus:ring-cyan-500/50"
                  />
                  <label htmlFor="remember" className="text-sm text-gray-400">
                    Remember this key
                  </label>
                </div>

                <button
                  onClick={validateKey}
                  disabled={isValidating || !apiKey.trim()}
                  className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 disabled:from-gray-600 disabled:to-gray-600 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
                  data-testid="button-validate-key"
                >
                  {isValidating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Validating...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Continue
                    </>
                  )}
                </button>
              </div>

              <div className="mt-6 pt-6 border-t border-white/10 text-center">
                <p className="text-gray-500 text-sm mb-2">Don't have an API key?</p>
                <a
                  href="https://aiassist.net"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 text-sm transition-colors"
                >
                  Get one at aiassist.net
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </motion.div>
        )}

        {step === 'pick' && (
          <motion.div
            key="pick"
            className="relative z-10 w-full max-w-3xl mx-4"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
          >
            <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8">
              <button
                onClick={() => setStep('key')}
                className="flex items-center gap-1 text-gray-500 hover:text-gray-300 text-xs mb-4 transition-colors"
                data-testid="button-back-key"
              >
                <ArrowLeft className="w-3 h-3" /> Back
              </button>
              <h1 className="text-xl font-bold text-white mb-1">Where do you want to work?</h1>
              <p className="text-gray-400 text-sm mb-6">
                Open a workspace, or restore a previous session — everything is remembered by NEDB
                ENGINE.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center gap-2 text-gray-300 text-sm font-semibold mb-3">
                    <History className="w-4 h-4 text-purple-400" />
                    Restore a session
                  </div>
                  {sessions.length === 0 ? (
                    <div className="text-gray-500 text-xs bg-black/30 border border-white/10 rounded-xl p-4">
                      No previous sessions yet. Your chats, terminals, and workspaces will show up
                      here next time.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {sessions.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => {
                            const ws = workspaces.find((w) => w.id === s.workspaceId);
                            onComplete({ mode: 'api', apiKey, session: s, workspace: ws });
                          }}
                          className="w-full text-left bg-black/30 hover:bg-purple-500/10 border border-white/10 hover:border-purple-500/40 rounded-xl px-4 py-3 transition-all"
                          data-testid={`button-restore-session-${s.id}`}
                        >
                          <div className="text-white text-sm font-medium truncate">{s.name}</div>
                          <div className="text-gray-500 text-xs mt-0.5 flex items-center gap-2">
                            <span className="truncate">{workspaceName(s.workspaceId)}</span>
                            <span>·</span>
                            <span>{timeAgo(s.lastActiveAt)}</span>
                            {typeof s.messageCount === 'number' && s.messageCount > 0 && (
                              <>
                                <span>·</span>
                                <span>{s.messageCount} messages</span>
                              </>
                            )}
                          </div>
                          {s.summary && (
                            <div className="text-gray-400 text-xs mt-1 truncate italic">"{s.summary}"</div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2 text-gray-300 text-sm font-semibold mb-3">
                    <Folder className="w-4 h-4 text-cyan-400" />
                    Workspaces
                  </div>
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1 mb-3">
                    {workspaces.map((w) => (
                      <button
                        key={w.id}
                        onClick={() => onComplete({ mode: 'api', apiKey, workspace: w })}
                        className="w-full text-left bg-black/30 hover:bg-cyan-500/10 border border-white/10 hover:border-cyan-500/40 rounded-xl px-4 py-3 transition-all"
                        data-testid={`button-open-workspace-${w.id}`}
                      >
                        <div className="text-white text-sm font-medium truncate">{w.name}</div>
                        <div className="text-gray-500 text-xs mt-0.5 font-mono truncate">{w.path}</div>
                      </button>
                    ))}
                    {workspaces.length === 0 && (
                      <div className="text-gray-500 text-xs bg-black/30 border border-white/10 rounded-xl p-4">
                        No workspaces yet — open a folder to create your first one.
                      </div>
                    )}
                  </div>
                  <button
                    onClick={openFolderAsWorkspace}
                    disabled={pickBusy}
                    className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 disabled:from-gray-600 disabled:to-gray-600 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
                    data-testid="button-open-folder"
                  >
                    {pickBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
                    Open a folder as workspace
                  </button>
                  <div className="flex items-center justify-center gap-1 text-gray-600 text-xs mt-2">
                    <Plus className="w-3 h-3" />
                    New sessions bind to the workspace you pick
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
