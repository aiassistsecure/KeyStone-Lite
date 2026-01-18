import { useState, useEffect } from 'react';
import { ChevronDown, Check, Circle, Loader2, RefreshCw } from 'lucide-react';

interface ProviderModel {
  id: string;
  name: string;
  context_window?: number;
  max_output?: number;
}

interface ProviderGroup {
  id: string;
  name: string;
  is_default: boolean;
  models: ProviderModel[];
}

interface ProvidersResponse {
  default_provider: string;
  providers: ProviderGroup[];
  fallback_chain: string[];
}

interface ModelSelectorProps {
  apiKey: string;
}

export function ModelSelector({ apiKey }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderGroup[]>([]);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    loadSettings();
    fetchProviders();
  }, [apiKey]);

  const loadSettings = async () => {
    const savedProvider = await window.electron.store.get('defaultProvider');
    const savedModel = await window.electron.store.get('defaultModel');
    if (savedProvider) setProvider(savedProvider);
    if (savedModel) setModel(savedModel);
  };

  const fetchProviders = async () => {
    if (!apiKey) return;
    
    setIsLoading(true);
    try {
      const response = await fetch('https://api.aiassist.net/v1/providers', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        setIsOnline(false);
        return;
      }

      const data: ProvidersResponse = await response.json();
      
      const sortedProviders = [...data.providers].sort((a, b) => {
        if (a.is_default) return -1;
        if (b.is_default) return 1;
        return 0;
      });

      setProviders(sortedProviders);
      setIsOnline(true);

      if (!model && sortedProviders.length > 0 && sortedProviders[0].models.length > 0) {
        const defaultProv = sortedProviders.find(p => p.is_default) || sortedProviders[0];
        setProvider(defaultProv.id);
        setModel(defaultProv.models[0].id);
        await window.electron.store.set('defaultProvider', defaultProv.id);
        await window.electron.store.set('defaultModel', defaultProv.models[0].id);
      }
    } catch {
      setIsOnline(false);
    } finally {
      setIsLoading(false);
    }
  };

  const selectModel = async (providerId: string, modelId: string) => {
    setProvider(providerId);
    setModel(modelId);
    await window.electron.store.set('defaultProvider', providerId);
    await window.electron.store.set('defaultModel', modelId);
    setIsOpen(false);
  };

  const currentProvider = providers.find((p) => p.id === provider);
  const currentModel = currentProvider?.models.find((m) => m.id === model);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs transition-colors"
      >
        {isLoading ? (
          <Loader2 className="w-3 h-3 text-gray-400 animate-spin" />
        ) : (
          <Circle
            className={`w-2 h-2 ${isOnline ? 'fill-green-400 text-green-400' : 'fill-red-400 text-red-400'}`}
          />
        )}
        <span className="text-gray-400">{currentProvider?.name || 'Select'}</span>
        <span className="text-white">{currentModel?.name || model || 'Model'}</span>
        <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 w-64 bg-[#1a1a24] border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden">
            <div className="p-2 border-b border-white/5 flex items-center justify-between">
              <span className="text-xs text-gray-500 px-2">Select Model</span>
              <button
                onClick={(e) => { e.stopPropagation(); fetchProviders(); }}
                className="p-1 hover:bg-white/10 rounded transition-colors"
                title="Refresh models"
              >
                <RefreshCw className={`w-3 h-3 text-gray-500 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />
                </div>
              ) : providers.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  No models available
                </div>
              ) : (
                providers.map((p) => (
                  <div key={p.id}>
                    <div className="px-3 py-1.5 bg-white/5 text-xs text-gray-500 font-medium">
                      {p.name}
                    </div>
                    {p.models.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => selectModel(p.id, m.id)}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 text-left"
                      >
                        <span className="text-sm text-white truncate">{m.name}</span>
                        {model === m.id && (
                          <Check className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
