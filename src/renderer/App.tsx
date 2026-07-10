import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SetupScreen, type LaunchIntent } from './pages/SetupScreen';
import { MainLayout } from './pages/MainLayout';
import { DEMO_ROOT, swapToMemoryBridge, restoreRealBridge } from './lib/browser-bridge';
import { swapToRemoteBridge, restoreFromRemoteBridge, envVirtualRoot } from './lib/remote-bridge';
import { KeystoneClient, getKeystoneBaseUrl } from './lib/keystone-api';
import { createSession, createWorkspace, getWorkspace, setActiveSession, touchSession } from './lib/sessions';
import { terminals } from './lib/terminal-sessions';
import type { SessionInfo, WorkspaceInfo } from './types/electron';

interface Launch {
  mode: 'demo' | 'api';
  apiKey: string;
  session: SessionInfo;
  workspace: WorkspaceInfo;
}

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [storedApiKey, setStoredApiKey] = useState('');
  const [launch, setLaunch] = useState<Launch | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const apiKey = await window.electron.store.get('apiKey');
        if (apiKey && apiKey.startsWith('aai_')) setStoredApiKey(apiKey);
      } catch {
        // ignore — setup will ask
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const handleSetupComplete = async (intent: LaunchIntent) => {
    if (intent.mode === 'demo') {
      swapToMemoryBridge();
      const ws = await createWorkspace('Aurora Landing (demo)', DEMO_ROOT);
      const session = await createSession('demo', ws);
      setLaunch({ mode: 'demo', apiKey: intent.apiKey || '', session, workspace: ws });
      return;
    }

    const apiKey = intent.apiKey || storedApiKey;

    // Enter a Keystone environment (remote = live over the API, local = checkout folder).
    if (intent.environment && intent.envMode === 'remote') {
      const client = new KeystoneClient(apiKey, await getKeystoneBaseUrl());
      swapToRemoteBridge(client, intent.environment.id);
      const ws = await createWorkspace(
        `${intent.environment.name} (remote)`,
        envVirtualRoot(intent.environment.id)
      );
      const session = await createSession('api', ws, `Remote — ${intent.environment.name}`, {
        environmentId: intent.environment.id,
        environmentName: intent.environment.name,
        envMode: 'remote',
      });
      setLaunch({ mode: 'api', apiKey, session, workspace: ws });
      return;
    }

    if (intent.environment && intent.envMode === 'local' && intent.checkoutFolder) {
      await window.electron.project.setPath(intent.checkoutFolder);
      const ws = await createWorkspace(intent.environment.name, intent.checkoutFolder);
      const session = await createSession('api', ws, `Local — ${intent.environment.name}`, {
        environmentId: intent.environment.id,
        environmentName: intent.environment.name,
        envMode: 'local',
      });
      setLaunch({ mode: 'api', apiKey, session, workspace: ws });
      return;
    }

    if (intent.session) {
      // Restoring a remote-env session needs the remote bridge back in place.
      if (intent.session.envMode === 'remote' && intent.session.environmentId) {
        const client = new KeystoneClient(apiKey, await getKeystoneBaseUrl());
        swapToRemoteBridge(client, intent.session.environmentId);
        const ws =
          intent.workspace ||
          (await getWorkspace(intent.session.workspaceId)) ||
          (await createWorkspace(
            `${intent.session.environmentName || 'Environment'} (remote)`,
            envVirtualRoot(intent.session.environmentId)
          ));
        await setActiveSession(intent.session.id);
        await touchSession(intent.session.id);
        setLaunch({ mode: 'api', apiKey, session: intent.session, workspace: ws });
        return;
      }
      const ws = intent.workspace || (await getWorkspace(intent.session.workspaceId));
      if (ws) {
        await window.electron.project.setPath(ws.path);
        await setActiveSession(intent.session.id);
        await touchSession(intent.session.id);
        setLaunch({ mode: 'api', apiKey, session: intent.session, workspace: ws });
        return;
      }
    }

    if (intent.workspace) {
      await window.electron.project.setPath(intent.workspace.path);
      const session = await createSession('api', intent.workspace);
      setLaunch({ mode: 'api', apiKey, session, workspace: intent.workspace });
    }
  };

  const handleNewSession = async () => {
    if (!launch) return;
    const old = launch.session;
    // Start a fresh session in the same workspace. The old session (and its
    // full transcript) stays in the session list for review or reattaching.
    const session = await createSession(
      launch.mode,
      launch.workspace,
      old.environmentName
        ? `${old.envMode === 'remote' ? 'Remote' : 'Local'} — ${old.environmentName}`
        : undefined,
      {
        ...(old.environmentId ? { environmentId: old.environmentId } : {}),
        ...(old.environmentName ? { environmentName: old.environmentName } : {}),
        ...(old.envMode ? { envMode: old.envMode } : {}),
      }
    );
    setLaunch({ ...launch, session });
  };

  const handleExitToSetup = () => {
    // Kill any running commands and drop all terminal tabs/buffers so the
    // next session starts clean instead of inheriting old terminals.
    terminals.reset();
    restoreFromRemoteBridge();
    restoreRealBridge();
    setLaunch(null);
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
      {!launch ? (
        <SetupScreen key="setup" onComplete={handleSetupComplete} initialApiKey={storedApiKey} />
      ) : (
        <MainLayout
          key={`main-${launch.session.id}`}
          apiKey={launch.apiKey}
          mode={launch.mode}
          session={launch.session}
          workspace={launch.workspace}
          onExit={handleExitToSetup}
          onNewSession={handleNewSession}
        />
      )}
    </AnimatePresence>
  );
}
