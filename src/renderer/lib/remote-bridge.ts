import type { FileEntry } from '../types/electron';
import { KeystoneApiError, KeystoneClient, type KeystoneTreeNode } from './keystone-api';

// ---------------------------------------------------------------------------
// Remote bridge — swaps window.electron.fs to proxy a Keystone environment
// over the /api/keystone files API. Everything else (store, memory, terminal,
// templates) stays on the prior bridge: the terminal is ALWAYS local.
//
// Virtual root: /env/{envId} — MainLayout/FileExplorer see normal absolute
// paths and need zero changes. HTTP errors map to the same { error } shapes
// the local fs bridge returns.
// ---------------------------------------------------------------------------

export function envVirtualRoot(envId: string): string {
  return `/env/${envId}`;
}

interface TreeCache {
  dirs: Set<string>; // relative dir paths ('' = root)
  files: Map<string, KeystoneTreeNode>; // relative file path -> node
}

function flattenTree(root: KeystoneTreeNode): TreeCache {
  const cache: TreeCache = { dirs: new Set(['']), files: new Map() };
  const walk = (node: KeystoneTreeNode) => {
    if (node.type === 'directory') {
      cache.dirs.add(node.path || '');
      for (const child of node.children || []) walk(child);
    } else {
      cache.files.set(node.path, node);
    }
  };
  walk(root);
  return cache;
}

function relParent(rel: string): string {
  const idx = rel.lastIndexOf('/');
  return idx === -1 ? '' : rel.slice(0, idx);
}

function relBase(rel: string): string {
  const idx = rel.lastIndexOf('/');
  return idx === -1 ? rel : rel.slice(idx + 1);
}

function errMessage(e: unknown): string {
  if (e instanceof KeystoneApiError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

export function createRemoteFs(client: KeystoneClient, envId: string) {
  const root = envVirtualRoot(envId);
  let cache: TreeCache | null = null;
  let dirty = true;

  const toRel = (path: string): string | null => {
    const norm = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '') || '/';
    if (norm === root) return '';
    if (norm.startsWith(root + '/')) return norm.slice(root.length + 1);
    return null;
  };

  const ensureCache = async (): Promise<TreeCache> => {
    if (!cache || dirty) {
      const tree = await client.getFileTree(envId);
      cache = flattenTree(tree);
      dirty = false;
    }
    return cache;
  };

  const invalidate = () => {
    dirty = true;
  };

  return {
    invalidate,
    fs: {
      readDir: async (path: string): Promise<FileEntry[] | { error: string }> => {
        const rel = toRel(path);
        if (rel === null) return { error: `Path outside environment: ${path}` };
        try {
          const c = await ensureCache();
          if (!c.dirs.has(rel)) return { error: `Directory not found: ${path}` };
          const entries: FileEntry[] = [];
          for (const d of c.dirs) {
            if (d !== '' && relParent(d) === rel && d !== rel) {
              entries.push({ name: relBase(d), path: `${root}/${d}`, isDirectory: true, isFile: false });
            }
          }
          for (const [f] of c.files) {
            if (relParent(f) === rel) {
              entries.push({ name: relBase(f), path: `${root}/${f}`, isDirectory: false, isFile: true });
            }
          }
          return entries;
        } catch (e) {
          return { error: errMessage(e) };
        }
      },
      readFile: async (path: string) => {
        const rel = toRel(path);
        if (rel === null || rel === '') return { error: `Not a file: ${path}` };
        try {
          const result = await client.readFile(envId, rel);
          if (result.encoding === 'binary' || result.content === null) {
            return { error: result.error || 'Binary file cannot be read as text' };
          }
          return { content: result.content };
        } catch (e) {
          return { error: errMessage(e) };
        }
      },
      writeFile: async (path: string, content: string) => {
        const rel = toRel(path);
        if (rel === null || rel === '') return { error: `Not a file: ${path}` };
        try {
          await client.writeFile(envId, rel, content);
          if (cache && !cache.files.has(rel)) invalidate();
          return { success: true };
        } catch (e) {
          return { error: errMessage(e) };
        }
      },
      createFile: async (path: string) => {
        const rel = toRel(path);
        if (rel === null || rel === '') return { error: `Not a file: ${path}` };
        try {
          await client.writeFile(envId, rel, '');
          invalidate();
          return { success: true };
        } catch (e) {
          return { error: errMessage(e) };
        }
      },
      createDir: async (path: string) => {
        const rel = toRel(path);
        if (rel === null || rel === '') return { error: `Invalid directory: ${path}` };
        try {
          await client.mkdir(envId, rel);
          invalidate();
          return { success: true };
        } catch (e) {
          return { error: errMessage(e) };
        }
      },
      delete: async (path: string) => {
        const rel = toRel(path);
        if (rel === null || rel === '') return { error: `Cannot delete: ${path}` };
        try {
          await client.deletePath(envId, rel);
          invalidate();
          return { success: true };
        } catch (e) {
          return { error: errMessage(e) };
        }
      },
      rename: async (oldPath: string, newPath: string) => {
        const relOld = toRel(oldPath);
        const relNew = toRel(newPath);
        if (relOld === null || relNew === null || relOld === '' || relNew === '') {
          return { error: `Invalid rename: ${oldPath} -> ${newPath}` };
        }
        try {
          await client.rename(envId, relOld, relNew);
          invalidate();
          return { success: true };
        } catch (e) {
          return { error: errMessage(e) };
        }
      },
    },
  };
}

let priorBridge: Window['electron'] | null = null;
let activeInvalidate: (() => void) | null = null;

export function isRemoteBridge(): boolean {
  return Boolean((window.electron as unknown as { __remoteBridge?: boolean })?.__remoteBridge);
}

/** Force the remote fs to refetch the environment tree on next readDir. */
export function invalidateRemoteTree(): void {
  activeInvalidate?.();
}

export function swapToRemoteBridge(client: KeystoneClient, envId: string): void {
  if (isRemoteBridge()) restoreFromRemoteBridge();
  const prior = window.electron;
  priorBridge = prior;
  const remote = createRemoteFs(client, envId);
  activeInvalidate = remote.invalidate;

  const bridge = {
    ...prior,
    __remoteBridge: true as const,
    fs: remote.fs,
    // Folder/file pickers do not apply inside a remote environment.
    dialog: {
      ...prior.dialog,
      openFolder: async () => null,
      openFile: async () => null,
      selectFolder: async () => null,
      newFile: async () => {
        const c = client;
        for (let i = 1; i < 100; i++) {
          const rel = `untitled-${i}.txt`;
          try {
            const existing = await c.getFileHash(envId, rel);
            if (existing === null) {
              await c.writeFile(envId, rel, '');
              remote.invalidate();
              return `${envVirtualRoot(envId)}/${rel}`;
            }
          } catch {
            return null;
          }
        }
        return null;
      },
    },
    // Terminal, store, memory, templates, project stay on the prior bridge —
    // the terminal is always the user's local one.
  } as unknown as Window['electron'];

  window.electron = bridge;
}

export function restoreFromRemoteBridge(): void {
  if (priorBridge) {
    window.electron = priorBridge;
    priorBridge = null;
    activeInvalidate = null;
  }
}
