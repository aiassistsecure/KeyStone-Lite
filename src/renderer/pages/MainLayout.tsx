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

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  language: string;
  isDirty: boolean;
}

interface MainLayoutProps {
  apiKey: string;
}

export function MainLayout({ apiKey }: MainLayoutProps) {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [chatContext, setChatContext] = useState<string[]>([]);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

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
            {openFiles.length > 0 ? (
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
          </Panel>

          <PanelResizeHandle className="w-1 bg-white/5 hover:bg-cyan-500/50 transition-colors" />

          <Panel defaultSize={30} minSize={20} maxSize={50}>
            <ChatPanel
              apiKey={apiKey}
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
