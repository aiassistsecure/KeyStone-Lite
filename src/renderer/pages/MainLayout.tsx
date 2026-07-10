import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
} from 'react-resizable-panels';
import { FileExplorer } from '../components/FileExplorer';
import { EditorTabs } from '../components/EditorTabs';
import { ChatPanel } from '../components/ChatPanel';
import { TitleBar } from '../components/TitleBar';
import { WelcomePanel } from '../components/WelcomePanel';
import { TerminalPanel } from '../components/TerminalPanel';
import { PreviewPanel } from '../components/PreviewPanel';
import { MetricsPanel } from '../components/MetricsPanel';
import { StatusBar } from '../components/StatusBar';
import { startDemo, stopDemo } from '../lib/demo-adapter';
import { subscribe } from '../lib/agent-events';
import { KeystoneClient, getKeystoneBaseUrl } from '../lib/keystone-api';
import { pullEnvironment, pushEnvironment } from '../lib/env-sync';
import { TerminalSquare, Eye, Activity } from 'lucide-react';
import type { SessionInfo, WorkspaceInfo } from '../types/electron';

type DockTab = 'terminal' | 'metrics';
type CenterView = 'code' | 'preview';

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  language: string;
  isDirty: boolean;
}

interface MainLayoutProps {
  apiKey: string;
  mode?: 'demo' | 'api';
  session?: SessionInfo | null;
  workspace?: WorkspaceInfo | null;
  onExit?: () => void;
  onNewSession?: () => void;
}

