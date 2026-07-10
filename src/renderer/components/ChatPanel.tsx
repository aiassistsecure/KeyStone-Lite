import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  X,
  FileCode,
  Bot,
  User,
  Copy,
  Check,
  Sparkles,
  RotateCcw,
  FileEdit,
  Paperclip,
  Play,
  ShieldAlert,
  TerminalSquare,
  Square,
  Crosshair,
} from 'lucide-react';
import type { OpenFile } from '../pages/MainLayout';
import { ModelSelector } from './ModelSelector';
import { parseSurgicalEdits, applyMultipleEdits, type SurgicalEdit } from '../lib/surgical-edit';
import { streamToolCompletion } from '../lib/stream-completion';
import { subscribe as subscribeAgentEvents, publish as publishAgentEvent } from '../lib/agent-events';
import { terminals } from '../lib/terminal-sessions';
import { KeystoneClient, getKeystoneBaseUrl, DEFAULT_KEYSTONE_BASE_URL } from '../lib/keystone-api';
import { invalidateRemoteTree } from '../lib/remote-bridge';
import { saveChatMessage, loadChatMessages, type ChatRecord } from '../lib/sessions';
import type { SessionInfo } from '../types/electron';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface CodeBlock {
  filename: string | null;
  language: string;
  code: string;
}

function parseCodeBlocks(content: string): (string | CodeBlock)[] {
  const parts: (string | CodeBlock)[] = [];
  const regex = /(?:([^\s`]+)\s*\n)?```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    
    let filename = match[1] || null;
    if (filename && !filename.includes('.')) {
      filename = null;
    }
    
    parts.push({
      filename,
      language: match[2] || 'text',
      code: match[3].trim(),
    });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts;
}

const THINKING_PHRASES = [
  { text: "PROCESSING DIRECTIVE" },
  { text: "COMPUTING SOLUTION" },
  { text: "EXECUTING WRITE OPS" },
];

interface ThinkingAnimationProps {
  activeFile?: string;
  activeTool?: string;
  activeOperation?: string;
}

function ThinkingAnimation({ activeFile, activeTool, activeOperation }: ThinkingAnimationProps) {
  const [phraseIndex, setPhraseIndex] = useState(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % THINKING_PHRASES.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);
  
  const phrase = THINKING_PHRASES[phraseIndex];
  const displayFile = activeFile ? activeFile.split(/[/\\]/).pop() : null;
  
  const getActivityLabel = () => {
    if (activeOperation === 'insert') return 'Inserting code in';
    if (activeOperation === 'replace') return 'Replacing code in';
    if (activeOperation === 'delete') return 'Deleting code in';
    if (activeOperation === 'edit') return 'Editing';
    if (activeOperation === 'create') return 'Creating';
    if (activeTool === 'surgical_edit') return 'Writing code in';
    if (activeTool === 'read_file') return 'Reading';
    if (activeTool === 'search_files') return 'Searching';
    if (activeTool === 'tavily_search') return 'Researching';
    if (activeTool === 'list_files') return 'Browsing';
    return null;
  };
  
  const activityLabel = getActivityLabel();
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3"
    >
      <div className="w-8 h-8 rounded-none border border-cyan-500/40 bg-cyan-500/10 flex items-center justify-center overflow-hidden flex-shrink-0">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
        >
          <Crosshair className="w-4 h-4 text-cyan-400" />
        </motion.div>
      </div>
      <motion.div 
        className="relative rounded-none border border-cyan-500/25 bg-black/40 px-4 py-3"
        animate={{ 
          boxShadow: [
            '0 0 0 0 rgba(34, 211, 238, 0)',
            '0 0 14px 1px rgba(34, 211, 238, 0.12)',
            '0 0 0 0 rgba(34, 211, 238, 0)'
          ]
        }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <span className="pointer-events-none absolute -top-px -left-px h-2 w-2 border-t border-l border-cyan-400/70" />
        <span className="pointer-events-none absolute -bottom-px -right-px h-2 w-2 border-b border-r border-cyan-400/70" />
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <AnimatePresence mode="wait">
              <motion.span
                key={phraseIndex}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.3 }}
                className="font-mono text-xs tracking-[0.2em] text-cyan-300"
              >
                {phrase.text}
              </motion.span>
            </AnimatePresence>
            <motion.span
              animate={{ opacity: [1, 0, 1] }}
              transition={{ duration: 0.9, repeat: Infinity }}
              className="font-mono text-xs text-cyan-400"
            >▮</motion.span>
          </div>
          {displayFile && (
            <AnimatePresence mode="wait">
              <motion.div
                key={`${activityLabel}-${displayFile}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="flex items-center gap-2 font-mono text-[11px] tracking-wider text-gray-500"
              >
                <FileCode className="w-3 h-3" />
                <span>{activityLabel && `${activityLabel.toUpperCase()} `}<span className="text-cyan-400/80">{displayFile}</span></span>
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

async function getProjectTree(projectPath: string, maxDepth = 3, maxFiles = 200): Promise<string> {
  if (!projectPath) return '';
  
  const lines: string[] = [];
  let fileCount = 0;
  
  async function traverse(path: string, depth: number, prefix: string) {
    if (depth > maxDepth || fileCount >= maxFiles) return;
    
    try {
      const result = await window.electron.fs.readDir(path);
      if ('error' in result) return;
      
      const entries = result.filter(e => 
        !e.name.startsWith('.') && 
        !['node_modules', '__pycache__', 'build', 'dist', '.git', 'target', 'vendor'].includes(e.name)
      ).sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      
      for (let i = 0; i < entries.length && fileCount < maxFiles; i++) {
        const entry = entries[i];
        const isLast = i === entries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const nextPrefix = prefix + (isLast ? '    ' : '│   ');
        
        lines.push(`${prefix}${connector}${entry.name}${entry.isDirectory ? '/' : ''}`);
        fileCount++;
        
        if (entry.isDirectory) {
          await traverse(entry.path, depth + 1, nextPrefix);
        }
      }
    } catch (e) {
      console.error('[Tree] Error reading:', path, e);
    }
  }
  
  const projectName = projectPath.split(/[/\\]/).pop() || 'project';
  lines.push(`${projectName}/`);
  await traverse(projectPath, 0, '');
  
  if (fileCount >= maxFiles) {
    lines.push(`... (truncated at ${maxFiles} files)`);
  }
  
  return lines.join('\n');
}

async function readFileInProject(projectPath: string, filePath: string): Promise<{ content: string } | { error: string }> {
  if (!projectPath) return { error: 'No project open' };
  
  const normalizedProject = projectPath.replace(/\\/g, '/').toLowerCase();
  let fullPath: string;
  
  if (/^[a-zA-Z]:[\\\/]/.test(filePath) || filePath.startsWith('/')) {
    fullPath = filePath;
  } else {
    const separator = projectPath.includes('\\') ? '\\' : '/';
    fullPath = `${projectPath}${separator}${filePath.replace(/\//g, separator)}`;
  }
  
  const normalizedFull = fullPath.replace(/\\/g, '/').toLowerCase();
  if (!normalizedFull.startsWith(normalizedProject)) {
    return { error: 'Access denied: file outside project folder' };
  }
  
  const result = await window.electron.fs.readFile(fullPath);
  if ('error' in result) return { error: result.error || 'Could not read file' };
  return { content: result.content || '' };
}

async function searchFilesInProject(
  projectPath: string, 
  pattern: string, 
  extension?: string
): Promise<{ results: Array<{ file: string; matches: string[] }> } | { error: string }> {
  if (!projectPath) return { error: 'No project open' };
  
  const results: Array<{ file: string; matches: string[] }> = [];
  const patternLower = pattern.toLowerCase();
  let fileCount = 0;
  const maxResults = 20;
  
  async function searchDir(path: string) {
    if (results.length >= maxResults) return;
    
    try {
      const entries = await window.electron.fs.readDir(path);
      if ('error' in entries) return;
      
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        if (entry.name.startsWith('.') || 
            ['node_modules', '__pycache__', 'build', 'dist', '.git', 'target'].includes(entry.name)) {
          continue;
        }
        
        if (entry.isDirectory) {
          await searchDir(entry.path);
        } else {
          if (extension && !entry.name.endsWith(extension)) continue;
          fileCount++;
          if (fileCount > 500) continue;
          
          const content = await window.electron.fs.readFile(entry.path);
          if ('error' in content || !content.content) continue;
          
          const lines = content.content.split('\n');
          const matches: string[] = [];
          for (let i = 0; i < lines.length && matches.length < 10; i++) {
            if (lines[i].toLowerCase().includes(patternLower)) {
              matches.push(`L${i + 1}: ${lines[i].trim().slice(0, 120)}`);
            }
          }
          
          if (matches.length > 0) {
            const relPath = entry.path.replace(projectPath, '').replace(/^[\\\/]/, '');
            results.push({ file: relPath, matches });
          }
        }
      }
    } catch (e) {
      console.error('[Search] Error:', e);
    }
  }
  
  await searchDir(projectPath);
  return { results };
}

const LLM_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read the contents of a file in the project. Use this to examine code before making edits.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path to the file from project root (e.g., "src/main.cpp")'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_files',
      description: 'Search for a pattern in all files. Returns matching file paths and line snippets.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Text pattern to search for (case-insensitive)'
          },
          file_extension: {
            type: 'string',
            description: 'Optional: limit to files with this extension (e.g., ".cpp", ".h")'
          }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'tavily_search',
      description: 'Search the web for information, documentation, best practices, or API references. Use this for research when you need external context.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (e.g., "React useEffect best practices", "Bitcoin RPC API documentation")'
          },
          search_depth: {
            type: 'string',
            enum: ['basic', 'advanced'],
            description: 'Search depth: basic for quick results, advanced for comprehensive research'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_command',
      description: 'Run a shell command in a terminal tab. The user must approve every command before it runs (unless they turned on auto-approve for this session). Returns the captured output.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to run (e.g., "ls -la", "npm test")'
          },
          terminal: {
            type: 'string',
            description: 'Optional terminal tab name to run in (default "main"). Use open_terminal to create named tabs.'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'open_terminal',
      description: 'Open a new named terminal tab (e.g., one for the backend, one for the frontend). Returns the tab name.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name for the terminal tab (e.g., "backend", "tests")'
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_terminals',
      description: 'List all open terminal tabs with their status and working directory.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'recall_context',
      description: 'Search earlier material from this session that was archived to keep the context window small (large tool outputs, older messages). Use this when you need details that were trimmed or archived earlier. For file contents or command output, prefer re-running the original tool for fresh data.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Keywords to search the archived context for (e.g., a function name, file path, or error text)'
          }
        },
        required: ['query']
      }
    }
  }
];

