/**
 * shell-path — make spawned commands see the user's REAL PATH.
 *
 * THE PROBLEM: GUI apps on macOS (Finder/Dock launch) and Linux (desktop
 * launchers) inherit a skeleton PATH — `/usr/bin:/bin:/usr/sbin:/sbin` —
 * not the user's shell PATH. So `npm`, `node`, `python3` installed via
 * nvm/Homebrew/Volta/asdf are invisible to child_process, and the agent's
 * first `npm install` dies with `/bin/sh: npm: command not found` (127).
 *
 * THE FIX (zero configuration, works for every shell + install style):
 *   Layer 1 — augmentPathSync(): instantly append well-known install dirs
 *             that exist on disk (Homebrew, /usr/local, Volta, bun, pnpm,
 *             ~/.local). Synchronous, runs before anything can spawn.
 *   Layer 2 — resolveShellPath(): ask the user's OWN login shell what PATH
 *             it exports (`$SHELL -ilc 'echo $PATH'`) and prepend the
 *             result. Their shell sources their .bash_profile / .zshrc /
 *             fish config / nvm init — whatever they use — so we inherit
 *             exactly what their terminal has, without knowing or caring
 *             which rc file it lives in.
 *
 * Both layers mutate process.env.PATH once at startup; every later
 * child_process/node-pty spawn inherits it via `{ ...process.env }`.
 * Windows is a no-op (GUI apps inherit the user PATH there already).
 * Never throws — on any failure the app keeps the PATH it already had.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const MARKER_START = '__KSL_PATH_START__';
const MARKER_END = '__KSL_PATH_END__';

/** Well-known binary dirs, appended only when they exist on this machine. */
function fallbackDirs(): string[] {
  const home = os.homedir();
  return [
    '/opt/homebrew/bin',        // Homebrew, Apple Silicon
    '/opt/homebrew/sbin',
    '/usr/local/bin',           // Homebrew Intel / classic installs
    '/usr/local/sbin',
    path.join(home, '.volta', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.local', 'share', 'pnpm'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.deno', 'bin'),
    path.join(home, '.cargo', 'bin'),
  ];
}

function mergePath(front: string[], back: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of [...front, ...back]) {
    const d = dir.trim();
    if (d && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out.join(path.delimiter);
}

/**
 * Layer 1 — synchronous, instant: append existing well-known dirs to PATH.
 * Safe to call multiple times (idempotent by dedupe).
 */
export function augmentPathSync(): void {
  if (process.platform === 'win32') return;
  try {
    const current = (process.env.PATH || '').split(path.delimiter);
    const extras = fallbackDirs().filter((d) => {
      try { return fs.existsSync(d); } catch { return false; }
    });
    process.env.PATH = mergePath(current, extras);
  } catch {
    /* keep whatever PATH we had — never break startup */
  }
}

/** Determine the user's login shell, defensively. */
function userShell(): string {
  const fromEnv = process.env.SHELL;
  if (fromEnv && fromEnv.trim()) return fromEnv;
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
}

/**
 * Layer 2 — ask the user's own shell for its PATH via a login+interactive
 * invocation (sources .zprofile/.zshrc/.bash_profile/.bashrc/fish config —
 * wherever nvm/asdf/brew shellenv actually lives). 3s timeout; resolves to
 * the shell's PATH string or null on any failure.
 */
export function resolveShellPath(): Promise<string | null> {
  if (process.platform === 'win32') return Promise.resolve(null);

  const shell = userShell();
  const script = `echo ${MARKER_START}; printf '%s' "$PATH"; echo; echo ${MARKER_END}`;
  // fish rejects combined "-ilc"; bash/zsh accept split flags identically.
  const args = shell.endsWith('fish') ? ['-l', '-c', script] : ['-i', '-l', '-c', script];

  return new Promise((resolve) => {
    let settled = false;
    const done = (v: string | null) => { if (!settled) { settled = true; resolve(v); } };
    try {
      execFile(shell, args, { timeout: 3000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err && !stdout) return done(null);
        const out = String(stdout);
        // rc files can print arbitrary noise — take the LAST marker pair.
        const start = out.lastIndexOf(MARKER_START);
        const end = out.lastIndexOf(MARKER_END);
        if (start === -1 || end === -1 || end <= start) return done(null);
        const inner = out.slice(start + MARKER_START.length, end).trim();
        done(inner.length > 0 ? inner : null);
      });
    } catch {
      done(null);
    }
  });
}

/**
 * Full fix — call once at app startup (before any user-triggered spawn).
 * Layer 1 applies instantly; layer 2 refines PATH as soon as the user's
 * shell answers. Returns after layer 2 settles; never rejects.
 */
export async function fixSpawnPath(): Promise<void> {
  augmentPathSync();
  const before = process.env.PATH || '';
  const shellPath = await resolveShellPath();
  if (shellPath) {
    // Shell's PATH wins ordering (prepend); fallbacks + original keep coverage.
    process.env.PATH = mergePath(shellPath.split(path.delimiter), before.split(path.delimiter));
  }
  if (process.env.PATH !== before) {
    console.log('[shell-path] PATH resolved from login shell:', process.env.PATH);
  } else {
    console.log('[shell-path] PATH unchanged (shell resolution unavailable):', before);
  }
}
