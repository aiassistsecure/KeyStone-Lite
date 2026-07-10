import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Globe, EyeOff, FileCode, Play, Loader2 } from 'lucide-react';
import { subscribe } from '../lib/agent-events';
import { terminals } from '../lib/terminal-sessions';
import { discoverProject, type ProjectProfile } from '../lib/project-discovery';

interface PreviewPanelProps {
  projectPath: string | null;
}

async function buildSrcDoc(projectPath: string): Promise<string | null> {
  const sep = projectPath.includes('\\') ? '\\' : '/';
  const indexPath = `${projectPath}${sep}index.html`;
  const res = await window.electron.fs.readFile(indexPath);
  if (res.error || !res.content) return null;
  let html = res.content;

  const linkRe = /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi;
  for (const match of [...html.matchAll(linkRe)]) {
    const href = match[1];
    if (/^https?:/i.test(href)) continue;
    const css = await window.electron.fs.readFile(`${projectPath}${sep}${href.replace(/^\.\//, '')}`);
    if (!css.error && css.content !== undefined) {
      html = html.replace(match[0], `<style>\n${css.content}\n</style>`);
    }
  }

  const scriptRe = /<script[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi;
  for (const match of [...html.matchAll(scriptRe)]) {
    const src = match[1];
    if (/^https?:/i.test(src)) continue;
    const js = await window.electron.fs.readFile(`${projectPath}${sep}${src.replace(/^\.\//, '')}`);
    if (!js.error && js.content !== undefined) {
      html = html.replace(match[0], `<script>\n${js.content}\n</script>`);
    }
  }

  return html;
}

export function PreviewPanel({ projectPath }: PreviewPanelProps) {
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  // Seed from already-running servers — this panel only mounts while the
  // Preview tab is open, so it usually misses the server_detected event.
  const [liveServers, setLiveServers] = useState<string[]>(() => terminals.getActiveServers());
  const [selectedServer, setSelectedServer] = useState<string | null>(
    () => terminals.getActiveServers().slice(-1)[0] ?? null
  );
  const [showLive, setShowLive] = useState(true);
  const [frameKey, setFrameKey] = useState(0);
  const [profile, setProfile] = useState<ProjectProfile | null>(null);
  const [port, setPort] = useState('');
  const [starting, setStarting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const liveUrl =
    selectedServer && liveServers.includes(selectedServer)
      ? selectedServer
      : liveServers.length > 0
        ? liveServers[liveServers.length - 1]
        : null;
  const showingLive = Boolean(liveUrl && showLive);

  const refresh = useCallback(async () => {
    if (showingLive) {
      setFrameKey((k) => k + 1);
      setLastRefresh(Date.now());
      return;
    }
    if (!projectPath) {
      setSrcDoc(null);
      return;
    }
    setRefreshing(true);
    try {
      const doc = await buildSrcDoc(projectPath);
      setSrcDoc(doc);
      setLastRefresh(Date.now());
    } finally {
      setRefreshing(false);
    }
  }, [projectPath, showingLive]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Identify the project (package.json / Python markers) so we can offer
  // a one-click dev server with the right command and port.
  useEffect(() => {
    let alive = true;
    setProfile(null);
    if (!projectPath) return;
    discoverProject(projectPath).then((p) => {
      if (!alive) return;
      setProfile(p);
      if (p) setPort(String(p.defaultPort));
    });
    return () => {
      alive = false;
    };
  }, [projectPath]);

  // Don't spin forever if the server never announces itself.
  useEffect(() => {
    if (!starting) return;
    const t = setTimeout(() => setStarting(false), 30_000);
    return () => clearTimeout(t);
  }, [starting]);

  const effectivePort = (() => {
    const p = parseInt(port, 10);
    return p > 0 && p <= 65535 ? p : profile?.defaultPort ?? 3000;
  })();

  // Remote environments read files over HTTP, but the terminal is always
  // local — starting a server there would run in the wrong directory.
  const isLocalWorkspace = Boolean(projectPath && !projectPath.startsWith('/env/'));

  const startServer = () => {
    if (!profile || !projectPath || starting) return;
    const t = terminals.create('dev server', projectPath, 'user');
    if (terminals.isBusy(t.id)) {
      setStarting(true);
      return;
    }
    setStarting(true);
    // run() resolves whenever the process exits — success or failure —
    // so any resolution means we're no longer "starting".
    terminals.run(t.id, profile.buildCommand(effectivePort), 'user').then(() => setStarting(false));
  };

  useEffect(() => {
    const unsub = subscribe((e) => {
      if (e.type === 'server_detected') {
        setLiveServers((prev) => (prev.includes(e.url) ? prev : [...prev, e.url]));
        setSelectedServer(e.url);
        setShowLive(true);
        setStarting(false);
        setLastRefresh(Date.now());
      }
      if (e.type === 'server_lost') {
        setLiveServers((prev) => prev.filter((u) => u !== e.url));
        setSelectedServer((cur) => (cur === e.url ? null : cur));
      }
      if ((e.type === 'preview_refresh' || e.type === 'file_write') && !showingLive) {
        // Live dev servers hot-reload on their own; only the static
        // snapshot needs rebuilding on file changes.
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(refresh, 350);
      }
    });
    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [refresh]);

  return (
    <div className="h-full flex flex-col bg-[#07070c]">
      <div className="flex items-center justify-between border-b border-white/10 bg-black/40 px-3 py-1.5 flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-gray-400 min-w-0">
          <Globe className={`w-3.5 h-3.5 flex-shrink-0 ${showingLive ? 'text-green-400' : 'text-cyan-400'}`} />
          <span className="font-mono truncate" data-testid="text-preview-source">
            {showingLive
              ? liveUrl
              : projectPath
                ? `${projectPath.split(/[\\/]/).pop()}/index.html`
                : 'no workspace'}
          </span>
          {showingLive && (
            <span className="rounded-full bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium text-green-400 flex-shrink-0">
              LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {liveServers.length > 1 && showingLive && (
            <select
              value={liveUrl || ''}
              onChange={(e) => setSelectedServer(e.target.value)}
              className="bg-black/60 border border-white/10 rounded text-[10px] text-gray-300 px-1 py-0.5 font-mono"
              data-testid="select-live-server"
            >
              {liveServers.map((u) => (
                <option key={u} value={u}>
                  :{new URL(u).port}
                </option>
              ))}
            </select>
          )}
          {liveUrl && (
            <button
              onClick={() => setShowLive((v) => !v)}
              className={`transition-colors ${showingLive ? 'text-green-400 hover:text-cyan-400' : 'text-gray-500 hover:text-green-400'}`}
              title={showingLive ? 'Show static index.html' : `Show live server (${liveUrl})`}
              data-testid="button-toggle-live"
            >
              <FileCode className="w-3.5 h-3.5" />
            </button>
          )}
          {lastRefresh && (
            <span className="text-gray-600 text-[10px]">
              {new Date(lastRefresh).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={refresh}
            className="text-gray-500 hover:text-cyan-400 transition-colors"
            title="Refresh preview"
            data-testid="button-refresh-preview"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      {profile && !showingLive && isLocalWorkspace && (
        <div className="flex items-center gap-2 border-b border-white/10 bg-black/30 px-3 py-1.5 text-xs flex-shrink-0">
          <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300" data-testid="text-project-type">
            {profile.label}
          </span>
          <span className="text-gray-500">detected</span>
          <span className="text-gray-700">·</span>
          <label className="text-gray-500">port</label>
          <input
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
            className="w-14 bg-black/60 border border-white/10 rounded px-1.5 py-0.5 font-mono text-gray-200 text-xs focus:border-cyan-500/50 focus:outline-none"
            data-testid="input-dev-port"
          />
          <button
            onClick={startServer}
            disabled={starting}
            className="flex items-center gap-1 rounded bg-cyan-500/15 px-2 py-0.5 text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-60 transition-colors"
            data-testid="button-start-dev-server"
          >
            {starting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            {starting ? 'waiting for server…' : 'Start dev server'}
          </button>
          <span className="text-gray-600 text-[10px] font-mono truncate min-w-0" title={profile.buildCommand(effectivePort)}>
            {profile.buildCommand(effectivePort)}
          </span>
        </div>
      )}
      {showingLive && liveUrl ? (
        <iframe
          key={frameKey}
          title="live preview"
          className="flex-1 w-full bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
          src={liveUrl}
          data-testid="iframe-live-preview"
        />
      ) : srcDoc ? (
        <iframe
          title="preview"
          className="flex-1 w-full bg-white"
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          data-testid="iframe-preview"
        />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-600 gap-2">
          <EyeOff className="w-6 h-6" />
          <div className="text-xs">
            No <span className="font-mono text-gray-500">index.html</span> in this workspace yet
          </div>
          {projectPath && !profile && (
            <div className="text-[10px] text-gray-700" data-testid="text-scan-result">
              Scanned for <span className="font-mono">package.json</span> ·{' '}
              <span className="font-mono">manage.py</span> ·{' '}
              <span className="font-mono">requirements.txt</span> — no project type detected
            </div>
          )}
          <div className="text-[10px] text-gray-700">
            Start a dev server in the terminal and the preview will pick it up automatically
          </div>
        </div>
      )}
    </div>
  );
}