// ---- Context window management ----------------------------------------
// Tool outputs are trimmed before entering the conversation, old tool
// results are compacted as the loop progresses, and when the payload
// approaches the model's input window the older messages are archived.
// The model can search the archive with the recall_context tool.

type ConvMsg = { role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string };
type ArchiveEntry = { label: string; content: string };

const MAX_TOOL_RESULT_CHARS = 6000;
// ~4 chars per token; leaves headroom for the system prompt and the reply.
const CONTEXT_CHAR_BUDGET = 360_000;
const KEEP_RECENT_MESSAGES = 8;

const TOOL_TRIM_HINTS: Record<string, string> = {
  run_command: 'narrow the command (more specific grep pattern, add "| head -50", or target one file)',
  read_file: 'read a smaller file or use search_files to locate the exact lines you need',
  search_files: 'use a more specific pattern or limit by file extension',
  get_logs: 'request fewer lines',
  tavily_search: 'use a more specific query',
};

function trimToolResult(fnName: string, result: string): string {
  if (result.length <= MAX_TOOL_RESULT_CHARS) return result;
  const head = result.slice(0, 4200);
  const tail = result.slice(-1200);
  const hint = TOOL_TRIM_HINTS[fnName] || 're-run the tool with a narrower scope';
  return `${head}\n\n[... ${(result.length - head.length - tail.length).toLocaleString()} characters trimmed ...]\n\n${tail}\n\n(Note: this output was too large for context and was trimmed. The full output is archived — search it with recall_context, or ${hint}.)`;
}

function compactOldToolResults(msgs: ConvMsg[], archive: ArchiveEntry[], keepRecent = 3): void {
  const toolIdxs: number[] = [];
  msgs.forEach((m, i) => {
    if (m.role === 'tool') toolIdxs.push(i);
  });
  const cutoff = toolIdxs.length - keepRecent;
  for (let k = 0; k < cutoff; k++) {
    const i = toolIdxs[k];
    const content = msgs[i].content || '';
    if (content.length > 1200 && !content.startsWith('[archived')) {
      // Results trimmed at push time were already archived in full there —
      // don't archive the trimmed copy again (it would dilute search results).
      const alreadyArchived = content.includes('The full output is archived');
      if (!alreadyArchived) archive.push({ label: 'tool output', content });
      msgs[i] = {
        ...msgs[i],
        content: `[archived tool output — ${content.length.toLocaleString()} chars, began with: "${content.slice(0, 140).replace(/\s+/g, ' ')}...". Use recall_context to search it, or re-run the tool for fresh data.]`,
      };
    }
  }
}

function archiveOverflow(msgs: ConvMsg[], archive: ArchiveEntry[]): boolean {
  if (JSON.stringify(msgs).length <= CONTEXT_CHAR_BUDGET) return false;
  // Keep the system prompt (index 0) and the most recent messages. Never
  // start the kept window on a tool message — its assistant tool_call
  // partner must stay with it.
  let start = Math.max(1, msgs.length - KEEP_RECENT_MESSAGES);
  while (start > 1 && msgs[start].role === 'tool') start--;
  if (start <= 1) return false;
  const removed = msgs.splice(1, start - 1);
  for (const m of removed) {
    if (m.content && m.content.length > 0) {
      archive.push({ label: `${m.role} message`, content: m.content });
    }
  }
  msgs.splice(1, 0, {
    role: 'system',
    content: `[Context management: ${removed.length} earlier messages were archived to stay within the model's input window. Nothing is lost — use the recall_context tool to search the archived material when needed.]`,
  });
  return true;
}

function searchArchive(archive: ArchiveEntry[], query: string): string {
  if (archive.length === 0) {
    return 'The context archive is empty — nothing has been archived yet this session.';
  }
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = archive
    .map((entry, i) => {
      const lower = entry.content.toLowerCase();
      const score = terms.reduce((s, t) => s + (lower.includes(t) ? 1 : 0), 0);
      return { entry, i, score };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (scored.length === 0) {
    return `No archived content matched "${query}". The archive holds ${archive.length} entries. Try different keywords, or re-run the original tool for fresh data.`;
  }
  return (
    `Found ${scored.length} archived snippet(s):\n\n` +
    scored
      .map(({ entry, i }) => {
        const lower = entry.content.toLowerCase();
        const firstHit = terms.map((t) => lower.indexOf(t)).filter((x) => x >= 0).sort((a, b) => a - b)[0] || 0;
        const from = Math.max(0, firstHit - 400);
        const snippet = entry.content.slice(from, from + 2400);
        return `--- archive #${i + 1} (${entry.label}, ${entry.content.length.toLocaleString()} chars total) ---\n${from > 0 ? '...' : ''}${snippet}${from + 2400 < entry.content.length ? '...' : ''}`;
      })
      .join('\n\n')
  );
}

// Terminal tool names that do not apply when working inside a remote Keystone
// environment (the terminal panel itself stays local for the user, but the
// agent gets app controls against the environment instead of a local shell).
const LOCAL_TERMINAL_TOOL_NAMES = new Set(['run_command', 'open_terminal', 'list_terminals']);

const REMOTE_APP_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'start_app',
      description:
        'Start the app process inside the remote Keystone environment. Only allowlisted app commands work (npm/pnpm/yarn run|start|dev|build, python, uvicorn, flask run, node). This is NOT a shell — one long-running app process per environment. The user must approve before it runs.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'App start command (e.g., "npm run dev", "python main.py", "uvicorn app:app")'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'stop_app',
      description: 'Stop the running app process in the remote Keystone environment. The user must approve.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_logs',
      description: 'Read recent output logs from the app process running in the remote Keystone environment.',
      parameters: {
        type: 'object',
        properties: {
          lines: {
            type: 'number',
            description: 'How many recent log lines to fetch (default 100, max 500)'
          }
        }
      }
    }
  }
];

