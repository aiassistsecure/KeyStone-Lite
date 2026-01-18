import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import Store from 'electron-store';

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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
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
