import { useRef, useCallback } from 'react';
import { X, Circle, MessageSquarePlus, Paperclip } from 'lucide-react';
import Editor from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import type { OpenFile } from '../pages/MainLayout';

interface EditorTabsProps {
  files: OpenFile[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  onUpdateContent: (path: string, content: string) => void;
  onSaveFile: (path: string) => void;
  onAddToContext: (path: string) => void;
  onAskAboutSelection: (message: string) => void;
  contextFiles: string[];
}

export function EditorTabs({
  files,
  activeFile,
  onSelectFile,
  onCloseFile,
  onUpdateContent,
  onSaveFile,
  onAddToContext,
  onAskAboutSelection,
  contextFiles,
}: EditorTabsProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const handleEditorMount = useCallback((editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
    
    editor.addAction({
      id: 'ask-ai-explain',
      label: 'Ask AI: Explain this code',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE],
      contextMenuGroupId: 'ai',
      contextMenuOrder: 1,
      run: (ed) => {
        const selection = ed.getSelection();
        const selectedText = ed.getModel()?.getValueInRange(selection!);
        if (selectedText) {
          onAskAboutSelection(`Explain this code:\n\`\`\`\n${selectedText}\n\`\`\``);
        }
      }
    });

    editor.addAction({
      id: 'ask-ai-fix',
      label: 'Ask AI: Fix this code',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF],
      contextMenuGroupId: 'ai',
      contextMenuOrder: 2,
      run: (ed) => {
        const selection = ed.getSelection();
        const selectedText = ed.getModel()?.getValueInRange(selection!);
        if (selectedText && selection) {
          onAskAboutSelection(`Fix any issues in this code (lines ${selection.startLineNumber}-${selection.endLineNumber}):\n\`\`\`\n${selectedText}\n\`\`\``);
        }
      }
    });

    editor.addAction({
      id: 'ask-ai-improve',
      label: 'Ask AI: Improve this code',
      contextMenuGroupId: 'ai',
      contextMenuOrder: 3,
      run: (ed) => {
        const selection = ed.getSelection();
        const selectedText = ed.getModel()?.getValueInRange(selection!);
        if (selectedText && selection) {
          onAskAboutSelection(`Improve this code (lines ${selection.startLineNumber}-${selection.endLineNumber}):\n\`\`\`\n${selectedText}\n\`\`\``);
        }
      }
    });

    editor.addAction({
      id: 'ask-ai-document',
      label: 'Ask AI: Add documentation',
      contextMenuGroupId: 'ai',
      contextMenuOrder: 4,
      run: (ed) => {
        const selection = ed.getSelection();
        const selectedText = ed.getModel()?.getValueInRange(selection!);
        if (selectedText && selection) {
          onAskAboutSelection(`Add documentation/comments to this code (lines ${selection.startLineNumber}-${selection.endLineNumber}):\n\`\`\`\n${selectedText}\n\`\`\``);
        }
      }
    });
  }, [onAskAboutSelection]);

  const activeFileData = files.find((f) => f.path === activeFile);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (activeFile) {
        onSaveFile(activeFile);
      }
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0d0d12]" onKeyDown={handleKeyDown}>
      <div className="flex items-center border-b border-white/5 overflow-x-auto">
        {files.map((file) => (
          <button
            key={file.path}
            onClick={() => onSelectFile(file.path)}
            className={`flex items-center gap-2 px-4 py-2 text-sm border-r border-white/5 min-w-fit group transition-colors ${
              activeFile === file.path
                ? 'bg-[#1a1a24] text-white'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {contextFiles.includes(file.path) && (
              <span title="In context">
                <Paperclip className="w-3 h-3 text-cyan-400" />
              </span>
            )}
            {file.isDirty && (
              <Circle className="w-2 h-2 fill-amber-400 text-amber-400" />
            )}
            <span>{file.name}</span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                onCloseFile(file.path);
              }}
              className="p-0.5 rounded hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-3 h-3" />
            </span>
          </button>
        ))}
      </div>

      {activeFileData && (
        <div className="flex-1 relative">
          <Editor
            height="100%"
            language={activeFileData.language}
            value={activeFileData.content}
            theme="vs-dark"
            onChange={(value) => {
              if (value !== undefined) {
                onUpdateContent(activeFileData.path, value);
              }
            }}
            onMount={handleEditorMount}
            options={{
              fontSize: 14,
              fontFamily: 'JetBrains Mono, Monaco, Consolas, monospace',
              minimap: { enabled: true, scale: 1 },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              wordWrap: 'on',
              lineNumbers: 'on',
              folding: true,
              glyphMargin: true,
              renderLineHighlight: 'all',
              cursorBlinking: 'smooth',
              smoothScrolling: true,
              padding: { top: 10 },
            }}
          />

          <button
            onClick={() => onAddToContext(activeFileData.path)}
            disabled={contextFiles.includes(activeFileData.path)}
            className={`absolute bottom-4 right-4 flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
              contextFiles.includes(activeFileData.path)
                ? 'bg-cyan-500/20 text-cyan-400 cursor-not-allowed'
                : 'bg-white/10 hover:bg-cyan-500/20 text-gray-400 hover:text-cyan-400'
            }`}
            title="Add to chat context"
          >
            <MessageSquarePlus className="w-4 h-4" />
            {contextFiles.includes(activeFileData.path) ? 'In Context' : 'Add to Chat'}
          </button>
        </div>
      )}
    </div>
  );
}
