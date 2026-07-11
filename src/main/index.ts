import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import Store from 'electron-store';
// PATH fix layer 1 — synchronous, before anything can spawn: GUI-launched
// apps get a skeleton PATH (no Homebrew/nvm/Volta), which is why the very
// first `npm install` used to die with "npm: command not found" (127).
augmentPathSync();

// Optional native deps — loaded lazily, everything degrades gracefully.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ptyModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ptyModule = require('node-pty');
} catch {
  ptyModule = null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let NedbCoreCtor: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  NedbCoreCtor = require('nedb-engine').NedbCore;
} catch (e) {
  console.error('[Memory] nedb-engine not available:', (e as Error).message);
}

const store = new Store({
  defaults: {
    apiKey: '',
    defaultProvider: 'groq',
    defaultModel: 'llama-3.3-70b-versatile',
    customEndpoints: [],
    editorTheme: 'dark',
    fontSize: 14,
    tabSize: 2,
    wordWrap: true,
    temperature: 0.7,
    maxTokens: 4096,
    streamResponses: true,
    recentProjects: [],
  },
});

let mainWindow: BrowserWindow | null = null;
let currentProjectPath: string | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function isPathWithinProject(targetPath: string): boolean {
  if (!currentProjectPath) return false;
  const resolvedTarget = path.resolve(targetPath);
  const resolvedProject = path.resolve(currentProjectPath);
  return resolvedTarget.startsWith(resolvedProject + path.sep) || resolvedTarget === resolvedProject;
}

