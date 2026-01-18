import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type { FileEntry } from '../types/electron';

interface FileExplorerProps {
  projectPath: string | null;
  onOpenFile: (path: string) => void;
  onOpenFolder: () => void;
}

interface TreeNode extends FileEntry {
  children?: TreeNode[];
  isExpanded?: boolean;
  isLoading?: boolean;
}

export function FileExplorer({ projectPath, onOpenFile, onOpenFolder }: FileExplorerProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (projectPath) {
      loadDirectory(projectPath);
    }
  }, [projectPath]);

  const loadDirectory = async (path: string) => {
    setIsLoading(true);
    const result = await window.electron.fs.readDir(path);
    if (!Array.isArray(result)) {
      setIsLoading(false);
      return;
    }

    const sortedEntries = result
      .filter((e) => !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

    setTree(sortedEntries);
    setIsLoading(false);
  };

  const toggleFolder = async (node: TreeNode, path: number[]) => {
    if (!node.isDirectory) {
      onOpenFile(node.path);
      return;
    }

    setTree((prev) => {
      const newTree = [...prev];
      let current = newTree;
      for (let i = 0; i < path.length - 1; i++) {
        current = current[path[i]].children || [];
      }
      const targetIndex = path[path.length - 1];
      const target = current[targetIndex];

      if (target.isExpanded) {
        current[targetIndex] = { ...target, isExpanded: false };
      } else {
        current[targetIndex] = { ...target, isExpanded: true, isLoading: true };
      }
      return newTree;
    });

    if (!node.isExpanded) {
      const result = await window.electron.fs.readDir(node.path);
      if (Array.isArray(result)) {
        const children = result
          .filter((e) => !e.name.startsWith('.'))
          .sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
          });

        setTree((prev) => {
          const newTree = [...prev];
          let current = newTree;
          for (let i = 0; i < path.length - 1; i++) {
            current = current[path[i]].children || [];
          }
          current[path[path.length - 1]] = {
            ...current[path[path.length - 1]],
            children,
            isLoading: false,
          };
          return newTree;
        });
      }
    }
  };

  const renderNode = (node: TreeNode, path: number[], depth: number) => {
    const Icon = node.isDirectory
      ? node.isExpanded
        ? FolderOpen
        : Folder
      : File;
    const iconColor = node.isDirectory ? 'text-cyan-400' : 'text-gray-400';

    return (
      <div key={node.path}>
        <button
          onClick={() => toggleFolder(node, path)}
          className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-white/5 rounded text-left group"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {node.isDirectory && (
            <span className="w-4 h-4 flex items-center justify-center text-gray-500">
              {node.isLoading ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : node.isExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </span>
          )}
          {!node.isDirectory && <span className="w-4" />}
          <Icon className={`w-4 h-4 ${iconColor}`} />
          <span className="text-sm text-gray-300 truncate">{node.name}</span>
        </button>

        <AnimatePresence>
          {node.isExpanded && node.children && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {node.children.map((child, i) =>
                renderNode(child, [...path, i], depth + 1)
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  if (!projectPath) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <Folder className="w-12 h-12 text-gray-600 mb-4" />
        <p className="text-gray-500 text-sm mb-4">No folder open</p>
        <button
          onClick={onOpenFolder}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 rounded-lg text-sm transition-colors"
        >
          <FolderOpen className="w-4 h-4" />
          Open Folder
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Explorer
        </span>
        <button
          onClick={() => loadDirectory(projectPath)}
          className="p-1 hover:bg-white/10 rounded text-gray-500 hover:text-white"
          title="Refresh"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      <div className="flex-1 overflow-auto py-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-5 h-5 text-gray-500 animate-spin" />
          </div>
        ) : (
          tree.map((node, i) => renderNode(node, [i], 0))
        )}
      </div>
    </div>
  );
}
