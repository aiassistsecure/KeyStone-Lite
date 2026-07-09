import type { FileEntry, StoreSchema } from '../types/electron';

const STORE_KEY = 'keystone-lite:store';
export const DEMO_ROOT = '/demo/aurora-landing';

interface MemFs {
  files: Map<string, string>;
  dirs: Set<string>;
}

function normalize(p: string): string {
  let out = p.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

function parentOf(p: string): string {
  const n = normalize(p);
  const idx = n.lastIndexOf('/');
  return idx <= 0 ? '/' : n.slice(0, idx);
}

function baseName(p: string): string {
  const n = normalize(p);
  return n.slice(n.lastIndexOf('/') + 1);
}

function ensureDirs(fs: MemFs, dir: string): void {
  let cur = normalize(dir);
  while (cur && cur !== '/' && !fs.dirs.has(cur)) {
    fs.dirs.add(cur);
    cur = parentOf(cur);
  }
  fs.dirs.add('/');
}

function readStore(): Partial<StoreSchema> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStore(data: Partial<StoreSchema>): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('[BrowserBridge] store write failed:', e);
  }
}

export function seedDemoWorkspace(fs: MemFs): void {
  ensureDirs(fs, DEMO_ROOT);
  ensureDirs(fs, `${DEMO_ROOT}/assets`);
  fs.files.set(
    `${DEMO_ROOT}/README.md`,
    `# Aurora Landing\n\nA demo workspace inside Keystone Lite.\n\nThe agent builds a small landing page here so you can watch\nfile writes, terminal activity, and live preview in action.\n\n- \`index.html\` — page markup\n- \`styles.css\` — visual design\n- \`app.js\` — interactions\n`
  );
  fs.files.set(
    `${DEMO_ROOT}/index.html`,
    `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <title>Aurora</title>\n  <link rel="stylesheet" href="styles.css" />\n</head>\n<body>\n  <main class="hero">\n    <h1>Aurora</h1>\n    <p>The landing page the demo agent is about to improve.</p>\n  </main>\n  <script src="app.js"></script>\n</body>\n</html>\n`
  );
  fs.files.set(
    `${DEMO_ROOT}/styles.css`,
    `:root { color-scheme: dark; }\nbody {\n  margin: 0;\n  font-family: system-ui, sans-serif;\n  background: #0b0b12;\n  color: #e6e6f0;\n}\n.hero {\n  min-height: 100vh;\n  display: grid;\n  place-content: center;\n  text-align: center;\n}\n`
  );
  fs.files.set(`${DEMO_ROOT}/app.js`, `console.log('Aurora demo loaded');\n`);
}

export interface MemoryBridgeOptions {
  seed?: boolean;
  label?: string;
}

// ---------------------------------------------------------------------------
// Browser-mode persistent memory — localStorage stand-in for NEDB ENGINE.
// Same IPC envelope shapes as the Electron preload, so lib/memory.ts can
// treat both backends identically. Data survives demo restarts.
// ---------------------------------------------------------------------------
interface LocalMemoryScope {
  colls: Record<string, Record<string, unknown>>;
  links: Array<{ frm: string; rel: string; to: string }>;
}

const MEMORY_PREFIX = 'keystone-lite:memory:';

function readMemScope(scope: string): LocalMemoryScope {
  try {
    const raw = localStorage.getItem(MEMORY_PREFIX + scope);
    if (raw) return JSON.parse(raw);
  } catch {
    // corrupted — start fresh
  }
  return { colls: {}, links: [] };
}

function writeMemScope(scope: string, data: LocalMemoryScope): void {
  try {
    localStorage.setItem(MEMORY_PREFIX + scope, JSON.stringify(data));
  } catch (e) {
    console.warn('[BrowserBridge] memory write failed:', e);
  }
}

export function createLocalMemoryApi() {
  return {
    available: async () => true,
    put: async (scope: string, coll: string, id: string, doc: unknown) => {
      const data = readMemScope(scope);
      data.colls[coll] = data.colls[coll] || {};
      data.colls[coll][id] = doc;
      writeMemScope(scope, data);
      return { doc };
    },
    get: async (scope: string, coll: string, id: string) => {
      const data = readMemScope(scope);
      return { doc: data.colls[coll]?.[id] ?? null };
    },
    delete: async (scope: string, coll: string, id: string) => {
      const data = readMemScope(scope);
      if (data.colls[coll]) {
        delete data.colls[coll][id];
        writeMemScope(scope, data);
      }
      return { success: true };
    },
    list: async (scope: string, coll: string) => {
      const data = readMemScope(scope);
      return { docs: Object.values(data.colls[coll] || {}) };
    },
    query: async (_scope: string, _nql: string) => {
      return { docs: [], error: 'NQL queries need the desktop app (NEDB ENGINE)' };
    },
    link: async (scope: string, frm: string, rel: string, to: string) => {
      const data = readMemScope(scope);
      if (!data.links.some((l) => l.frm === frm && l.rel === rel && l.to === to)) {
        data.links.push({ frm, rel, to });
        writeMemScope(scope, data);
      }
      return { success: true };
    },
    unlink: async (scope: string, frm: string, rel: string, to: string) => {
      const data = readMemScope(scope);
      data.links = data.links.filter((l) => !(l.frm === frm && l.rel === rel && l.to === to));
      writeMemScope(scope, data);
      return { success: true };
    },
    neighbors: async (scope: string, frm: string, rel: string) => {
      const data = readMemScope(scope);
      return { ids: data.links.filter((l) => l.frm === frm && l.rel === rel).map((l) => l.to) };
    },
  };
}