function validateProjectPath(targetPath: string): void {
  if (!isPathWithinProject(targetPath)) {
    throw new Error('Access denied: path is outside project directory');
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'Keystone Lite',
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => { 
  // PATH fix layer 2 — ask the user's own login shell (bash/zsh/fish,
  // whatever they use) for its real PATH and adopt it. Non-blocking;
  // resolves in well under a second on typical setups, long before the
  // first user-triggered command spawn.
  fixSpawnPath().catch(() => { /* never let PATH resolution break startup */ });
  createWindow();

  // Register 'activate' only after the app is ready — on macOS this event
  // can fire during launch (e.g. opening from a DMG), and creating a
  // BrowserWindow before ready crashes with an uncaught exception.
  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers for Settings
ipcMain.handle('store:get', (_, key: string) => {
  return store.get(key);
});

ipcMain.handle('store:set', (_, key: string, value: unknown) => {
  store.set(key, value);
  return true;
});

ipcMain.handle('store:getAll', () => {
  return store.store;
});

// IPC Handlers for File System (scoped to project directory)
ipcMain.handle('fs:readDir', async (_, dirPath: string) => {
  try {
    validateProjectPath(dirPath);
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      path: path.join(dirPath, entry.name),
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }));
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('fs:readFile', async (_, filePath: string) => {
  try {
    validateProjectPath(filePath);
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return { content };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('fs:writeFile', async (_, filePath: string, content: string) => {
  try {
    validateProjectPath(filePath);
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return { success: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('fs:createFile', async (_, filePath: string) => {
  try {
    validateProjectPath(filePath);
    await fs.promises.writeFile(filePath, '', 'utf-8');
    return { success: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('fs:createDir', async (_, dirPath: string) => {
  try {
    validateProjectPath(dirPath);
    await fs.promises.mkdir(dirPath, { recursive: true });
    return { success: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('fs:delete', async (_, targetPath: string) => {
  try {
    validateProjectPath(targetPath);
    const stat = await fs.promises.stat(targetPath);
    if (stat.isDirectory()) {
      await fs.promises.rm(targetPath, { recursive: true });
    } else {
      await fs.promises.unlink(targetPath);
    }
    return { success: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('fs:rename', async (_, oldPath: string, newPath: string) => {
  try {
    validateProjectPath(oldPath);
    validateProjectPath(newPath);
    await fs.promises.rename(oldPath, newPath);
    return { success: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

// Dialog handlers
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
  });
  if (!result.canceled && result.filePaths[0]) {
    currentProjectPath = result.filePaths[0];
  }
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('project:setPath', (_, projectPath: string) => {
  currentProjectPath = projectPath;
  return true;
});

ipcMain.handle('project:getPath', () => {
  return currentProjectPath;
});

ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:saveFile', async (_, defaultPath?: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath,
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('dialog:newFile', async () => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'New File',
    buttonLabel: 'Create',
  });
  if (result.canceled || !result.filePath) return null;
  try {
    await fs.promises.writeFile(result.filePath, '', 'utf-8');
    return result.filePath;
  } catch (error) {
    return { error: (error as Error).message };
  }
});

const getTemplatesDir = () => {
  if (isDev) {
    // In dev, try multiple paths
    const paths = [
      path.join(app.getAppPath(), 'templates'),
      path.join(process.cwd(), 'templates'),
      path.join(__dirname, '../../templates'),
      path.join(__dirname, '../../../templates'),
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        console.log('[Templates] Found at:', p);
        return p;
      }
    }
    console.log('[Templates] Not found in any path:', paths);
    return paths[0];
  }
  return path.join(process.resourcesPath, 'templates');
};

ipcMain.handle('templates:list', async () => {
  const templatesDir = getTemplatesDir();
  try {
    const entries = await fs.promises.readdir(templatesDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => ({
        id: e.name,
        name: e.name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        path: path.join(templatesDir, e.name),
      }));
  } catch (err) {
    console.error('Failed to list templates:', err);
    return [];
  }
});

ipcMain.handle('templates:create', async (_, templateId: string, targetPath: string) => {
  const templatesDir = getTemplatesDir();
  const srcPath = path.join(templatesDir, templateId);
  
  console.log('[Templates] Creating from:', srcPath, 'to:', targetPath);
  
  if (!fs.existsSync(srcPath)) {
    console.error('[Templates] Source path does not exist:', srcPath);
    return { error: `Template "${templateId}" not found at ${srcPath}` };
  }
  
  const copyDir = async (src: string, dest: string) => {
    await fs.promises.mkdir(dest, { recursive: true });
    const entries = await fs.promises.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcEntry = path.join(src, entry.name);
      const destEntry = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcEntry, destEntry);
      } else {
        await fs.promises.copyFile(srcEntry, destEntry);
      }
    }
  };
  
  try {
    await copyDir(srcPath, targetPath);
    console.log('[Templates] Successfully created at:', targetPath);
    return { success: true, path: targetPath };
  } catch (error) {
    console.error('[Templates] Failed to create:', error);
    return { error: (error as Error).message };
  }
});

ipcMain.handle('dialog:selectFolder', async (_, title: string) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title,
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

// ---------------------------------------------------------------------------
// Terminal IPC — spawn-per-command. node-pty when available, child_process
// fallback otherwise. Output is batched (~50ms) before sending to renderer.
// ---------------------------------------------------------------------------
interface RunningProc {
  kill: () => void;
}
const runningProcs = new Map<string, RunningProc>();

function termEnv(): NodeJS.ProcessEnv {
  return { ...process.env, CI: '1', FORCE_COLOR: '0', TERM: 'xterm-256color' };
}

function resolveCwd(cwd?: string): string {
  if (cwd && fs.existsSync(cwd)) return cwd;
  if (currentProjectPath && fs.existsSync(currentProjectPath)) return currentProjectPath;
  return app.getPath('home');
}

ipcMain.handle('terminal:exec', (event, id: string, command: string, cwd?: string) => {
  if (runningProcs.has(id)) return { error: 'Execution id already in use' };
  const wc = event.sender;
  const workDir = resolveCwd(cwd);

  let buf = '';
  let timer: NodeJS.Timeout | null = null;
  const flush = () => {
    timer = null;
    if (buf && !wc.isDestroyed()) {
      wc.send('terminal:data', id, buf);
      buf = '';
    }
  };
  const push = (chunk: string) => {
    buf += chunk;
    if (buf.length > 64_000) flush();
    else if (!timer) timer = setTimeout(flush, 50);
  };
  const finish = (code: number | null) => {
    if (timer) clearTimeout(timer);
    flush();
    runningProcs.delete(id);
    if (!wc.isDestroyed()) wc.send('terminal:exit', id, code);
  };

  const runWithChildProcess = () => {
    const child = spawn(command, {
      shell: true,
      cwd: workDir,
      env: termEnv(),
      windowsHide: true,
      // Own process group on POSIX so killing takes down grandchildren
      // (e.g. a dev server spawned by the shell), not just the shell itself.
      detached: process.platform !== 'win32',
    });
    child.stdout?.on('data', (c: Buffer) => push(c.toString('utf8').replace(/\r?\n/g, '\r\n')));
    child.stderr?.on('data', (c: Buffer) => push(c.toString('utf8').replace(/\r?\n/g, '\r\n')));
    child.on('close', (code) => finish(code));
    child.on('error', (err) => {
      push(`\r\n${err.message}\r\n`);
      finish(1);
    });
    runningProcs.set(id, {
      kill: () => {
        if (process.platform !== 'win32' && child.pid) {
          try {
            process.kill(-child.pid, 'SIGTERM');
            return;
          } catch {
            // Process group already gone or not available — fall through.
          }
        }
        child.kill('SIGTERM');
      },
    });
  };

  try {
    if (ptyModule) {
      try {
        const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
        const args = process.platform === 'win32' ? ['-Command', command] : ['-lc', command];
        const p = ptyModule.spawn(shell, args, {
          name: 'xterm-256color',
          cols: 120,
          rows: 30,
          cwd: workDir,
          env: termEnv(),
        });
        p.onData((data: string) => push(data));
        p.onExit(({ exitCode }: { exitCode: number }) => finish(exitCode));
        runningProcs.set(id, { kill: () => p.kill() });
        return { started: true };
      } catch (ptyError) {
        // node-pty is present but broken (e.g. "posix_spawnp failed" when its
        // spawn-helper binary is unsigned or lost its exec bit in a packaged
        // build). Disable it for the rest of this run and fall back to the
        // plain child_process engine, which needs no native helper.
        console.error('[terminal] node-pty spawn failed, falling back to child_process:', ptyError);
        ptyModule = null;
      }
    }
    runWithChildProcess();
    return { started: true };
  } catch (error) {
    runningProcs.delete(id);
    return { error: (error as Error).message };
  }
});

ipcMain.handle('terminal:kill', (_, id: string) => {
  const proc = runningProcs.get(id);
  if (proc) {
    try {
      proc.kill();
    } catch {
      // already dead
    }
  }
  return true;
});

// ---------------------------------------------------------------------------
// Memory IPC — NEDB ENGINE (content-addressed, versioned embedded DB).
// Scope 'global' → userData/keystone-memory (workspace + session index).
// Scope <workspacePath> → {workspace}/.keystone/memory (history travels
// with the workspace folder).
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const memDbs = new Map<string, any>();

function memoryPathFor(scope: string): string {
  if (scope === 'global') return path.join(app.getPath('userData'), 'keystone-memory');
  return path.join(scope, '.keystone', 'memory');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMemoryDb(scope: string): any {
  const existing = memDbs.get(scope);
  if (existing) return existing;
  if (!NedbCoreCtor) throw new Error('nedb-engine is not installed in this build');
  if (scope !== 'global') {
    if (!path.isAbsolute(scope) || !fs.existsSync(scope)) {
      throw new Error(`Invalid memory scope: ${scope}`);
    }
  }
  const dbPath = memoryPathFor(scope);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = NedbCoreCtor.open(dbPath);
  memDbs.set(scope, db);
  return db;
}

function safeIdent(value: string, label: string): string {
  if (!/^[A-Za-z0-9_:.\-]+$/.test(value)) throw new Error(`Invalid ${label}: ${value}`);
  return value;
}

ipcMain.handle('memory:put', (_, scope: string, coll: string, id: string, doc: unknown) => {
  try {
    const db = getMemoryDb(scope);
    const stored = db.put(safeIdent(coll, 'collection'), safeIdent(id, 'id'), JSON.stringify(doc));
    return { doc: JSON.parse(stored) };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('memory:get', (_, scope: string, coll: string, id: string) => {
  try {
    const db = getMemoryDb(scope);
    const raw = db.get(safeIdent(coll, 'collection'), safeIdent(id, 'id'));
    return { doc: raw ? JSON.parse(raw) : null };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('memory:delete', (_, scope: string, coll: string, id: string) => {
  try {
    getMemoryDb(scope).delete(safeIdent(coll, 'collection'), safeIdent(id, 'id'));
    return { success: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('memory:list', (_, scope: string, coll: string) => {
  try {
    const db = getMemoryDb(scope);
    const rows: string[] = db.query(`FROM ${safeIdent(coll, 'collection')}`);
    return { docs: rows.map((r) => JSON.parse(r)) };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('memory:query', (_, scope: string, nql: string) => {
  try {
    const rows: string[] = getMemoryDb(scope).query(nql);
    return { docs: rows.map((r) => JSON.parse(r)) };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('memory:link', (_, scope: string, frm: string, rel: string, to: string) => {
  try {
    getMemoryDb(scope).link(frm, rel, to);
    return { success: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('memory:unlink', (_, scope: string, frm: string, rel: string, to: string) => {
  try {
    getMemoryDb(scope).unlink(frm, rel, to);
    return { success: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('memory:neighbors', (_, scope: string, frm: string, rel: string) => {
  try {
    return { ids: getMemoryDb(scope).neighbors(frm, rel) };
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('memory:available', () => Boolean(NedbCoreCtor));

app.on('before-quit', () => {
  for (const [scope, db] of memDbs) {
    try {
      db.flush();
    } catch (e) {
      console.error(`[Memory] flush failed for ${scope}:`, e);
    }
  }
  for (const proc of runningProcs.values()) {
    try {
      proc.kill();
    } catch {
      // ignore
    }
  }
});
