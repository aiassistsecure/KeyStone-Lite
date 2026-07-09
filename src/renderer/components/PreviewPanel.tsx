import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Globe, EyeOff } from 'lucide-react';
import { subscribe } from '../lib/agent-events';

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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
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
  }, [projectPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const unsub = subscribe((e) => {
      if (e.type === 'preview_refresh' || e.type === 'file_write') {
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
          <Globe className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
          <span className="font-mono truncate">
            {projectPath ? `${projectPath.split(/[\\/]/).pop()}/index.html` : 'no workspace'}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
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
      {srcDoc ? (
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
        </div>
      )}
    </div>
  );
}
