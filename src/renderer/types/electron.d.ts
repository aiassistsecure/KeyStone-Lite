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
    };
  }
}

export {};