function waitForApproval(approvalId: string, signal?: AbortSignal): Promise<'run' | 'deny'> {
  return new Promise((resolve, reject) => {
    const unsub = subscribeAgentEvents((e) => {
      if (e.type === 'approval_resolved' && e.approvalId === approvalId) {
        unsub();
        resolve(e.decision);
      }
    });
    if (signal) {
      const onAbort = () => {
        unsub();
        // Dismiss the pending approval card in the UI, then bail out.
        publishAgentEvent({ type: 'approval_resolved', approvalId, decision: 'deny', auto: true });
        reject(new DOMException('Stopped by user', 'AbortError'));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

type EditorMode = 'debug' | 'focus' | 'keystone';

interface ChatPanelProps {
  apiKey: string;
  mode: 'demo' | 'api';
  session: SessionInfo | null;
  projectPath?: string | null;
  contextFiles: string[];
  openFiles: OpenFile[];
  activeFile: string | null;
  pendingMessage: string | null;
  onClearPendingMessage: () => void;
  onRemoveFromContext: (path: string) => void;
  onApplyEdit: (path: string, content: string) => void;
  onNewSession?: () => void;
}

interface ApprovalInfo {
  approvalId: string;
  command: string;
  terminal: string;
  decision: 'pending' | 'run' | 'deny';
  auto?: boolean;
  source: 'demo' | 'real';
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'approval';
  content: string;
  timestamp: Date;
  approval?: ApprovalInfo;
}

export function ChatPanel({
  apiKey,
  mode: appMode,
  session,
  contextFiles,
  openFiles,
  activeFile,
  pendingMessage,
  onClearPendingMessage,
  onRemoveFromContext,
  onApplyEdit,
  onNewSession,
  projectPath: projectPathProp = null,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>('debug');
  const [appliedMessageIds, setAppliedMessageIds] = useState<Set<string>>(new Set());
  const appliedIdsRef = useRef<Set<string>>(new Set());
  const [streamingFile, setStreamingFile] = useState<string | undefined>();
  const [streamingTool, setStreamingTool] = useState<string | undefined>();
  const [streamingOperation, setStreamingOperation] = useState<string | undefined>();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [autoApprove, setAutoApprove] = useState(false);
  const autoApproveRef = useRef(false);
  const seqRef = useRef(0);

  // Remote Keystone environment session: agent gets app controls instead of
  // local terminal tools. The user's terminal panel always stays local.
  const remoteEnvId = session?.envMode === 'remote' ? session.environmentId : undefined;
  const keystoneBaseUrlRef = useRef(DEFAULT_KEYSTONE_BASE_URL);
  const contextArchiveRef = useRef<ArchiveEntry[]>([]);
  useEffect(() => {
    if (!remoteEnvId) return;
    getKeystoneBaseUrl().then((url) => {
      keystoneBaseUrlRef.current = url;
    });
  }, [remoteEnvId]);

  const persistMessage = (role: ChatRecord['role'], content: string, meta?: Record<string, unknown>) => {
    if (!session) return;
    const record: ChatRecord = { seq: seqRef.current++, role, content, ts: Date.now(), ...(meta ? { meta } : {}) };
    void saveChatMessage(session, record).catch((e) => console.warn('[Chat] persist failed:', e));
  };

  useEffect(() => {
    autoApproveRef.current = autoApprove;
  }, [autoApprove]);

  // Restore the persisted transcript when a session opens.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const records = await loadChatMessages(session);
        if (cancelled || records.length === 0) {
          if (!cancelled) seqRef.current = 0;
          return;
        }
        seqRef.current = records[records.length - 1].seq + 1;
        const restored: Message[] = records
          .filter((r) => r.role === 'user' || r.role === 'assistant' || r.role === 'approval')
          .map((r) => ({
            id: `hist_${r.seq}`,
            role: r.role as Message['role'],
            content: r.content,
            timestamp: new Date(r.ts),
            ...(r.role === 'approval'
              ? {
                  approval: {
                    approvalId: String(r.meta?.approvalId || ''),
                    command: String(r.meta?.command || r.content),
                    terminal: String(r.meta?.terminal || 'main'),
                    decision: (r.meta?.decision === 'run' ? 'run' : 'deny') as ApprovalInfo['decision'],
                    auto: Boolean(r.meta?.auto),
                    source: (r.meta?.source === 'demo' ? 'demo' : 'real') as ApprovalInfo['source'],
                  },
                }
              : {}),
          }));
        setMessages(restored);
      } catch (e) {
        console.warn('[Chat] transcript restore failed:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.id]);

  // Agent event bus: demo chat stream + command approval cards.
  useEffect(() => {
    const unsub = subscribeAgentEvents((e) => {
      if (e.type === 'chat_delta') {
        setMessages((prev) => {
          const exists = prev.some((m) => m.id === e.msgId);
          if (exists) {
            return prev.map((m) => (m.id === e.msgId ? { ...m, content: m.content + e.delta } : m));
          }
          return [...prev, { id: e.msgId, role: 'assistant', content: e.delta, timestamp: new Date() }];
        });
      } else if (e.type === 'chat_done') {
        setMessages((prev) => {
          const msg = prev.find((m) => m.id === e.msgId);
          if (msg && msg.content) persistMessage('assistant', msg.content);
          return prev;
        });
      } else if (e.type === 'approval_request') {
        const approval: ApprovalInfo = {
          approvalId: e.approvalId,
          command: e.command,
          terminal: e.terminal,
          decision: 'pending',
          source: e.source,
        };
        if (autoApproveRef.current) {
          approval.decision = 'run';
          approval.auto = true;
          setMessages((prev) => [
            ...prev,
            { id: `approval_${e.approvalId}`, role: 'approval', content: e.command, timestamp: new Date(), approval },
          ]);
          persistMessage('approval', e.command, { ...approval });
          publishAgentEvent({ type: 'approval_resolved', approvalId: e.approvalId, decision: 'run', auto: true });
        } else {
          setMessages((prev) => [
            ...prev,
            { id: `approval_${e.approvalId}`, role: 'approval', content: e.command, timestamp: new Date(), approval },
          ]);
        }
      } else if (e.type === 'approval_resolved') {
        setMessages((prev) =>
          prev.map((m) =>
            m.approval?.approvalId === e.approvalId && m.approval.decision === 'pending'
              ? { ...m, approval: { ...m.approval, decision: e.decision, auto: e.auto } }
              : m
          )
        );
      }
    });
    return unsub;
  }, [session?.id]);

  const resolvedApprovalsRef = useRef<Set<string>>(new Set());

  const resolveApproval = (message: Message, decision: 'run' | 'deny') => {
    if (!message.approval || message.approval.decision !== 'pending') return;
    if (resolvedApprovalsRef.current.has(message.approval.approvalId)) return;
    resolvedApprovalsRef.current.add(message.approval.approvalId);
    persistMessage('approval', message.approval.command, { ...message.approval, decision });
    publishAgentEvent({ type: 'approval_resolved', approvalId: message.approval.approvalId, decision, auto: false });
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (pendingMessage && !isLoading) {
      setInput(pendingMessage);
      onClearPendingMessage();
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [pendingMessage]);

  useEffect(() => {
    console.log('[AutoApply] Effect triggered - isLoading:', isLoading, 'mode:', mode);
    if (isLoading) return;
    if (mode !== 'keystone' && mode !== 'focus') return;
    
    const lastMessage = messages[messages.length - 1];
    console.log('[AutoApply] Last message:', lastMessage?.role, 'hasContent:', !!lastMessage?.content, 'alreadyApplied:', appliedIdsRef.current.has(lastMessage?.id || ''));
    
    if (lastMessage?.role === 'assistant' && lastMessage.content && !appliedIdsRef.current.has(lastMessage.id)) {
      const { edits } = parseSurgicalEdits(lastMessage.content);
      console.log('[AutoApply] Parsed edits:', edits.length, edits.map(e => `${e.type}:${e.file}`));
      
      if (edits.length > 0) {
        if (mode === 'focus') {
          const mdEdits = edits.filter(e => e.file.endsWith('.md'));
          console.log('[Focus] .md edits found:', mdEdits.length, mdEdits.map(e => e.file));
          if (mdEdits.length > 0) {
            console.log('[Focus] Auto-applying .md files:', mdEdits.map(e => e.file));
            appliedIdsRef.current.add(lastMessage.id);
            setAppliedMessageIds(prev => new Set(prev).add(lastMessage.id));
            applySurgicalEdits(mdEdits);
          }
        } else {
          console.log('[Keystone] Auto-applying all edits');
          appliedIdsRef.current.add(lastMessage.id);
          setAppliedMessageIds(prev => new Set(prev).add(lastMessage.id));
          applySurgicalEdits(edits);
        }
      }
    }
  }, [isLoading, mode, messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;
    if (appMode === 'demo') return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    persistMessage('user', userMessage.content);
    publishAgentEvent({ type: 'status', status: 'working', detail: 'Assistant is thinking' });
    setInput('');
    setIsLoading(true);

    // Stop button support: aborting this controller cuts the network stream,
    // cancels pending approvals, and exits the tool loop at the next check.
    const abortController = new AbortController();
    abortRef.current = abortController;
    const throwIfAborted = () => {
      if (abortController.signal.aborted) {
        throw new DOMException('Stopped by user', 'AbortError');
      }
    };
    // Tracks streamed text so a stopped turn can keep its partial reply.
    let partialText = '';

    const assistantMessageId = (Date.now() + 1).toString();

    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      },
    ]);

    try {
      const model = await window.electron.store.get('defaultModel');
      const provider = await window.electron.store.get('defaultProvider');
      const storedTemperature = await window.electron.store.get('temperature') || 0.7;
      const isClaude = /claude/i.test(model || '') || provider === 'anthropic';
      // Frontier models (Claude/Anthropic) require temperature 1.0 — auto-set
      // it so requests comply with the provider regardless of the saved setting.
      const temperature = isClaude ? 1.0 : storedTemperature;
      const storedMaxTokens = await window.electron.store.get('maxTokens');
      // 8192 was the old default cap — treat it as unset so existing users
      // get the new 100k default without having to touch settings.
      const rawMaxTokens = !storedMaxTokens || storedMaxTokens === 8192 ? 102400 : storedMaxTokens;
      // Anthropic rejects max_tokens above the model's output ceiling (64k
      // for Sonnet, 32k for Opus) with a 400 — clamp instead of failing.
      const claudeCeiling = /opus/i.test(model || '') ? 32000 : 64000;
      const maxTokens = isClaude ? Math.min(rawMaxTokens, claudeCeiling) : rawMaxTokens;

      const filesToInclude = new Set(contextFiles);
      if (activeFile) filesToInclude.add(activeFile);
      
      const contextContent = Array.from(filesToInclude)
        .map((path) => {
          const file = openFiles.find((f) => f.path === path || f.path.endsWith(path) || path.endsWith(f.path));
          if (file && file.content) {
            const numberedLines = file.content
              .split('\n')
              .map((line, i) => `${(i + 1).toString().padStart(4, ' ')}| ${line}`)
              .join('\n');
            const isActive = file.path === activeFile ? ' (active)' : '';
            console.log(`[Context] Adding file: ${file.name}${isActive}, lines: ${file.content.split('\n').length}`);
            return `File: ${file.name}${isActive}\n\`\`\`${file.language}\n${numberedLines}\n\`\`\``;
          }
          return null;
        })
        .filter(Boolean)
        .join('\n\n');

      const runToolsList = remoteEnvId
        ? `- start_app(command): Start the app in the remote environment (user approves first)
- stop_app(): Stop the running remote app
- get_logs(lines?): Read recent output from the remote app`
        : `- run_command(command, terminal?): Run a shell command in a terminal tab (user approves first). Use for builds, tests, installs — NOT for reading files (use read_file) or searching (use search_files)
- open_terminal(name): Open a named terminal tab (e.g., one for backend, one for tests)
- list_terminals(): List open terminal tabs`;

      const keystoneModeInstructions = `
YOU ARE IN KEYSTONE (CREATIVE) MODE.

WORKFLOW (follow this order):
1. GATHER: Use read_file and search_files to understand the relevant code (3-8 calls typically)
2. ANALYZE: Once you have enough context, stop reading
3. PRODUCE: Generate your response with specific code suggestions, edits, or solutions

TOOLS AVAILABLE:
- read_file(path): Read any file in the project. Use relative paths like "src/main.cpp". ALWAYS prefer this over shell commands like cat/grep for reading code
- search_files(pattern, file_extension?): Search for text patterns across files. Prefer this over shell grep
- tavily_search(query, search_depth?): Search the web for docs, APIs, best practices
- recall_context(query): Search earlier material from this session that was trimmed or archived out of context (old tool outputs, earlier messages)
${runToolsList}

CONTEXT MANAGEMENT (how your context window works):
- Large tool outputs get trimmed (start + end kept, middle cut) and the full version is archived
- Older tool outputs are compacted to stubs as you work; if the conversation gets too big, the oldest messages are archived automatically
- If you need trimmed or archived details: call recall_context, or better, re-run the tool with a narrower scope (specific file, tighter pattern)
- Keep outputs small on purpose: read specific files instead of dumping directories, search with tight patterns

IMPORTANT RULES:
- Maximum 15 tool calls - be strategic, don't read every file
- After reading 3-8 key files, you likely have enough context - STOP and produce output
- Your final response MUST include actionable suggestions, code examples, or edits
- Never end with just "I've read the files" - always provide solutions

When outputting code changes, use this EXACT format:

<<<EDIT filename.ext>>>
<<<REPLACE lines X-Y>>>
complete new code for those lines
<<<END>>>

For NEW files, use:
<<<EDIT path/to/newfile.ext>>>
<<<CREATE>>>
complete file content here
<<<END>>>

EDIT FORMAT RULES:
1. ALWAYS use the exact format above - <<<EDIT>>>, then operation, then <<<END>>>
2. Operations: REPLACE lines X-Y, INSERT after line X, DELETE lines X-Y, CREATE (for new files)
3. Output the COMPLETE code between the operation and END - never truncate or use "..." or "// rest of code"
4. You can use multiple REPLACE blocks in one EDIT for different sections
5. Line numbers MUST match the file you read (use read_file to get line numbers)

DO NOT:
- Show code snippets outside the EDIT format
- Use placeholder comments like "// ... rest remains the same"
- Truncate code - always output complete sections
- Skip the <<<END>>> tag
`;

      const debugModeInstructions = filesToInclude.size > 0 ? `
YOU ARE IN DEBUG MODE. Make minimal, surgical edits to fix issues. Use this format:

<<<EDIT filename.ext>>>
<<<REPLACE lines 5-10>>>
new code here
<<<END>>>

Commands: REPLACE lines X-Y, INSERT after line X, DELETE lines X-Y
The user has an "Apply All" button that applies your edits automatically.
Always use line numbers from the context files shown below.
` : '';

      const focusModeInstructions = `
YOU ARE IN FOCUS MODE - DOCUMENTATION & RESEARCH SPECIALIST.

Your role is to UNDERSTAND, RESEARCH, and DOCUMENT - NOT to write or modify code.

TOOLS AVAILABLE:
- read_file(path): Read any file to understand the codebase
- search_files(pattern): Search for patterns across the project
- tavily_search(query): Search the web for documentation, best practices, API references
- recall_context(query): Search earlier session material that was trimmed or archived out of context

NOTE: Large tool outputs are trimmed and archived automatically. Use recall_context to retrieve archived details, or re-run a tool with a narrower scope.

WORKFLOW:
1. EXPLORE: Use tools to understand the codebase structure and purpose
2. RESEARCH: Use tavily_search for external context (APIs, libraries, best practices)
3. ASK: If you need more context, ask the user specific clarifying questions
4. SYNTHESIZE: Create or update documentation in Markdown format

CRITICAL OUTPUT RULES:
- You may ONLY create/edit .md files (documentation)
- NEVER output edits for .ts, .js, .py, or any code files
- NEVER suggest code changes - your job is ONLY documentation
- Use proper Markdown formatting (headers, lists, code blocks for examples)
- When updating existing docs, use surgical EDIT blocks to modify specific sections (efficient!)
- End with: "Ready to build? Switch to Keystone mode!"

DOCUMENTATION TYPES:
- Project specs and architecture (docs/spec.md, docs/architecture.md)
- Implementation plans and task breakdowns (docs/plan.md)
- API documentation (docs/api.md)
- README files (README.md)
- Technical decision documents (docs/decisions.md)

TO CREATE A NEW DOCUMENT:
<<<CREATE docs/filename.md>>>
# Document Title
Your markdown content here...
<<<END>>>

TO UPDATE AN EXISTING DOCUMENT (preferred for iterations):
<<<EDIT docs/existing.md>>>
<<<REPLACE lines 15-20>>>
Updated section content here...
<<<END>>>
`;

      const modeInstructions = mode === 'keystone' 
        ? keystoneModeInstructions 
        : mode === 'focus' 
          ? focusModeInstructions 
          : debugModeInstructions;

      const openFilesList = openFiles.length > 0 
        ? `\nOpen files: ${openFiles.map(f => f.name).join(', ')}`
        : '';
      
      // The workspace prop is the source of truth for the open project —
      // the stored setting only updates via "Open Folder", so it goes stale
      // when a session or environment is restored.
      const projectPath = projectPathProp || (await window.electron.store.get('projectPath'));
      const projectTree = projectPath ? await getProjectTree(projectPath as string) : '';
      
      const systemPrompt = `You are Keystone Lite, an AI code editor. You help users write, debug, and improve code.
${modeInstructions}${openFilesList}
${projectTree ? `\nProject structure:\n\`\`\`\n${projectTree}\n\`\`\`\n` : ''}
${contextContent ? `\nFiles in context:\n${contextContent}` : ''}`;

      console.log('[Chat] System prompt length:', systemPrompt.length, 'Context files:', contextFiles.length);
      
      const conversationMessages: ConvMsg[] = [
        { role: 'system', content: systemPrompt },
        // Only real user/assistant turns with content — empty assistant
        // messages (from failed replies) and approval cards make providers
        // like Anthropic reject the whole request with a 400.
        ...messages
          .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content && m.content.trim())
          .map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: input.trim() },
      ];
      
      if (mode === 'keystone' || mode === 'focus') {
        let toolLoopCount = 0;
        const maxToolLoops = 15;
        
        const modeLabel = mode === 'focus' ? 'Focus' : 'Keystone';
        console.log(`[${modeLabel}] Starting tool-enabled chat, tools:`, LLM_TOOLS.map(t => t.function.name));
        
        while (toolLoopCount < maxToolLoops) {
          throwIfAborted();
          const forceFinish = toolLoopCount >= 12;
          // Context window tracking: compact older tool outputs every round,
          // and archive the oldest messages when the payload nears the
          // model's input window. The model can recall archived material
          // with the recall_context tool.
          compactOldToolResults(conversationMessages, contextArchiveRef.current);
          if (archiveOverflow(conversationMessages, contextArchiveRef.current)) {
            console.log('[Context] Overflow archived; archive entries:', contextArchiveRef.current.length);
          }
          const payloadSize = JSON.stringify(conversationMessages).length;
          console.log('[Keystone] Loop', toolLoopCount + 1, 'messages:', conversationMessages.length, 'payload size:', Math.round(payloadSize / 1024), 'KB', forceFinish ? '(forcing finish)' : '');
          console.log('[Keystone] Last 2 messages:', JSON.stringify(conversationMessages.slice(-2)).slice(0, 1000));
          
          const startTime = Date.now();
          console.log('[Keystone] Starting streaming API call at:', new Date().toISOString());
          
          const forceFinishMessage = mode === 'focus'
            ? 'You have gathered enough context. Now PRODUCE your comprehensive documentation in Markdown format. Create .md files with your specs, analysis, and recommendations. End with "Ready to build? Switch to Keystone mode!"'
            : 'You have gathered the file content. Now PRODUCE your response with the surgical edit format. Do not request more tools.';
          
          const messagesForRequest = forceFinish 
            ? [...conversationMessages, { role: 'system', content: forceFinishMessage }]
            : conversationMessages;
          
          const activeTools = remoteEnvId
            ? [...LLM_TOOLS.filter((t) => !LOCAL_TERMINAL_TOOL_NAMES.has(t.function.name)), ...REMOTE_APP_TOOLS]
            : LLM_TOOLS;
          const toolData = await streamToolCompletion({
            apiKey,
            model: model || 'llama-3.3-70b-versatile',
            messages: messagesForRequest,
            tools: forceFinish ? undefined : activeTools,
            tool_choice: forceFinish ? undefined : 'auto',
            temperature,
            maxTokens,
            provider: provider || undefined,
            signal: abortController.signal,
            onToolActivity: (toolName, filePath, operation) => {
              setStreamingTool(toolName);
              if (filePath) setStreamingFile(filePath);
              if (operation) setStreamingOperation(operation);
            },
          });
          
          console.log('[Keystone] Streaming API call completed in', Date.now() - startTime, 'ms');
          console.log('[Keystone] Response received:', JSON.stringify(toolData).slice(0, 500));
          
          const choice = toolData.choices?.[0];
          const toolCalls = choice?.message?.tool_calls;
          
          console.log('[Keystone] Tool calls:', toolCalls ? toolCalls.length : 'none');
          
          if (!toolCalls || toolCalls.length === 0) {
            const finalContent = choice?.message?.content || '';
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId ? { ...m, content: finalContent } : m
              )
            );
            if (finalContent) persistMessage('assistant', finalContent);
            publishAgentEvent({
              type: 'tokens',
              prompt: Math.round(JSON.stringify(messagesForRequest).length / 4),
              completion: Math.round(finalContent.length / 4),
              estimated: true,
            });
            break;
          }
          
          conversationMessages.push({
            role: 'assistant',
            content: choice.message.content || undefined,
            tool_calls: toolCalls,
          });
          
          for (const toolCall of toolCalls) {
            throwIfAborted();
            const fnName = toolCall.function.name;
            const args = JSON.parse(toolCall.function.arguments || '{}');
            let result: string;
            
            const getToolStatusMessage = () => {
              if (fnName === 'read_file') return `🔍 Reading ${args.path}...`;
              if (fnName === 'search_files') return `🔎 Searching for "${args.pattern}"...`;
              if (fnName === 'tavily_search') return `🌐 Researching: ${args.query}...`;
              if (fnName === 'recall_context') return `Recalling archived context: ${args.query}...`;
              if (fnName === 'run_command') return `Waiting to run: ${args.command}`;
              if (fnName === 'open_terminal') return `Opening terminal "${args.name}"...`;
              if (fnName === 'list_terminals') return `Checking open terminals...`;
              if (fnName === 'start_app') return `Waiting to start app: ${args.command}`;
              if (fnName === 'stop_app') return `Waiting to stop the remote app...`;
              if (fnName === 'get_logs') return `Reading remote app logs...`;
              return `⚙️ Running ${fnName}...`;
            };

            publishAgentEvent({
              type: 'tool_call',
              tool: fnName,
              phase: 'start',
              detail: String(args.path || args.pattern || args.query || args.command || args.name || ''),
            });
            
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId 
                  ? { ...m, content: getToolStatusMessage() }
                  : m
              )
            );
            
            if (fnName === 'read_file') {
              const readResult = await readFileInProject(projectPath as string, args.path);
              if ('error' in readResult) {
                result = `Error: ${readResult.error}`;
              } else {
                const lines = readResult.content.split('\n').map((l, i) => `${(i+1).toString().padStart(4)}| ${l}`).join('\n');
                result = `File: ${args.path}\n\`\`\`\n${lines}\n\`\`\``;
              }
            } else if (fnName === 'search_files') {
              console.log('[search_files] Searching for:', args.pattern, 'ext:', args.file_extension);
              const searchResult = await searchFilesInProject(projectPath as string, args.pattern, args.file_extension);
              console.log('[search_files] Result:', searchResult);
              if ('error' in searchResult) {
                result = `Error: ${searchResult.error}`;
              } else if (searchResult.results.length === 0) {
                result = `No matches found for "${args.pattern}"${args.file_extension ? ` in *${args.file_extension} files` : ''}`;
              } else {
                result = `Found ${searchResult.results.length} files:\n\n` + 
                  searchResult.results.map(r => `${r.file}:\n${r.matches.join('\n')}`).join('\n\n');
              }
              console.log('[search_files] Returning:', result.slice(0, 300));
            } else if (fnName === 'tavily_search') {
              console.log('[tavily_search] Searching for:', args.query);
              try {
                const tavilyResponse = await fetch('https://api.aiassist.net/v1/search', {
                  method: 'POST',
                  signal: abortController.signal,
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                  },
                  body: JSON.stringify({
                    query: args.query,
                    search_depth: args.search_depth || 'basic',
                  }),
                });
                if (!tavilyResponse.ok) {
                  result = `Search error: ${tavilyResponse.status}`;
                } else {
                  const tavilyData = await tavilyResponse.json();
                  const searchResults = tavilyData.results || [];
                  if (searchResults.length === 0) {
                    result = `No results found for: "${args.query}"`;
                  } else {
                    result = `Search results for "${args.query}":\n\n` +
                      searchResults.slice(0, 5).map((r: { title: string; url: string; content: string }) => 
                        `**${r.title}**\n${r.url}\n${r.content?.slice(0, 500) || ''}`
                      ).join('\n\n---\n\n');
                  }
                }
              } catch (e) {
                result = `Search error: ${e instanceof Error ? e.message : 'Unknown error'}`;
              }
              console.log('[tavily_search] Returning:', result.slice(0, 300));
            } else if (fnName === 'open_terminal') {
              const t = terminals.create(String(args.name || 'agent'), (projectPath as string) || '/', 'agent');
              result = `Terminal "${t.name}" is open (cwd: ${t.cwd}).`;
            } else if (fnName === 'list_terminals') {
              const all = terminals.list();
              result = all.length
                ? all.map((t) => `${t.name} — ${t.status} — ${t.cwd}`).join('\n')
                : 'No terminals are open yet.';
            } else if (fnName === 'run_command') {
              const command = String(args.command || '').trim();
              if (!command) {
                result = 'Error: run_command needs a command.';
              } else {
                const termName = String(args.terminal || 'main').trim() || 'main';
                const t =
                  terminals.getByName(termName) ||
                  terminals.create(termName, (projectPath as string) || '/', 'agent');
                const approvalId = `ap_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
                publishAgentEvent({ type: 'status', status: 'waiting', detail: 'Waiting for command approval' });
                const decisionPromise = waitForApproval(approvalId, abortController.signal);
                publishAgentEvent({
                  type: 'approval_request',
                  approvalId,
                  command,
                  terminal: t.name,
                  source: 'real',
                });
                const decision = await decisionPromise;
                publishAgentEvent({ type: 'status', status: 'working', detail: 'Assistant is working' });
                if (decision === 'run') {
                  const res = await terminals.run(t.id, command, 'agent');
                  result =
                    res.code === 0
                      ? `Command finished.\nOutput:\n${res.output || '(no output)'}`
                      : `Command exited with code ${res.code}.\nOutput:\n${res.output || '(no output)'}`;
                } else {
                  result =
                    'The user denied this command. Do not run it again; ask the user how to proceed or continue without it.';
                }
              }
            } else if (fnName === 'start_app' || fnName === 'stop_app') {
              if (!remoteEnvId) {
                result = 'Error: no remote environment is attached to this session.';
              } else {
                const command = fnName === 'start_app' ? String(args.command || '').trim() : 'stop the running app';
                if (fnName === 'start_app' && !command) {
                  result = 'Error: start_app needs a command.';
                } else {
                  const approvalId = `ap_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
                  publishAgentEvent({ type: 'status', status: 'waiting', detail: 'Waiting for approval' });
                  const decisionPromise = waitForApproval(approvalId, abortController.signal);
                  publishAgentEvent({
                    type: 'approval_request',
                    approvalId,
                    command: fnName === 'start_app' ? command : 'Stop the remote app',
                    terminal: 'remote app',
                    source: 'real',
                  });
                  const decision = await decisionPromise;
                  publishAgentEvent({ type: 'status', status: 'working', detail: 'Assistant is working' });
                  if (decision === 'run') {
                    const client = new KeystoneClient(apiKey, keystoneBaseUrlRef.current);
                    try {
                      if (fnName === 'start_app') {
                        const res = await client.run(remoteEnvId, command);
                        invalidateRemoteTree();
                        result = `App started.\nStatus: ${res.status}\nCommand: ${res.command}${
                          res.port ? `\nPort: ${res.port}` : ''
                        }${res.pid ? `\nPID: ${res.pid}` : ''}\nUse get_logs to check output.`;
                      } else {
                        const res = await client.stop(remoteEnvId);
                        result = res.stopped
                          ? 'App stopped.'
                          : 'No app process was running.';
                      }
                    } catch (e) {
                      result = `Error: ${e instanceof Error ? e.message : String(e)}`;
                    }
                  } else {
                    result =
                      'The user denied this action. Do not try it again; ask the user how to proceed or continue without it.';
                  }
                }
              }
            } else if (fnName === 'recall_context') {
              const query = String(args.query || '').trim();
              result = query
                ? searchArchive(contextArchiveRef.current, query)
                : 'Error: recall_context needs a query.';
            } else if (fnName === 'get_logs') {
              if (!remoteEnvId) {
                result = 'Error: no remote environment is attached to this session.';
              } else {
                const client = new KeystoneClient(apiKey, keystoneBaseUrlRef.current);
                try {
                  const lines = Math.min(Math.max(Number(args.lines) || 100, 1), 500);
                  const res = await client.getLogs(remoteEnvId, lines);
                  const logs = Array.isArray(res.logs) ? res.logs.join('\n') : typeof res.logs === 'string' ? res.logs : JSON.stringify(res);
                  result = logs.trim() ? `Recent app logs:\n${logs}` : 'No log output yet.';
                } catch (e) {
                  result = `Error: ${e instanceof Error ? e.message : String(e)}`;
                }
              }
            } else {
              result = `Unknown tool: ${fnName}`;
            }

            publishAgentEvent({
              type: 'tool_call',
              tool: fnName,
              phase: 'end',
              ok: !result.startsWith('Error'),
            });
            
            const storedResult = trimToolResult(fnName, result);
            if (storedResult !== result && fnName !== 'recall_context') {
              // Full output goes to the archive so recall_context can find
              // it. recall_context output is already derived from the
              // archive — re-archiving it would create recursive noise.
              contextArchiveRef.current.push({ label: `${fnName} output`, content: result });
            }
            conversationMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: storedResult,
            });
            
            console.log(`[Tool] ${fnName}:`, args, '→', result.slice(0, 200));
          }
          
          toolLoopCount++;
        }
        
        publishAgentEvent({ type: 'status', status: 'idle' });
        setIsLoading(false);
        setStreamingFile(undefined);
        setStreamingTool(undefined);
        setStreamingOperation(undefined);
        return;
      }
      
      const response = await fetch('https://api.aiassist.net/v1/chat/completions', {
        method: 'POST',
        signal: abortController.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(provider && { 'X-AiAssist-Provider': provider }),
        },
        body: JSON.stringify({
          model: model || 'llama-3.3-70b-versatile',
          messages: conversationMessages,
          stream: true,
          temperature,
          max_tokens: maxTokens,
          max_completion_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.detail || errorData.error?.message || `API request failed (${response.status})`;
        throw new Error(errorMsg);
      }

      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('text/event-stream')) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let accumulatedContent = '';

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;

                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta?.content || '';
                  accumulatedContent += delta;
                  partialText = accumulatedContent;

                  // Detect surgical edit operations from streaming content
                  const editMatch = accumulatedContent.match(/<<<(EDIT|INSERT|REPLACE|DELETE|CREATE)>>>\s*\n\s*([^\n]+)/);
                  if (editMatch) {
                    const op = editMatch[1].toLowerCase();
                    const filePath = editMatch[2].replace(/^(file:|path:)\s*/i, '').trim();
                    const opLabels: Record<string, string> = {
                      'edit': 'Editing',
                      'insert': 'Inserting code in',
                      'replace': 'Replacing code in',
                      'delete': 'Removing code from',
                      'create': 'Creating',
                    };
                    setStreamingOperation(opLabels[op] || 'Processing');
                    if (filePath) setStreamingFile(filePath);
                    setStreamingTool('surgical_edit');
                  }

                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessageId
                        ? { ...m, content: accumulatedContent }
                        : m
                    )
                  );
                } catch {
                }
              }
            }
          }
        }
        if (accumulatedContent) persistMessage('assistant', accumulatedContent);
        publishAgentEvent({
          type: 'tokens',
          prompt: Math.round(JSON.stringify(conversationMessages).length / 4),
          completion: Math.round(accumulatedContent.length / 4),
          estimated: true,
        });
      } else {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? { ...m, content }
              : m
          )
        );
        if (content) persistMessage('assistant', content);
        publishAgentEvent({
          type: 'tokens',
          prompt: Math.round(JSON.stringify(conversationMessages).length / 4),
          completion: Math.round(content.length / 4),
          estimated: true,
        });
      }
    } catch (error) {
      const wasStopped =
        abortController.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError');
      if (wasStopped) {
        // Keep whatever streamed in before the stop, and mark the turn so
        // the model knows this reply was cut short by the user.
        const stoppedContent = partialText
          ? `${partialText}\n\n*[Stopped by user]*`
          : '*[Stopped by user]*';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId ? { ...m, content: stoppedContent } : m
          )
        );
        persistMessage('assistant', stoppedContent);
      } else {
        const errorText = error instanceof Error ? error.message : 'Unknown error occurred';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? { ...m, content: `Error: ${errorText}` }
              : m
          )
        );
      }
    } finally {
      if (abortRef.current === abortController) abortRef.current = null;
      publishAgentEvent({ type: 'status', status: 'idle' });
      setIsLoading(false);
      setStreamingFile(undefined);
      setStreamingTool(undefined);
      setStreamingOperation(undefined);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const clearChat = () => {
    // Roll a fresh session so the model gets clean context, while the old
    // chat stays persisted in the session list for review or reattaching.
    if (onNewSession) {
      onNewSession();
      return;
    }
    setMessages([]);
    setInput('');
  };

  const applyCodeToFile = async (filename: string, code: string) => {
    try {
      const projectPath = projectPathProp || (await window.electron.store.get('projectPath'));
      if (!projectPath) {
        alert('No project open. Please open a project first.');
        return;
      }
      const filePath = `${projectPath}/${filename}`;
      await window.electron.fs.writeFile(filePath, code);
      onApplyEdit(filePath, code);
    } catch (error) {
      console.error('Failed to write file:', error);
      alert(`Failed to write file: ${error}`);
    }
  };

  const applySurgicalEdits = async (edits: SurgicalEdit[]) => {
    console.log('[Apply] Starting surgical edits:', edits.length, 'edits');
    try {
      const projectPath = projectPathProp || (await window.electron.store.get('projectPath'));
      console.log('[Apply] Project path:', projectPath);
      
      if (!projectPath) {
        alert('No project open. Please open a project first.');
        return;
      }

      const editsByFile = edits.reduce((acc, edit) => {
        if (!acc[edit.file]) acc[edit.file] = [];
        acc[edit.file].push(edit);
        return acc;
      }, {} as Record<string, SurgicalEdit[]>);

      console.log('[Apply] Files to edit:', Object.keys(editsByFile));

      for (const [filename, fileEdits] of Object.entries(editsByFile)) {
        const isCreateOnly = fileEdits.every(e => e.type === 'create' || e.type === 'full_replace');
        const separator = String(projectPath).includes('\\') ? '\\' : '/';
        
        if (isCreateOnly) {
          const filePath = /^[a-zA-Z]:[\\\/]/.test(filename) || filename.startsWith('/')
            ? filename
            : `${projectPath}${separator}${filename.replace(/\//g, separator)}`;
          
          // Ensure parent directory exists
          const dirPath = filePath.substring(0, filePath.lastIndexOf(separator));
          console.log('[Apply] File path:', filePath);
          console.log('[Apply] Dir path:', dirPath);
          console.log('[Apply] Project path:', projectPath);
          
          if (dirPath && dirPath !== projectPath) {
            console.log('[Apply] Creating directory:', dirPath);
            try {
              const mkdirResult = await window.electron.fs.createDir(dirPath);
              console.log('[Apply] createDir result:', mkdirResult);
            } catch (mkdirErr) {
              console.error('[Apply] createDir FAILED:', mkdirErr);
            }
          }
          
          const newContent = fileEdits[0].content || '';
          console.log('[Apply] Creating new file:', filePath, 'Content length:', newContent.length);
          try {
            const writeResult = await window.electron.fs.writeFile(filePath, newContent);
            console.log('[Apply] writeFile result:', writeResult);
            if (writeResult?.success) {
              onApplyEdit(filePath, newContent);
              console.log('[Apply] Successfully created:', filePath);
            } else {
              console.error('[Apply] writeFile returned failure:', writeResult);
            }
          } catch (writeErr) {
            console.error('[Apply] writeFile FAILED:', writeErr);
          }
          continue;
        }
        
        const normalizedFilename = filename.replace(/\\/g, '/').toLowerCase();
        const baseFilename = filename.split('/').pop()?.toLowerCase() || filename.split('\\').pop()?.toLowerCase() || '';
        
        const openFile = openFiles.find((f) => {
          const normalizedPath = f.path.replace(/\\/g, '/').toLowerCase();
          const fileBasename = f.name.toLowerCase();
          return (
            normalizedPath.endsWith(normalizedFilename) ||
            normalizedPath.endsWith('/' + normalizedFilename) ||
            normalizedPath.includes('/' + normalizedFilename) ||
            fileBasename === baseFilename
          );
        });
        
        let filePath: string;
        let originalContent: string;
        
        if (openFile) {
          filePath = openFile.path;
          originalContent = openFile.content;
          console.log('[Apply] Found in open files:', openFile.name);
        } else {
          const isAbsolutePath = /^[a-zA-Z]:[\\\/]/.test(filename) || filename.startsWith('/');
          
          if (isAbsolutePath) {
            console.log('[Apply] Trying absolute path:', filename);
            const readResult = await window.electron.fs.readFile(filename);
            if (!readResult.error && readResult.content) {
              filePath = filename;
              originalContent = readResult.content;
            } else {
              alert(`File not found: ${filename}`);
              continue;
            }
          } else {
            filePath = `${projectPath}${separator}${filename.replace(/\//g, separator)}`;
            console.log('[Apply] Reading from disk:', filePath);
            
            const readResult = await window.electron.fs.readFile(filePath);
            if (readResult.error || !readResult.content) {
              alert(`File not found: ${filename}`);
              continue;
            }
            originalContent = readResult.content;
          }
        }

        const newContent = applyMultipleEdits(originalContent, fileEdits);
        console.log('[Apply] Writing to:', filePath, 'New content length:', newContent.length);
        const writeResult = await window.electron.fs.writeFile(filePath, newContent);
        console.log('[Apply] Write result:', writeResult);
        onApplyEdit(filePath, newContent);
        console.log('[Apply] Successfully applied edits to:', filePath);
      }
    } catch (error) {
      console.error('[Apply] Failed to apply surgical edits:', error);
      alert(`Failed to apply edits: ${error}`);
    }
  };

  const renderMessageContent = (content: string, messageId: string) => {
    const { edits, explanation } = parseSurgicalEdits(content);
    const parts = parseCodeBlocks(explanation);
    const isApplied = appliedMessageIds.has(messageId);
    
    return (
      <>
        {edits.length > 0 && (
          <div className={`my-2 p-3 rounded-none border ${
            mode === 'keystone' || isApplied
              ? 'bg-green-500/10 border-green-500/30 border-l-2 border-l-green-400/70' 
              : 'bg-amber-500/10 border-amber-500/30 border-l-2 border-l-amber-400/70'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <FileEdit className={`w-4 h-4 ${mode === 'keystone' || isApplied ? 'text-green-400' : 'text-amber-400'}`} />
                <span className={`font-mono text-[11px] uppercase tracking-[0.15em] ${mode === 'keystone' || isApplied ? 'text-green-400' : 'text-amber-400'}`}>
                  {mode === 'keystone' || isApplied ? 'Applied' : 'Surgical Edits'} ({edits.length})
                </span>
              </div>
              {mode !== 'keystone' && !isApplied && (
                <button
                  onClick={async () => {
                    console.log('[Apply All] Button clicked, edits:', edits);
                    await applySurgicalEdits(edits);
                    setAppliedMessageIds(prev => new Set(prev).add(messageId));
                  }}
                  className="flex items-center gap-1 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.1em] bg-amber-500/20 border border-amber-500/30 text-amber-400 hover:bg-amber-500/30 rounded-none transition-colors"
                >
                  <FileEdit className="w-3.5 h-3.5" />
                  Apply All
                </button>
              )}
            </div>
            <div className="space-y-2 text-xs">
              {edits.map((edit, i) => (
                <div key={i} className="border border-white/10 rounded-none overflow-hidden">
                  <div className="flex items-center gap-2 px-2 py-1 bg-white/5">
                    <span className={`px-1.5 py-0.5 rounded-none text-xs font-mono ${
                      edit.type === 'insert' ? 'bg-green-500/20 text-green-400' :
                      edit.type === 'delete' ? 'bg-red-500/20 text-red-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                      {edit.type.toUpperCase()}
                    </span>
                    <span className="font-mono text-gray-400">{edit.file}</span>
                    <span className="text-gray-500">
                      {edit.type === 'insert' ? `after line ${edit.startLine - 1}` :
                       edit.endLine && edit.endLine !== edit.startLine 
                         ? `lines ${edit.startLine}-${edit.endLine}` 
                         : `line ${edit.startLine}`}
                    </span>
                  </div>
                  {edit.content && (
                    <pre className="p-2 bg-black/30 text-gray-300 font-mono text-xs overflow-x-auto max-h-32">
                      {edit.content}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {parts.map((part, index) => {
          if (typeof part === 'string') {
            return (
              <div key={index} className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-a:text-cyan-400 prose-code:text-cyan-300 prose-code:bg-white/10 prose-code:px-1 prose-code:rounded">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {part}
                </ReactMarkdown>
              </div>
            );
          }
          
          return (
            <div key={index} className="my-2 rounded-none overflow-hidden border border-cyan-500/20">
              <div className="flex items-center justify-between px-3 py-1.5 bg-cyan-500/[0.06] border-b border-cyan-500/20">
                <div className="flex items-center gap-2">
                  <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-xs text-gray-400 font-mono">
                    {part.filename || part.language || 'code'}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {part.filename && (
                    <button
                      onClick={() => applyCodeToFile(part.filename!, part.code)}
                      className="flex items-center gap-1 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.1em] bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30 rounded-none transition-colors"
                    >
                      <FileEdit className="w-3 h-3" />
                      Apply
                    </button>
                  )}
                  <button
                    onClick={() => navigator.clipboard.writeText(part.code)}
                    className="flex items-center gap-1 px-2 py-0.5 text-xs text-gray-400 hover:text-white hover:bg-white/10 rounded-none transition-colors"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <pre className="p-3 text-xs overflow-x-auto bg-black/30">
                <code className="text-gray-300">{part.code}</code>
              </pre>
            </div>
          );
        })}
      </>
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#05070a] relative">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: 'linear-gradient(rgba(34,211,238,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.03) 1px, transparent 1px)', backgroundSize: '32px 32px' }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: 'repeating-linear-gradient(0deg, rgba(148,210,255,0.025) 0px, rgba(148,210,255,0.025) 1px, transparent 1px, transparent 3px)' }}
      />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />
      
      <div className="px-4 py-3 border-b border-cyan-500/15 relative z-[200] bg-black/40">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2.5 relative">
            <span className="relative flex h-2 w-2">
              <motion.span
                className="absolute inline-flex h-full w-full rounded-full bg-cyan-400"
                animate={{ opacity: [0.2, 0.9, 0.2], scale: [1, 1.6, 1] }}
                transition={{ duration: 2.4, repeat: Infinity }}
              />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400/80" />
            </span>
            <span className="font-mono text-xs font-semibold tracking-[0.25em] text-cyan-300">AI LINK</span>
            {contextFiles.length > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/30 rounded-none font-mono text-[10px] tracking-wider text-cyan-400">
                <Paperclip className="w-3 h-3" />
                CTX {String(contextFiles.length).padStart(2, '0')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="flex bg-black/60 rounded-none p-0.5 border border-cyan-500/20">
                <button
                  onClick={() => setMode('debug')}
                  className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.15em] rounded-none transition-all duration-200 ${
                    mode === 'debug'
                      ? 'bg-cyan-500/15 text-cyan-300 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.4)]'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                  title="Debug Mode: Review surgical edits before applying"
                >
                  Debug
                </button>
                <button
                  onClick={() => setMode('focus')}
                  className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.15em] rounded-none transition-all duration-200 ${
                    mode === 'focus'
                      ? 'bg-purple-500/15 text-purple-300 shadow-[inset_0_0_0_1px_rgba(192,132,252,0.4)]'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                  title="Focus Mode: Research & documentation only"
                >
                  Focus
                </button>
                <button
                  onClick={() => setMode('keystone')}
                  className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.15em] rounded-none transition-all duration-200 flex items-center gap-1 ${
                    mode === 'keystone'
                      ? 'bg-amber-500/15 text-amber-300 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.45)]'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                  title="Keystone Mode: Agentic coding with auto-apply"
                >
                  {mode === 'keystone' && <Sparkles className="w-3 h-3" />}
                  Keystone
                </button>
              </div>
            </div>
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                disabled={isLoading}
                className="flex items-center gap-1 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-gray-400 hover:text-white hover:bg-white/10 rounded-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400"
                title={
                  isLoading
                    ? 'Wait for the assistant to finish before starting a new chat'
                    : 'Start a new chat with fresh context — this chat stays saved in your session history'
                }
              >
                <RotateCcw className="w-3 h-3" />
                New
              </button>
            )}
            <ModelSelector apiKey={apiKey} />
          </div>
        </div>

        {contextFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {contextFiles.map((path) => {
              const name = path.split('/').pop();
              return (
                <span
                  key={path}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-cyan-500/[0.06] border border-cyan-500/25 rounded-none font-mono text-[11px] text-cyan-400"
                >
                  <FileCode className="w-3 h-3" />
                  {name}
                  <button
                    onClick={() => onRemoveFromContext(path)}
                    className="hover:text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 relative z-0">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <div className="relative inline-block mb-4">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
              >
                <Crosshair className="w-14 h-14 text-cyan-500/40 mx-auto" />
              </motion.div>
              <motion.div
                className="absolute inset-0 flex items-center justify-center"
                animate={{ opacity: [0.2, 0.8, 0.2] }}
                transition={{ duration: 2.4, repeat: Infinity }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              </motion.div>
            </div>
            <p className="font-mono text-xs tracking-[0.3em] text-cyan-300">
              SYSTEMS NOMINAL
            </p>
            <p className="font-mono text-[11px] tracking-[0.2em] text-gray-500 mt-2">
              AWAITING DIRECTIVE · ADD FILES TO CONTEXT
            </p>
          </div>
        )}

        <AnimatePresence>
          {messages.filter(m => !(isLoading && m.role === 'assistant' && !m.content)).map((message) => (
            message.role === 'approval' && message.approval ? (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-3"
                data-testid={`card-approval-${message.approval.approvalId}`}
              >
                <div className="w-8 h-8 rounded-none bg-amber-500/15 flex items-center justify-center flex-shrink-0 border border-amber-500/30">
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                </div>
                <div className="max-w-[85%] flex-1 rounded-none border border-amber-500/30 border-l-2 border-l-amber-400/70 bg-amber-500/5 px-4 py-3">
                  <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.15em] text-amber-300">
                    <TerminalSquare className="w-3.5 h-3.5" />
                    Command Auth · {message.approval.terminal}
                  </div>
                  <code className="mt-2 block rounded-none border border-white/10 bg-black/50 px-3 py-2 font-mono text-sm text-gray-200">
                    $ {message.approval.command}
                  </code>
                  {message.approval.decision === 'pending' ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => resolveApproval(message, 'run')}
                        className="flex items-center gap-1.5 rounded-none bg-emerald-500/20 border border-emerald-500/30 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                        data-testid={`button-approve-${message.approval.approvalId}`}
                      >
                        <Play className="w-3 h-3" />
                        Run
                      </button>
                      <button
                        onClick={() => resolveApproval(message, 'deny')}
                        className="flex items-center gap-1.5 rounded-none bg-red-500/10 border border-red-500/30 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-red-300 hover:bg-red-500/20 transition-colors"
                        data-testid={`button-deny-${message.approval.approvalId}`}
                      >
                        <X className="w-3 h-3" />
                        Deny
                      </button>
                      <label className="ml-auto flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={autoApprove}
                          onChange={(e) => setAutoApprove(e.target.checked)}
                          className="h-3 w-3 accent-cyan-400"
                          data-testid="checkbox-auto-approve"
                        />
                        Auto-approve this session
                      </label>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs" data-testid={`status-approval-${message.approval.approvalId}`}>
                      {message.approval.decision === 'run' ? (
                        <span className="text-emerald-400">
                          {message.approval.auto ? 'Auto-approved and ran' : 'Approved — ran in terminal'}
                        </span>
                      ) : (
                        <span className="text-red-400">Denied — command never ran</span>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}
            >
              {message.role === 'assistant' && (
                <div className="w-8 h-8 rounded-none bg-cyan-500/10 flex items-center justify-center flex-shrink-0 border border-cyan-500/30">
                  <Bot className="w-4 h-4 text-cyan-400" />
                </div>
              )}

              <div
                className={`max-w-[85%] rounded-none px-4 py-3 relative ${
                  message.role === 'user'
                    ? 'bg-emerald-500/[0.06] text-white border border-emerald-500/25 border-r-2 border-r-emerald-400/60'
                    : 'bg-black/30 text-gray-300 border border-cyan-500/15 border-l-2 border-l-cyan-400/50'
                }`}
              >
                <div className="text-sm">
                  {message.role === 'assistant' 
                    ? renderMessageContent(message.content, message.id)
                    : <div className="prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                      </div>
                  }
                </div>
                {message.role === 'assistant' && (
                  <button
                    onClick={() => copyToClipboard(message.content, message.id)}
                    className="mt-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-gray-500 hover:text-white"
                  >
                    {copiedId === message.id ? (
                      <>
                        <Check className="w-3 h-3" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copy all
                      </>
                    )}
                  </button>
                )}
              </div>

              {message.role === 'user' && (
                <div className="w-8 h-8 rounded-none bg-emerald-500/10 flex items-center justify-center flex-shrink-0 border border-emerald-500/30">
                  <User className="w-4 h-4 text-emerald-400" />
                </div>
              )}
            </motion.div>
            )
          ))}
        </AnimatePresence>

        {isLoading && (
          <ThinkingAnimation activeFile={streamingFile} activeTool={streamingTool} activeOperation={streamingOperation} />
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-cyan-500/15 relative z-10 bg-black/40">
        <div className="relative group">
          <div className="absolute -inset-0.5 bg-cyan-500/20 rounded-none opacity-0 group-focus-within:opacity-100 transition-opacity blur-sm" />
          <div className="relative">
            <span className="pointer-events-none absolute top-0 left-0 z-10 h-2.5 w-2.5 border-t border-l border-cyan-400/60" />
            <span className="pointer-events-none absolute top-0 right-0 z-10 h-2.5 w-2.5 border-t border-r border-cyan-400/60" />
            <span className="pointer-events-none absolute bottom-1.5 left-0 z-10 h-2.5 w-2.5 border-b border-l border-cyan-400/60" />
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={appMode === 'demo' ? 'DEMO MODE — AGENT HAS THE CONTROLS' : '> ENTER DIRECTIVE'}
              disabled={appMode === 'demo'}
              rows={3}
              className="w-full px-4 py-3 pr-12 bg-[#04070a] border border-cyan-500/20 rounded-none text-sm text-white placeholder:text-gray-600 placeholder:font-mono placeholder:text-xs placeholder:tracking-[0.15em] resize-none focus:outline-none focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-400/40"
            />
            {isLoading ? (
              <button
                onClick={() => abortRef.current?.abort()}
                title="Stop generating"
                className="absolute right-3 bottom-3 p-2 bg-red-500 hover:bg-red-400 rounded-none transition-all shadow-lg shadow-red-500/20"
              >
                <Square className="w-4 h-4 text-white fill-white" />
              </button>
            ) : (
              <button
                onClick={sendMessage}
                disabled={!input.trim() || appMode === 'demo'}
                className="absolute right-3 bottom-3 p-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 rounded-none transition-all shadow-lg shadow-cyan-500/20"
              >
                <Send className="w-4 h-4 text-black" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
