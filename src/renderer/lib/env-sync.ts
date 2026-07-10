import type { KeystoneClient, KeystoneTreeNode } from './keystone-api';

// ---------------------------------------------------------------------------
// Local checkout + Pull/Push sync for Keystone environments.
//
// A checkout folder carries `{folder}/.keystone/remote-manifest.json`:
//   { envId, baseUrl?, files: { [relPath]: sha256hex } }
// recording the hash of each file AS LAST SYNCED. This is the three-way
// baseline that lets Pull/Push detect true conflicts:
//   Pull conflict: local != manifest AND remote != local  (both sides changed)
//   Push conflict: local != manifest AND remote != manifest (both sides changed)
// Hash algorithm matches the backend: SHA-256 hex of UTF-8 content.
// Deletions are not synced in v1 — only file adds/updates travel.
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['.keystone', '.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', '.next']);

export interface SyncManifest {
  envId: string;
  files: Record<string, string>;
  syncedAt: number;
}

export interface PullResult {
  updated: string[];
  skippedBinary: string[];
  conflicts: string[]; // both sides changed; not overwritten unless force
  unchanged: number;
}

export interface PushResult {
  uploaded: string[];
  skipped: string[]; // unreadable / binary local files
  conflicts: string[]; // remote changed since last sync; not pushed unless force
  unchanged: number;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function joinPath(folder: string, rel: string): string {
  const sep = folder.includes('\\') ? '\\' : '/';
  const base = folder.replace(/[\\/]+$/, '');
  return base + sep + (sep === '\\' ? rel.replace(/\//g, '\\') : rel);
}

function manifestPath(folder: string): string {
  return joinPath(folder, '.keystone/remote-manifest.json');
}

export async function loadManifest(folder: string): Promise<SyncManifest | null> {
  const result = await window.electron.fs.readFile(manifestPath(folder));
  if (!result || result.error || typeof result.content !== 'string') return null;
  try {
    const data = JSON.parse(result.content);
    if (data && typeof data === 'object' && data.files) return data as SyncManifest;
  } catch {
    // corrupted manifest — treat as absent
  }
  return null;
}

async function saveManifest(folder: string, manifest: SyncManifest): Promise<void> {
  await window.electron.fs.createDir(joinPath(folder, '.keystone'));
  const res = await window.electron.fs.writeFile(manifestPath(folder), JSON.stringify(manifest, null, 2));
  if (res.error) throw new Error(`Could not save sync manifest: ${res.error}`);
}

function collectRemoteFiles(root: KeystoneTreeNode): { files: string[]; dirs: string[] } {
  const files: string[] = [];
  const dirs: string[] = [];
  const walk = (node: KeystoneTreeNode) => {
    if (node.type === 'directory') {
      if (node.path) dirs.push(node.path);
      for (const child of node.children || []) walk(child);
    } else if (node.path) {
      files.push(node.path);
    }
  };
  walk(root);
  return { files, dirs };
}

async function readLocal(folder: string, rel: string): Promise<string | null> {
  const res = await window.electron.fs.readFile(joinPath(folder, rel));
  if (!res || res.error || typeof res.content !== 'string') return null;
  return res.content;
}

/**
 * First-time checkout: download every text file into the folder and write the
 * manifest. Existing local files are overwritten (caller should pick an empty
 * or dedicated folder; SetupScreen warns about this).
 */
export async function checkoutEnvironment(
  client: KeystoneClient,
  envId: string,
  folder: string,
  onProgress?: (done: number, total: number, current: string) => void
): Promise<PullResult> {
  const tree = await client.getFileTree(envId);
  const { files, dirs } = collectRemoteFiles(tree);
  const manifest: SyncManifest = { envId, files: {}, syncedAt: Date.now() };
  const result: PullResult = { updated: [], skippedBinary: [], conflicts: [], unchanged: 0 };

  for (const dir of dirs) {
    await window.electron.fs.createDir(joinPath(folder, dir));
  }

  let done = 0;
  for (const rel of files) {
    onProgress?.(done, files.length, rel);
    const remote = await client.readFile(envId, rel);
    done++;
    if (remote.encoding === 'binary' || remote.content === null) {
      result.skippedBinary.push(rel);
      continue;
    }
    const write = await window.electron.fs.writeFile(joinPath(folder, rel), remote.content);
    if (write.error) throw new Error(`Could not write ${rel}: ${write.error}`);
    manifest.files[rel] = await sha256Hex(remote.content);
    result.updated.push(rel);
  }
  onProgress?.(files.length, files.length, 'done');

  await saveManifest(folder, manifest);
  return result;
}

/**
 * Pull remote changes into the checkout. Files where BOTH sides changed are
 * reported as conflicts and left untouched unless `force` (remote wins).
 */
export async function pullEnvironment(
  client: KeystoneClient,
  envId: string,
  folder: string,
  options: { force?: boolean; onProgress?: (done: number, total: number, current: string) => void } = {}
): Promise<PullResult> {
  const manifest = (await loadManifest(folder)) || { envId, files: {}, syncedAt: 0 };
  const tree = await client.getFileTree(envId);
  const { files, dirs } = collectRemoteFiles(tree);
  const result: PullResult = { updated: [], skippedBinary: [], conflicts: [], unchanged: 0 };

  for (const dir of dirs) {
    await window.electron.fs.createDir(joinPath(folder, dir));
  }

  let done = 0;
  for (const rel of files) {
    options.onProgress?.(done, files.length, rel);
    const remote = await client.readFile(envId, rel);
    done++;
    if (remote.encoding === 'binary' || remote.content === null) {
      result.skippedBinary.push(rel);
      continue;
    }
    const remoteHash = await sha256Hex(remote.content);
    const baseHash = manifest.files[rel];
    const localContent = await readLocal(folder, rel);
    const localHash = localContent !== null ? await sha256Hex(localContent) : null;

    if (localHash === remoteHash) {
      manifest.files[rel] = remoteHash;
      result.unchanged++;
      continue;
    }
    const localChanged = localHash !== null && baseHash !== undefined && localHash !== baseHash;
    const isNewLocalFile = localHash !== null && baseHash === undefined;
    if ((localChanged || isNewLocalFile) && !options.force) {
      result.conflicts.push(rel);
      continue;
    }
    const write = await window.electron.fs.writeFile(joinPath(folder, rel), remote.content);
    if (write.error) throw new Error(`Could not write ${rel}: ${write.error}`);
    manifest.files[rel] = remoteHash;
    result.updated.push(rel);
  }
  options.onProgress?.(files.length, files.length, 'done');

  manifest.syncedAt = Date.now();
  await saveManifest(folder, manifest);
  return result;
}

async function walkLocal(folder: string, rel = ''): Promise<string[]> {
  const dirPath = rel ? joinPath(folder, rel) : folder;
  const entries = await window.electron.fs.readDir(dirPath);
  if (!Array.isArray(entries)) return [];
  const out: string[] = [];
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...(await walkLocal(folder, childRel)));
    } else if (entry.isFile) {
      out.push(childRel);
    }
  }
  return out;
}

