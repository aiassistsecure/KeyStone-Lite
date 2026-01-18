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
});
