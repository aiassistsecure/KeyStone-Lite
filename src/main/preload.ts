import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  // Store operations
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
    getAll: () => ipcRenderer.invoke('store:getAll'),
  },

  // File system operations
  fs: {
    readDir: (path: string) => ipcRenderer.invoke('fs:readDir', path),
    readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
    writeFile: (path: string, content: string) => ipcRenderer.invoke('fs:writeFile', path, content),
    createFile: (path: string) => ipcRenderer.invoke('fs:createFile', path),
    createDir: (path: string) => ipcRenderer.invoke('fs:createDir', path),
    delete: (path: string) => ipcRenderer.invoke('fs:delete', path),
    rename: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
  },

  // Dialog operations
  dialog: {
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
    saveFile: (defaultPath?: string) => ipcRenderer.invoke('dialog:saveFile', defaultPath),
    newFile: () => ipcRenderer.invoke('dialog:newFile'),
    selectFolder: (title: string) => ipcRenderer.invoke('dialog:selectFolder', title),
  },

  // Templates
  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    create: (templateId: string, targetPath: string) => ipcRenderer.invoke('templates:create', templateId, targetPath),
  },

  // Project scope
  project: {
    setPath: (projectPath: string) => ipcRenderer.invoke('project:setPath', projectPath),
    getPath: () => ipcRenderer.invoke('project:getPath'),
  },

  // Terminal (spawn-per-command)
  terminal: {
    exec: (id: string, command: string, cwd?: string) => ipcRenderer.invoke('terminal:exec', id, command, cwd),
    kill: (id: string) => ipcRenderer.invoke('terminal:kill', id),
    onData: (cb: (id: string, chunk: string) => void) => {
      const handler = (_: unknown, id: string, chunk: string) => cb(id, chunk);
      ipcRenderer.on('terminal:data', handler);
      return () => ipcRenderer.removeListener('terminal:data', handler);
    },
    onExit: (cb: (id: string, code: number | null) => void) => {
      const handler = (_: unknown, id: string, code: number | null) => cb(id, code);
      ipcRenderer.on('terminal:exit', handler);
      return () => ipcRenderer.removeListener('terminal:exit', handler);
    },
  },

  // Persistent memory — NEDB ENGINE
  memory: {
    available: () => ipcRenderer.invoke('memory:available'),
    put: (scope: string, coll: string, id: string, doc: unknown) => ipcRenderer.invoke('memory:put', scope, coll, id, doc),
    get: (scope: string, coll: string, id: string) => ipcRenderer.invoke('memory:get', scope, coll, id),
    delete: (scope: string, coll: string, id: string) => ipcRenderer.invoke('memory:delete', scope, coll, id),
    list: (scope: string, coll: string) => ipcRenderer.invoke('memory:list', scope, coll),
    query: (scope: string, nql: string) => ipcRenderer.invoke('memory:query', scope, nql),
    link: (scope: string, frm: string, rel: string, to: string) => ipcRenderer.invoke('memory:link', scope, frm, rel, to),
    unlink: (scope: string, frm: string, rel: string, to: string) => ipcRenderer.invoke('memory:unlink', scope, frm, rel, to),
    neighbors: (scope: string, frm: string, rel: string) => ipcRenderer.invoke('memory:neighbors', scope, frm, rel),
  },
});
