import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderOpen, FileCode, Sparkles, Zap, X, Loader2 } from 'lucide-react';

interface Template {
  id: string;
  name: string;
  path: string;
}

interface WelcomePanelProps {
  onOpenFolder: () => void;
  onNewFile?: (path: string) => void;
  onTemplateCreated?: (path: string) => void;
}

export function WelcomePanel({ onOpenFolder, onNewFile, onTemplateCreated }: WelcomePanelProps) {
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleNewFile = async () => {
    const filePath = await window.electron.dialog.newFile();
    if (filePath && onNewFile) {
      onNewFile(filePath);
    }
  };

  const handleShowTemplates = async () => {
    setIsLoading(true);
    const list = await window.electron.templates.list();
    setTemplates(list);
    setShowTemplates(true);
    setIsLoading(false);
  };

  const handleSelectTemplate = async (template: Template) => {
    const targetPath = await window.electron.dialog.selectFolder('Select folder for new project');
    if (!targetPath) return;
    
    setIsLoading(true);
    const result = await window.electron.templates.create(template.id, targetPath);
    setIsLoading(false);
    setShowTemplates(false);
    
    if (result.error) {
      console.error('Template creation failed:', result.error);
      return;
    }
    
    if (result.success && result.path && onTemplateCreated) {
      onTemplateCreated(result.path);
    }
  };
  return (
    <div className="h-full flex items-center justify-center bg-[#0d0d12] p-8">
      <motion.div
        className="max-w-md text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <motion.div
          className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 mb-6"
          animate={{
            boxShadow: [
              '0 0 20px rgba(0,212,255,0.2)',
              '0 0 40px rgba(0,212,255,0.1)',
              '0 0 20px rgba(0,212,255,0.2)',
            ],
          }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <Zap className="w-10 h-10 text-cyan-400" />
        </motion.div>

        <h2 className="text-2xl font-bold text-white mb-2">Keystone Lite</h2>
        <p className="text-gray-400 mb-8">
          AI-powered code debugging and editing. Open a folder to get started.
        </p>

        <div className="space-y-3">
          <button
            onClick={onOpenFolder}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 hover:from-cyan-500/30 hover:to-blue-500/30 border border-cyan-500/30 rounded-xl text-white font-medium transition-all"
          >
            <FolderOpen className="w-5 h-5 text-cyan-400" />
            Open Folder
          </button>

          <div className="grid grid-cols-2 gap-3">
            <button 
              onClick={handleNewFile}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-gray-400 hover:text-white text-sm transition-all"
            >
              <FileCode className="w-4 h-4" />
              New File
            </button>
            <button 
              onClick={handleShowTemplates}
              disabled={isLoading}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-gray-400 hover:text-white text-sm transition-all disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Templates
            </button>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-white/5">
          <h3 className="text-sm font-medium text-gray-500 mb-3">Features</h3>
          <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              Multi-model AI
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              Code debugging
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
              Chat with files
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
              Surgical edits
            </div>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {showTemplates && (
          <motion.div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowTemplates(false)}
          >
            <motion.div
              className="bg-[#12121a] border border-white/10 rounded-2xl p-6 max-w-md w-full mx-4"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Project Templates</h3>
                <button
                  onClick={() => setShowTemplates(false)}
                  className="p-1 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>
              
              <p className="text-gray-400 text-sm mb-4">
                Select a template to create a new project
              </p>

              <div className="space-y-2">
                {templates.length === 0 ? (
                  <p className="text-gray-500 text-sm text-center py-4">No templates available</p>
                ) : (
                  templates.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => handleSelectTemplate(template)}
                      disabled={isLoading}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-left transition-all disabled:opacity-50"
                    >
                      <Sparkles className="w-5 h-5 text-purple-400 flex-shrink-0" />
                      <div>
                        <div className="text-white font-medium">{template.name}</div>
                        <div className="text-gray-500 text-xs">{template.id}</div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
