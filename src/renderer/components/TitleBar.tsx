import { Settings, FolderOpen, Zap } from 'lucide-react';
import { useState } from 'react';
import { SettingsDialog } from './SettingsDialog';

interface TitleBarProps {
  projectPath: string | null;
  onOpenFolder: () => void;
}

export function TitleBar({ projectPath, onOpenFolder }: TitleBarProps) {
  const [showSettings, setShowSettings] = useState(false);

  const projectName = projectPath?.split('/').pop() || 'Keystone Lite';

  return (
    <>
      <div className="h-10 bg-[#0d0d12] border-b border-white/5 flex items-center px-4 drag-region">
        <div className="flex items-center gap-2 pl-16">
          <Zap className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-medium text-white">{projectName}</span>
          {projectPath && (
            <span className="text-xs text-gray-500 truncate max-w-[300px]">
              {projectPath}
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1 no-drag">
          <button
            onClick={onOpenFolder}
            className="p-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-colors"
            title="Open Folder"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-colors"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
}
