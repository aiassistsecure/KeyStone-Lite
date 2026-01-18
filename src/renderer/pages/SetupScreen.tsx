import { useState } from 'react';
import { motion } from 'framer-motion';
import { Key, ExternalLink, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface SetupScreenProps {
  onComplete: (apiKey: string) => void;
}

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const [apiKey, setApiKey] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState('');
  const [rememberKey, setRememberKey] = useState(true);

  const validateAndSave = async () => {
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
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error('Invalid API key');
      }

      if (rememberKey) {
        await window.electron.store.set('apiKey', apiKey);
      }

      onComplete(apiKey);
    } catch {
      setError('Could not validate API key. Please check and try again.');
    } finally {
      setIsValidating(false);
    }
  };

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
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
            }}
            animate={{
              opacity: [0.2, 0.8, 0.2],
              scale: [1, 1.5, 1],
            }}
            transition={{
              duration: 2 + Math.random() * 2,
              repeat: Infinity,
              delay: Math.random() * 2,
            }}
          />
        ))}
      </div>

      <motion.div
        className="relative z-10 w-full max-w-md mx-4"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8">
          <div className="text-center mb-8">
            <motion.div
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 mb-4"
              animate={{ boxShadow: ['0 0 20px rgba(0,212,255,0.3)', '0 0 40px rgba(0,212,255,0.1)', '0 0 20px rgba(0,212,255,0.3)'] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Key className="w-8 h-8 text-cyan-400" />
            </motion.div>
            <h1 className="text-2xl font-bold text-white mb-2">Welcome to Keystone Lite</h1>
            <p className="text-gray-400 text-sm">Enter your AiAS API key to get started</p>
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
                onKeyDown={(e) => e.key === 'Enter' && validateAndSave()}
              />
            </div>

            {error && (
              <motion.div
                className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
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
              onClick={validateAndSave}
              disabled={isValidating || !apiKey.trim()}
              className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 disabled:from-gray-600 disabled:to-gray-600 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
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

        <p className="text-center text-gray-600 text-xs mt-4">
          Powered by AiAS • Multi-model AI orchestration
        </p>
      </motion.div>
    </motion.div>
  );
}
