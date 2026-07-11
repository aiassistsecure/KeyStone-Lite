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

export interface RuntimeSyncWorkspaceResult {
  synced: boolean;
  workspace: string;
  environment_id: string;
  files_extracted?: number;
  [key: string]: unknown;
}

export interface ShellCommandOptions {
  workspaceRoot: string;
  environmentId: string;
  workingDirectory?: string;
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

  syncWorkspace(sessionId: string, environmentId: string): Promise<RuntimeSyncWorkspaceResult> {
    return this.request('POST', '/sync_workspace', {
      session_id: sessionId,
      environment_id: environmentId,
    });
  }

  runCode(
    sessionId: string,
    language: 'python' | 'node',
    code: string,
    timeoutSeconds?: number,
    environmentId?: string
  ): Promise<RuntimeRunCodeResult> {
    return this.request('POST', '/run_code', {
      session_id: sessionId,
      language,
      code,
      ...(timeoutSeconds ? { timeout_seconds: timeoutSeconds } : {}),
      ...(environmentId ? { environment_id: environmentId } : {}),
    });
  }

  destroySession(sessionId: string): Promise<unknown> {
    return this.request('DELETE', `/sessions/${sessionId}`);
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
  command: string,
  options: ShellCommandOptions
): Promise<RuntimeRunCodeResult> {
  const workingDirectory = options.workingDirectory || '.';
  const code = [
    'import os, signal, subprocess, sys',
    `root = os.path.realpath(${JSON.stringify(options.workspaceRoot)})`,
    `expected_session = ${JSON.stringify(sessionId)}`,
    "if os.path.basename(root) != expected_session or os.path.basename(os.path.dirname(root)) != 'workspaces':",
    "    sys.stderr.write('Runtime returned an invalid workspace root')",
    '    sys.exit(2)',
    'if not os.path.isdir(root):',
    "    sys.stderr.write('Synced runtime workspace is unavailable')",
    '    sys.exit(2)',
    `requested = ${JSON.stringify(workingDirectory)}`,
    'workdir = os.path.realpath(os.path.join(root, requested))',
    "if os.path.commonpath([root, workdir]) != root or not os.path.isdir(workdir):",
    "    sys.stderr.write('Invalid remote working directory')",
    '    sys.exit(2)',
    `p = subprocess.Popen(${JSON.stringify(command)}, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=workdir, start_new_session=True)`,
    'try:',
    `    out, err = p.communicate(timeout=${SHELL_TIMEOUT_SECONDS})`,
    'except subprocess.TimeoutExpired:',
    '    os.killpg(p.pid, signal.SIGKILL)',
    '    out, err = p.communicate()',
    "    sys.stdout.write(out or '')",
    "    sys.stderr.write(err or '')",
    `    sys.stderr.write('\\n[command timed out after ${SHELL_TIMEOUT_SECONDS}s]')`,
    '    sys.exit(124)',
    "sys.stdout.write(out or '')",
    "sys.stderr.write(err or '')",
    'sys.exit(p.returncode or 0)',
  ].join('\n');
  return client.runCode(
    sessionId,
    'python',
    code,
    SHELL_TIMEOUT_SECONDS + 10,
    options.environmentId
  );
}

export interface RemoteTerminalCommandResult extends RuntimeRunCodeResult {
  cwd: string;
}

/**
 * Execute one interactive terminal line inside the remote runtime workspace.
 * A per-call marker captures the shell's final directory so commands such as
 * `cd src` persist for the next line without exposing the host runtime path.
 */
export async function runRemoteTerminalCommand(
  client: RuntimeClient,
  sessionId: string,
  command: string,
  options: ShellCommandOptions
): Promise<RemoteTerminalCommandResult> {
  const workingDirectory = options.workingDirectory || '.';
  const marker = `__KEYSTONE_CWD_${crypto.randomUUID().replace(/-/g, '')}__`;
  const shellCommand = [
    command,
    '__keystone_exit=$?',
    `printf '\\n${marker}%s\\n' "$PWD"`,
    'exit "$__keystone_exit"',
  ].join('\n');
  const result = await runShellCommand(client, sessionId, shellCommand, options);

  let stdout = result.stdout || '';
  let stderr = result.stderr || '';
  let cwd = workingDirectory;
  const markerIndex = stdout.lastIndexOf(marker);
  if (markerIndex >= 0) {
    const beforeMarker = stdout.slice(0, markerIndex).replace(/\n$/, '');
    const absoluteCwd = stdout.slice(markerIndex + marker.length).split(/\r?\n/, 1)[0].trim();
    stdout = beforeMarker;

    const workspaceToken = `/workspaces/${sessionId}`;
    const workspaceIndex = absoluteCwd.indexOf(workspaceToken);
    if (workspaceIndex >= 0) {
      const runtimeWorkspaceRoot = absoluteCwd.slice(0, workspaceIndex + workspaceToken.length);
      stdout = stdout.split(runtimeWorkspaceRoot).join('/workspace');
      stderr = stderr.split(runtimeWorkspaceRoot).join('/workspace');
      const relative = absoluteCwd.slice(workspaceIndex + workspaceToken.length).replace(/^\/+/, '');
      cwd = relative || '.';
    }
  }

  return { ...result, stdout, stderr, cwd };
}
