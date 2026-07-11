// ---------------------------------------------------------------------------
// Typed client for the AiAS platform runtime API (/api/runtime/*).
// Used in remote-environment mode to run approved agent commands inside a
// sandboxed runtime session that is scoped to the Keystone environment.
// Auth: Bearer aai_ API key (same key as the Keystone client).
// ---------------------------------------------------------------------------

export class RuntimeApiError extends Error {
  status: number;
  friendly: string;
  constructor(status: number, message: string, friendly: string) {
    super(message);
    this.name = 'RuntimeApiError';
    this.status = status;
    this.friendly = friendly;
  }
}

function friendlyFor(status: number, detail: string): string {
  if (status === 503) {
    return 'The platform runtime is not available right now (it may be offline or not configured for this server). You can still edit files, and use start_app/get_logs for the app process.';
  }
  if (status === 403) {
    return 'Your AiAS plan does not include runtime access (Pro or higher is required). You can still edit files, and use start_app/get_logs for the app process.';
  }
  if (status === 401) {
    return 'The runtime rejected your API key. Check the key in Settings.';
  }
  if (status === 429) {
    return 'The runtime is at capacity right now. Wait a moment and try again.';
  }
  if (status === 0) {
    return `Could not reach the runtime server: ${detail}`;
  }
  return detail;
}

export interface RuntimeRunCodeResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  [key: string]: unknown;
}

export class RuntimeClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/runtime${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new RuntimeApiError(0, msg, friendlyFor(0, msg));
    }
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const data = await response.json();
        if (data && typeof data.detail === 'string') detail = data.detail;
      } catch {
        // keep generic detail
      }
      throw new RuntimeApiError(response.status, detail, friendlyFor(response.status, detail));
    }
    return (await response.json()) as T;
  }

  createSession(environmentId: string): Promise<{ session_id: string }> {
    // Raise the per-execution cap above the shell wrapper's inner timeout so
    // long builds/installs hit the friendly exit-124 path instead of a 500.
    return this.request('POST', '/sessions', {
      environment_id: environmentId,
      policy: { max_execution_seconds: SHELL_TIMEOUT_SECONDS + 10 },
    });
  }

  syncWorkspace(sessionId: string, environmentId: string): Promise<unknown> {
    return this.request('POST', '/sync_workspace', {
      session_id: sessionId,
      environment_id: environmentId,
    });
  }

  runCode(
    sessionId: string,
    language: 'python' | 'node',
    code: string,
    timeoutSeconds?: number
  ): Promise<RuntimeRunCodeResult> {
    return this.request('POST', '/run_code', {
      session_id: sessionId,
      language,
      code,
      ...(timeoutSeconds ? { timeout_seconds: timeoutSeconds } : {}),
    });
  }
}

const SHELL_TIMEOUT_SECONDS = 55;

/**
 * Run a shell command inside the runtime session via a python wrapper.
 * The command string is embedded as a JSON string literal, which is also a
 * valid Python string literal, so no manual escaping is needed.
 */
export function runShellCommand(
  client: RuntimeClient,
  sessionId: string,
  command: string
): Promise<RuntimeRunCodeResult> {
  const code = [
    'import subprocess, sys',
    'try:',
    `    p = subprocess.run(${JSON.stringify(command)}, shell=True, capture_output=True, text=True, timeout=${SHELL_TIMEOUT_SECONDS})`,
    'except subprocess.TimeoutExpired as e:',
    "    out = e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or '')",
    '    sys.stdout.write(out)',
    `    sys.stderr.write('\\n[command timed out after ${SHELL_TIMEOUT_SECONDS}s]')`,
    '    sys.exit(124)',
    "sys.stdout.write(p.stdout or '')",
    "sys.stderr.write(p.stderr or '')",
    'sys.exit(p.returncode)',
  ].join('\n');
  return client.runCode(sessionId, 'python', code, SHELL_TIMEOUT_SECONDS + 10);
}
