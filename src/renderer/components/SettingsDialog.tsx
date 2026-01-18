import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Key,
  Palette,
  Settings2,
  Plus,
  Trash2,
  Save,
  Check,
  ExternalLink,
  Server,
} from 'lucide-react';
import type { CustomEndpoint } from '../types/electron';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [tab, setTab] = useState<'api' | 'endpoints' | 'editor'>('api');
  const [apiKey, setApiKey] = useState('');
  const [defaultProvider, setDefaultProvider] = useState('groq');
  const [defaultModel, setDefaultModel] = useState('llama-3.3-70b-versatile');
  const [customEndpoints, setCustomEndpoints] = useState<CustomEndpoint[]>([]);
  const [fontSize, setFontSize] = useState(14);
  const [tabSize, setTabSize] = useState(2);
  const [wordWrap, setWordWrap] = useState(true);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(8192);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      loadSettings();
    }
  }, [open]);

  const loadSettings = async () => {
    const settings = await window.electron.store.getAll();
    setApiKey(settings.apiKey || '');
    setDefaultProvider(settings.defaultProvider || 'groq');
    setDefaultModel(settings.defaultModel || 'llama-3.3-70b-versatile');
    setCustomEndpoints(settings.customEndpoints || []);
    setFontSize(settings.fontSize || 14);
    setTabSize(settings.tabSize || 2);
    setWordWrap(settings.wordWrap ?? true);
    setTemperature(settings.temperature || 0.7);
    setMaxTokens(settings.maxTokens || 8192);
  };

  const saveSettings = async () => {
    await window.electron.store.set('apiKey', apiKey);
    await window.electron.store.set('defaultProvider', defaultProvider);
    await window.electron.store.set('defaultModel', defaultModel);
    await window.electron.store.set('customEndpoints', customEndpoints);
    await window.electron.store.set('fontSize', fontSize);
    await window.electron.store.set('tabSize', tabSize);
    await window.electron.store.set('wordWrap', wordWrap);
    await window.electron.store.set('temperature', temperature);
    await window.electron.store.set('maxTokens', maxTokens);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const addEndpoint = () => {
    setCustomEndpoints((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        name: 'New Endpoint',
        url: 'http://localhost:11434/v1',
        models: [],
        isOnline: false,
      },
    ]);
  };

  const updateEndpoint = (id: string, updates: Partial<CustomEndpoint>) => {
    setCustomEndpoints((prev) =>
      prev.map((ep) => (ep.id === id ? { ...ep, ...updates } : ep))
    );
  };

  const removeEndpoint = (id: string) => {
    setCustomEndpoints((prev) => prev.filter((ep) => ep.id !== id));
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="w-full max-w-2xl bg-[#0d0d12] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
            <h2 className="text-lg font-semibold text-white">Settings</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex">
            <div className="w-48 border-r border-white/5 p-2">
              {[
                { id: 'api', icon: Key, label: 'API Keys' },
                { id: 'endpoints', icon: Server, label: 'Custom Endpoints' },
                { id: 'editor', icon: Settings2, label: 'Editor' },
              ].map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  onClick={() => setTab(id as typeof tab)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    tab === id
                      ? 'bg-cyan-500/20 text-cyan-400'
                      : 'text-gray-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm">{label}</span>
                </button>
              ))}
            </div>

            <div className="flex-1 p-6 min-h-[400px]">
              {tab === 'api' && (
                <div className="space-y-6">
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">AiAS API Key</label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="aai_xxxxxxxxxxxxxxxx"
                      className="w-full px-4 py-3 bg-black/50 border border-white/20 rounded-xl text-white placeholder:text-gray-500 font-mono text-sm focus:outline-none focus:border-cyan-500/50"
                    />
                    <a
                      href="https://aiassist.net"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 mt-2"
                    >
                      Get API key at aiassist.net
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-gray-400 mb-2 block">Default Provider</label>
                      <select
                        value={defaultProvider}
                        onChange={(e) => setDefaultProvider(e.target.value)}
                        className="w-full px-4 py-3 bg-black/50 border border-white/20 rounded-xl text-white focus:outline-none focus:border-cyan-500/50"
                      >
                        <option value="groq">Groq</option>
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="google">Google</option>
                        <option value="mistral">Mistral</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm text-gray-400 mb-2 block">Default Model</label>
                      <input
                        type="text"
                        value={defaultModel}
                        onChange={(e) => setDefaultModel(e.target.value)}
                        className="w-full px-4 py-3 bg-black/50 border border-white/20 rounded-xl text-white focus:outline-none focus:border-cyan-500/50"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-gray-400 mb-2 block">
                        Temperature: {temperature}
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={temperature}
                        onChange={(e) => setTemperature(parseFloat(e.target.value))}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-gray-400 mb-2 block">
                        Max Tokens: {maxTokens.toLocaleString()}
                      </label>
                      <input
                        type="range"
                        min="1024"
                        max="32768"
                        step="1024"
                        value={maxTokens}
                        onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                        className="w-full"
                      />
                    </div>
                  </div>
                </div>
              )}

              {tab === 'endpoints' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm text-gray-400">
                      Add OpenAI-compatible endpoints (Ollama, vLLM, etc.)
                    </p>
                    <button
                      onClick={addEndpoint}
                      className="flex items-center gap-2 px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 rounded-lg text-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Add
                    </button>
                  </div>

                  {customEndpoints.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <Server className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>No custom endpoints configured</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {customEndpoints.map((ep) => (
                        <div
                          key={ep.id}
                          className="p-4 bg-white/5 border border-white/10 rounded-xl"
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex-1 space-y-2">
                              <input
                                type="text"
                                value={ep.name}
                                onChange={(e) =>
                                  updateEndpoint(ep.id, { name: e.target.value })
                                }
                                placeholder="Endpoint name"
                                className="w-full px-3 py-2 bg-black/50 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500/50"
                              />
                              <input
                                type="text"
                                value={ep.url}
                                onChange={(e) =>
                                  updateEndpoint(ep.id, { url: e.target.value })
                                }
                                placeholder="http://localhost:11434/v1"
                                className="w-full px-3 py-2 bg-black/50 border border-white/20 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-cyan-500/50"
                              />
                            </div>
                            <button
                              onClick={() => removeEndpoint(ep.id)}
                              className="p-2 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-lg"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === 'editor' && (
                <div className="space-y-6">
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">
                      Font Size: {fontSize}px
                    </label>
                    <input
                      type="range"
                      min="10"
                      max="24"
                      value={fontSize}
                      onChange={(e) => setFontSize(parseInt(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">Tab Size</label>
                    <select
                      value={tabSize}
                      onChange={(e) => setTabSize(parseInt(e.target.value))}
                      className="w-full px-4 py-3 bg-black/50 border border-white/20 rounded-xl text-white focus:outline-none focus:border-cyan-500/50"
                    >
                      <option value={2}>2 spaces</option>
                      <option value={4}>4 spaces</option>
                      <option value={8}>8 spaces</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="wordWrap"
                      checked={wordWrap}
                      onChange={(e) => setWordWrap(e.target.checked)}
                      className="w-4 h-4 rounded border-white/20 bg-black/50 text-cyan-500"
                    />
                    <label htmlFor="wordWrap" className="text-sm text-gray-400">
                      Word Wrap
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/5">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={saveSettings}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-white rounded-lg transition-colors"
            >
              {saved ? (
                <>
                  <Check className="w-4 h-4" />
                  Saved
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save
                </>
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
