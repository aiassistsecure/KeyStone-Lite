import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SetupScreen } from './pages/SetupScreen';
import { MainLayout } from './pages/MainLayout';

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [sessionApiKey, setSessionApiKey] = useState<string | null>(null);

  useEffect(() => {
    checkApiKey();
  }, []);

  const checkApiKey = async () => {
    try {
      const apiKey = await window.electron.store.get('apiKey');
      if (apiKey && apiKey.startsWith('aai_')) {
        setHasApiKey(true);
        setSessionApiKey(apiKey);
      }
    } catch {
      setHasApiKey(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApiKeySet = (apiKey: string) => {
    setSessionApiKey(apiKey);
    setHasApiKey(true);
  };

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0a0a0f]">
        <motion.div
          className="w-12 h-12 border-2 border-cyan-500 border-t-transparent rounded-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        />
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {!hasApiKey ? (
        <SetupScreen key="setup" onComplete={handleApiKeySet} />
      ) : (
        <MainLayout key="main" apiKey={sessionApiKey!} />
      )}
    </AnimatePresence>
  );
}