export function MainLayout({ apiKey, mode = 'api', session = null, workspace = null, onExit, onNewSession }: MainLayoutProps) {
  const [projectPath, setProjectPath] = useState<string | null>(workspace?.path || null);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [chatContext, setChatContext] = useState<string[]>([]);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [dockTab, setDockTab] = useState<DockTab>('terminal');
  const [centerView, setCenterView] = useState<CenterView>('code');
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  const isLocalEnv = session?.envMode === 'local' && !!session.environmentId && !!projectPath;

  const reloadOpenFiles = async () => {
    const refreshed = new Map<string, OpenFile>();
    await Promise.all(
      openFiles.map(async (f) => {
        const result = await window.electron.fs.readFile(f.path);
        if ('error' in result && result.error) return;
        refreshed.set(f.path, { ...f, content: result.content || '', isDirty: false });
      })
    );
    setOpenFiles((prev) => prev.map((f) => refreshed.get(f.path) ?? f));
  };

  const runEnvSync = async (direction: 'pull' | 'push') => {
    if (!session?.environmentId || !projectPath || syncBusy) return;
    setSyncBusy(true);
    setSyncMessage('');
    try {
      const client = new KeystoneClient(apiKey, await getKeystoneBaseUrl());
      const doIt = direction === 'pull' ? pullEnvironment : pushEnvironment;
      let res = await doIt(client, session.environmentId, projectPath, {});
      if (res.conflicts.length > 0) {
        const overwrite = window.confirm(
          `${res.conflicts.length} file(s) changed both here and in the environment:\n\n` +
            res.conflicts.slice(0, 10).join('\n') +
            (res.conflicts.length > 10 ? '\n...' : '') +
            `\n\n${direction === 'pull' ? 'Overwrite your local copies with the environment version?' : 'Overwrite the environment with your local version?'}`
        );
        if (overwrite) {
          res = await doIt(client, session.environmentId, projectPath, { force: true });
        }
      }
      const moved = direction === 'pull' ? (res as { updated: string[] }).updated : (res as { uploaded: string[] }).uploaded;
      const parts: string[] = [`${direction === 'pull' ? 'Pulled' : 'Pushed'} ${moved.length} file(s)`];
      if (res.conflicts.length > 0) parts.push(`${res.conflicts.length} conflict(s) skipped`);
      setSyncMessage(parts.join(' · '));
      if (direction === 'pull' && moved.length > 0) await reloadOpenFiles();
    } catch (e) {
      setSyncMessage(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncBusy(false);
    }
  };

  useEffect(() => {
    if (workspace?.path) {
      setProjectPath(workspace.path);
      window.electron.project.setPath(workspace.path);
    }
  }, [workspace?.path]);

  useEffect(() => {
    if (mode !== 'demo') return;
    const stop = startDemo();
    return () => {
      stop();
      stopDemo();
    };
  }, [mode]);

  useEffect(() => {
    // Agent activity pulls the relevant surface forward.
    const unsub = subscribe((e) => {
      if (e.type === 'approval_request') setDockTab('terminal');
      if (e.type === 'preview_refresh') setCenterView('preview');
    });
    return unsub;
  }, []);

  const openFile = async (filePath: string) => {
    const existing = openFiles.find((f) => f.path === filePath);
    if (existing) {
      setActiveFile(filePath);
      return;
    }

    const result = await window.electron.fs.readFile(filePath);
    if ('error' in result) {
      console.error('Failed to read file:', result.error);
      return;
    }

    const name = filePath.split('/').pop() || filePath;
    const language = getLanguageFromExtension(name);

    setOpenFiles((prev) => [
      ...prev,
      {
        path: filePath,
        name,
        content: result.content || '',
        language,
        isDirty: false,
      },
    ]);
    setActiveFile(filePath);
  };

  const closeFile = (filePath: string) => {
    setOpenFiles((prev) => prev.filter((f) => f.path !== filePath));
    if (activeFile === filePath) {
      const remaining = openFiles.filter((f) => f.path !== filePath);
      setActiveFile(remaining.length > 0 ? remaining[remaining.length - 1].path : null);
    }
  };

  const updateFileContent = (filePath: string, content: string) => {
    setOpenFiles((prev) =>
      prev.map((f) =>
        f.path === filePath ? { ...f, content, isDirty: true } : f
      )
    );
  };

  const saveFile = async (filePath: string, contentOverride?: string) => {
    const file = openFiles.find((f) => f.path === filePath);
    if (!file && !contentOverride) return;

    const contentToSave = contentOverride ?? file?.content ?? '';
    const result = await window.electron.fs.writeFile(filePath, contentToSave);
    if (result.success) {
      setOpenFiles((prev) =>
        prev.map((f) => (f.path === filePath ? { ...f, isDirty: false } : f))
      );
    }
  };

  const addToContext = (filePath: string) => {
    if (!chatContext.includes(filePath)) {
      setChatContext((prev) => [...prev, filePath]);
    }
  };

  const removeFromContext = (filePath: string) => {
    setChatContext((prev) => prev.filter((p) => p !== filePath));
  };

  const openFolder = async () => {
    const path = await window.electron.dialog.openFolder();
    if (path) {
      setProjectPath(path);
      await window.electron.store.set('projectPath', path);
      setOpenFiles([]);
      setActiveFile(null);
      setChatContext([]);
    }
  };

  return (
    <motion.div
      className="h-screen flex flex-col bg-[#0a0a0f]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <TitleBar projectPath={projectPath} onOpenFolder={openFolder} />

      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="horizontal" className="h-full">
          <Panel defaultSize={20} minSize={15} maxSize={35}>
            <FileExplorer
              projectPath={projectPath}
              onOpenFile={openFile}
              onOpenFolder={openFolder}
            />
          </Panel>

          <PanelResizeHandle className="w-1 bg-white/5 hover:bg-cyan-500/50 transition-colors" />

          <Panel defaultSize={50} minSize={30}>
            <PanelGroup direction="vertical" className="h-full">
              <Panel defaultSize={65} minSize={25}>
                <div className="h-full flex flex-col">
                  <div className="flex items-center border-b border-white/10 bg-black/40 flex-shrink-0">
                    {(
                      [
                        { id: 'code' as CenterView, label: 'Code', icon: TerminalSquare },
                        { id: 'preview' as CenterView, label: 'Preview', icon: Eye },
                      ]
                    ).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setCenterView(t.id)}
                        className={`flex items-center gap-1.5 px-4 py-1.5 text-xs border-b-2 transition-colors ${
                          centerView === t.id
                            ? 'border-cyan-400 text-cyan-300 bg-white/5'
                            : 'border-transparent text-gray-500 hover:text-gray-300'
                        }`}
                        data-testid={`tab-center-${t.id}`}
                      >
                        <t.icon className="w-3.5 h-3.5" />
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 min-h-0">
                    {centerView === 'preview' ? (
                      <PreviewPanel projectPath={projectPath} />
                    ) : openFiles.length > 0 ? (
                  <EditorTabs
                    files={openFiles}
                    activeFile={activeFile}
                    onSelectFile={setActiveFile}
                    onCloseFile={closeFile}
                    onUpdateContent={updateFileContent}
                    onSaveFile={saveFile}
                    onAddToContext={addToContext}
                    onAskAboutSelection={(message) => {
                      setPendingMessage(message);
                    }}
                    contextFiles={chatContext}
                  />
                ) : (
                  <WelcomePanel 
                    onOpenFolder={openFolder}
                    onNewFile={async (filePath) => {
                      const content = await window.electron.fs.readFile(filePath);
                      if (!content.error) {
                        const name = filePath.split(/[\\/]/).pop() || 'untitled';
                        const ext = name.split('.').pop()?.toLowerCase() || '';
                        const langMap: Record<string, string> = {
                          ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
                          py: 'python', rs: 'rust', go: 'go', json: 'json', html: 'html', css: 'css',
                        };
                        setOpenFiles([{
                          path: filePath,
                          name,
                          content: content.content || '',
                          language: langMap[ext] || 'plaintext',
                          isDirty: false,
                        }]);
                        setActiveFile(filePath);
                      }
                    }}
                    onTemplateCreated={async (path) => {
                      await window.electron.project.setPath(path);
                      await window.electron.store.set('projectPath', path);
                      setProjectPath(path);
                      setOpenFiles([]);
                      setActiveFile(null);
                      setChatContext([]);
                    }}
                  />
                )}
                  </div>
                </div>
              </Panel>

              <PanelResizeHandle className="h-1 bg-white/5 hover:bg-cyan-500/50 transition-colors" />

              <Panel defaultSize={35} minSize={15}>
                <div className="h-full flex flex-col bg-[#07070c]">
                  <div className="flex items-center border-b border-white/10 bg-black/40 flex-shrink-0">
                    {(
                      [
                        { id: 'terminal' as DockTab, label: 'Terminal', icon: TerminalSquare },
                        { id: 'metrics' as DockTab, label: 'Metrics', icon: Activity },
                      ]
                    ).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setDockTab(t.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-b-2 transition-colors ${
                          dockTab === t.id
                            ? 'border-cyan-400 text-cyan-300 bg-white/5'
                            : 'border-transparent text-gray-500 hover:text-gray-300'
                        }`}
                        data-testid={`tab-dock-${t.id}`}
                      >
                        <t.icon className="w-3.5 h-3.5" />
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 min-h-0">
                    {dockTab === 'terminal' && <TerminalPanel cwd={projectPath || '/'} />}
                    {dockTab === 'metrics' && <MetricsPanel />}
                  </div>
                </div>
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="w-1 bg-white/5 hover:bg-cyan-500/50 transition-colors" />

          <Panel defaultSize={30} minSize={20} maxSize={50}>
            <ChatPanel
              apiKey={apiKey}
              mode={mode}
              session={session}
              onNewSession={onNewSession}
              contextFiles={chatContext}
              openFiles={openFiles}
              activeFile={activeFile}
              pendingMessage={pendingMessage}
              onClearPendingMessage={() => setPendingMessage(null)}
              onRemoveFromContext={removeFromContext}
              onApplyEdit={(filePath, content) => {
                updateFileContent(filePath, content);
                saveFile(filePath, content);
              }}
            />
          </Panel>
        </PanelGroup>
      </div>

      <StatusBar
        mode={mode}
        session={session}
        workspace={workspace}
        onExit={onExit}
        onPull={isLocalEnv ? () => runEnvSync('pull') : undefined}
        onPush={isLocalEnv ? () => runEnvSync('push') : undefined}
        syncBusy={syncBusy}
        syncMessage={syncMessage}
      />
    </motion.div>
  );
}

function getLanguageFromExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    cs: 'csharp',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    md: 'markdown',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    dockerfile: 'dockerfile',
    graphql: 'graphql',
  };
  return languageMap[ext || ''] || 'plaintext';
}