export function createMemoryBridge(options: MemoryBridgeOptions = {}) {
  const memfs: MemFs = { files: new Map(), dirs: new Set(['/']) };
  if (options.seed !== false) seedDemoWorkspace(memfs);

  const dataListeners = new Set<(id: string, chunk: string) => void>();
  const exitListeners = new Set<(id: string, code: number | null) => void>();
  const timers = new Map<string, ReturnType<typeof setTimeout>[]>();

  const emitData = (id: string, chunk: string) => {
    for (const cb of dataListeners) cb(id, chunk);
  };
  const emitExit = (id: string, code: number | null) => {
    for (const cb of exitListeners) cb(id, code);
  };

  const schedule = (id: string, fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    const arr = timers.get(id) || [];
    arr.push(t);
    timers.set(id, arr);
  };

  function listDir(path: string): FileEntry[] {
    const dir = normalize(path);
    const seen = new Map<string, FileEntry>();
    for (const d of memfs.dirs) {
      if (parentOf(d) === dir && d !== dir) {
        seen.set(d, { name: baseName(d), path: d, isDirectory: true, isFile: false });
      }
    }
    for (const f of memfs.files.keys()) {
      if (parentOf(f) === dir) {
        seen.set(f, { name: baseName(f), path: f, isDirectory: false, isFile: true });
      }
    }
    return Array.from(seen.values());
  }

  function runShell(id: string, command: string, cwd: string): void {
    const trimmed = command.trim();
    const [cmd, ...args] = trimmed.split(/\s+/);
    const finish = (code: number | null = 0) => schedule(id, () => emitExit(id, code), 120);
    const out = (text: string, delay = 60) => schedule(id, () => emitData(id, text), delay);

    switch (cmd) {
      case '':
        finish();
        break;
      case 'help':
        out('Demo shell — available commands:\r\n  ls, cat <file>, pwd, echo <text>, date, whoami, help\r\n');
        finish();
        break;
      case 'pwd':
        out(`${cwd}\r\n`);
        finish();
        break;
      case 'ls': {
        const target = args[0] ? normalize(args[0].startsWith('/') ? args[0] : `${cwd}/${args[0]}`) : cwd;
        if (!memfs.dirs.has(target)) {
          out(`ls: ${args[0] || target}: No such directory\r\n`);
          finish(1);
        } else {
          const entries = listDir(target)
            .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
            .map((e) => (e.isDirectory ? `\x1b[36m${e.name}/\x1b[0m` : e.name));
          out(entries.join('  ') + '\r\n');
          finish();
        }
        break;
      }
      case 'cat': {
        if (!args[0]) {
          out('cat: missing file operand\r\n');
          finish(1);
          break;
        }
        const target = normalize(args[0].startsWith('/') ? args[0] : `${cwd}/${args[0]}`);
        const content = memfs.files.get(target);
        if (content === undefined) {
          out(`cat: ${args[0]}: No such file\r\n`);
          finish(1);
        } else {
          out(content.replace(/\n/g, '\r\n') + '\r\n');
          finish();
        }
        break;
      }
      case 'echo':
        out(args.join(' ') + '\r\n');
        finish();
        break;
      case 'date':
        out(new Date().toString() + '\r\n');
        finish();
        break;
      case 'whoami':
        out('demo-agent\r\n');
        finish();
        break;
      default:
        out(`${cmd}: command not available in demo mode (try \x1b[36mhelp\x1b[0m)\r\n`);
        finish(127);
    }
  }

  const bridge = {
    __memoryBridge: true as const,
    store: {
      get: async <K extends keyof StoreSchema>(key: K) => readStore()[key] as StoreSchema[K],
      set: async <K extends keyof StoreSchema>(key: K, value: StoreSchema[K]) => {
        const data = readStore();
        data[key] = value;
        writeStore(data);
        return true;
      },
      getAll: async () => readStore() as StoreSchema,
    },
    fs: {
      readDir: async (path: string) => {
        const dir = normalize(path);
        if (!memfs.dirs.has(dir)) return { error: `Directory not found: ${path}` };
        return listDir(dir);
      },
      readFile: async (path: string) => {
        const content = memfs.files.get(normalize(path));
        if (content === undefined) return { error: `File not found: ${path}` };
        return { content };
      },
      writeFile: async (path: string, content: string) => {
        const p = normalize(path);
        ensureDirs(memfs, parentOf(p));
        memfs.files.set(p, content);
        return { success: true };
      },
      createFile: async (path: string) => {
        const p = normalize(path);
        ensureDirs(memfs, parentOf(p));
        if (!memfs.files.has(p)) memfs.files.set(p, '');
        return { success: true };
      },
      createDir: async (path: string) => {
        ensureDirs(memfs, normalize(path));
        return { success: true };
      },
      delete: async (path: string) => {
        const p = normalize(path);
        if (memfs.files.delete(p)) return { success: true };
        if (memfs.dirs.has(p)) {
          memfs.dirs.delete(p);
          for (const f of Array.from(memfs.files.keys())) {
            if (f.startsWith(p + '/')) memfs.files.delete(f);
          }
          for (const d of Array.from(memfs.dirs)) {
            if (d.startsWith(p + '/')) memfs.dirs.delete(d);
          }
          return { success: true };
        }
        return { error: `Not found: ${path}` };
      },
      rename: async (oldPath: string, newPath: string) => {
        const from = normalize(oldPath);
        const to = normalize(newPath);
        const content = memfs.files.get(from);
        if (content === undefined) return { error: `Not found: ${oldPath}` };
        memfs.files.delete(from);
        ensureDirs(memfs, parentOf(to));
        memfs.files.set(to, content);
        return { success: true };
      },
    },
    dialog: {
      openFolder: async () => DEMO_ROOT,
      openFile: async () => null,
      saveFile: async (defaultPath?: string) => defaultPath || `${DEMO_ROOT}/untitled.txt`,
      newFile: async () => {
        let i = 1;
        while (memfs.files.has(`${DEMO_ROOT}/untitled-${i}.txt`)) i++;
        const p = `${DEMO_ROOT}/untitled-${i}.txt`;
        memfs.files.set(p, '');
        return p;
      },
      selectFolder: async () => {
        let i = 1;
        while (memfs.dirs.has(`/demo/project-${i}`)) i++;
        const p = `/demo/project-${i}`;
        ensureDirs(memfs, p);
        return p;
      },
    },
    templates: {
      list: async () => [
        { id: 'landing-page', name: 'Landing Page', path: '' },
        { id: 'node-api', name: 'Node API Starter', path: '' },
      ],
      create: async (templateId: string, targetPath: string) => {
        const root = normalize(targetPath);
        ensureDirs(memfs, root);
        if (templateId === 'landing-page') {
          memfs.files.set(`${root}/index.html`, '<!doctype html>\n<html><body><h1>New Landing</h1></body></html>\n');
          memfs.files.set(`${root}/styles.css`, 'body { font-family: sans-serif; }\n');
        } else {
          memfs.files.set(`${root}/server.js`, "const http = require('http');\nhttp.createServer((_, res) => res.end('ok')).listen(3000);\n");
          memfs.files.set(`${root}/package.json`, '{\n  "name": "starter",\n  "version": "1.0.0"\n}\n');
        }
        return { success: true, path: root };
      },
    },
    project: {
      setPath: async (projectPath: string) => {
        const data = readStore();
        data.projectPath = projectPath;
        writeStore(data);
        return true;
      },
      getPath: async () => readStore().projectPath ?? null,
    },
    memory: createLocalMemoryApi(),
    terminal: {
      exec: async (id: string, command: string, cwd?: string) => {
        runShell(id, command, normalize(cwd || DEMO_ROOT));
        return { started: true };
      },
      kill: async (id: string) => {
        for (const t of timers.get(id) || []) clearTimeout(t);
        timers.delete(id);
        emitExit(id, null);
        return true;
      },
      onData: (cb: (id: string, chunk: string) => void) => {
        dataListeners.add(cb);
        return () => dataListeners.delete(cb);
      },
      onExit: (cb: (id: string, code: number | null) => void) => {
        exitListeners.add(cb);
        return () => exitListeners.delete(cb);
      },
    },
  };

  return bridge;
}

export type MemoryBridge = ReturnType<typeof createMemoryBridge>;

export function isMemoryBridge(): boolean {
  return Boolean((window.electron as unknown as { __memoryBridge?: boolean })?.__memoryBridge);
}

let realBridge: Window['electron'] | null = null;

export function installBrowserBridgeIfNeeded(): void {
  if (typeof window !== 'undefined' && !window.electron) {
    window.electron = createMemoryBridge() as unknown as Window['electron'];
  }
}

export function swapToMemoryBridge(): void {
  if (!isMemoryBridge()) {
    realBridge = window.electron;
    window.electron = createMemoryBridge() as unknown as Window['electron'];
  }
}

export function restoreRealBridge(): void {
  if (realBridge) {
    window.electron = realBridge;
    realBridge = null;
  }
}