/**
 * Push local changes to the environment. Files where the remote ALSO changed
 * since last sync are reported as conflicts and skipped unless `force`
 * (local wins).
 */
export async function pushEnvironment(
  client: KeystoneClient,
  envId: string,
  folder: string,
  options: { force?: boolean; onProgress?: (done: number, total: number, current: string) => void } = {}
): Promise<PushResult> {
  const manifest = (await loadManifest(folder)) || { envId, files: {}, syncedAt: 0 };
  const localFiles = await walkLocal(folder);
  const result: PushResult = { uploaded: [], skipped: [], conflicts: [], unchanged: 0 };

  let done = 0;
  for (const rel of localFiles) {
    options.onProgress?.(done, localFiles.length, rel);
    done++;
    const content = await readLocal(folder, rel);
    if (content === null) {
      result.skipped.push(rel);
      continue;
    }
    const localHash = await sha256Hex(content);
    const baseHash = manifest.files[rel];

    if (baseHash === localHash) {
      result.unchanged++;
      continue;
    }

    // Local changed (or is new) — check whether remote moved too.
    const remoteHash = await client.getFileHash(envId, rel);
    if (remoteHash === localHash) {
      manifest.files[rel] = localHash;
      result.unchanged++;
      continue;
    }
    const remoteChanged =
      (baseHash !== undefined && remoteHash !== null && remoteHash !== baseHash) ||
      (baseHash === undefined && remoteHash !== null);
    if (remoteChanged && !options.force) {
      result.conflicts.push(rel);
      continue;
    }
    await client.writeFile(envId, rel, content);
    manifest.files[rel] = localHash;
    result.uploaded.push(rel);
  }
  options.onProgress?.(localFiles.length, localFiles.length, 'done');

  manifest.syncedAt = Date.now();
  await saveManifest(folder, manifest);
  return result;
}
