export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
}

export interface FileReadResult {
  content?: string;
  error?: string;
}

export interface FileWriteResult {
  success?: boolean;
  error?: string;
}

export interface CustomEndpoint {
  id: string;
  name: string;
  url: string;
  apiKey?: string;
  models: string[];
  isOnline: boolean;
}

export interface Template {
  id: string;
  name: string;
  path: string;
}

export interface TemplateCreateResult {
  success?: boolean;
  path?: string;
  error?: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

export interface SessionInfo {
  id: string;
  name: string;
  workspaceId: string;
  workspacePath?: string;
  mode: 'demo' | 'api';
  createdAt: number;
  lastActiveAt: number;
  summary?: string;
  messageCount?: number;
}

export interface MemoryDocResult<T = unknown> {
  doc?: T | null;
  error?: string;
}

export interface MemoryListResult<T = unknown> {
  docs?: T[];
  error?: string;
}

export interface MemoryOpResult {
  success?: boolean;
  error?: string;
}

export interface MemoryNeighborsResult {
  ids?: string[];
  error?: string;
}

export interface TerminalExecResult {
  started?: boolean;
  error?: string;
}

export interface StoreSchema {
  apiKey: string;
  defaultProvider: string;
  defaultModel: string;
  customEndpoints: CustomEndpoint[];
  editorTheme: string;
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  temperature: number;
  maxTokens: number;
  streamResponses: boolean;
  recentProjects: string[];
  projectPath: string;
  workspaces: WorkspaceInfo[];
  sessions: SessionInfo[];
  activeSessionId: string;
}

declare global {
  interface Window {
    electron: {
      store: {
        get: <K extends keyof StoreSchema>(key: K) => Promise<StoreSchema[K]>;
        set: <K extends keyof StoreSchema>(key: K, value: StoreSchema[K]) => Promise<boolean>;
        getAll: () => Promise<StoreSchema>;
      };
      fs: {
        readDir: (path: string) => Promise<FileEntry[] | { error: string }>;
        readFile: (path: string) => Promise<FileReadResult>;
        writeFile: (path: string, content: string) => Promise<FileWriteResult>;
        createFile: (path: string) => Promise<FileWriteResult>;
        createDir: (path: string) => Promise<FileWriteResult>;
        delete: (path: string) => Promise<FileWriteResult>;
        rename: (oldPath: string, newPath: string) => Promise<FileWriteResult>;
      };
      dialog: {
        openFolder: () => Promise<string | null>;
        openFile: () => Promise<string | null>;
        saveFile: (defaultPath?: string) => Promise<string | null>;
        newFile: () => Promise<string | null>;
        selectFolder: (title: string) => Promise<string | null>;
      };
      templates: {
        list: () => Promise<Template[]>;
        create: (templateId: string, targetPath: string) => Promise<TemplateCreateResult>;
      };
      project: {
        setPath: (projectPath: string) => Promise<boolean>;
        getPath: () => Promise<string | null>;
      };
      terminal?: {
        exec: (id: string, command: string, cwd?: string) => Promise<TerminalExecResult>;
        kill: (id: string) => Promise<boolean>;
        onData: (cb: (id: string, chunk: string) => void) => () => void;
        onExit: (cb: (id: string, code: number | null) => void) => () => void;
      };
      memory?: {
        available: () => Promise<boolean>;
        put: (scope: string, coll: string, id: string, doc: unknown) => Promise<MemoryDocResult>;
        get: (scope: string, coll: string, id: string) => Promise<MemoryDocResult>;
        delete: (scope: string, coll: string, id: string) => Promise<MemoryOpResult>;
        list: (scope: string, coll: string) => Promise<MemoryListResult>;
        query: (scope: string, nql: string) => Promise<MemoryListResult>;
        link: (scope: string, frm: string, rel: string, to: string) => Promise<MemoryOpResult>;
        unlink: (scope: string, frm: string, rel: string, to: string) => Promise<MemoryOpResult>;
        neighbors: (scope: string, frm: string, rel: string) => Promise<MemoryNeighborsResult>;
      };
    };
  }
}

export {};
