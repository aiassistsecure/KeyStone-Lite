// ---------------------------------------------------------------------------
// Typed client for the AiAS Keystone environments API (/api/keystone/*).
// Auth: Bearer aai_ API key. Base URL is configurable via the store
// (`keystoneBaseUrl`) so Lite can point at self-hosted AiAS instances.
// ---------------------------------------------------------------------------

export const DEFAULT_KEYSTONE_BASE_URL = 'https://api.aiassist.net';

export interface KeystoneEnvironment {
  id: string;
  org_id: string;
  user_id: string;
  name: string;
  description: string;
  template_id: string | null;
  status: string;
  llm_provider: string | null;
  llm_model: string | null;
  preview_port: number | null;
  created_at: string;
  updated_at: string;
}

export interface KeystoneTreeNode {
  name: string;
  path: string; // relative to env root; '' for the root itself
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  children?: KeystoneTreeNode[];
}

export interface KeystoneFileRead {
  path: string;
  content: string | null;
  size: number;
  encoding: 'utf-8' | 'binary';
  error?: string;
}

export interface KeystoneRunResult {
  status: string;
  port: number | null;
  pid: number | null;
  command: string;
  preview_url?: string;
}

export interface KeystoneLogsResult {
  logs?: string[] | string;
  [key: string]: unknown;
}

export class KeystoneApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'KeystoneApiError';
    this.status = status;
  }
}

export async function getKeystoneBaseUrl(): Promise<string> {
  try {
    const stored = await window.electron.store.get('keystoneBaseUrl');
    if (stored && typeof stored === 'string' && /^https?:\/\//.test(stored)) {
      return stored.replace(/\/+$/, '');
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_KEYSTONE_BASE_URL;
}

export class KeystoneClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = DEFAULT_KEYSTONE_BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/keystone${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      throw new KeystoneApiError(0, `Network error reaching ${this.baseUrl}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const data = await response.json();
        if (data && typeof data.detail === 'string') detail = data.detail;
      } catch {
        // keep generic detail
      }
      throw new KeystoneApiError(response.status, detail);
    }
    return (await response.json()) as T;
  }

  // -- environments ---------------------------------------------------------

  listEnvironments(): Promise<KeystoneEnvironment[]> {
    return this.request('GET', '/environments');
  }

  getEnvironment(envId: string): Promise<KeystoneEnvironment> {
    return this.request('GET', `/environments/${encodeURIComponent(envId)}`);
  }

  // -- files ----------------------------------------------------------------

  async getFileTree(envId: string): Promise<KeystoneTreeNode> {
    const data = await this.request<{ tree: KeystoneTreeNode }>(
      'GET',
      `/environments/${encodeURIComponent(envId)}/files/tree`
    );
    return data.tree;
  }

  readFile(envId: string, path: string): Promise<KeystoneFileRead> {
    return this.request('GET', `/environments/${encodeURIComponent(envId)}/files/read?path=${encodeURIComponent(path)}`);
  }

  writeFile(envId: string, path: string, content: string): Promise<unknown> {
    return this.request('POST', `/environments/${encodeURIComponent(envId)}/files/write`, { path, content });
  }

  mkdir(envId: string, path: string): Promise<unknown> {
    return this.request('POST', `/environments/${encodeURIComponent(envId)}/files/mkdir`, { path });
  }

  deletePath(envId: string, path: string): Promise<unknown> {
    return this.request('DELETE', `/environments/${encodeURIComponent(envId)}/files/delete?path=${encodeURIComponent(path)}`);
  }

  rename(envId: string, oldPath: string, newPath: string): Promise<unknown> {
    return this.request('POST', `/environments/${encodeURIComponent(envId)}/files/rename`, {
      old_path: oldPath,
      new_path: newPath,
    });
  }

  async getFileHash(envId: string, path: string): Promise<string | null> {
    try {
      const data = await this.request<{ hash: string }>(
        'GET',
        `/environments/${encodeURIComponent(envId)}/files/hash?path=${encodeURIComponent(path)}`
      );
      return data.hash;
    } catch (e) {
      if (e instanceof KeystoneApiError && e.status === 404) return null;
      throw e;
    }
  }

  // -- app process (NOT a terminal — allowlisted app start/stop/logs only) --

  run(envId: string, command: string): Promise<KeystoneRunResult> {
    return this.request('POST', `/environments/${encodeURIComponent(envId)}/run`, { command });
  }

  stop(envId: string): Promise<{ stopped: boolean }> {
    return this.request('POST', `/environments/${encodeURIComponent(envId)}/stop`);
  }

  getLogs(envId: string, lines = 100): Promise<KeystoneLogsResult> {
    return this.request('GET', `/environments/${encodeURIComponent(envId)}/logs?lines=${lines}`);
  }
}
